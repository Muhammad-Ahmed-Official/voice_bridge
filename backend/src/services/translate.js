import { v2 } from '@google-cloud/translate';

const LANG_MAP = { UR: 'ur', EN: 'en', AR: 'ar' };

let translateClient = null;

function getTranslateClient() {
  if (!translateClient) {
    const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    
    if (credentials) {
      translateClient = new v2.Translate({
        keyFilename: credentials
      });
      console.log('[Translate] Initialized with service account credentials');
    } else if (process.env.GOOGLE_API_KEY) {
      translateClient = new v2.Translate({
        key: process.env.GOOGLE_API_KEY
      });
      console.log('[Translate] Initialized with API key');
    } else {
      throw new Error('No Google Cloud credentials configured. Set GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_API_KEY');
    }
  }
  return translateClient;
}

/**
 * Translate text using Google Cloud Translation API
 * @param {string} text - Text to translate
 * @param {string} fromCode - Source language code (UR, EN, AR)
 * @param {string} toCode - Target language code (UR, EN, AR)
 * @returns {Promise<{text: string, success: boolean}>} Translated text and success flag
 */
export async function translateText(text, fromCode, toCode) {
  if (!text || !text.trim()) {
    return { text, success: true };
  }
  
  if (fromCode === toCode) {
    console.log(`[Translate] Same language (${fromCode}), skipping translation`);
    return { text, success: true };
  }

  const from = LANG_MAP[fromCode] ?? fromCode.toLowerCase();
  const to = LANG_MAP[toCode] ?? toCode.toLowerCase();

  try {
    const client = getTranslateClient();
    const [translation] = await client.translate(text, { from, to });
    
    console.log(`[Translate] "${text}" (${fromCode}) → "${translation}" (${toCode})`);
    return { text: translation, success: true };
  } catch (err) {
    console.error(`[Translate] Failed:`, err.message);
    return { text, success: false };
  }
}
