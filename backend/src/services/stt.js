import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { Readable } from 'stream';

ffmpeg.setFfmpegPath(ffmpegPath);

const GOOGLE_STT_URL = 'https://speech.googleapis.com/v1/speech:recognize';

// mimeType → Google STT encoding config
// Some formats need sampleRateHertz, others auto-detect from container
const ENCODING_MAP = {
  // WebM/Opus (browser path)
  'audio/webm':               { encoding: 'WEBM_OPUS' },
  'audio/webm;codecs=opus':   { encoding: 'WEBM_OPUS' },
  // OGG/Opus
  'audio/ogg':                { encoding: 'OGG_OPUS' },
  'audio/ogg;codecs=opus':    { encoding: 'OGG_OPUS' },
  // LINEAR16 PCM formats (raw PCM / WAV)
  'audio/l16':                { encoding: 'LINEAR16', sampleRateHertz: 16000 },
  'audio/l16;rate=16000':     { encoding: 'LINEAR16', sampleRateHertz: 16000 },
  'audio/wav':                { encoding: 'LINEAR16', sampleRateHertz: 16000 },
  // AMR / AMR-WB formats
  'audio/amr-wb':             { encoding: 'AMR_WB', sampleRateHertz: 16000 },
  'audio/amr':                { encoding: 'AMR', sampleRateHertz: 8000 },
  // M4A / AAC / MP3: let Google auto-detect encoding from container
  'audio/m4a':                {},
  'audio/mp4':                {},
  'audio/aac':                {},
  'audio/mpeg':               {}, // mp3
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

function bufferToStream(buffer) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

async function convertM4aToLinear16Wav(audioBase64) {
  const inputBuffer = Buffer.from(audioBase64, 'base64');
  const inputStream = bufferToStream(inputBuffer);

  return new Promise((resolve, reject) => {
    const chunks = [];

    ffmpeg(inputStream)
      .format('wav')
      .audioCodec('pcm_s16le')
      .audioChannels(1)
      .audioFrequency(16000)
      .on('error', (err) => {
        console.error('[STT] ffmpeg conversion error:', err);
        reject(err);
      })
      .on('end', () => {
        const outputBuffer = Buffer.concat(chunks);
        const outputBase64 = outputBuffer.toString('base64');
        resolve(outputBase64);
      })
      .pipe()
      .on('data', (chunk) => chunks.push(chunk));
  });
}

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

  // If we receive M4A from native (Expo) clients, convert once to WAV/LINEAR16
  // so Google STT v1 gets a fully supported format.
  if (mimeType === 'audio/m4a') {
    console.log('[STT] Converting audio/m4a to audio/wav (LINEAR16,16kHz) before STT');
    try {
      audioBase64 = await convertM4aToLinear16Wav(audioBase64);
      mimeType = 'audio/wav';
    } catch (err) {
      console.error('[STT] Failed to convert M4A to WAV; falling back to original audio.', err);
    }
  }

  // Default: treat unknown as WebM Opus (Ahmed/web path). Known M4A/MP3 entries
  // above intentionally map to an empty object so Google can auto-detect.
  const encodingConfig = ENCODING_MAP[mimeType] ?? { encoding: 'WEBM_OPUS' };

  // Choose model; fall back to "default" when language is unknown or we explicitly
  // don't want to use an enhanced model (e.g. for container formats like M4A).
  let model = isFallback ? 'default' : (LANGUAGE_MODEL_MAP[languageCode] ?? 'default');
  let supportsEnhanced =
    !isFallback && (languageCode === 'en-US' || languageCode === 'ar-SA');

  // For M4A/AAC we let Google auto-detect the encoding and also avoid
  // forcing "latest_*" enhanced models, which can be strict about formats.
  // After conversion above mimeType becomes audio/wav, so this branch will
  // only apply if conversion failed and we are still sending M4A.
  if (mimeType === 'audio/m4a') {
    model = 'default';
    supportsEnhanced = false;
  }

  console.log(`[STT] Processing: mimeType=${mimeType}, encoding=${encodingConfig.encoding}, lang=${languageCode}`);

  const config = {
    languageCode,
    enableAutomaticPunctuation: true,
    model,
    ...(supportsEnhanced ? { useEnhanced: true } : {}),
  };

  // Only set encoding when we explicitly know it; for M4A/MP3 we let Google infer.
  if (encodingConfig.encoding) {
    config.encoding = encodingConfig.encoding;
  }

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
