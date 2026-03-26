import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { translateText } from './translate.js';

const GOOGLE_STT_URL = 'https://speech.googleapis.com/v1/speech:recognize';

const ENCODING_MAP = {
  'audio/webm':               { encoding: 'WEBM_OPUS' },
  'audio/webm;codecs=opus':   { encoding: 'WEBM_OPUS' },
  'audio/ogg':                { encoding: 'OGG_OPUS' },
  'audio/ogg;codecs=opus':    { encoding: 'OGG_OPUS' },
  'audio/l16':                { encoding: 'LINEAR16', sampleRateHertz: 16000 },
  'audio/l16;rate=16000':     { encoding: 'LINEAR16', sampleRateHertz: 16000 },
  'audio/wav':                { encoding: 'LINEAR16', sampleRateHertz: 16000 },
  'audio/amr-wb':             { encoding: 'AMR_WB', sampleRateHertz: 16000 },
  'audio/amr':                { encoding: 'AMR', sampleRateHertz: 8000 },
  'audio/m4a':                {},
  'audio/mp4':                {},
  'audio/aac':                {},
  'audio/mpeg':               {}, // mp3
};

// Languages that can use special models for better recognition
const LANGUAGE_MODEL_MAP = {
  'ur-PK': 'default',       // Best for Urdu (standard model)
  'ar-SA': 'latest_long',   // High-accuracy model for Arabic
  'en-US': 'latest_long',   // Best for conversational English
};


/**
 * Run ffmpeg with the given args, feeding inputBuffer via stdin, returning stdout.
 * Stderr is fully consumed to prevent the child process from blocking on it.
 * A 10 s hard timeout kills a hung ffmpeg process.
 *
 * @param {Buffer}   inputBuffer
 * @param {string[]} args
 * @returns {Promise<Buffer>}
 */
function runFfmpeg(inputBuffer, args) {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, args);
    const outChunks = [];
    const errChunks = [];

    ff.stdout.on('data', (c) => outChunks.push(c));
    ff.stderr.on('data', (c) => errChunks.push(c)); // must drain — ffmpeg blocks if stderr fills

    const timer = setTimeout(() => {
      ff.kill('SIGKILL');
      reject(new Error('ffmpeg timed out after 10 s'));
    }, 10_000);

    ff.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const msg = Buffer.concat(errChunks).toString().slice(-300); // last 300 chars of stderr
        return reject(new Error(`ffmpeg exited ${code}: ${msg}`));
      }
      const out = Buffer.concat(outChunks);
      // A valid WAV file has at least a 44-byte header; anything less is an empty/failed output
      if (out.length < 44) {
        return reject(new Error(`ffmpeg output too small (${out.length} bytes) — conversion produced no audio`));
      }
      resolve(out);
    });

    ff.on('error', (err) => { clearTimeout(timer); reject(err); });

    // Write the entire input then close stdin so ffmpeg sees EOF
    ff.stdin.write(inputBuffer);
    ff.stdin.end();
  });
}

/**
 * Convert a complete M4A buffer to LINEAR16 WAV (16 kHz, mono).
 * Attempts twice: first with an explicit MP4 container hint, then without.
 *
 * @param {string} audioBase64  - base64-encoded M4A bytes
 * @returns {Promise<string>}   - base64-encoded WAV bytes
 * @throws if both attempts fail
 */
async function convertM4aToLinear16Wav(audioBase64) {
  const inputBuffer = Buffer.from(audioBase64, 'base64');

  const BASE_ARGS = [
    '-y',
    '-i', 'pipe:0',        // read from stdin
    '-f', 'wav',           // output format: WAV container
    '-acodec', 'pcm_s16le',// codec: signed 16-bit little-endian PCM
    '-ar', '16000',        // sample rate: 16 kHz (Google STT optimal)
    '-ac', '1',            // channels: mono
    'pipe:1',              // write to stdout
  ];

  // Attempt 1: explicit MP4 format hint — fastest, works for standard Expo recordings
  try {
    const wav = await runFfmpeg(inputBuffer, ['-f', 'mp4', ...BASE_ARGS]);
    return wav.toString('base64');
  } catch (firstErr) {
    console.warn(`[STT] ffmpeg attempt 1 (mp4 hint) failed: ${firstErr.message} — retrying`);
  }

  // Attempt 2: no format hint — let ffmpeg probe the container
  const wav = await runFfmpeg(inputBuffer, BASE_ARGS);
  return wav.toString('base64');
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

 
  if (mimeType === 'audio/m4a') {
    console.log('[STT] Converting audio/m4a → LINEAR16 WAV (16 kHz mono)');
    try {
      audioBase64 = await convertM4aToLinear16Wav(audioBase64);
      mimeType = 'audio/wav';
      console.log('[STT] M4A conversion OK');
    } catch (err) {
      throw new Error(`M4A→WAV conversion failed — chunk skipped: ${err.message}`);
    }
  }

  
  const encodingConfig = ENCODING_MAP[mimeType] ?? { encoding: 'WEBM_OPUS' };


  // Urdu (ur-PK) does not support the enhanced model — only EN and AR do.
  const model = isFallback ? 'default' : (LANGUAGE_MODEL_MAP[languageCode] ?? 'default');
  const supportsEnhanced = !isFallback && (languageCode === 'en-US' || languageCode === 'ar-SA');

  console.log(`[STT] Processing: mimeType=${mimeType}, encoding=${encodingConfig.encoding}, lang=${languageCode}`);

  const config = {
    languageCode,
    alternativeLanguageCodes: [],
    enableAutomaticPunctuation: true,
    model,
    useEnhanced: supportsEnhanced,  // false for ur-PK — avoids guaranteed 400 + retry
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

    // --- Find this part at the end of transcribeAudio ---
  const transcript = data.results?.[0]?.alternatives?.[0]?.transcript ?? '';
  if (transcript.trim()) {
    console.log(`[STT] Recognized (${languageCode}): "${transcript}"`);
    return transcript;
  }
  return transcript;
}
  


// const targetLanguage = options?.targetLanguage || 'en-US'; 
// try {
//   const translationResult = await translateText(transcript, languageCode, targetLanguage);
//   if (translationResult.success) {
//     console.log(`[STT] Final Translated Text: "${translationResult.text}"`);
//     return translationResult.text; // This text goes to ElevenLabs
//   }
// } catch (transError) {  
//   console.error('[STT] Translation error, falling back to original:', transError.message);
// }


// const transcript = data.results?.[0]?.alternatives?.[0]?.transcript ?? '';
// // Only log non-empty transcripts to reduce noise
// if (transcript.trim()) {
//   console.log(`[STT] Transcript (${languageCode}): "${transcript}"`);
// }
// return transcript;
// const config = {
//   languageCode,
//   enableAutomaticPunctuation: true,
//   model,
//   ...(supportsEnhanced ? { useEnhanced: true } : {}),
// };