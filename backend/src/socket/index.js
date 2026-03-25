import { Server } from 'socket.io';
import {
  registerUser,
  unregisterUser,
  getSocketIdForUser,
  createRoom,
  getRoom,
  deleteRoom,
  getRoomForSocket,
  getOtherParticipant,
  addDiscoverableUser,
  removeDiscoverableUser,
  getAllDiscoverableUsers,
} from './roomManager.js';
import {
  createMeeting,
  addInvitedParticipant,
  participantJoined,
  participantLeft,
  getMeeting,
  getMeetingForSocket,
  getJoinedParticipants,
  getAllParticipantEntries,
  deleteMeeting,
  isHost,
} from './meetingManager.js';
import { translateText } from '../services/translate.js';
import { transcribeAudio } from '../services/stt.js';
import { getTtsForUser } from '../services/tts.js';
import {
  initCloneBuffer,
  addChunkToCloneBuffer,
  getCloneState,
  getClonedVoiceId,
  performVoiceClone,
  clearCloneBuffer,
  resetCloneBufferForRetry,
  isVoiceLimitReached,
  markUserCallActive,
  markUserCallEnded,
} from '../services/voiceCloning.js';
import { User } from '../models/user.models.js';

const LOCALE_MAP  = { UR: 'ur-PK', EN: 'en-US', AR: 'ar-SA' };
const VALID_LANGS = new Set(['UR', 'EN', 'AR']);

// ── Pipeline state maps ───────────────────────────────────────────────────────

// Text buffering: accumulate STT results before translating (reduces API calls)
// key: `${roomId}_${socketId}` → { text, timeout }
const textBuffers = new Map();
const BUFFER_DELAY_MS = 1500; // flush after 1.5s of silence

// STT deduplication: reject new chunk if one is already in-flight for this socket.
// Prevents duplicate STT requests when two chunks arrive faster than STT responds.
// key: socketId → true
const sttInFlight = new Map();

// TTS delivery tracking: tells the RECEIVER client when to gate its microphone.
// key: receiverSocketId → true
const ttsInFlight = new Map();

// Rooms being gracefully torn down
const roomsClosing = new Set();

function broadcastDiscoverableList(io) {
  const all = getAllDiscoverableUsers();
  all.forEach(({ userId, socketId }) => {
    const others = all
      .filter(u => u.userId !== userId)
      .map(({ userId, name }) => ({ userId, name }));
    io.to(socketId).emit('discoverable-users', others);
  });
}

/**
 * resolveAudioStrategy
 *
 * Single decision point for the entire audio pipeline.
 * Determines what the backend should do with the sender's audio RIGHT NOW,
 * based on cloning config, clone state, and voice-limit status.
 *
 * Strategies:
 *   'passthrough'  — forward raw audio to receiver + produce text captions async
 *                    Used when: clone is ON but not yet ready, or limit was hit
 *   'cloned-tts'   — STT → translate → TTS using the sender's cloned voice
 *                    Used when: clone is ON and voice_id is available
 *   'tts'          — STT → translate → TTS using default voice
 *                    Used when: clone is OFF for this sender
 *
 * @param {object} room            - Room object from roomManager
 * @param {string} senderSocketId
 * @returns {{ strategy, cloneVoiceId, receiver, sender,
 *             speakLang, hearLang, sttLocale, ttsLocale }}
 */
function resolveAudioStrategy(room, senderSocketId) {
  const isUserA  = room.userA.socketId === senderSocketId;
  const sender   = isUserA ? room.userA : room.userB;
  const receiver = isUserA ? room.userB : room.userA;

  const speakLang = sender.speakLang;
  const hearLang  = receiver.hearLang;
  const sttLocale = LOCALE_MAP[speakLang] ?? 'en-US';
  const ttsLocale = LOCALE_MAP[hearLang]  ?? 'en-US';

  const senderCloningEnabled = !!sender.voiceCloningEnabled;
  const cloneState           = getCloneState(senderSocketId);
  const cloneVoiceId         = cloneState?.voiceId ?? null;
  const limitReached         = cloneState?.voiceLimitReached ?? false;

  let strategy;
  if (!senderCloningEnabled) {
    // Case 3 / Case 2 (this sender has cloning OFF) → standard TTS
    strategy = 'tts';
  } else if (limitReached) {
    // Voice limit hit — graceful passthrough, no more clone attempts
    strategy = 'passthrough';
  } else if (cloneVoiceId) {
    // Clone ready → use it for TTS synthesis
    strategy = 'cloned-tts';
  } else {
    // Clone ON but still buffering/cloning → passthrough in the meantime
    strategy = 'passthrough';
  }

  // ── Pipeline invariant assertions (dev only) ─────────────────────────────
  // These catch any future refactor that accidentally breaks sender/receiver separation.
  if (process.env.NODE_ENV !== 'production') {
    if (sttLocale !== (LOCALE_MAP[speakLang] ?? 'en-US')) {
      console.error(`[INVARIANT] sttLocale="${sttLocale}" !== LOCALE_MAP[sender.speakLang="${speakLang}"]`);
    }
    if (ttsLocale !== (LOCALE_MAP[hearLang] ?? 'en-US')) {
      console.error(`[INVARIANT] ttsLocale="${ttsLocale}" !== LOCALE_MAP[receiver.hearLang="${hearLang}"]`);
    }
    if (speakLang === sender.hearLang && sender.hearLang !== receiver.hearLang) {
      console.warn(`[SUSPECT] speakLang="${speakLang}" matches sender.hearLang — check field ownership`);
    }
  }

  // ── Route log: shows all four key values in one line ─────────────────────
  console.log(
    `[Route] ${sender.userId}(speaks=${speakLang}) → ${receiver.userId}(hears=${hearLang})` +
    ` | stt=${sttLocale} tts=${ttsLocale} | strategy=${strategy}` +
    (cloneVoiceId ? ` | clone=${cloneVoiceId.slice(0, 8)}…` : ''),
  );

  return { strategy, cloneVoiceId, receiver, sender, speakLang, hearLang, sttLocale, ttsLocale, senderCloningEnabled };
}

