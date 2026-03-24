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
 * @param {string} params.locale          - Target locale for the listener.
 * @param {string} params.speakerUserId   - Logical userId of the speaker.
 * @param {string} [params.clonedVoiceId] - In-memory cloned voice_id if clone is ready.
 *                                          Bypasses DB lookup and avoids the DB write race.
 * @returns {Promise<string|null>} Base64-encoded MP3 audio.
 */
export async function getTtsForUser({ text, locale, speakerUserId, clonedVoiceId }) {
  if (!text || !text.trim()) return null;

  // ── Path A: In-memory cloned voice_id provided (fastest, no DB round-trip) ─
  // This is set by the socket handler once performVoiceClone() succeeds.
  // Using the in-memory value avoids the window between DB write and replica read.
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
        `[TTS Router] ⚠️  ElevenLabs cloned voice failed (voice_id=${clonedVoiceId}), ` +
        `falling back to Google TTS: ${err.message}`,
      );
    }
    // Fall through to Google TTS if ElevenLabs fails even with cloned id
    return synthesizeSpeech(text, locale);
  }

  // ── Path B: DB lookup — used when no in-memory voiceId provided ────────────
  if (speakerUserId) {
    try {
      const user = await User.findOne({ userId: speakerUserId }).lean();
      const cloningEnabled = !!user?.voiceCloningEnabled;

      // Only use a voiceId that is explicitly stored for THIS user (their clone).
      // Do NOT fall through to ELEVENLABS_DEFAULT_VOICE_ID here — if the user has
      // cloning enabled but hasn't finished the clone yet, use Google TTS instead.
      // Using the default voice would make the user think cloning is "working"
      // when it's actually serving a generic ElevenLabs voice.
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
        // Cloning is enabled but clone is not ready yet — use Google TTS
        // (NOT the default ElevenLabs voice, which would look identical to a working clone)
        console.log(
          `[TTS Router] ⏳ CLONE PENDING — speaker=${speakerUserId} using Google TTS until clone ready`,
        );
        return synthesizeSpeech(text, locale);
      } else if (!cloningEnabled) {
        // Cloning toggle OFF → always use Google TTS.
        // Do NOT route through ELEVENLABS_DEFAULT_VOICE_ID here: that would
        // synthesize in a random ElevenLabs voice with no relation to the
        // actual speaker, which is misleading and indistinguishable from a
        // "working" clone. Google TTS is the honest fallback when OFF.
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

  // ── Path C: Google TTS fallback ────────────────────────────────────────────
  console.log(`[TTS Router] 🔤 GOOGLE TTS — speaker=${speakerUserId ?? 'unknown'} locale=${locale}`);
  return synthesizeSpeech(text, locale);
}
