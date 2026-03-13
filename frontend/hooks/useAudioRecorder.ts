import { useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import {
  Audio,
  AudioModule,
  InterruptionModeAndroid,
  InterruptionModeIOS,
  RecordingPresets,
  useAudioRecorder as useExpoAudioRecorder,
} from 'expo-audio';
import * as FileSystemLegacy from 'expo-file-system/legacy';

const CYCLE_MS = 4000; // record 4-second chunks, send each to Google STT

export function useAudioRecorder() {
  const activeRef = useRef(false);
  const recorder = useExpoAudioRecorder(RecordingPresets.HIGH_QUALITY);
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
      // Guard: expo-audio is not available in Expo Go
      if (!AudioModule || typeof AudioModule.requestRecordingPermissionsAsync !== 'function' || !Audio || typeof Audio.setAudioModeAsync !== 'function') {
        console.warn('[AudioRecorder] expo-audio not available on this platform; skipping native recording');
        onDenied?.();
        return;
      }

      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        console.warn('[AudioRecorder] Permission denied');
        onDenied?.();
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: true,
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
      await recorder.prepareToRecordAsync();
      await recorder.record();

      setTimeout(async () => {
        if (!activeRef.current) return;

        try {
          await recorder.stop();
          const status = await recorder.getStatusAsync();
          const uri = status?.uri;
          
          if (uri) {
            // Use legacy API for expo-file-system SDK 54+
            const base64 = await FileSystemLegacy.readAsStringAsync(uri, {
              encoding: FileSystemLegacy.EncodingType.Base64,
            });
            
            console.log('[AudioRecorder] Native chunk ready, size:', base64.length);
            // RecordingPresets.HIGH_QUALITY defaults to AAC/linear formats; backend must accept these mime types
            const mimeType = Platform.OS === 'android' ? 'audio/m4a' : 'audio/m4a';
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
      try {
        await recorder.stop();
      } catch {}
    }
    
    console.log('[AudioRecorder] Stopped');
  }, []);

  return { startRecording, stopRecording };
}
