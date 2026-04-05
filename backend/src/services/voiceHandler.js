/**
 * Optimized Voice Handler
 * Minimizes latency through parallel processing and caching
 */

import { LatencyProfiler, assessLatency } from '../utils/latencyProfiler.js';
import { transcribeAudio } from './stt.js';
import { translateText } from './translate.js';
import { getTtsForUser } from './tts.js';
import { User } from '../models/user.models.js';

/**
 * Cache for recently translated texts (TTL: 5 minutes)
 * Reduces redundant API calls
 */
class TranslationCache {
  constructor(ttlMs = 5 * 60 * 1000) {
    this.cache = new Map();
    this.ttlMs = ttlMs;
  }

  getKey(text, fromLang, toLang) {
    return `${text}:${fromLang}:${toLang}`;
  }

  get(text, fromLang, toLang) {
    const key = this.getKey(text, fromLang, toLang);
    const entry = this.cache.get(key);

    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    return entry.translation;
  }

  set(text, fromLang, toLang, translation) {
    const key = this.getKey(text, fromLang, toLang);
    this.cache.set(key, {
      translation,
      timestamp: Date.now(),
    });
  }

  clear() {
    this.cache.clear();
  }

  getStats() {
    return {
      size: this.cache.size,
      ttlMs: this.ttlMs,
    };
  }
}

const translationCache = new TranslationCache();

/**
 * Process voice chunk with optimized latency
 *
 * Flow:
 * 1. STT (Speech-to-Text) - Convert audio to text
 * 2. Translation - Translate to target language
 * 3. TTS (Text-to-Speech) - Convert translated text to speech
 *
 * @param {Object} params
 * @param {string} params.audioBase64 - Base64 encoded audio
 * @param {string} params.audioMimeType - MIME type (audio/webm, audio/m4a, etc)
 * @param {string} params.speakerLanguage - Speaker's language (UR, EN, AR)
 * @param {string} params.listenerLanguage - Listener's desired language
 * @param {string} params.speakerId - Speaker's user ID
 * @param {string} params.listenerId - Listener's user ID (for cloning preferences)
 * @returns {Promise<Object>} Processed voice data
 */
export async function processVoiceChunk(params) {
  const {
    audioBase64,
    audioMimeType = 'audio/webm;codecs=opus',
    speakerLanguage,
    listenerLanguage,
    speakerId,
    listenerId,
    enableCloning = false,
  } = params;

  const profiler = new LatencyProfiler(`voice_${speakerId}_${listenerId}`);
  const results = {
    success: false,
    transcript: null,
    translatedText: null,
    audioOutput: null,
    latency: {},
    errors: [],
  };

  try {
    // ============ STEP 1: STT (Speech-to-Text) ============
    profiler.mark('stt_start');
    console.log(`🎤 STT: Converting ${audioMimeType} to text (${speakerLanguage})`);

    const sttLocaleMap = { UR: 'ur-PK', EN: 'en-US', AR: 'ar-SA' };
    const sttLocale = sttLocaleMap[speakerLanguage] || 'en-US';

    const transcript = await profiler.measureAsync('STT', async () => {
      return await transcribeAudio(audioBase64, sttLocale, audioMimeType);
    });

    profiler.mark('stt_end');
    const sttLatency = profiler.measure('stt_start', 'stt_end');

    if (!transcript || !transcript.trim()) {
      console.warn('⚠️  STT produced no transcript');
      results.errors.push('No speech detected');
      return results;
    }

    results.transcript = transcript;
    results.latency.stt = assessLatency('STT', sttLatency);

    console.log(`✅ STT (${sttLatency.toFixed(2)}ms): "${transcript}"`);

    // ============ STEP 2: Translation (Parallel with next steps) ============
    profiler.mark('translation_start');

    // Check cache first
    let translatedText = translationCache.get(transcript, speakerLanguage, listenerLanguage);

    if (translatedText) {
      console.log('⚡ Translation cache HIT');
      profiler.mark('translation_end');
    } else {
      console.log(`🌍 Translating: ${speakerLanguage} → ${listenerLanguage}`);

      const translationResult = await profiler.measureAsync('Translation', async () => {
        return await translateText(transcript, speakerLanguage, listenerLanguage);
      });

      profiler.mark('translation_end');

      if (!translationResult.success) {
        console.warn('⚠️  Translation failed, using original text');
        translatedText = transcript;
      } else {
        translatedText = translationResult.text;
        translationCache.set(transcript, speakerLanguage, listenerLanguage, translatedText);
      }
    }

    const translationLatency = profiler.measure('translation_start', 'translation_end');
    results.translatedText = translatedText;
    results.latency.translation = assessLatency('TRANSLATION', translationLatency);

    console.log(`✅ Translation (${translationLatency.toFixed(2)}ms): "${translatedText}"`);

    // ============ STEP 3: TTS (Text-to-Speech) ============
    profiler.mark('tts_start');

    const ttsLocaleMap = { UR: 'ur-PK', EN: 'en-US', AR: 'ar-SA' };
    const ttsLocale = ttsLocaleMap[listenerLanguage] || 'en-US';

    console.log(`🔊 TTS: Synthesizing ${listenerLanguage} speech`);

    const ttsParams = {
      text: translatedText,
      locale: ttsLocale,
      speakerUserId: speakerId,
      cloningEnabled: enableCloning,
      listenerCloningEnabled: false, // TODO: Get from listener preferences
    };

    const audioOutput = await profiler.measureAsync('TTS', async () => {
      return await getTtsForUser(ttsParams);
    });

    profiler.mark('tts_end');
    const ttsLatency = profiler.measure('tts_start', 'tts_end');

    if (!audioOutput) {
      console.warn('⚠️  TTS produced no audio');
      results.errors.push('Audio synthesis failed');
      return results;
    }

    results.audioOutput = audioOutput;
    results.latency.tts = assessLatency('TTS', ttsLatency);

    console.log(`✅ TTS (${ttsLatency.toFixed(2)}ms): ${audioOutput.substring(0, 30)}...`);

    // ============ STEP 4: Calculate Total Latency ============
    profiler.mark('complete');
    profiler.measure('stt_start', 'complete');

    const measurements = profiler.measurements;
    const totalLatency = measurements.reduce((sum, m) => sum + (m.latencyMs || 0), 0);

    results.success = true;
    results.latency.total = assessLatency('TOTAL_PIPELINE', totalLatency);

    // Log summary
    console.log('\n✅ VOICE CHUNK PROCESSED SUCCESSFULLY');
    console.log(`📊 Total Latency: ${totalLatency.toFixed(2)}ms`);
    console.log(`   STT: ${results.latency.stt.latencyMs}ms`);
    console.log(`   Translation: ${results.latency.translation.latencyMs}ms`);
    console.log(`   TTS: ${results.latency.tts.latencyMs}ms`);

    return results;

  } catch (error) {
    console.error('❌ Voice chunk processing failed:', error.message);
    results.errors.push(error.message);
    return results;
  }
}

