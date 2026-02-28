import { v2 } from '@google-cloud/translate';

const LANG_MAP = { UR: 'ur', EN: 'en', AR: 'ar' };

let translateClient = null;

function getTranslateClient() {
  if (!translateClient) {
    const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;
    if (credentialsJson) {
      try {
        const credentials = JSON.parse(credentialsJson);
        translateClient = new v2.Translate({ credentials });
        console.log('[Translate] Initialized with service account credentials (env JSON)');
      } catch (err) {
        console.error('[Translate] Invalid GOOGLE_CREDENTIALS_JSON: parse failed');
        throw new Error('GOOGLE_CREDENTIALS_JSON is set but contains invalid JSON');
      }
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      translateClient = new v2.Translate({
        keyFilename
      });
      console.log('[Translate] Initialized with service account credentials');
    } else if (process.env.GOOGLE_API_KEY) {
      translateClient = new v2.Translate({
        key: process.env.GOOGLE_API_KEY
      });
      console.log('[Translate] Initialized with API key');
    } else {
      throw new Error('No Google Cloud credentials configured. Set GOOGLE_CREDENTIALS_JSON, GOOGLE_APPLICATION_CREDENTIALS, or GOOGLE_API_KEY');
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
