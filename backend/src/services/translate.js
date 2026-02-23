const TRANSLATE_URL = 'https://translation.googleapis.com/language/translate/v2';

const LANG_MAP = { UR: 'ur', EN: 'en', AR: 'ar' };

export async function translateText(text, fromCode, toCode) {
  if (fromCode === toCode) return text;

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY is not set in backend/.env');
  }

  const from = LANG_MAP[fromCode] ?? fromCode;
  const to   = LANG_MAP[toCode]   ?? toCode;

  const res = await fetch(`${TRANSLATE_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source: from, target: to, format: 'text' }),
  });

  const data = await res.json();

  if (data.error) {
    throw new Error(`Google Translate API error ${data.error.code}: ${data.error.message}`);
  }

  return data.data.translations[0].translatedText;
}