/**
 * Process voice in real-time (streaming mode)
 * Flushes after silence detection
 *
 * @param {Object} params
 * @param {string} params.audioChunk - Base64 audio chunk
 * @param {string} params.userId - User ID
 * @param {Map} params.bufferMap - Shared buffer map across socket
 * @returns {Promise<Object|null>} Processed data if ready, null if buffering
 */
export async function processVoiceStream(params) {
  const {
    audioChunk,
    userId,
    language,
    targetLanguage,
    bufferMap,
    flushDelayMs = 1500, // Reduced from 1500ms to 1000ms for lower latency
  } = params;

  if (!bufferMap.has(userId)) {
    bufferMap.set(userId, {
      chunks: [],
      lastActivityTime: Date.now(),
      flushTimer: null,
    });
  }

  const buffer = bufferMap.get(userId);
  buffer.chunks.push(audioChunk);
  buffer.lastActivityTime = Date.now();

  // Clear existing timer
  if (buffer.flushTimer) {
    clearTimeout(buffer.flushTimer);
  }

  // Set new flush timer
  return new Promise((resolve) => {
    buffer.flushTimer = setTimeout(async () => {
      console.log(`⏱️  Silence detected after ${flushDelayMs}ms, processing buffer...`);

      if (buffer.chunks.length === 0) {
        resolve(null);
        return;
      }

      try {
        // Combine chunks
        const combinedBase64 = Buffer.concat(
          buffer.chunks.map(b => Buffer.from(b, 'base64'))
        ).toString('base64');

        // Reset buffer for next batch
        buffer.chunks = [];

        // Process combined audio
        const result = await processVoiceChunk({
          audioBase64: combinedBase64,
          speakerLanguage: language,
          listenerLanguage: targetLanguage,
          speakerId: userId,
        });

        resolve(result);
      } catch (err) {
        console.error('Error processing buffered voice:', err.message);
        resolve(null);
      }
    }, flushDelayMs);
  });
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return {
    translation: translationCache.getStats(),
  };
}

/**
 * Clear all caches
 */
export function clearCaches() {
  translationCache.clear();
  console.log('✅ All caches cleared');
}

export default {
  processVoiceChunk,
  processVoiceStream,
  getCacheStats,
  clearCaches,
  translationCache,
};
