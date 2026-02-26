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

// Languages supported by Chrome Web Speech API
// Urdu (ur-PK) is NOT supported by Web Speech API - must use Google Cloud STT
const WEB_SPEECH_SUPPORTED_LOCALES = [
  'en-US', 'en-GB', 'en-AU', 'en-IN',
  'ar-SA', 'ar-EG', 'ar-AE',
  'es-ES', 'es-MX',
  'fr-FR',
  'de-DE',
  'hi-IN',
  'zh-CN', 'zh-TW',
  'ja-JP',
  'ko-KR',
];

export function isWebSpeechSupported(locale: string): boolean {
  // Mobile pe Web Speech API available nahi hai
  // Expo Go mein @react-native-voice/voice bhi kaam nahi karta
  // So mobile pe hamesha false return karo - audio recorder use hoga
  if (Platform.OS !== 'web') return false;
  
  return WEB_SPEECH_SUPPORTED_LOCALES.some(l => 
    locale.toLowerCase().startsWith(l.toLowerCase().split('-')[0])
  );
}

export function useSpeechRecognition() {
  const recognitionRef = useRef<any>(null);

  const startListening = useCallback(
    (
      locale: string,
      onResult: (text: string) => void,
      onPermissionDenied?: () => void,
      onInterim?: (text: string) => void,
      onUnsupportedLanguage?: () => void,
    ): boolean => {
      if (Platform.OS === 'web') {
        // Check if this language is supported by Web Speech API
        if (!isWebSpeechSupported(locale)) {
          console.log(`[STT] ${locale} not supported by Web Speech API, use audio recorder instead`);
          onUnsupportedLanguage?.();
          return false;
        }

        const SpeechRecognitionCtor =
          (window as any).SpeechRecognition ??
          (window as any).webkitSpeechRecognition;

        if (!SpeechRecognitionCtor) {
          console.warn('[STT] SpeechRecognition not supported. Use Chrome or Edge.');
          onUnsupportedLanguage?.();
          return false;
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
        recognition.interimResults = true;

        recognition.onstart = () => console.log('[STT] Web Speech API listening started, locale:', locale);

        recognition.onresult = (event: any) => {
          let interim = '';
          let final = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const t = event.results[i][0].transcript;
            if (event.results[i].isFinal) final += t;
            else interim += t;
          }
          if (interim) {
            console.log('[STT] interim:', interim);
            onInterim?.(interim);
          }
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
            // normal cases
          } else if (event.error === 'language-not-supported') {
            console.warn('[STT] Language not supported by browser:', locale);
            recognitionRef.current = null;
            onUnsupportedLanguage?.();
          } else {
            console.error('[STT] error:', event.error);
          }
        };

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
        try { 
          recognition.start(); 
          return true;
        } catch (e) {
          console.error('[STT] start failed:', e);
          return false;
        }
      } else {
        // Native: @react-native-voice/voice
        const Voice = getVoice();
        if (!Voice) return false;
        Voice.onSpeechResults = (e: any) => {
          const text = e.value?.[0];
          if (text) onResult(text);
        };
        Voice.start(locale).catch(() => {});
        return true;
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
