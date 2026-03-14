import {
  ELEVENLABS_API_KEY,
  ELEVENLABS_MODEL_ID,
} from '../config/elevenlabs.config.js';

/**
 * Synthesize speech using ElevenLabs Text-to-Speech.
 * Returns a base64-encoded MP3 string compatible with existing frontend player.
 * @param {string} text
 * @param {string} locale - Target locale (e.g. 'ur-PK', 'en-US', 'ar-SA') – currently unused but kept for future tuning.
 * @param {string} voiceId - ElevenLabs voice id to use.
 * @returns {Promise<string|null>}
 */
export async function synthesizeWithElevenLabs(text, locale, voiceId) {
  if (!text || !text.trim()) return null;

  if (!ELEVENLABS_API_KEY) {
    console.warn('[ElevenLabs] API key missing, skipping ElevenLabs TTS');
    return null;
  }

  if (!voiceId) {
    console.warn('[ElevenLabs] voiceId missing, skipping ElevenLabs TTS');
    return null;
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL_ID,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(
        `[ElevenLabs] HTTP ${res.status} ${res.statusText} ${errorText}`,
      );
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return buffer.toString('base64');
  } catch (err) {
    console.error('[ElevenLabs] TTS error:', err.message);
    throw err;
  }
}

