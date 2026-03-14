const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';

// Multilingual model suitable for UR/EN/AR and others
const ELEVENLABS_MODEL_ID =
  process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';

// Optional default voice; if not provided we will fall back to Google TTS
const ELEVENLABS_DEFAULT_VOICE_ID =
  process.env.ELEVENLABS_VOICE_ID || '';

export {
  ELEVENLABS_API_KEY,
  ELEVENLABS_MODEL_ID,
  ELEVENLABS_DEFAULT_VOICE_ID,
};

