import { v2 } from '@google-cloud/translate';
import fs from 'fs';
import path from 'path';

// const LANG_MAP = { UR: 'ur', EN: 'en', AR: 'ar' };
const LANG_MAP = {
  UR: 'ur',
  EN: 'en',
  AR: 'ar',

  'ur-PK': 'ur',
  'en-US': 'en',
  'ar-SA': 'ar',

  ur: 'ur',
  en: 'en',
  ar: 'ar'
};

let translateClient = null;

function getTranslateClient() {
  if (!translateClient) {
    const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;
    if (credentialsJson) {
      try {
        let credentials;

        // If env looks like a path (ends with .json), read file contents
        if (credentialsJson.trim().endsWith('.json')) {
          const resolvedPath = path.resolve(process.cwd(), credentialsJson.trim());
          const raw = fs.readFileSync(resolvedPath, 'utf-8');
          credentials = JSON.parse(raw);
          console.log('[Translate] Initialized with service account credentials from file:', resolvedPath);
        } else {
          credentials = JSON.parse(credentialsJson);
          console.log('[Translate] Initialized with service account credentials (env JSON)');
        }

        translateClient = new v2.Translate({ credentials });
      } catch (err) {
        console.error('[Translate] Invalid GOOGLE_CREDENTIALS_JSON:', err.message);
        throw new Error('GOOGLE_CREDENTIALS_JSON is set but is neither valid JSON nor a readable .json file');
      }
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      translateClient = new v2.Translate({
        keyFilename
      });
      console.log('[Translate] Initialized with service account credentials (GOOGLE_APPLICATION_CREDENTIALS)');
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

  const normalizedFrom = (fromCode ?? '').toString().trim();
  const normalizedTo = (toCode ?? '').toString().trim();

  const from =
    normalizedFrom && normalizedFrom.toLowerCase() !== 'auto'
      ? (LANG_MAP[normalizedFrom] ?? normalizedFrom.toLowerCase())
      : null;
  const to = LANG_MAP[normalizedTo] ?? normalizedTo.toLowerCase();

  if (!to) {
    console.error('[Translate] Missing/invalid target language:', toCode);
    return { text, success: false };
  }

  try {
    const client = getTranslateClient();
    // Google Translate auto-detect works best by omitting `from` entirely.
    const options = from ? { from, to } : { to };
    const [translation] = await client.translate(text, options);
    
    console.log(`[Translate] "${text}" (${fromCode}) → "${translation}" (${toCode})`);
    return { text: translation, success: true };
  } catch (err) {
    console.error(`[Translate] Failed:`, err.message);
    return { text, success: false };
  }
}