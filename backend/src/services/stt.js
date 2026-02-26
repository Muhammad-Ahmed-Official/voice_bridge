const GOOGLE_STT_URL = 'https://speech.googleapis.com/v1/speech:recognize';

// mimeType → Google STT encoding config
// Some formats need sampleRateHertz, others auto-detect from container
const ENCODING_MAP = {
  'audio/webm':               { encoding: 'WEBM_OPUS' },
  'audio/webm;codecs=opus':   { encoding: 'WEBM_OPUS' },
  'audio/ogg':                { encoding: 'OGG_OPUS' },
  'audio/ogg;codecs=opus':    { encoding: 'OGG_OPUS' },
  // LINEAR16 PCM formats (iOS native recording)
  'audio/l16':                { encoding: 'LINEAR16', sampleRateHertz: 16000 },
  'audio/l16;rate=16000':     { encoding: 'LINEAR16', sampleRateHertz: 16000 },
  'audio/wav':                { encoding: 'LINEAR16', sampleRateHertz: 16000 },
  // AMR-WB format (Android native recording)
  'audio/amr-wb':             { encoding: 'AMR_WB', sampleRateHertz: 16000 },
  'audio/amr':                { encoding: 'AMR', sampleRateHertz: 8000 },
};

// Languages that can use special models for better recognition
const LANGUAGE_MODEL_MAP = {
  // Urdu: use generic/default model (enhanced/\"latest_long\" not supported for ur-PK)
  'ur-PK': 'default',
  // Arabic & English can still use language-specific models where supported
  'ar-SA': 'latest_long',
  'en-US': 'latest_short',
};

// For WEBM_OPUS / OGG_OPUS Google auto-detects the sample rate from the container,
// so we must NOT include sampleRateHertz in the config.
export async function transcribeAudio(
  audioBase64,
  languageCode,
  mimeType = 'audio/webm;codecs=opus',
  options,
) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY is not set in backend/.env');
  }

  const isFallback = options?.isFallback === true;

  const encodingConfig = ENCODING_MAP[mimeType] ?? { encoding: 'WEBM_OPUS' };
  const model = isFallback ? 'default' : (LANGUAGE_MODEL_MAP[languageCode] ?? 'default');
  const supportsEnhanced =
    !isFallback && (languageCode === 'en-US' || languageCode === 'ar-SA');
  
  console.log(`[STT] Processing: mimeType=${mimeType}, encoding=${encodingConfig.encoding}, lang=${languageCode}`);

  const config = {
    encoding: encodingConfig.encoding,
    languageCode,
    enableAutomaticPunctuation: true,
    model,
    ...(supportsEnhanced ? { useEnhanced: true } : {}),
  };

  console.log(
    `[STT] Using model="${model}", enhanced=${supportsEnhanced} for ${languageCode}${
      isFallback ? ' (fallback)' : ''
    }`,
  );

  // Add sample rate only for formats that need it
  if (encodingConfig.sampleRateHertz) {
    config.sampleRateHertz = encodingConfig.sampleRateHertz;
  }

  const body = JSON.stringify({
    config,
    audio: { content: audioBase64 },
  });

  const res = await fetch(`${GOOGLE_STT_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  const data = await res.json();

  if (data.error) {
    console.error(`[STT] API Error:`, data.error);
    const msg = data.error.message || '';

    const isModelUnsupported =
      data.error.code === 400 &&
      msg.includes('The requested model is currently not supported for language');

    // Retry once with safest config if model is not supported for this language
    if (isModelUnsupported && !isFallback) {
      console.warn('[STT] Retrying with default model and no enhanced for', languageCode);
      return transcribeAudio(audioBase64, languageCode, mimeType, { isFallback: true });
    }

    if (data.error.code === 403) {
      throw new Error(`Google STT API blocked. Please enable "Cloud Speech-to-Text API" in Google Cloud Console and ensure billing is enabled.`);
    }
    throw new Error(`Google STT API error ${data.error.code}: ${data.error.message}`);
  }

  const transcript = data.results?.[0]?.alternatives?.[0]?.transcript ?? '';
  
  // Only log non-empty transcripts to reduce noise
  if (transcript.trim()) {
    console.log(`[STT] Transcript (${languageCode}): "${transcript}"`);
  }
  
  return transcript;
}
