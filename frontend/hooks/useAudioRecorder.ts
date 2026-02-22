import { useRef, useCallback } from 'react';

const CYCLE_MS = 4000; // record 4-second chunks, send each to Google STT

export function useAudioRecorder() {
  const streamRef   = useRef<MediaStream | null>(null);
  const activeRef   = useRef(false);

  const startRecording = useCallback(
    (
      onChunk: (audioBase64: string, mimeType: string) => void,
      onDenied?: () => void,
    ) => {
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

          console.log('[AudioRecorder] using mimeType:', mimeType);

          const runCycle = () => {
            if (!activeRef.current || !streamRef.current) return;

            const recorder = new MediaRecorder(streamRef.current, { mimeType });
            const chunks: Blob[] = [];

            recorder.ondataavailable = (e) => {
              if (e.data.size > 0) chunks.push(e.data);
            };

            recorder.onstop = () => {
              if (!activeRef.current) return; // stopped by user — discard
              if (chunks.length === 0) { runCycle(); return; }

              const blob = new Blob(chunks, { type: mimeType });
              const reader = new FileReader();
              reader.onloadend = () => {
                const b64 = (reader.result as string).split(',')[1];
                if (b64) onChunk(b64, mimeType);
                runCycle(); // start next cycle immediately
              };
              reader.readAsDataURL(blob);
            };

            recorder.start();
            setTimeout(() => {
              if (recorder.state === 'recording') recorder.stop();
            }, CYCLE_MS);
          };

          runCycle();
        })
        .catch((err) => {
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            onDenied?.();
          } else {
            console.error('[AudioRecorder] getUserMedia error:', err);
          }
        });
    },
    [],
  );

  const stopRecording = useCallback(() => {
    activeRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  return { startRecording, stopRecording };
}
