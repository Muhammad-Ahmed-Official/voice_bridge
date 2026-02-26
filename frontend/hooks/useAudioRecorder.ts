import { useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystemLegacy from 'expo-file-system/legacy';

const CYCLE_MS = 4000; // record 4-second chunks, send each to Google STT

export function useAudioRecorder() {
  const activeRef = useRef(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = useCallback(
    (
      onChunk: (audioBase64: string, mimeType: string) => void,
      onDenied?: () => void,
    ) => {
      if (Platform.OS === 'web') {
        startWebRecording(onChunk, onDenied);
      } else {
        startNativeRecording(onChunk, onDenied);
      }
    },
    [],
  );

  async function startNativeRecording(
    onChunk: (audioBase64: string, mimeType: string) => void,
    onDenied?: () => void,
  ) {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        console.warn('[AudioRecorder] Permission denied');
        onDenied?.();
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      activeRef.current = true;
      console.log('[AudioRecorder] Native recording started');
      runNativeCycle(onChunk);
    } catch (err: any) {
      console.error('[AudioRecorder] Native start error:', err);
      onDenied?.();
    }
  }

  async function runNativeCycle(onChunk: (audioBase64: string, mimeType: string) => void) {
    if (!activeRef.current) return;

    try {
      const recording = new Audio.Recording();
      // Android: Use AMR_WB which Google STT supports
      // iOS: Use LINEAR PCM which Google STT supports
      await recording.prepareToRecordAsync({
        android: {
          extension: '.amr',
          outputFormat: Audio.AndroidOutputFormat.AMR_WB,
          audioEncoder: Audio.AndroidAudioEncoder.AMR_WB,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 23850,
        },
        ios: {
          extension: '.wav',
          outputFormat: Audio.IOSOutputFormat.LINEARPCM,
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 256000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {},
      });

      recordingRef.current = recording;
      await recording.startAsync();

      setTimeout(async () => {
        if (!activeRef.current) return;

        try {
          await recording.stopAndUnloadAsync();
          const uri = recording.getURI();
          
          if (uri) {
            // Use legacy API for expo-file-system SDK 54+
            const base64 = await FileSystemLegacy.readAsStringAsync(uri, {
              encoding: FileSystemLegacy.EncodingType.Base64,
            });
            
            console.log('[AudioRecorder] Native chunk ready, size:', base64.length);
            // Android uses AMR_WB, iOS uses LINEAR16
            const mimeType = Platform.OS === 'android' ? 'audio/amr-wb' : 'audio/l16;rate=16000';
            onChunk(base64, mimeType);
            
            await FileSystemLegacy.deleteAsync(uri, { idempotent: true });
          }

          runNativeCycle(onChunk);
        } catch (err) {
          console.error('[AudioRecorder] Native cycle error:', err);
          runNativeCycle(onChunk);
        }
      }, CYCLE_MS);
    } catch (err) {
      console.error('[AudioRecorder] Native recording error:', err);
    }
  }

  function startWebRecording(
    onChunk: (audioBase64: string, mimeType: string) => void,
    onDenied?: () => void,
  ) {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return;

    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((stream) => {
        streamRef.current = stream;
        activeRef.current = true;

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
            ? 'audio/ogg;codecs=opus'
            : 'audio/webm';

        console.log('[AudioRecorder] Web recording started, mimeType:', mimeType);
        runWebCycle(stream, mimeType, onChunk);
      })
      .catch((err) => {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          onDenied?.();
        } else {
          console.error('[AudioRecorder] Web getUserMedia error:', err);
        }
      });
  }

  function runWebCycle(
    stream: MediaStream,
    mimeType: string,
    onChunk: (audioBase64: string, mimeType: string) => void,
  ) {
    if (!activeRef.current || !streamRef.current) return;

    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      if (!activeRef.current) return;
      if (chunks.length === 0) {
        runWebCycle(stream, mimeType, onChunk);
        return;
      }

      const blob = new Blob(chunks, { type: mimeType });
      const reader = new FileReader();
      reader.onloadend = () => {
        const b64 = (reader.result as string).split(',')[1];
        if (b64) onChunk(b64, mimeType);
        runWebCycle(stream, mimeType, onChunk);
      };
      reader.readAsDataURL(blob);
    };

    recorder.start();
    setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, CYCLE_MS);
  }

  const stopRecording = useCallback(async () => {
    activeRef.current = false;

    if (Platform.OS === 'web') {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    } else {
      if (recordingRef.current) {
        try {
          await recordingRef.current.stopAndUnloadAsync();
        } catch {}
        recordingRef.current = null;
      }
    }
    
    console.log('[AudioRecorder] Stopped');
  }, []);

  return { startRecording, stopRecording };
}
