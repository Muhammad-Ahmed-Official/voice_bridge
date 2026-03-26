import { useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
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
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        console.warn('[AudioRecorder] Permission denied');
        onDenied?.();
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        // SDK 55: use cross-platform string interruptionMode (replaces platform enums)
        interruptionMode: 'doNotMix',
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
          // expo-audio (SDK 55): recording file path is exposed on recorder.uri
          const uri = (recorder as any)?.uri as string | undefined;
          
          if (uri) {
            // Use legacy API for expo-file-system SDK 54+
            const base64 = await FileSystemLegacy.readAsStringAsync(uri, {
              encoding: FileSystemLegacy.EncodingType.Base64,
            });
            
            console.log('[AudioRecorder] Native chunk ready, size:', base64.length);
            // HIGH_QUALITY preset records AAC/M4A by default
            const mimeType = Platform.OS === 'android' ? 'audio/m4a' : 'audio/m4a';
            onChunk(base64, mimeType);
            
            await FileSystemLegacy.deleteAsync(uri, { idempotent: true });
          } else {
            console.warn('[AudioRecorder] No URI after stop(); skipping chunk');
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