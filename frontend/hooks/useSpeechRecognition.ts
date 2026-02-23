import { useRef, useCallback } from 'react';
import { Platform } from 'react-native';

// Lazy-load so the file can be imported on platforms where the native module
// isn't available (e.g. standard Expo Go). Requires a custom dev client for
// full native speech recognition support.
let _Voice: any = null;
function getVoice(): any | null {
  if (_Voice) return _Voice;
  try {
    _Voice = require('@react-native-voice/voice').default;
  } catch {
    console.warn('[STT] @react-native-voice/voice not available — requires custom dev client');
  }
  return _Voice;
}

export function useSpeechRecognition() {
  const recognitionRef = useRef<any>(null);

  const startListening = useCallback(
    (
      locale: string,
      onResult: (text: string) => void,
      onPermissionDenied?: () => void,
      onInterim?: (text: string) => void,
    ) => {
      if (Platform.OS === 'web') {
        const SpeechRecognitionCtor =
          (window as any).SpeechRecognition ??
          (window as any).webkitSpeechRecognition;

        if (!SpeechRecognitionCtor) {
          console.warn('[STT] SpeechRecognition not supported. Use Chrome or Edge.');
          return;
        }

        // Stop any existing instance before creating a new one
        if (recognitionRef.current) {
          const old = recognitionRef.current;
          recognitionRef.current = null;
          try { old.stop(); } catch {}
        }

        const recognition = new SpeechRecognitionCtor();
        recognition.lang = locale;
        recognition.continuous = true;
        recognition.interimResults = true; // show partial results so user knows mic is working

        recognition.onstart = () => console.log('[STT] listening started, locale:', locale);

        recognition.onresult = (event: any) => {
          let interim = '';
          let final = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const t = event.results[i][0].transcript;
            if (event.results[i].isFinal) final += t;
            else interim += t;
          }
          // Show interim text in UI immediately so user knows mic is working
          if (interim) {
            console.log('[STT] interim:', interim);
            onInterim?.(interim);
          }
          // Send final text to backend for translation
          if (final) {
            console.log('[STT] final:', final);
            onResult(final);
          }
        };

        recognition.onerror = (event: any) => {
          if (event.error === 'not-allowed') {
            recognitionRef.current = null;
            onPermissionDenied?.();
          } else if (event.error === 'aborted' || event.error === 'no-speech') {
            // 'aborted' = we deliberately stopped it; 'no-speech' = silence — both are normal
          } else {
            console.error('[STT] error:', event.error);
          }
        };

        // Chrome stops after silence — restart only if still active
        // Use a small delay to avoid InvalidStateError when Chrome hasn't fully closed yet
        recognition.onend = () => {
          if (recognitionRef.current === recognition) {
            setTimeout(() => {
              if (recognitionRef.current === recognition) {
                try { recognition.start(); } catch (e) {
                  console.warn('[STT] restart failed:', e);
                }
              }
            }, 150);
          }
        };

        recognitionRef.current = recognition;
        try { recognition.start(); } catch (e) {
          console.error('[STT] start failed:', e);
        }
      } else {
        // Native: @react-native-voice/voice
        const Voice = getVoice();
        if (!Voice) return;
        Voice.onSpeechResults = (e: any) => {
          const text = e.value?.[0];
          if (text) onResult(text);
        };
        Voice.start(locale).catch(() => {});
      }
    },
    []
  );

  const stopListening = useCallback(() => {
    if (Platform.OS === 'web') {
      const rec = recognitionRef.current;
      recognitionRef.current = null; // null first so onend doesn't restart
      if (rec) try { rec.stop(); } catch {}
    } else {
      getVoice()?.stop().catch(() => {});
    }
  }, []);

  return { startListening, stopListening };
}
