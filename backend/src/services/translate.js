import { translate } from '@vitalets/google-translate-api';

const LANG_MAP = { UR: 'ur', EN: 'en', AR: 'ar' };

export async function translateText(text, fromCode, toCode) {
  if (fromCode === toCode) return text;
  const from = LANG_MAP[fromCode] ?? fromCode;
  const to = LANG_MAP[toCode] ?? toCode;
  const { text: result } = await translate(text, { from, to });
  return result;
}
