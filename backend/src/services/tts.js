import googleTTS from 'google-tts-api';
import { User } from '../models/user.models.js';
import {
  ELEVENLABS_DEFAULT_VOICE_ID,
} from '../config/elevenlabs.config.js';
import { synthesizeWithElevenLabs } from './elevenlabsTts.js';

// Maps our internal locale codes to google-tts-api language codes
const LANG_MAP = {
  'ur-PK': 'ur',
  'en-US': 'en',
  'ar-SA': 'ar',
};

/**
 * Synthesize speech using google-tts-api (free, no API key required).
 * Used as the default / fallback TTS engine.
 * @param {string} text     - The text to synthesize.
 * @param {string} locale   - Locale code, e.g. 'ur-PK', 'en-US', 'ar-SA'.
 * @returns {Promise<string|null>} Base64-encoded MP3 audio.
 */
export async function synthesizeSpeech(text, locale) {
  if (!text || !text.trim()) {
    return null;
  }

  const lang = LANG_MAP[locale] ?? 'en';
  
  try {
    // For long text, google-tts-api can split into multiple parts
    // Each part max 200 chars
    if (text.length > 200) {
      const allParts = googleTTS.getAllAudioUrls(text, {
        lang,
        slow: false,
        host: 'https://translate.google.com',
      });
      
      // Fetch all audio parts and combine
      const audioBuffers = await Promise.all(
        allParts.map(async (part) => {
          const res = await fetch(part.url);
          const arrayBuffer = await res.arrayBuffer();
          return Buffer.from(arrayBuffer);
        }),
      );
      
      const combined = Buffer.concat(audioBuffers);
      console.log(`[TTS] Synthesized ${text.length} chars in ${allParts.length} parts (${lang})`);
      return combined.toString('base64');
    } else {
      // Short text - single request
      const url = googleTTS.getAudioUrl(text, {
        lang,
        slow: false,
        host: 'https://translate.google.com',
      });
      
      const res = await fetch(url);
      const arrayBuffer = await res.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      
      console.log(
        `[TTS] Synthesized: "${text.substring(0, 50)}${
          text.length > 50 ? '...' : ''
        }" (${lang})`,
      );
      return base64;
    }
  } catch (err) {
    console.error('[TTS] Error:', err.message);
    throw err;
  }
}

/**
 * Decide at runtime whether to use ElevenLabs (if enabled for the speaker)
 * or fall back to the existing Google-based TTS.
 *
 * @param {Object} params
 * @param {string} params.text
 * @param {string} params.locale - Target locale for the listener (e.g. 'ur-PK').
 * @param {string} params.speakerUserId - Logical userId of the speaker.
 * @returns {Promise<string|null>} Base64-encoded MP3 audio.
 */
export async function getTtsForUser({ text, locale, speakerUserId }) {
  if (!text || !text.trim()) return null;

  // First, attempt ElevenLabs if the speaker has cloning enabled
  if (speakerUserId) {
    try {
      const user = await User.findOne({ userId: speakerUserId }).lean();
      const cloningEnabled = !!user?.voiceCloningEnabled;
      const voiceId =
        (user && typeof user.voiceId === 'string' && user.voiceId) ||
        ELEVENLABS_DEFAULT_VOICE_ID;

      if (cloningEnabled && voiceId) {
        try {
          const elevenAudio = await synthesizeWithElevenLabs(
            text,
            locale,
            voiceId,
          );
          if (elevenAudio) {
            console.log(
              `[TTS Router] Using ElevenLabs for speaker=${speakerUserId}`,
            );
            return elevenAudio;
          }
        } catch (err) {
          console.warn(
            '[TTS Router] ElevenLabs failed, falling back to Google TTS:',
            err.message,
          );
        }
      }
    } catch (err) {
      console.warn(
        '[TTS Router] Failed to read user preferences, falling back:',
        err.message,
      );
    }
  }

  // Fallback: existing Google TTS
  return await synthesizeSpeech(text, locale);
}

