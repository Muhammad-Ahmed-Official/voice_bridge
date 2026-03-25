import { ELEVENLABS_API_KEY } from '../config/elevenlabs.config.js';
import { User } from '../models/user.models.js';

const cloneBuffers = new Map();

const activeCallUsers = new Set();


const voiceLimitUsers = new Set();

export function markUserCallActive(userId) {
  activeCallUsers.add(userId);
}

export function markUserCallEnded(userId) {
  activeCallUsers.delete(userId);
}


const CLONE_WINDOW_MS = 45_000; // collect 20 s of wall-clock audio
const MIN_CHUNKS      = 3;      // need at least 3 segments for a usable sample


export function initCloneBuffer(socketId, userId) {
  cloneBuffers.delete(socketId);

  const limitReached = voiceLimitUsers.has(userId);

  cloneBuffers.set(socketId, {
    chunks:           [],
    mimeType:         'audio/webm',
    startTime:        null,   // set on first chunk
    userId,
    status:           limitReached ? 'failed' : 'buffering',
    voiceId:          null,
    cloneTriggered:   false,   // guard: prevent duplicate performVoiceClone calls
    voiceLimitReached: limitReached,
  });

  if (limitReached) {
    console.warn(`[VoiceClone] User=${userId} hit voice limit previously — cloning disabled for this session`);
  } else {
    console.log(`[VoiceClone] Buffer initialised for user=${userId} socket=${socketId}`);
  }
}

/**
 * Add a raw audio chunk to the buffer.
 * @param {string} socketId
 * @param {string} audioBase64
 * @param {string} mimeType  - e.g. 'audio/webm;codecs=opus' or 'audio/m4a'
 * @returns {boolean} true when 10 s have elapsed AND we have enough chunks → caller should trigger performVoiceClone()
 */
export function addChunkToCloneBuffer(socketId, audioBase64, mimeType) {
  const state = cloneBuffers.get(socketId);
  if (!state || state.status !== 'buffering') return false;

  if (state.startTime === null) {
    state.startTime = Date.now();
    state.mimeType = mimeType ? mimeType.split(';')[0].trim() : 'audio/webm';
  }

  state.chunks.push(Buffer.from(audioBase64, 'base64'));

  const elapsedMs = Date.now() - state.startTime;
  const shouldTrigger =
    elapsedMs >= CLONE_WINDOW_MS &&
    state.chunks.length >= MIN_CHUNKS &&
    !state.cloneTriggered;

  if (shouldTrigger) {
    state.cloneTriggered = true; // latch: only one caller gets true
  }
  return shouldTrigger;
}


export function getCloneState(socketId) {
  return cloneBuffers.get(socketId) ?? null;
}


export function getClonedVoiceId(socketId) {
  return cloneBuffers.get(socketId)?.voiceId ?? null;
}

/**
 * Upload buffered audio to ElevenLabs Instant Voice Cloning API.
 * Saves the resulting voice_id to MongoDB.
 *
 * @param {string} socketId
 * @returns {Promise<string>} voice_id
 * @throws on API or network failure
 */
