const GOOGLE_STT_URL = 'https://speech.googleapis.com/v1/speech:recognize';

// mimeType → Google STT encoding name
const ENCODING_MAP = {
  'audio/webm':               'WEBM_OPUS',
  'audio/webm;codecs=opus':   'WEBM_OPUS',
  'audio/ogg':                'OGG_OPUS',
  'audio/ogg;codecs=opus':    'OGG_OPUS',
};

// For WEBM_OPUS / OGG_OPUS Google auto-detects the sample rate from the container,
// so we must NOT include sampleRateHertz in the config.
export async function transcribeAudio(audioBase64, languageCode, mimeType = 'audio/webm;codecs=opus') {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY is not set in backend/.env');
  }

  const encoding = ENCODING_MAP[mimeType] ?? 'WEBM_OPUS';

  const body = JSON.stringify({
    config: {
      encoding,
      languageCode,
      enableAutomaticPunctuation: true,
      model: 'default',
    },
    audio: { content: audioBase64 },
  });

  const res = await fetch(`${GOOGLE_STT_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  const data = await res.json();

  if (data.error) {
    throw new Error(`Google STT API error ${data.error.code}: ${data.error.message}`);
  }

  return data.results?.[0]?.alternatives?.[0]?.transcript ?? '';
}
