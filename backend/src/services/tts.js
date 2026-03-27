import googleTTS from 'google-tts-api';
import { User } from '../models/user.models.js';
import { synthesizeWithElevenLabs } from './elevenlabsTts.js';

const LANG_MAP = { 
  'ur-PK': 'ur', 
  'en-US': 'en', 
  'ar-SA': 'ar',
  'UR': 'ur', 
  'EN': 'en', 
  'AR': 'ar' 
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
      console.log(`[TTS] Google TTS: ${text.length} chars in ${allParts.length} parts (${lang})`);
      return combined.toString('base64');
    } else {
      const url = googleTTS.getAudioUrl(text, {
        lang,
        slow: false,
        host: 'https://translate.google.com',
      });

      const res = await fetch(url);
      const arrayBuffer = await res.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');

      console.log(
        `[TTS] Google TTS: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}" (${lang})`,
      );
      return base64;
    }
  } catch (err) {
    console.error('[TTS] Google TTS error:', err.message);
    throw err;
  }
}

/**
 * Decide at runtime whether to use ElevenLabs (cloned or default voice)
 * or fall back to Google TTS.
 *
 * @param {Object} params
 * @param {string} params.text
 * @param {string} params.locale               - Target locale for the listener.
 * @param {string} params.speakerUserId        - Logical userId of the speaker.
 * @param {string} [params.clonedVoiceId]      - In-memory cloned voice_id if clone is ready.
 *                                               Bypasses DB lookup and avoids the DB write race.
 * @param {boolean} [params.listenerCloningEnabled=false] - Whether the listener has cloning ON.
 *                                               When true, cloning is suppressed (CASE 2 / CASE 3).
 * @returns {Promise<string|null>} Base64-encoded MP3 audio.
 */
export async function getTtsForUser({ text, locale, speakerUserId, clonedVoiceId, cloningEnabled, listenerCloningEnabled = false }) {
  if (!text || !text.trim()) return null;

  if (!clonedVoiceId && cloningEnabled === false) {
    console.log(`[TTS Router] GOOGLE TTS (fast) — speaker=${speakerUserId} locale=${locale}`);
    return synthesizeSpeech(text, locale);
  }

  if (clonedVoiceId) {
    try {
      const audio = await synthesizeWithElevenLabs(text, locale, clonedVoiceId);
      if (audio) {
        console.log(
          `[TTS Router] ✅ CLONED VOICE (in-memory) — speaker=${speakerUserId} voice_id=${clonedVoiceId}`,
        );
        return audio;
      }
    } catch (err) {
      console.warn(
        `[TTS Router] ⚠️  ElevenLabs cloned voice failed (voice_id=${clonedVoiceId}): ${err.message}` +
        ` — returning null (no fallback TTS when clone is active)`,
      );
    }
    // Do NOT fall back to Google TTS when a cloned voice was active.
    // Caller will send captionOnly:true so the receiver sees text but hears nothing
    // rather than a generic voice the speaker never consented to.
    return null;
  }

  if (speakerUserId) {
    try {
      // No listener-based gate here. Whether the listener has cloning on is irrelevant —
      // cloning is the SPEAKER's identity and is applied to their outgoing voice only.
      // CASE 3 (both ON): each hears the other's clone, decided upstream in resolveAudioStrategy.
      const user = await User.findOne({ userId: speakerUserId }).lean();
      const cloningEnabled = !!user?.voiceCloningEnabled;

      const clonedDbVoiceId =
        user && typeof user.voiceId === 'string' && user.voiceId.length > 0
          ? user.voiceId
          : null;

      if (cloningEnabled && clonedDbVoiceId) {
        try {
          const audio = await synthesizeWithElevenLabs(text, locale, clonedDbVoiceId);
          if (audio) {
            console.log(
              `[TTS Router] ✅ CLONED VOICE (from DB) — speaker=${speakerUserId} voice_id=${clonedDbVoiceId}`,
            );
            return audio;
          }
        } catch (err) {
          console.warn(
            `[TTS Router] ⚠️  ElevenLabs (DB voice_id=${clonedDbVoiceId}) failed, ` +
            `falling back to Google TTS: ${err.message}`,
          );
        }
      } else if (cloningEnabled && !clonedDbVoiceId) {
        console.log(
          `[TTS Router] ⏳ CLONE PENDING — speaker=${speakerUserId} using Google TTS until clone ready`,
        );
        return synthesizeSpeech(text, locale);
      } else if (!cloningEnabled) {
        console.log(`[TTS Router] 🔤 CLONING OFF — speaker=${speakerUserId} → Google TTS`);
        return synthesizeSpeech(text, locale);
      }
    } catch (err) {
      console.warn(
        '[TTS Router] Failed to read user preferences, falling back to Google TTS:',
        err.message,
      );
    }
  }

  console.log(`[TTS Router] 🔤 GOOGLE TTS — speaker=${speakerUserId ?? 'unknown'} locale=${locale}`);
  return synthesizeSpeech(text, locale);
}
