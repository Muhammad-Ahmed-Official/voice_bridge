import WebSocket from 'ws';
import { ELEVENLABS_API_KEY, ELEVENLABS_MODEL_ID } from '../config/elevenlabs.config.js';


/**
 * Synthesize speech using ElevenLabs REST API.
 * Used internally as a fallback when WebSocket streaming fails.
 * @param {string} text
 * @param {string} voiceId
 * @returns {Promise<string|null>} base64-encoded MP3
 */
async function synthesizeWithElevenLabsRest(text, voiceId) {
  if (!text?.trim() || !voiceId || !ELEVENLABS_API_KEY) return null;

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method:  'POST',
      headers: {
        'xi-api-key':   ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        Accept:         'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL_ID,
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`[ElevenLabs REST] HTTP ${res.status}: ${errText}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('base64');
}


/**
 * Synthesize speech using ElevenLabs WebSocket Streaming API (LOW LATENCY).
 *
 * Calls onChunk(base64Fragment) for every audio fragment as it arrives.
 * Calls onDone() when the stream is complete.
 * Calls onError(err) on unrecoverable error (onDone is NOT called afterward).
 *
 * Returns an abort() function — call it to cleanly terminate an in-progress stream
 * (e.g. when the call ends before TTS finishes).
 *
 * @param {string}   text
 * @param {string}   voiceId
 * @param {function} onChunk  - (base64String) => void
 * @param {function} onDone   - () => void
 * @param {function} onError  - (Error) => void
 * @returns {function} abort
 */
export function synthesizeWithElevenLabsStream(text, voiceId, onChunk, onDone, onError) {
  if (!text?.trim() || !voiceId || !ELEVENLABS_API_KEY) {
    const missing = !ELEVENLABS_API_KEY ? 'API key' : !voiceId ? 'voiceId' : 'text';
    onError?.(new Error(`[ElevenLabs Stream] Missing ${missing}`));
    return () => {};
  }

  const modelId = ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';

  console.log(`[ElevenLabs] Opening WS stream — voice_id=${voiceId} model=${modelId} text="${text.substring(0, 40)}…"`);

  const wsUrl =
    `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input` +
    `?model_id=${modelId}` +
    `&output_format=mp3_44100_128` +
    `&optimize_streaming_latency=3`; // 0–4; 3 = aggressive latency reduction

  const ws = new WebSocket(wsUrl);
  let finalised = false;

  const safetyTimer = setTimeout(() => {
    if (!finalised) {
      const err = new Error('[ElevenLabs Stream] Timeout after 30 s');
      finalised = true;
      onError?.(err);
      ws.terminate();
    }
  }, 30_000);

  const finish = (err) => {
    if (finalised) return;
    finalised = true;
    clearTimeout(safetyTimer);
    try { ws.terminate(); } catch {}
    if (err) {
      onError?.(err);
    } else {
      onDone?.();
    }
  };

  ws.on('open', () => {
    try {
      ws.send(JSON.stringify({
        text: ' ',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.95, 
          style: 0.0,
          use_speaker_boost: true,
        },
        xi_api_key: ELEVENLABS_API_KEY,
      }));

      ws.send(JSON.stringify({ text }));

      ws.send(JSON.stringify({ text: '' }));
    } catch (sendErr) {
      finish(sendErr);
    }
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.audio) {
        onChunk?.(msg.audio);
      }

      if (msg.isFinal) {
        finish(null);
      }
    } catch (parseErr) {
      console.error('[ElevenLabs Stream] message parse error:', parseErr.message);
    }
  });

  ws.on('error', (err) => {
    console.error('[ElevenLabs Stream] WebSocket error:', err.message);
    finish(err);
  });

  ws.on('close', () => {
    finish(null);
  });

  return () => finish(new Error('[ElevenLabs Stream] Aborted'));
}


/**
 * Synthesize speech using ElevenLabs, preferring WebSocket streaming.
 * Collects all streaming chunks and returns the combined base64 MP3.
 * Falls back to REST API if WebSocket streaming fails.
 *
 * @param {string} text
 * @param {string} locale - target locale (for logging; ElevenLabs uses the cloned voice)
 * @param {string} voiceId
 * @returns {Promise<string|null>} base64-encoded MP3
 */
export async function synthesizeWithElevenLabs(text, locale, voiceId) {
  if (!text?.trim() || !voiceId || !ELEVENLABS_API_KEY) return null;

  try {
    const base64Audio = await new Promise((resolve, reject) => {
      const parts = [];

      synthesizeWithElevenLabsStream(
        text,
        voiceId,
        (b64Chunk) => parts.push(Buffer.from(b64Chunk, 'base64')),
        () => {
          if (parts.length === 0) {
            reject(new Error('[ElevenLabs Stream] No audio received'));
          } else {
            resolve(Buffer.concat(parts).toString('base64'));
          }
        },
        reject,
      );
    });

    console.log(`[ElevenLabs] Streaming TTS complete for voiceId=${voiceId}`);
    return base64Audio;

  } catch (streamErr) {
    console.warn(
      '[ElevenLabs] Streaming failed, falling back to REST:',
      streamErr.message,
    );
  }

  try {
    const audio = await synthesizeWithElevenLabsRest(text, voiceId);
    console.log(`[ElevenLabs] REST TTS complete for voiceId=${voiceId}`);
    return audio;
  } catch (restErr) {
    console.error('[ElevenLabs] REST fallback also failed:', restErr.message);
    throw restErr;
  }
}