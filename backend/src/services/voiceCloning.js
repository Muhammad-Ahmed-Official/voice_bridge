/**
 * Voice Cloning Service
 *
 * Handles:
 *  - Per-socket audio buffering (first ~10 s of speech)
 *  - Instant Voice Cloning via ElevenLabs POST /v1/voices/add
 *  - voice_id persistence to MongoDB
 *  - Cleanup on call end / disconnect
 */

import { ELEVENLABS_API_KEY } from '../config/elevenlabs.config.js';
import { User } from '../models/user.models.js';

// ── In-memory state ──────────────────────────────────────────────────────────
// key: socketId
// val: { chunks: Buffer[], mimeType, startTime, userId, status, voiceId }
const cloneBuffers = new Map();

// ElevenLabs IVC recommends ≥30 s of speech. We use 20 s wall-clock which
// typically yields 12-16 s of voiced audio after VAD silence removal.
// This is a notable improvement over 10 s without making the first clone wait too long.
const CLONE_WINDOW_MS = 20_000; // collect 20 s of wall-clock audio
const MIN_CHUNKS      = 3;      // need at least 3 segments for a usable sample

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Start buffering audio for a socket.
 * Call this when a call is accepted and voiceCloningEnabled === true.
 */
export function initCloneBuffer(socketId, userId) {
  // Clear any leftover state (e.g. reconnect)
  cloneBuffers.delete(socketId);

  cloneBuffers.set(socketId, {
    chunks:      [],
    mimeType:    'audio/webm',
    startTime:   null,   // set on first chunk
    userId,
    status:      'buffering', // 'buffering' | 'cloning' | 'ready' | 'failed'
    voiceId:     null,
    cloneTriggered: false,   // guard: prevent duplicate performVoiceClone calls
  });

  console.log(`[VoiceClone] Buffer initialised for user=${userId} socket=${socketId}`);
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

  // Record start time and mime type from first chunk
  if (state.startTime === null) {
    state.startTime = Date.now();
    // Normalise mime type: keep only the base type for the filename extension
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

/**
 * Return the current clone state for a socket (or null).
 */
export function getCloneState(socketId) {
  return cloneBuffers.get(socketId) ?? null;
}

/**
 * Return the cloned voice_id once ready (or null).
 */
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
    // ── Optionally delete old cloned voice to keep ElevenLabs library clean ──
    await deleteOldClonedVoice(state.userId);

    // ── Build multipart form ──────────────────────────────────────────────────
    // ElevenLabs /v1/voices/add accepts multiple files; send each segment separately
    // so we never need to re-encode/concatenate WebM frames.
    const ext      = state.mimeType.includes('m4a') ? 'm4a' : 'webm';
    const formData = new FormData();
    formData.append('name',        `vc_${state.userId}_${Date.now()}`);
    formData.append('description', `Auto-cloned for ${state.userId}`);

    state.chunks.forEach((buf, i) => {
      const blob = new Blob([buf], { type: state.mimeType });
      formData.append('files', blob, `sample_${i}.${ext}`);
    });

    console.log(
      `[VoiceClone] Uploading ${state.chunks.length} chunk(s) ` +
      `(~${(state.chunks.reduce((a, b) => a + b.length, 0) / 1024).toFixed(1)} KB) ` +
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
      throw new Error(
        `ElevenLabs /v1/voices/add HTTP ${response.status}: ${errText}`,
      );
    }

    const data    = await response.json();
    const voiceId = data.voice_id;
    if (!voiceId) throw new Error('ElevenLabs returned no voice_id');

    // ── Persist to DB so TTS picks it up automatically ───────────────────────
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
    console.error(`[VoiceClone] Failed for user=${state.userId}:`, err.message);
    throw err;
  }
}

/**
 * Remove clone buffer for a socket (call on end-call / disconnect).
 */
export function clearCloneBuffer(socketId) {
  if (cloneBuffers.has(socketId)) {
    cloneBuffers.delete(socketId);
    console.log(`[VoiceClone] Buffer cleared for socket ${socketId}`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Delete the user's previously cloned voice from ElevenLabs to avoid
 * accumulating unused voices in the account library.
 * Silently ignores errors (old voice may already be gone).
 */
async function deleteOldClonedVoice(userId) {
  if (!ELEVENLABS_API_KEY) return;

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
