import googleTTS from 'google-tts-api';

// Maps our internal locale codes to google-tts-api language codes
const LANG_MAP = {
  'ur-PK': 'ur',
  'en-US': 'en',
  'ar-SA': 'ar',
};

/**
 * Synthesize speech using google-tts-api (free, no API key required).
 * @param {string} text     - The text to synthesize.
 * @param {string} locale   - Locale code, e.g. 'ur-PK', 'en-US', 'ar-SA'.
 * @returns {Promise<string>} Base64-encoded MP3 audio.
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
        })
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
      
      console.log(`[TTS] Synthesized: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}" (${lang})`);
      return base64;
    }
  } catch (err) {
    console.error('[TTS] Error:', err.message);
    throw err;
  }
}
