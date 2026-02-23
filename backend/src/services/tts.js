const TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';

// Maps our internal locale codes to Google Cloud TTS voice configs
const VOICE_MAP = {
  'ur-PK': { languageCode: 'ur-IN', name: 'ur-IN-Standard-A' },
  'en-US': { languageCode: 'en-US', name: 'en-US-Neural2-C' },
  'ar-SA': { languageCode: 'ar-XA', name: 'ar-XA-Standard-A' },
};

/**
 * Synthesize speech using Google Cloud Text-to-Speech API.
 * @param {string} text     - The text to synthesize.
 * @param {string} locale   - Locale code, e.g. 'ur-PK', 'en-US', 'ar-SA'.
 * @returns {Promise<string>} Base64-encoded MP3 audio.
 */
export async function synthesizeSpeech(text, locale) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_API_KEY is not set in backend/.env');

  const voice = VOICE_MAP[locale] ?? { languageCode: 'en-US', name: 'en-US-Neural2-C' };

  const res = await fetch(`${TTS_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: voice.languageCode, name: voice.name },
      audioConfig: { audioEncoding: 'MP3' },
    }),
  });

  const data = await res.json();

  if (data.error) {
    throw new Error(`Google TTS API error ${data.error.code}: ${data.error.message}`);
  }

  return data.audioContent; // base64-encoded MP3
}