/**
 * bufferAndTranslate
 *
 * Accumulates STT results until BUFFER_DELAY_MS of silence, then:
 *   captionOnly=false (cloning OFF):  translate → TTS → deliver audio + text to receiver
 *   captionOnly=true  (cloning ON):   translate → deliver text caption only (no TTS audio)
 *
 *   Steps for captionOnly=false:
 *   1. Translates accumulated text  (speakLang → hearLang)
 *   2. Synthesises TTS audio        (in hearLang)
 *   3. Notifies receiver to PAUSE microphone  (tts-start)
 *   4. Delivers audio + text to receiver
 *   5. Receiver will ACK tts-end after playback → resumes its mic
 */
function bufferAndTranslate(io, socket, roomId, text, speakLang, hearLang, receiver, ttsLocale, captionOnly = false, senderCloningEnabled = false) {
  const key = `${roomId}_${socket.id}`;
  const buffer = textBuffers.get(key) || { text: '', timeout: null };

  if (buffer.timeout) clearTimeout(buffer.timeout);
  buffer.text = buffer.text ? `${buffer.text} ${text}` : text;

  buffer.timeout = setTimeout(async () => {
    const fullText = buffer.text.trim();
    textBuffers.delete(key);
    if (!fullText) return;

    // Same-language: no translation or TTS delivery needed.
    // The receiver already speaks this language (or is hearing via passthrough).
    if (speakLang === hearLang) {
      socket.emit('speech-transcript', { text: fullText });
      return;
    }

    const room = getRoom(roomId);
    if (!room || roomsClosing.has(roomId)) return;

    console.log(`\n[Pipeline] ${socket.data.userId} → "${fullText}" (${speakLang}→${hearLang})`);

    try {
      // ── 1. Translate ──────────────────────────────────────────────────────
      const result = await translateText(fullText, speakLang, hearLang);
      if (!result.success) {
        socket.emit('translation-error', { text: fullText, error: 'Translation unavailable' });
        return;
      }
      console.log(`[Pipeline] Translated: "${result.text}" captionOnly=${captionOnly}`);

      // ── Caption-only path (cloning ON): deliver text with no audio ────────
      // The receiver is already hearing the sender's real voice via audio-passthrough.
      // We just send the translated text so the receiver can read the caption.
      if (captionOnly) {
        io.to(receiver.socketId).emit('translated-text', {
          text:        result.text,
          audioBase64: null,
          fromUserId:  socket.data.userId,
          captionOnly: true,
        });
        socket.emit('speech-transcript', { text: fullText });
        return;
      }

      // ── 2. Synthesise TTS (cloning OFF) ──────────────────────────────────
      // Re-fetch clonedVoiceId here (not at call-time) so we always get the
      // most current value. The clone may complete during the buffer window.
      const freshCloneVoiceId = getClonedVoiceId(socket.id);

      const ttsAudio = await getTtsForUser({
        text:              result.text,
        locale:            ttsLocale,            // ← receiver's hearLang locale
        speakerUserId:     socket.data.userId,
        clonedVoiceId:     freshCloneVoiceId,    // ← always fresh at flush time
        cloningEnabled:    senderCloningEnabled, // ← skips DB lookup when cloning is off
      }).catch((err) => {
        console.warn('[Pipeline] TTS failed, delivering text-only to receiver:', err.message);
        return null;
      });

      // ── 3. Signal receiver to PAUSE microphone before playing audio ───────
      if (ttsAudio) {
        ttsInFlight.set(receiver.socketId, true);
        io.to(receiver.socketId).emit('tts-start', { fromUserId: socket.data.userId });

        // Auto-clear after 60 s safety net — prevents permanently muted mic
        // if the receiver client crashes or never sends tts-end.
        setTimeout(() => {
          if (ttsInFlight.get(receiver.socketId)) {
            ttsInFlight.delete(receiver.socketId);
            console.log(`[TTS] Auto-cleared ttsInFlight for ${receiver.userId} (60 s safety timeout)`);
          }
        }, 60_000);
      }

      // ── 4. Deliver translated audio to receiver ───────────────────────────
      io.to(receiver.socketId).emit('translated-text', {
        text:        result.text,
        audioBase64: ttsAudio,
        fromUserId:  socket.data.userId,
        captionOnly: false,
      });

      // Echo raw transcript to the speaker's own tile
      socket.emit('speech-transcript', { text: fullText });

    } catch (err) {
      console.error('[Pipeline Error]', err.message);
      socket.emit('translation-error', { text: fullText, error: err.message });
    }
  }, BUFFER_DELAY_MS);

  textBuffers.set(key, buffer);
}