export async function performVoiceClone(socketId) {
  const state = cloneBuffers.get(socketId);
  if (!state) throw new Error(`[VoiceClone] No buffer for socket ${socketId}`);

  // Guard: already done or in progress
  if (state.status === 'ready')   return state.voiceId;
  if (state.status === 'cloning') throw new Error('[VoiceClone] Clone already in progress');
  if (state.status === 'failed')  throw new Error('[VoiceClone] Previous clone attempt failed');

  if (state.chunks.length === 0) {
    state.status = 'failed';
    throw new Error('[VoiceClone] No audio data collected — cannot clone');
  }

  state.status = 'cloning';

  try {
    await deleteOldClonedVoice(state.userId);

    const ext        = state.mimeType.includes('m4a') ? 'm4a' : 'webm';
    const totalBytes = state.chunks.reduce((a, b) => a + b.length, 0);
    const combined   = Buffer.concat(state.chunks);
    // ADD THIS CHECK:
    if (combined.length < 50000) { // Approx 50KB minimum for a decent sample
      state.status = 'failed';
      throw new Error('[VoiceClone] Audio sample too small for quality cloning');
    }
    const blob   = new Blob([combined], { type: state.mimeType });

    const formData = new FormData();
    formData.append('name',        `vc_${state.userId}_${Date.now()}`);
    formData.append('description', `Auto-cloned for ${state.userId}`);
    formData.append('remove_background_noise', 'true'); // <--- ADD THIS LINE
    formData.append('files', blob, `voice_sample.${ext}`);

    console.log(
      `[VoiceClone] Uploading 1 concatenated file ` +
      `(${state.chunks.length} segments, ~${(totalBytes / 1024).toFixed(1)} KB) ` +
      `for user=${state.userId}`,
    );

    // ── POST to ElevenLabs Instant Voice Cloning endpoint ────────────────────
    const response = await fetch('https://api.elevenlabs.io/v1/voices/add', {
      method:  'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
      body:    formData,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '(no body)');
      if (errText.includes('voice_limit_reached')) {
        state.voiceLimitReached = true;
        voiceLimitUsers.add(state.userId);
      }
      throw new Error(
        `ElevenLabs /v1/voices/add HTTP ${response.status}: ${errText}`,
      );
    }

    const data    = await response.json();
    const voiceId = data.voice_id;
    if (!voiceId) throw new Error('ElevenLabs returned no voice_id');

    await User.findOneAndUpdate(
      { userId: state.userId },
      { $set: { voiceId } },
      { returnDocument: 'after' },
    );

    state.status  = 'ready';
    state.voiceId = voiceId;

    console.log(`[VoiceClone] Success — user=${state.userId} voice_id=${voiceId}`);
    return voiceId;

  } catch (err) {
    state.status = 'failed';
    console.warn(`[VoiceClone] Failed for user=${state.userId}:`, err.message);
    throw err;
  }
}


export function resetCloneBufferForRetry(socketId) {
  const state = cloneBuffers.get(socketId);
  if (!state) return false;

  if (state.voiceLimitReached) {
    console.warn(`[VoiceClone] Skipping retry for user=${state.userId} — voice limit is permanent`);
    return false;
  }

  state.chunks         = [];
  state.startTime      = null;
  state.status         = 'buffering';
  state.cloneTriggered = false;
  state.voiceId        = null;

  console.log(`[VoiceClone] Buffer reset for retry — user=${state.userId} socket=${socketId}`);
  return true;
}


export function isVoiceLimitReached(socketId) {
  return cloneBuffers.get(socketId)?.voiceLimitReached ?? false;
}


export function clearCloneBuffer(socketId) {
  if (cloneBuffers.has(socketId)) {
    cloneBuffers.delete(socketId);
    console.log(`[VoiceClone] Buffer cleared for socket ${socketId}`);
  }
}

async function deleteOldClonedVoice(userId) {
  if (!ELEVENLABS_API_KEY) return;

  if (activeCallUsers.has(userId)) {
    console.log(`[VoiceClone] Skipping voice deletion for ${userId} — active call in progress`);
    return;
  }

  try {
    const user = await User.findOne({ userId }).lean();
    const oldVoiceId = user?.voiceId;
    if (!oldVoiceId) return;

    const res = await fetch(
      `https://api.elevenlabs.io/v1/voices/${oldVoiceId}`,
      {
        method:  'DELETE',
        headers: { 'xi-api-key': ELEVENLABS_API_KEY },
      },
    );

    if (res.ok) {
      console.log(`[VoiceClone] Deleted old voice ${oldVoiceId} for user=${userId}`);
    }
  } catch (err) {
    console.warn('[VoiceClone] Could not delete old voice (non-fatal):', err.message);
  }
}