/**
 * Clear all buffers for a room (used during cleanup)
 */
function clearRoomBuffers(roomId) {
  for (const [key, buffer] of textBuffers.entries()) {
    if (key.startsWith(`${roomId}_`)) {
      if (buffer.timeout) clearTimeout(buffer.timeout);
      textBuffers.delete(key);
    }
  }
}

export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, cb) => {
        // Allow:
        //  • no origin (curl, Postman, React Native fetch which sends no Origin)
        //  • localhost / 127.0.0.1 (web dev server)
        //  • any 192.168.x.x / 10.x.x.x LAN address (Expo Go on physical device)
        //  • deployed domains
        if (!origin) return cb(null, true);
        if (
          origin.startsWith('http://localhost:')     ||
          origin.startsWith('http://127.0.0.1:')     ||
          origin.startsWith('https://voice-bridge-backend-xq5w.onrender.com') 
          // ||
          // // LAN ranges used by Expo Go on a physical device
          // /^https?:\/\/192\.168\.\d+\.\d+/.test(origin) ||
          // /^https?:\/\/10\.\d+\.\d+\.\d+/.test(origin)  ||
          // /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+/.test(origin)
        ) {
          return cb(null, true);
        }
        cb(null, false);
      },
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log(`[socket] connected: ${socket.id}`);

    // ── register ────────────────────────────────────────────────────────────
    socket.on('register', ({ userId, odId }) => {
      socket.data.userId = userId;
      socket.data.odId = odId;
      registerUser(userId, socket.id);
      console.log(`[socket] registered: ${userId} (${odId || 'no _id'}) → ${socket.id}`);
    });

    // ── start-discoverable ───────────────────────────────────────────────────
    socket.on('start-discoverable', ({ userId, name }) => {
      addDiscoverableUser(userId, socket.id, name);
      console.log(`[BT] ${userId} is now discoverable`);
      broadcastDiscoverableList(io);
    });

    // ── stop-discoverable ────────────────────────────────────────────────────
    socket.on('stop-discoverable', ({ userId }) => {
      removeDiscoverableUser(userId);
      console.log(`[BT] ${userId} left discoverable mode`);
      broadcastDiscoverableList(io);
    });

    // ── call-user ────────────────────────────────────────────────────────────
    socket.on('call-user', ({ targetUserId, callerName, speakLang, hearLang }) => {
      // Prevent self-calling
      if (targetUserId === socket.data.userId) {
        socket.emit('call-error', { message: 'You cannot call yourself.' });
        return;
      }
      // Validate language codes before storing — an empty string or unknown
      // code would silently corrupt every downstream language-routing decision.
      if (!VALID_LANGS.has(speakLang) || !VALID_LANGS.has(hearLang)) {
        socket.emit('call-error', {
          message: `Invalid language configuration (speakLang=${speakLang}, hearLang=${hearLang}). Expected: UR | EN | AR`,
        });
        console.warn(`[call-user] Rejected invalid langs from ${socket.data.userId}: speak=${speakLang} hear=${hearLang}`);
        return;
      }
      const targetSocketId = getSocketIdForUser(targetUserId);
      if (!targetSocketId) {
        socket.emit('call-error', { message: `User "${targetUserId}" is not online.` });
        return;
      }
      // Persist caller's lang prefs so accept-call can read them
      socket.data.speakLang = speakLang;
      socket.data.hearLang  = hearLang;

      io.to(targetSocketId).emit('incoming-call', {
        callerId: socket.data.userId,
        callerName: callerName || socket.data.userId,
      });
    });

    // ── accept-call ──────────────────────────────────────────────────────────
    socket.on('accept-call', async ({ callerId, speakLang, hearLang }) => {
      const callerSocketId = getSocketIdForUser(callerId);
      if (!callerSocketId) {
        socket.emit('call-error', { message: 'Caller is no longer online.' });
        return;
      }

      const callerSocket = io.sockets.sockets.get(callerSocketId);
      const roomId = `${callerId}_${socket.data.userId}_${Date.now()}`;

      // Validate caller's stored language prefs (set during call-user).
      // If they are missing or invalid, reject instead of silently using wrong defaults.
      const rawSpeakA = callerSocket?.data.speakLang;
      const rawHearA  = callerSocket?.data.hearLang;
      if (!VALID_LANGS.has(rawSpeakA) || !VALID_LANGS.has(rawHearA)) {
        socket.emit('call-error', {
          message: 'Caller language configuration is missing or invalid. Please retry the call.',
        });
        console.error(
          `[accept-call] REJECTED room — caller ${callerId} has invalid langs: ` +
          `speakLang=${rawSpeakA} hearLang=${rawHearA}`,
        );
        return;
      }

      // voiceCloningEnabled defaults to false; updated below after DB fetch.
      // Stored on the room object so audio-chunk can read it without a DB call per chunk.
      const userA = {
        socketId:            callerSocketId,
        odId:                callerSocket?.data.odId || null,
        userId:              callerId,
        speakLang:           rawSpeakA,   // validated — no silent fallback
        hearLang:            rawHearA,    // validated — no silent fallback
        voiceCloningEnabled: false,
      };
      const userB = {
        socketId: socket.id,
        odId: socket.data.odId || null,
        userId: socket.data.userId,
        speakLang,
        hearLang,
        voiceCloningEnabled: false,
      };

      createRoom(roomId, userA, userB);
      markUserCallActive(callerId);
      markUserCallActive(socket.data.userId);

      console.log(`\n╔════════════════════════════════════════════════════════════════════════╗`);
      console.log(`║                         CALL STARTED - ROOM CONFIG                      ║`);
      console.log(`╠════════════════════════════════════════════════════════════════════════╣`);
      console.log(`║  UserA: ${userA.userId.padEnd(15)} │ Speaks: ${userA.speakLang.padEnd(4)} │ Hears: ${userA.hearLang.padEnd(4)}        ║`);
      console.log(`║  UserB: ${userB.userId.padEnd(15)} │ Speaks: ${userB.speakLang.padEnd(4)} │ Hears: ${userB.hearLang.padEnd(4)}        ║`);
      console.log(`╠════════════════════════════════════════════════════════════════════════╣`);
      console.log(`║  UserA speaks ${userA.speakLang.padEnd(2)} → STT(${userA.speakLang}) → Translate(${userA.speakLang}→${userB.hearLang}) → TTS(${userB.hearLang}) → UserB ║`);
      console.log(`║  UserB speaks ${userB.speakLang.padEnd(2)} → STT(${userB.speakLang}) → Translate(${userB.speakLang}→${userA.hearLang}) → TTS(${userA.hearLang}) → UserA ║`);
      console.log(`╚════════════════════════════════════════════════════════════════════════╝\n`);

      // Remove both users from discoverable list when a call starts
      removeDiscoverableUser(callerId);
      removeDiscoverableUser(socket.data.userId);
      broadcastDiscoverableList(io);

      // ── Voice Cloning: init buffers for users who have it enabled ────────
      try {
        const [userADoc, userBDoc] = await Promise.all([
          User.findOne({ userId: callerId }).lean(),
          User.findOne({ userId: socket.data.userId }).lean(),
        ]);

        // Persist cloning preference on the room objects (mutating in-place is safe
        // because createRoom stores a reference to the same object).
        userA.voiceCloningEnabled = !!userADoc?.voiceCloningEnabled;
        userB.voiceCloningEnabled = !!userBDoc?.voiceCloningEnabled;

        console.log(`[VoiceClone] Cloning flags — ${callerId}: ${userA.voiceCloningEnabled} | ${socket.data.userId}: ${userB.voiceCloningEnabled}`);

        if (userA.voiceCloningEnabled) {
          initCloneBuffer(callerSocketId, callerId);
          io.to(callerSocketId).emit('clone-started', {
            status: 'buffering',
            message: 'Recording your voice for cloning…',
          });
        }

        if (userB.voiceCloningEnabled) {
          initCloneBuffer(socket.id, socket.data.userId);
          socket.emit('clone-started', {
            status: 'buffering',
            message: 'Recording your voice for cloning…',
          });
        }
      } catch (cloneInitErr) {
        // Non-fatal — call still proceeds with default TTS
        console.warn('[VoiceClone] Could not init clone buffer:', cloneInitErr.message);
      }

      // Notify caller
      io.to(callerSocketId).emit('call-accepted', {
        roomId,
        peerOdId: userB.odId,
        peerUserId: userB.userId,
        peerSpeakLang: userB.speakLang,
        peerHearLang: userB.hearLang,
      });

      // Notify accepter
      socket.emit('call-accepted', {
        roomId,
        peerOdId: userA.odId,
        peerUserId: userA.userId,
        peerSpeakLang: userA.speakLang,
        peerHearLang: userA.hearLang,
      });

      console.log(`[socket] room created: ${roomId}`);
    });

    // ── decline-call ─────────────────────────────────────────────────────────
    socket.on('decline-call', ({ callerId }) => {
      const callerSocketId = getSocketIdForUser(callerId);
      if (callerSocketId) {
        io.to(callerSocketId).emit('call-declined');
      }
    });

    // ── speech-text → translate → TTS → peer ─────────────────────────────────
    // Used when the client sends text directly (typed input fallback).
    // Language routing: same resolveAudioStrategy() rules apply.
    socket.on('speech-text', async ({ roomId, text }) => {
      const room = getRoom(roomId);
      if (!room) return;

      const { ttsLocale, speakLang, hearLang, receiver, cloneVoiceId } =
        resolveAudioStrategy(room, socket.id);

      if (speakLang === hearLang) {
        socket.emit('speech-transcript', { text });
        return;
      }

      try {
        const result = await translateText(text, speakLang, hearLang);
        if (!result.success) {
          socket.emit('translation-error', { text, error: 'Translation unavailable' });
          return;
        }

        const ttsAudio = await getTtsForUser({
          text:          result.text,
          locale:        ttsLocale,
          speakerUserId: socket.data.userId,
          clonedVoiceId: cloneVoiceId,
        }).catch(() => null);

        if (ttsAudio) {
          ttsInFlight.set(receiver.socketId, true);
          io.to(receiver.socketId).emit('tts-start', { fromUserId: socket.data.userId });
        }

        io.to(receiver.socketId).emit('translated-text', {
          text:        result.text,
          audioBase64: ttsAudio,
          fromUserId:  socket.data.userId,
        });
      } catch (err) {
        console.warn('[speech-text error]', err.message);
        socket.emit('translation-error', { text, error: err.message });
      }
    });

    // ── audio-chunk → STT → buffer → translate → TTS → peer ─────────────────
    //
    // Security / quality gates applied in order:
    //   1. Reject if room is closing
    //   2. Buffer audio for voice cloning (runs BEFORE STT gates so we capture
    //      all speech even when STT is temporarily skipped)
    //   3. Reject duplicate: if a previous STT call is still in-flight for this
    //      socket, skip — the VAD recorder already sends one segment per utterance
    //      but network retries or overlapping segments would cause duplicates.
    //   4. Run Google STT with the SPEAKER's language (speakLang)
    //   5. Buffer and translate using resolveAudioStrategy() — STT lang ≠ TTS lang
    //   6. TTS uses the RECEIVER's hearLang (enforced in bufferAndTranslate)
    socket.on('audio-chunk', async ({ roomId, audioBase64, mimeType }) => {
      if (!roomId) { console.warn('[STT] audio-chunk missing roomId from', socket.data.userId); return; }
      if (roomsClosing.has(roomId)) return;

      const room = getRoom(roomId);
      if (!room) { console.warn('[STT] room not found:', roomId, '— user:', socket.data.userId); return; }

      // ── Resolve strategy FIRST so we know if cloning is even active ───────
      const { strategy, cloneVoiceId, receiver, speakLang, hearLang, sttLocale, ttsLocale, senderCloningEnabled } =
        resolveAudioStrategy(room, socket.id);

      // ── Voice Cloning: buffer audio for pending clone (runs BEFORE STT) ──
      // Only buffer when the sender has cloning ON and the clone isn't done yet.
      // Skip entirely when limit was hit (status='failed', voiceLimitReached=true).
      if (strategy === 'passthrough' && !isVoiceLimitReached(socket.id)) {
        const cloneState = getCloneState(socket.id);
        if (cloneState?.status === 'buffering' && audioBase64) {
          const readyToClone = addChunkToCloneBuffer(socket.id, audioBase64, mimeType);

          if (readyToClone) {
            // Async — do not block the audio pipeline
            performVoiceClone(socket.id)
              .then((voiceId) => {
                socket.emit('clone-ready', {
                  status:  'ready',
                  voiceId,
                  message: 'Your voice has been cloned! Using cloned voice for translations.',
                });
              })
              .catch((err) => {
                if (err.message.includes('already in progress')) return;

                const isLimitError = err.message.includes('voice_limit_reached');

                if (isLimitError) {
                  // Permanent account-level limit — warn once, no retry
                  console.warn(
                    `[VoiceClone] Voice limit reached for user=${socket.data.userId} ` +
                    `— cloning disabled for this session`,
                  );
                } else {
                  // Transient error — schedule one retry after 20 s
                  console.warn(`[VoiceClone] Transient failure for user=${socket.data.userId}:`, err.message);
                  setTimeout(() => {
                    const stillInRoom = getRoomForSocket(socket.id);
                    if (stillInRoom && resetCloneBufferForRetry(socket.id)) {
                      socket.emit('clone-started', {
                        status:  'buffering',
                        message: 'Retrying voice cloning…',
                      });
                    }
                  }, 20_000);
                }

                // Silently inform the UI — never show raw error text
                socket.emit('clone-failed', { status: 'failed', message: 'Using original voice' });
              });
          }
        }
      }

      // ══════════════════════════════════════════════════════════════════════
      // Strategy: passthrough — forward real voice + produce captions async
      // ══════════════════════════════════════════════════════════════════════
      if (strategy === 'passthrough') {
        io.to(receiver.socketId).emit('audio-passthrough', { audioBase64, mimeType });

        // Caption pipeline: async, non-blocking — produces translated text
        // for the receiver to read while hearing the speaker's original voice.
        if (!sttInFlight.get(socket.id)) {
          sttInFlight.set(socket.id, true);
          (async () => {
            try {
              const text = await transcribeAudio(audioBase64, sttLocale, mimeType);
              if (!text.trim()) return;
              socket.emit('speech-transcript', { text });
              bufferAndTranslate(io, socket, roomId, text, speakLang, hearLang, receiver, ttsLocale, true, senderCloningEnabled);
            } catch (err) {
              console.warn('[Caption STT Error]', err.message);
            } finally {
              sttInFlight.delete(socket.id);
            }
          })();
        }
        return;
      }

      // ══════════════════════════════════════════════════════════════════════
      // Strategy: tts | cloned-tts — STT → translate → TTS synthesis
      // ══════════════════════════════════════════════════════════════════════

      // Gate 0: same-language shortcut — no translation needed.
      // The receiver already understands this language, but since there is no
      // WebRTC direct audio they still need to hear via passthrough.
      if (speakLang === hearLang) {
        io.to(receiver.socketId).emit('audio-passthrough', { audioBase64, mimeType });
        // Still transcribe so sender sees their own words on their tile.
        if (!sttInFlight.get(socket.id)) {
          sttInFlight.set(socket.id, true);
          transcribeAudio(audioBase64, sttLocale, mimeType)
            .then(text => { if (text?.trim()) socket.emit('speech-transcript', { text }); })
            .catch(() => {})
            .finally(() => sttInFlight.delete(socket.id));
        }
        return;
      }

      // Gate 1: drop chunk if a previous STT call is still in-flight
      if (sttInFlight.get(socket.id)) return;
      // Gate 2: drop chunk while receiver is playing TTS (prevents echo)
      if (ttsInFlight.get(socket.id)) return;

      sttInFlight.set(socket.id, true);
      try {
        const text = await transcribeAudio(audioBase64, sttLocale, mimeType);
        if (!text.trim()) return; // pure silence — discard

        console.log(`[STT] ${socket.data.userId}: "${text}" (${speakLang}→${hearLang}) [${strategy}]`);
        socket.emit('speech-transcript', { text });
        bufferAndTranslate(io, socket, roomId, text, speakLang, hearLang, receiver, ttsLocale, false, senderCloningEnabled);

      } catch (err) {
        console.warn('[STT Error]', err.message);
      } finally {
        sttInFlight.delete(socket.id);
      }
    });

    // ── tts-end: receiver signals playback finished → re-enable its mic ──────
    // Frontend calls this after the TTS audio element fires 'ended'.
    socket.on('tts-end', () => {
      ttsInFlight.delete(socket.id);
      console.log(`[TTS] Receiver ${socket.data.userId} finished playback — mic re-enabled`);
    });

    // ── end-call ──────────────────────────────────────────────────────────────
    socket.on('end-call', ({ roomId }) => {
      const room = getRoom(roomId);
      if (!room) return;

      // Mark room as closing to stop processing new audio
      roomsClosing.add(roomId);

      // Clear voice clone buffers + active-call guard for both participants
      clearCloneBuffer(room.userA.socketId);
      clearCloneBuffer(room.userB.socketId);
      markUserCallEnded(room.userA.userId);
      markUserCallEnded(room.userB.userId);

      // Notify both users that call is ending
      io.to(room.userA.socketId).emit('call-ended', { roomId });
      io.to(room.userB.socketId).emit('call-ended', { roomId });

      console.log(`[socket] call ending: ${roomId}`);

      // Wait for any in-flight audio pipelines to complete, then cleanup
      setTimeout(() => {
        clearRoomBuffers(roomId);
        deleteRoom(roomId);
        roomsClosing.delete(roomId);
        console.log(`[socket] room deleted: ${roomId}`);
      }, 1000);
    });

    // ── create-meeting ────────────────────────────────────────────────────────
    socket.on('create-meeting', ({ meetingId, hostSpeakLang, hostHearLang, invitees }) => {
      console.log("OK")
      const hostUserId = socket.data.userId;
      if (!hostUserId) {
        socket.emit('meeting-error', { message: 'Not registered.' });
        return;
      }
      if (!Array.isArray(invitees) || invitees.length < 2 || invitees.length > 4) {
        socket.emit('meeting-error', { message: 'Invitees must be between 2 and 4.' });
        return;
      }

      // Resolve all invitee sockets and validate online / not-busy
      const resolved = [];
      for (const inv of invitees) {
        const sid = getSocketIdForUser(inv.userId);
        if (!sid) {
          socket.emit('meeting-error', { message: `User "${inv.userId}" is not online.` });
          return;
        }
        if (getRoomForSocket(sid) || getMeetingForSocket(sid)) {
          socket.emit('meeting-error', { message: `User "${inv.userId}" is currently busy.` });
          return;
        }
        resolved.push({ ...inv, socketId: sid });
      }

      // Build meeting
      const hostEntry = {
        userId: hostUserId,
        socketId: socket.id,
        speakLang: hostSpeakLang,
        hearLang: hostHearLang,
      };
      createMeeting(meetingId, hostEntry);
      for (const inv of resolved) {
        addInvitedParticipant(meetingId, inv.userId, inv.speakLang, inv.hearLang);
      }

      const config = getAllParticipantEntries(meetingId).map(e => ({
        userId: e.userId, speak: e.speakLang, hear: e.hearLang, status: e.status,
      }));

      socket.emit('meeting-created', { meetingId, config });

      for (const inv of resolved) {
        io.to(inv.socketId).emit('incoming-meeting-invite', {
          meetingId,
          hostUserId,
          hostName: hostUserId,
          totalParticipants: invitees.length + 1,
        });
      }

      console.log(`[Meeting] ${hostUserId} created meeting ${meetingId}`);
    });

    // ── join-meeting ──────────────────────────────────────────────────────────
    socket.on('join-meeting', ({ meetingId, speakLang, hearLang }) => {
      const userId = socket.data.userId;
      const room = getMeeting(meetingId);
      if (!room) {
        socket.emit('meeting-error', { message: 'Meeting not found.' });
        return;
      }
      if (!room.participants.has(userId)) {
        socket.emit('meeting-error', { message: 'You were not invited to this meeting.' });
        return;
      }

      participantJoined(meetingId, userId, socket.id, speakLang, hearLang);

      const allEntries = getAllParticipantEntries(meetingId);
      const config = allEntries.map(e => ({
        userId: e.userId, speak: e.speakLang, hear: e.hearLang, status: e.status,
      }));

      socket.emit('meeting-joined-ack', { meetingId, config });

      // Notify all other joined participants
      const joined = getJoinedParticipants(meetingId);
      joined.forEach(p => {
        if (p.socketId !== socket.id) {
          io.to(p.socketId).emit('meeting-participant-joined', {
            meetingId, userId, speakLang, hearLang, updatedConfig: config,
          });
        }
      });

      console.log(`[Meeting] ${userId} joined meeting ${meetingId}`);
    });

    // ── decline-meeting ───────────────────────────────────────────────────────
    socket.on('decline-meeting', ({ meetingId, hostUserId }) => {
      const userId = socket.data.userId;
      const hostSocketId = getSocketIdForUser(hostUserId);
      if (hostSocketId) {
        io.to(hostSocketId).emit('meeting-participant-declined', { meetingId, userId });
      }
      participantLeft(meetingId, userId);
      console.log(`[Meeting] ${userId} declined meeting ${meetingId}`);
    });

    // ── meeting-speech-text → translate → all joined peers ───────────────────
    socket.on('meeting-speech-text', async ({ meetingId, text }) => {
      const room = getMeeting(meetingId);
      if (!room) return;

      const senderId = socket.data.userId;
      const senderEntry = room.participants.get(senderId);
      if (!senderEntry) return;

      const fromLang = senderEntry.speakLang;
      const joined = getJoinedParticipants(meetingId).filter(p => p.userId !== senderId);

      // Echo raw transcript to sender
      socket.emit('meeting-speech-transcript', { text });

      // De-duplicate translations by unique hearLang
      const uniqueLangs = [...new Set(joined.map(p => p.hearLang))];
      try {
        const pairs = await Promise.all(
          uniqueLangs.map(async lang => {
            const result = await translateText(text, fromLang, lang);
            
            // Skip if translation failed
            if (!result.success) {
              console.warn(`[Meeting] Translation to ${lang} failed`);
              return [lang, null];
            }
            
            const locale = LOCALE_MAP[lang] ?? 'en-US';
            let audioBase64 = null;
            try {
              audioBase64 = await getTtsForUser({
                text: result.text,
                locale,
                speakerUserId: senderId,
              });
            } catch (ttsErr) {
              console.warn('[TTS] skipped (blocked/unavailable):', ttsErr.message);
            }
            return [lang, { text: result.text, audioBase64 }];
          })
        );
        const cache = new Map(pairs);
        joined.forEach(r => {
          const entry = cache.get(r.hearLang);
          if (entry) {
            io.to(r.socketId).emit('meeting-translated', {
              text: entry.text,
              audioBase64: entry.audioBase64,
              fromUserId: senderId,
              meetingId,
            });
          }
        });
      } catch (err) {
        console.error('[Meeting] translate error:', err.message);
      }
    });

    // ── meeting-audio-chunk → Google STT → translate → all joined peers ───────
    socket.on('meeting-audio-chunk', async ({ meetingId, audioBase64, mimeType }) => {
      const room = getMeeting(meetingId);
      if (!room) return;

      const senderId = socket.data.userId;
      const senderEntry = room.participants.get(senderId);
      if (!senderEntry) return;

      const speakLang = senderEntry.speakLang;
      const languageCode = LOCALE_MAP[speakLang] ?? 'en-US';

      try {
        const text = await transcribeAudio(audioBase64, languageCode, mimeType);
        if (!text.trim()) return;

        console.log(`[Meeting STT] ${senderId}: "${text}"`);

        socket.emit('meeting-speech-transcript', { text });

        const joined = getJoinedParticipants(meetingId).filter(p => p.userId !== senderId);
        const uniqueLangs = [...new Set(joined.map(p => p.hearLang))];
        const pairs = await Promise.all(
          uniqueLangs.map(async lang => {
            const result = await translateText(text, speakLang, lang);
            
            // Skip if translation failed
            if (!result.success) {
              console.warn(`[Meeting] Translation to ${lang} failed`);
              return [lang, null];
            }
            
            const locale = LOCALE_MAP[lang] ?? 'en-US';
            let ttsAudio = null;
            try {
              ttsAudio = await getTtsForUser({
                text: result.text,
                locale,
                speakerUserId: senderId,
              });
            } catch (ttsErr) {
              console.warn('[Meeting TTS] skipped:', ttsErr.message);
            }
            return [lang, { text: result.text, audioBase64: ttsAudio }];
          })
        );
        const cache = new Map(pairs);
        joined.forEach(r => {
          const entry = cache.get(r.hearLang);
          if (entry) {
            io.to(r.socketId).emit('meeting-translated', {
              text: entry.text,
              audioBase64: entry.audioBase64,
              fromUserId: senderId,
              meetingId,
            });
          }
        });
      } catch (err) {
        console.error('[Meeting STT] error:', err.message);
      }
    });

    // ── leave-meeting ─────────────────────────────────────────────────────────
    socket.on('leave-meeting', ({ meetingId }) => {
      const userId = socket.data.userId;
      if (isHost(meetingId, socket.id)) {
        // Host leaves → end meeting for all
        getJoinedParticipants(meetingId)
          .filter(p => p.socketId !== socket.id)
          .forEach(p => io.to(p.socketId).emit('meeting-ended', { meetingId, reason: 'host-ended' }));
        deleteMeeting(meetingId);
        console.log(`[Meeting] host ${userId} ended meeting ${meetingId}`);
      } else {
        participantLeft(meetingId, userId);
        getJoinedParticipants(meetingId).forEach(p =>
          io.to(p.socketId).emit('meeting-participant-left', { meetingId, userId })
        );
        console.log(`[Meeting] ${userId} left meeting ${meetingId}`);
      }
    });

    // ── disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const userId = socket.data.userId;
      if (userId) {
        unregisterUser(userId);
        removeDiscoverableUser(userId);
      }
      // Clean up pipeline state maps so stale entries don't block future connections
      sttInFlight.delete(socket.id);
      ttsInFlight.delete(socket.id);
      clearCloneBuffer(socket.id); // clean up any in-progress voice clone buffer
      if (userId) markUserCallEnded(userId); // allow voice deletion after disconnect
      broadcastDiscoverableList(io);

      const roomId = getRoomForSocket(socket.id);
      if (roomId) {
        const other = getOtherParticipant(roomId, socket.id);
        if (other) {
          io.to(other.socketId).emit('peer-disconnected');
          io.to(other.socketId).emit('call-ended', { roomId });
        }
        clearRoomBuffers(roomId);
        roomsClosing.delete(roomId);
        deleteRoom(roomId);
      }

      // Meeting cleanup on disconnect
      const meetingId = getMeetingForSocket(socket.id);
      if (meetingId) {
        if (isHost(meetingId, socket.id)) {
          getJoinedParticipants(meetingId)
            .filter(p => p.socketId !== socket.id)
            .forEach(p => io.to(p.socketId).emit('meeting-ended', { meetingId, reason: 'host-disconnected' }));
          deleteMeeting(meetingId);
          console.log(`[Meeting] host disconnected, ended meeting ${meetingId}`);
        } else {
          participantLeft(meetingId, userId);
          getJoinedParticipants(meetingId).forEach(p =>
            io.to(p.socketId).emit('meeting-participant-left', { meetingId, userId })
          );
          console.log(`[Meeting] participant ${userId} disconnected from meeting ${meetingId}`);
        }
      }

      console.log(`[socket] disconnected: ${socket.id}`);
    });
  });

  return io;
}
