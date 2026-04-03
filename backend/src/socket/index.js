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
getOnlineUserIds,
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
import { Chat } from '../models/chat.model.js';

const LOCALE_MAP  = { UR: 'ur-PK', EN: 'en-US', AR: 'ar-SA' };
const VALID_LANGS = new Set(['UR', 'EN', 'AR']);
const textBuffers = new Map();
const BUFFER_DELAY_MS = 1500; // flush after 1.5s of silence
const sttInFlight = new Map();
const ttsInFlight = new Map();
const roomsClosing = new Set();
// pendingCalls: stores caller's lang prefs when call-user fires so accept-call
// never depends on a potentially stale socket.data reference.
// Map<callerId → { speakLang, hearLang, callerSocketId }>
const pendingCalls = new Map();

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
  const senderCloningEnabled   = !!sender.voiceCloningEnabled;
  const receiverCloningEnabled = !!receiver.voiceCloningEnabled;

  const cloneState   = getCloneState(senderSocketId);
  const cloneVoiceId = cloneState?.voiceId ?? null;
  const limitReached = cloneState?.voiceLimitReached ?? false;
  const sameLanguage = speakLang === hearLang;

  // ── Two-user cloning decision matrix ─────────────────────────────────────
  // Voice cloning represents the SPEAKER'S identity.
  // The deciding factor is whether the SPEAKER has opted in — not the listener.
  //
  // CASE 1: Speaker ON,  Listener OFF → speaker's cloned voice
  // CASE 2: Speaker OFF, Listener ON  → Google TTS (speaker never opted in)
  // CASE 3: Both ON                   → EACH hears the OTHER's cloned voice
  //                                     (A speaks → B hears A's clone; B speaks → A hears B's clone)
  // CASE 4: Both OFF                  → Google TTS
  //
  // 'cloned-tts' is reachable in CASE 1 and CASE 3 when voice is ready and limit not hit.
  let cloningCase;
  if      ( senderCloningEnabled && !receiverCloningEnabled) cloningCase = 'CASE_1';
  else if (!senderCloningEnabled &&  receiverCloningEnabled) cloningCase = 'CASE_2';
  else if ( senderCloningEnabled &&  receiverCloningEnabled) cloningCase = 'CASE_3';
  else                                                        cloningCase = 'CASE_4';

  // Use cloned voice whenever the SENDER has cloning on and the voice is ready.
  // CASE 3 is intentionally the same as CASE 1 — each user's clone is used for
  // their own outgoing speech, so neither user ever hears their own cloned voice.
  const useClonedVoice = senderCloningEnabled && !limitReached && !!cloneVoiceId;

  let strategy;
  if (useClonedVoice) {
    strategy = 'cloned-tts';
  } else if (cloningCase === 'CASE_1' || cloningCase === 'CASE_3') {
    // Sender has cloning ON but clone not yet ready or failed:
    // passthrough raw audio + text captions only — never Google TTS as a
    // substitute for the cloned voice the sender opted into.
    strategy = 'passthrough';
  } else {
    strategy = sameLanguage ? 'passthrough' : 'tts';
  }

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

  console.log(
    `[Route] ${sender.userId}(speaks=${speakLang},clone=${senderCloningEnabled}) → ` +
    `${receiver.userId}(hears=${hearLang},clone=${receiverCloningEnabled}) | ` +
    `stt=${sttLocale} tts=${ttsLocale} | ${cloningCase} → strategy=${strategy}` +
    (useClonedVoice ? ` | voice=${cloneVoiceId.slice(0, 8)}…` : ''),
  );

  return {
    strategy,
    cloneVoiceId:        useClonedVoice ? cloneVoiceId : null,
    receiver,
    sender,
    speakLang,
    hearLang,
    sttLocale,
    ttsLocale,
    senderCloningEnabled,
    receiverCloningEnabled,
    cloningCase,
  };
}

function bufferAndTranslate( io, socket, roomId, text, speakLang, hearLang, receiver, ttsLocale, captionOnly = false, senderCloningEnabled = false, pipelineStrategy = 'tts', receiverCloningEnabled = false, audioChunk = null ) {
  const key = `${roomId}_${socket.id}`;
  const buffer = textBuffers.get(key) || { text: '', timeout: null, audioChunks: [] };
  if (!buffer.audioChunks) buffer.audioChunks = []; // migrate buffers created before this field existed
  if (buffer.timeout) clearTimeout(buffer.timeout);
  buffer.text = buffer.text ? `${buffer.text} ${text}` : text;
  // Accumulate raw audio chunks so we can fall back to passthrough if cloned TTS fails.
  // Only needed for cloned-tts — other strategies either use passthrough directly or Google TTS.
  if (audioChunk && pipelineStrategy === 'cloned-tts') {
    buffer.audioChunks.push(audioChunk);
  }
  buffer.timeout = setTimeout(async () => {
    const fullText = buffer.text.trim();
    textBuffers.delete(key);
    if (!fullText) return;

    if (speakLang === hearLang) { socket.emit('speech-transcript', { text: fullText });
      return;
    }

    const room = getRoom(roomId);
    if (!room || roomsClosing.has(roomId)) return;
    console.log(`\n[Pipeline] ${socket.data.userId} → "${fullText}" (${speakLang}→${hearLang})`);

    try {
      const result = await translateText(fullText, speakLang, hearLang);
      if (!result.success) { socket.emit('translation-error', { text: fullText, error: 'Translation unavailable' });
        return;
      }
      console.log(`[Pipeline] Translated: "${result.text}" captionOnly=${captionOnly}`);

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

      const freshCloneVoiceId = getClonedVoiceId(socket.id);
      const clonedVoiceIdForTts =
        pipelineStrategy === 'cloned-tts' ? freshCloneVoiceId : null;

      const ttsAudio = await getTtsForUser({
        text:                   result.text,
        locale:                 ttsLocale,       // ← receiver.hearLang (listener)
        speakerUserId:          socket.data.userId,
        clonedVoiceId:          clonedVoiceIdForTts,
        cloningEnabled:         pipelineStrategy === 'cloned-tts' && senderCloningEnabled,
        listenerCloningEnabled: receiverCloningEnabled,
      }).catch((err) => {
        console.warn('[Pipeline] TTS failed, delivering text-only to receiver:', err.message);
        return null;
      });

      if (ttsAudio) {
        ttsInFlight.set(receiver.socketId, true);
        io.to(receiver.socketId).emit('tts-start', { fromUserId: socket.data.userId });
        setTimeout(() => {
          if (ttsInFlight.get(receiver.socketId)) {
            ttsInFlight.delete(receiver.socketId);
            console.log(`[TTS] Auto-cleared ttsInFlight for ${receiver.userId} (60 s safety timeout)`);
          }
        }, 60_000);
      }

      const cloneTtsFailed = pipelineStrategy === 'cloned-tts' && !ttsAudio;

      if (cloneTtsFailed) {
        // ElevenLabs failed — fall back to raw audio passthrough so the receiver
        // always hears something (original voice) rather than silence.
        // The buffered audioChunks are all the raw segments accumulated during
        // this 1.5 s text-buffer window.
        const chunks = buffer.audioChunks || [];
        console.warn(
          `[Pipeline] Cloned TTS failed for ${socket.data.userId}` +
          ` — falling back to passthrough (${chunks.length} chunk(s))`,
        );
        for (const chunk of chunks) {
          io.to(receiver.socketId).emit('audio-passthrough', chunk);
        }
        // Also deliver the translated text as a caption
        io.to(receiver.socketId).emit('translated-text', {
          text:        result.text,
          audioBase64: null,
          fromUserId:  socket.data.userId,
          captionOnly: true,
        });
        socket.emit('clone-failed', {
          status:  'failed',
          reason:  'CLONE_TTS_FAILED',
          message: 'Cloned voice unavailable — falling back to your original voice.',
        });
      } else {
        io.to(receiver.socketId).emit('translated-text', {
          text:        result.text,
          audioBase64: ttsAudio || null,
          fromUserId:  socket.data.userId,
          captionOnly: false,
        });
      }
      socket.emit('speech-transcript', { text: fullText });

    } catch (err) {
      console.error('[Pipeline Error]', err.message);
      socket.emit('translation-error', { text: fullText, error: err.message });
    }
  }, BUFFER_DELAY_MS);

  textBuffers.set(key, buffer);
}

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
        if (!origin) return cb(null, true);
        if ( origin.startsWith('http://localhost:')   || origin.startsWith('http://127.0.0.1:')   || origin.startsWith('https://voice-bridge-backend-xq5w.onrender.com') ) {
          return cb(null, true);
        }
        cb(null, false);
      },
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log(`[socket] connected: ${socket.id}`);

    // Ensures clients can fetch current online list even if they missed
    // the initial `register` broadcast during reload.
    socket.on('requestOnlineUsers', () => {
      socket.emit('getOnlineUser', getOnlineUserIds());
    });

    // ── Bridge Messenger: realtime chat translation ─────────────────────────
    // Frontend jab "READ INTO" ya input translation (UR/EN/AR) select karta hai,
    // yahan server Google translate use karke text return karta hai.
    socket.on('translateChatMessage', async (data, callback) => {
      try {
        const { text, toLang, fromLang = 'auto' } = data || {};
        if (!text || !toLang) {
          return callback?.({ success: false, text });
        }
        const result = await translateText(text, fromLang, toLang);
        return callback?.({ success: !!result?.success, text: result?.text ?? text });
      } catch (err) {
        return callback?.({ success: false, text: data?.text });
      }
    });

    socket.on('register', ({ userId, odId }) => {
      socket.data.userId = userId;
      socket.data.odId = odId;
      registerUser(userId, socket.id);
      console.log(`[socket] registered: ${userId} (${odId || 'no _id'}) → ${socket.id}`);
      io.emit('getOnlineUser', getOnlineUserIds());
    });

    socket.on('start-discoverable', ({ userId, name }) => {
      addDiscoverableUser(userId, socket.id, name);
      console.log(`[BT] ${userId} is now discoverable`);
      broadcastDiscoverableList(io);
    });

    socket.on('stop-discoverable', ({ userId }) => {
      removeDiscoverableUser(userId);
      console.log(`[BT] ${userId} left discoverable mode`);
      broadcastDiscoverableList(io);
    });

    socket.on('call-user', ({ targetUserId, callerName, speakLang, hearLang }) => {
      if (targetUserId === socket.data.userId) {
        socket.emit('call-error', { message: 'You cannot call yourself.' });
        return;
      }

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
      socket.data.speakLang = speakLang;
      socket.data.hearLang  = hearLang;

      // Store lang prefs durably so accept-call never needs to read socket.data
      // from a possibly-stale caller socket reference.
      pendingCalls.set(socket.data.userId, {
        speakLang,
        hearLang,
        callerSocketId: socket.id,
        odId: socket.data.odId || null,
        callerName: callerName || socket.data.userId,
      });
      console.log(`[Call] pending: ${socket.data.userId} → ${targetUserId} | speak=${speakLang} hear=${hearLang}`);

      io.to(targetSocketId).emit('incoming-call', {
        callerId: socket.data.userId,
        callerName: callerName || socket.data.userId,
      });
    });

    // ── accept-call ──────────────────────────────────────────────────────────
    socket.on('accept-call', async ({ callerId, speakLang, hearLang }) => {
      // Read caller's live socketId from the map
      const callerSocketId = getSocketIdForUser(callerId);
      if (!callerSocketId) {
        socket.emit('call-error', { message: 'Caller is no longer online.' });
        return;
      }

      // Read lang prefs from pendingCalls — never from socket.data (stale on reconnect)
      const pending = pendingCalls.get(callerId);
      if (!pending) {
        socket.emit('call-error', { message: 'Call session expired. Please ask the caller to retry.' });
        console.error(`[accept-call] REJECTED — no pendingCalls entry for caller ${callerId}`);
        return;
      }
      pendingCalls.delete(callerId); // consume

      const rawSpeakA = pending.speakLang;
      const rawHearA  = pending.hearLang;

      if (!VALID_LANGS.has(rawSpeakA) || !VALID_LANGS.has(rawHearA)) {
        socket.emit('call-error', {
          message: 'Caller language configuration is invalid. Please retry the call.',
        });
        console.error(
          `[accept-call] REJECTED — caller ${callerId} stored invalid langs: ` +
          `speakLang=${rawSpeakA} hearLang=${rawHearA}`,
        );
        return;
      }

      const roomId = `${callerId}_${socket.data.userId}_${Date.now()}`;

      // Validate accepter's language selection before building the room.
      // Without this, an invalid/missing code silently falls back to en-US in LOCALE_MAP.
      if (!VALID_LANGS.has(speakLang) || !VALID_LANGS.has(hearLang)) {
        socket.emit('call-error', {
          message: `Invalid language configuration (speakLang=${speakLang}, hearLang=${hearLang}). Expected: UR | EN | AR`,
        });
        console.error(
          `[accept-call] REJECTED room — accepter ${socket.data.userId} has invalid langs: ` +
          `speakLang=${speakLang} hearLang=${hearLang}`,
        );
        return;
      }

      const userA = {
        socketId:            callerSocketId,
        odId:                pending.odId || null,
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

      // ── 1. Create room synchronously — roomId is live from this point ───────
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
      console.log(`[socket] room created: ${roomId}`);

      // Remove both users from discoverable list when a call starts
      removeDiscoverableUser(callerId);
      removeDiscoverableUser(socket.data.userId);
      broadcastDiscoverableList(io);

      // ── 2. Notify both clients immediately — roomId must reach them NOW ──────
      // Voice cloning init is async and must NEVER gate this signal. Clients need
      // roomId before they can send audio-chunk; delaying call-accepted here was
      // the root cause of "roomId missing / inconsistent when cloning=true".
      io.to(callerSocketId).emit('call-accepted', {
        roomId,
        peerOdId: userB.odId,
        peerUserId: userB.userId,
        peerSpeakLang: userB.speakLang,
        peerHearLang: userB.hearLang,
      });
      socket.emit('call-accepted', {
        roomId,
        peerOdId: userA.odId,
        peerUserId: userA.userId,
        peerSpeakLang: userA.speakLang,
        peerHearLang: userA.hearLang,
      });

      // ── 3. Voice cloning init — fire-and-forget, never blocks the call ───────
      (async () => {
        try {
          const [userADoc, userBDoc] = await Promise.all([
            User.findOne({ userId: callerId }).lean(),
            User.findOne({ userId: socket.data.userId }).lean(),
          ]);

          // Mutating in-place is safe — createRoom stores a reference to the same objects,
          // so resolveAudioStrategy will see the updated flags on the next audio-chunk.
          userA.voiceCloningEnabled = !!userADoc?.voiceCloningEnabled;
          userB.voiceCloningEnabled = !!userBDoc?.voiceCloningEnabled;

          console.log(`[VoiceClone] Init started after room ${roomId} — ${callerId}: ${userA.voiceCloningEnabled} | ${socket.data.userId}: ${userB.voiceCloningEnabled}`);

          if (userA.voiceCloningEnabled) {
            const existingVoiceA =
              typeof userADoc?.voiceId === 'string' && userADoc.voiceId.length > 0
                ? userADoc.voiceId : null;
            initCloneBuffer(callerSocketId, callerId, existingVoiceA);
            io.to(callerSocketId).emit(existingVoiceA ? 'clone-ready' : 'clone-started', existingVoiceA
              ? { status: 'ready', voiceId: existingVoiceA, message: 'Using your saved cloned voice.' }
              : { status: 'buffering', message: 'Recording your voice for cloning…' });
          }

          if (userB.voiceCloningEnabled) {
            const existingVoiceB =
              typeof userBDoc?.voiceId === 'string' && userBDoc.voiceId.length > 0
                ? userBDoc.voiceId : null;
            initCloneBuffer(socket.id, socket.data.userId, existingVoiceB);
            socket.emit(existingVoiceB ? 'clone-ready' : 'clone-started', existingVoiceB
              ? { status: 'ready', voiceId: existingVoiceB, message: 'Using your saved cloned voice.' }
              : { status: 'buffering', message: 'Recording your voice for cloning…' });
          }
        } catch (cloneInitErr) {
          // Non-fatal — call continues with default Google TTS
          console.warn(`[VoiceClone] Could not init clone buffer for room ${roomId}:`, cloneInitErr.message);
        }
      })();
    });

    socket.on('decline-call', ({ callerId }) => {
      const callerSocketId = getSocketIdForUser(callerId);
      if (callerSocketId) {
        io.to(callerSocketId).emit('call-declined');
      }
    });

    socket.on('speech-text', async ({ roomId, text }) => {
      const room = getRoom(roomId);
      if (!room) return;

      const { strategy, ttsLocale, speakLang, hearLang, receiver, cloneVoiceId, senderCloningEnabled, receiverCloningEnabled } =
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
          text:                   result.text,
          locale:                 ttsLocale,
          speakerUserId:          socket.data.userId,
          clonedVoiceId:          strategy === 'cloned-tts' ? cloneVoiceId : null,
          cloningEnabled:         strategy === 'cloned-tts' && senderCloningEnabled,
          listenerCloningEnabled: receiverCloningEnabled,
        }).catch(() => null);

        if (ttsAudio) {
          ttsInFlight.set(receiver.socketId, true);
          io.to(receiver.socketId).emit('tts-start', { fromUserId: socket.data.userId });
        }

        const cloneTtsFailed = strategy === 'cloned-tts' && !ttsAudio;
        io.to(receiver.socketId).emit('translated-text', {
          text:        result.text,
          audioBase64: ttsAudio || null,
          fromUserId:  socket.data.userId,
          captionOnly: cloneTtsFailed,
        });
        if (cloneTtsFailed) {
          socket.emit('clone-failed', {
            status:  'failed',
            reason:  'CLONE_TTS_FAILED',
            message: 'Cloned voice unavailable — receiver sees text only.',
          });
        }
      } catch (err) {
        console.warn('[speech-text error]', err.message);
        socket.emit('translation-error', { text, error: err.message });
      }
    });


    socket.on('audio-chunk', async ({ roomId, audioBase64, mimeType }) => {
      if (!roomId) { console.warn('[STT] audio-chunk missing roomId from', socket.data.userId); return; }
      if (roomsClosing.has(roomId)) return;

      const room = getRoom(roomId);
      if (!room) { console.warn('[STT] room not found:', roomId, '— user:', socket.data.userId); return; }

      // ── Resolve strategy FIRST so we know if cloning is even active ───────
      const { strategy, cloneVoiceId, receiver, speakLang, hearLang, sttLocale, ttsLocale, senderCloningEnabled, receiverCloningEnabled, cloningCase } =
        resolveAudioStrategy(room, socket.id);

    
      // Only buffer when the sender has cloning ON and the clone isn't done yet.
      // Skip entirely when limit was hit (status='failed', voiceLimitReached=true).
      
      // if (strategy === 'passthrough' && !isVoiceLimitReached(socket.id)) {
      //   const cloneState = getCloneState(socket.id);
      //   if (cloneState?.status === 'buffering' && audioBase64) {
      //     const readyToClone = addChunkToCloneBuffer(socket.id, audioBase64, mimeType);

      //     if (readyToClone) {
      //       // Async — do not block the audio pipeline
      //       performVoiceClone(socket.id)
      //         .then((voiceId) => {
      //           socket.emit('clone-ready', {
      //             status:  'ready',
      //             voiceId,
      //             message: 'Your voice has been cloned! Using cloned voice for translations.',
      //           });
      //         })
      //         .catch((err) => {
      //           if (err.message.includes('already in progress')) return;

      //           const isLimitError = err.message.includes('voice_limit_reached');

      //           if (isLimitError) {
      //             // Permanent account-level limit — warn once, no retry
      //             console.warn(
      //               `[VoiceClone] Voice limit reached for user=${socket.data.userId} ` +
      //               `— cloning disabled for this session`,
      //             );
      //           } else {
      //             // Transient error — schedule one retry after 20 s
      //             console.warn(`[VoiceClone] Transient failure for user=${socket.data.userId}:`, err.message);
      //             setTimeout(() => {
      //               const stillInRoom = getRoomForSocket(socket.id);
      //               if (stillInRoom && resetCloneBufferForRetry(socket.id)) {
      //                 socket.emit('clone-started', {
      //                   status:  'buffering',
      //                   message: 'Retrying voice cloning…',
      //                 });
      //               }
      //             }, 20_000);
      //           }

      //           // Silently inform the UI — never show raw error text
      //           socket.emit('clone-failed', { status: 'failed', message: 'Using original voice' });
      //         });
      //     }
      //   }
      // }

      // ── NEW CLONING TRIGGER (Replaces your old block) ────────────────────────
      // Strategy jo bhi ho, agar cloning ON hai aur voice ready nahi, to buffer karo
      // Only buffer for cloning in CASE 1 (speaker ON, listener OFF).
      // CASE 3 (both ON) resolves to Google TTS, so buffering is wasted work.
      // Buffer audio for cloning whenever the SENDER has cloning ON and voice isn't ready yet.
      // Removed !receiverCloningEnabled — CASE 3 (both ON) must also build the sender's clone.
      const canClone = senderCloningEnabled && speakLang !== hearLang && !cloneVoiceId && !isVoiceLimitReached(socket.id);

      if (canClone) {
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
                  message: 'Your voice has been cloned! Now using your original voice.',
                });
              })
              .catch((err) => {
                if (err.message.includes('already in progress')) return;

                const isLimitError = err.message.includes('VOICE_LIMIT_REACHED');
                if (isLimitError) {
                  console.warn(`[VoiceClone] Voice limit reached for user=${socket.data.userId}`);
                } else {
                  console.warn(`[VoiceClone] Failure for user=${socket.data.userId}:`, err.message);
                  setTimeout(() => {
                    if (getRoomForSocket(socket.id) && resetCloneBufferForRetry(socket.id)) {
                      socket.emit('clone-started', { status: 'buffering', message: 'Retrying voice cloning…' });
                    }
                  }, 20_000);
                }
                socket.emit('clone-failed', {
                  status: 'failed',
                  reason: isLimitError ? 'VOICE_LIMIT_REACHED' : 'CLONE_FAILED',
                  message: isLimitError
                    ? 'Voice limit reached. Please try later.'
                    : 'Voice cloning failed. Retrying soon.',
                });
              });
          }
        }
      }

      if (strategy === 'passthrough') {
        io.to(receiver.socketId).emit('audio-passthrough', { audioBase64, mimeType });

        if (!sttInFlight.get(socket.id)) {
          sttInFlight.set(socket.id, true);
          (async () => {
            try {
              const text = await transcribeAudio(audioBase64, sttLocale, mimeType);
              if (!text.trim()) return;
              socket.emit('speech-transcript', { text });
              // Caption-only when languages match OR when CASE 1/3 is using passthrough
              // (clone pending/failed). Raw audio is already forwarded above; we must
              // not also deliver a Google TTS render of the same utterance.
              const captionOnlyPassthrough =
                strategy === 'passthrough' &&
                (speakLang === hearLang || cloningCase === 'CASE_1' || cloningCase === 'CASE_3');
              bufferAndTranslate(
                io,
                socket,
                roomId,
                text,
                speakLang,
                hearLang,
                receiver,
                ttsLocale,
                captionOnlyPassthrough,
                senderCloningEnabled,
                strategy,
                receiverCloningEnabled,
              );
            } catch (err) {
              console.warn('[Caption STT Error]', err.message);
            } finally {
              sttInFlight.delete(socket.id);
            }
          })();
        }
        return;
      }
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
      if (ttsInFlight.get(receiver.socketId)) return;

      sttInFlight.set(socket.id, true);
      try {
        const text = await transcribeAudio(audioBase64, sttLocale, mimeType);
        if (!text.trim()) return; // pure silence — discard

        console.log(`[STT] ${socket.data.userId}: "${text}" (${speakLang}→${hearLang}) [${strategy}]`);
        socket.emit('speech-transcript', { text });
        bufferAndTranslate(
          io,
          socket,
          roomId,
          text,
          speakLang,
          hearLang,
          receiver,
          ttsLocale,
          false,
          senderCloningEnabled,
          strategy,
          receiverCloningEnabled,
          // For cloned-tts, store the raw chunk so bufferAndTranslate can fall
          // back to audio-passthrough if ElevenLabs TTS synthesis fails.
          strategy === 'cloned-tts' ? { audioBase64, mimeType } : null,
        );

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

    socket.on('create-meeting', ({ meetingId, hostSpeakLang, hostHearLang, invitees }) => {
      const hostUserId = socket.data.userId;
      if (!hostUserId) {
        socket.emit('meeting-error', { message: 'Not registered.' });
        return;
      }

      // Validate host's own languages — only the host's own langs are provided here.
      if (!VALID_LANGS.has(hostSpeakLang) || !VALID_LANGS.has(hostHearLang)) {
        socket.emit('meeting-error', {
          message: `Invalid host language configuration (speakLang=${hostSpeakLang}, hearLang=${hostHearLang}). Expected: UR | EN | AR`,
        });
        console.warn(`[Meeting] create-meeting: invalid host langs from ${hostUserId}: speak=${hostSpeakLang} hear=${hostHearLang}`);
        return;
      }

      if (!Array.isArray(invitees) || invitees.length < 2 || invitees.length > 4) {
        socket.emit('meeting-error', { message: 'Invitees must be between 2 and 4.' });
        return;
      }

      // Validate invitee list: only userId is expected — no langs
      for (const inv of invitees) {
        if (!inv.userId || typeof inv.userId !== 'string') {
          socket.emit('meeting-error', { message: 'Each invitee must have a valid userId.' });
          return;
        }
        if (inv.userId === hostUserId) {
          socket.emit('meeting-error', { message: 'Host cannot invite themselves.' });
          return;
        }
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
        resolved.push({ userId: inv.userId, socketId: sid });
      }

      // Build meeting — host's langs stored now, invitees' langs stored at join-meeting
      const hostEntry = {
        userId:    hostUserId,
        socketId:  socket.id,
        speakLang: hostSpeakLang,
        hearLang:  hostHearLang,
      };
      createMeeting(meetingId, hostEntry);

      // addInvitedParticipant stores null langs — invitees set their own at join time
      for (const inv of resolved) {
        addInvitedParticipant(meetingId, inv.userId);
      }

      // Config sent to host: invitees show null langs (they haven't joined yet)
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

      console.log(`[Meeting] created id=${meetingId} host=${hostUserId}(${hostSpeakLang}→${hostHearLang}) invitees=[${resolved.map(i => i.userId).join(', ')}]`);
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

    // ── join-meeting ──────────────────────────────────────────────────────────
    socket.on('join-meeting', async ({ meetingId, speakLang, hearLang }) => {
      const userId = socket.data.userId;

      if (!userId) {
        socket.emit('meeting-error', { message: 'Not registered.' });
        return;
      }

      if (!VALID_LANGS.has(speakLang) || !VALID_LANGS.has(hearLang)) {
        socket.emit('meeting-error', {
          message: `Invalid language configuration (speakLang=${speakLang}, hearLang=${hearLang}). Expected: UR | EN | AR`,
        });
        console.warn(`[Meeting] join-meeting: ${userId} sent invalid langs speak=${speakLang} hear=${hearLang}`);
        return;
      }

      const room = getMeeting(meetingId);
      if (!room) {
        socket.emit('meeting-error', { message: 'Meeting not found or has already ended.' });
        console.warn(`[Meeting] join-meeting: meeting ${meetingId} not found (user: ${userId})`);
        return;
      }

      const entry = room.participants.get(userId);
      if (!entry || entry.status !== 'invited') {
        socket.emit('meeting-error', { message: 'You are not invited to this meeting.' });
        console.warn(`[Meeting] join-meeting: ${userId} not eligible for ${meetingId} (status: ${entry?.status ?? 'not found'})`);
        return;
      }

      // Promote participant from 'invited' → 'joined' and bind their live socket.
      // speakLang / hearLang here are the invitee's OWN selection — authoritative.
      participantJoined(meetingId, userId, socket.id, speakLang, hearLang);
      console.log(`[Join] user=${userId} speak=${speakLang} hear=${hearLang} meeting=${meetingId} socket=${socket.id}`);

      // ── Voice Cloning: init buffer if user has it enabled ─────────────────
      try {
        const userDoc = await User.findOne({ userId }).lean();
        const cloningEnabled = !!userDoc?.voiceCloningEnabled;

        // Persist flag on the live participant entry so audio handlers can read it
        const freshEntry = room.participants.get(userId);
        if (freshEntry) freshEntry.voiceCloningEnabled = cloningEnabled;

        if (cloningEnabled) {
          const existingVoiceId =
            typeof userDoc?.voiceId === 'string' && userDoc.voiceId.length > 0
              ? userDoc.voiceId
              : null;
          initCloneBuffer(socket.id, userId, existingVoiceId);
          if (existingVoiceId) {
            socket.emit('clone-ready', { status: 'ready', voiceId: existingVoiceId, message: 'Using your saved cloned voice.' });
          } else {
            socket.emit('clone-started', { status: 'buffering', message: 'Recording your voice for cloning…' });
          }
        }
      } catch (cloneInitErr) {
        // Non-fatal — meeting still proceeds with default TTS
        console.warn('[VoiceClone] Meeting join — could not init clone buffer:', cloneInitErr.message);
      }

      // Build a full config snapshot for every client to sync on
      const updatedConfig = getAllParticipantEntries(meetingId).map(e => ({
        userId: e.userId, speak: e.speakLang, hear: e.hearLang, status: e.status,
      }));

      // Ack to the participant who just joined
      socket.emit('meeting-joined-ack', { meetingId, config: updatedConfig });

      // Notify all participants who are already in the meeting (host + earlier joiners)
      const alreadyJoined = getJoinedParticipants(meetingId).filter(p => p.socketId !== socket.id);
      alreadyJoined.forEach(p => {
        console.log(`[Meeting] notifying ${p.userId} (${p.socketId}) that ${userId} joined`);
        io.to(p.socketId).emit('meeting-participant-joined', {
          meetingId,
          userId,
          speakLang,
          hearLang,
          updatedConfig,
        });
      });

      console.log(
        `[Meeting] state after ${userId} joined: ` +
        updatedConfig.map(e => `${e.userId}(${e.status})`).join(', '),
      );
    });

    // ── meeting-speech-text → translate → all joined peers ───────────────────
    socket.on('meeting-speech-text', async ({ meetingId, text }) => {
      const room = getMeeting(meetingId);
      if (!room) return;

      const senderId = socket.data.userId;
      const senderEntry = room.participants.get(senderId);
      if (!senderEntry) return;

      // Guard: sender must have joined with their own language selection
      if (!senderEntry.speakLang) {
        console.warn(`[Meeting] speech-text dropped — ${senderId} has no speakLang yet`);
        return;
      }

      const senderCloningEnabled = !!senderEntry.voiceCloningEnabled;
      const fromLang              = senderEntry.speakLang;
      // Only route to listeners who have completed join-meeting (hearLang is set)
      const joined = getJoinedParticipants(meetingId).filter(
        p => p.userId !== senderId && p.hearLang !== null,
      );

      socket.emit('meeting-speech-transcript', { text });

      // Read cloneVoiceId at execution time — not a stale closure capture
      const freshCloneId = getClonedVoiceId(socket.id);

      // ── Per-listener routing + cloning decision (4-case matrix) ─────────────
      // CASE 1 + CASE 3: sender clone is used whenever sender has cloning ON + voice ready.
      const listenerMeta = joined.map(r => {
        const listenerCloningEnabled = !!r.voiceCloningEnabled;
        const useClonedVoice =
          senderCloningEnabled &&
          !!freshCloneId &&
          !isVoiceLimitReached(socket.id);
        const needsTranslation = fromLang !== r.hearLang;
        console.log(`[Route] ${senderId}(${fromLang}) → ${r.userId}(${r.hearLang}) | translate=${needsTranslation} clone=${useClonedVoice}`);
        return { ...r, listenerCloningEnabled, useClonedVoice };
      });

      // Deduplicate TTS work — two listeners with same (hearLang, useClonedVoice,
      // listenerCloningEnabled) share one API call.
      const ttsWorkMap = new Map();
      listenerMeta.forEach(r => {
        const key = `${r.hearLang}|${r.useClonedVoice}|${r.listenerCloningEnabled}`;
        if (!ttsWorkMap.has(key)) {
          ttsWorkMap.set(key, {
            hearLang:              r.hearLang,
            useClonedVoice:        r.useClonedVoice,
            listenerCloningEnabled: r.listenerCloningEnabled,
          });
        }
      });

      try {
        const ttsResults = await Promise.all(
          [...ttsWorkMap.entries()].map(async ([key, { hearLang, useClonedVoice, listenerCloningEnabled }]) => {
            const translationResult = await translateText(text, fromLang, hearLang);
            if (!translationResult.success) {
              console.warn(`[Meeting] Translation to ${hearLang} failed`);
              return [key, null];
            }

            const locale = LOCALE_MAP[hearLang] ?? 'en-US';
            let audioBase64 = null;
            try {
              audioBase64 = await getTtsForUser({
                text:                   translationResult.text,
                locale,
                speakerUserId:          senderId,
                clonedVoiceId:          useClonedVoice ? freshCloneId : null,
                cloningEnabled:         useClonedVoice && senderCloningEnabled,
                listenerCloningEnabled,
              });
            } catch (ttsErr) {
              console.warn('[Meeting TTS] skipped:', ttsErr.message);
            }
            return [key, { text: translationResult.text, audioBase64 }];
          })
        );

        const ttsCache = new Map(ttsResults);

        listenerMeta.forEach(r => {
          const key   = `${r.hearLang}|${r.useClonedVoice}|${r.listenerCloningEnabled}`;
          const entry = ttsCache.get(key);
          if (entry) {
            io.to(r.socketId).emit('meeting-translated', {
              text:        entry.text,
              audioBase64: entry.audioBase64,
              fromUserId:  senderId,
              meetingId,
            });
          }
        });
      } catch (err) {
        console.error('[Meeting speech-text] error:', err.message);
      }
    });

    

    // ── meeting-audio-chunk → STT → translate → all joined peers ─────────────
    socket.on('meeting-audio-chunk', async ({ meetingId, audioBase64, mimeType }) => {
      const room = getMeeting(meetingId);
      if (!room) return;

      const senderId    = socket.data.userId;
      const senderEntry = room.participants.get(senderId);
      if (!senderEntry) return;

      // Guard: reject audio if this participant hasn't joined with their own
      // language selection yet (speakLang / hearLang are null until join-meeting fires).
      if (!senderEntry.speakLang) {
        console.warn(`[Meeting] audio dropped — ${senderId} has no speakLang yet (not joined)`);
        return;
      }

      const senderCloningEnabled = !!senderEntry.voiceCloningEnabled;
      const speakLang            = senderEntry.speakLang;   // set by join-meeting
      const languageCode         = LOCALE_MAP[speakLang];   // undefined → caught by guard above
      // Only route to listeners who have joined with their own lang selection.
      // Skip anyone still in 'invited' state (hearLang = null).
      const joined = getJoinedParticipants(meetingId).filter(
        p => p.userId !== senderId && p.hearLang !== null,
      );

      // ── Voice clone buffering ────────────────────────────────────────────────
      // Buffer whenever the SENDER has cloning ON (CASE 1 + CASE 3).
      // The sender's clone is their voice identity — we need it regardless of
      // whether listeners also have cloning on (CASE 3).
      const anyListenerCloningOff = joined.some(p => !p.voiceCloningEnabled); // kept for legacy ref
      const currentCloneId = getClonedVoiceId(socket.id);
      const canClone =
        senderCloningEnabled &&
        !currentCloneId &&
        !isVoiceLimitReached(socket.id);

      if (canClone) {
        // Meetings have no accept-call setup phase, so lazily init the clone buffer
        // on the first qualifying chunk using the sender's stored voiceId (if any).
        if (!getCloneState(socket.id)) {
          try {
            const userDoc        = await User.findOne({ userId: senderId }).lean();
            const existingVoiceId = userDoc?.voiceId || null;
            initCloneBuffer(socket.id, senderId, existingVoiceId);
            if (existingVoiceId) {
              socket.emit('clone-ready', { status: 'ready', voiceId: existingVoiceId, message: 'Using your saved cloned voice.' });
            } else {
              socket.emit('clone-started', { status: 'buffering', message: 'Recording your voice for cloning…' });
            }
          } catch {
            initCloneBuffer(socket.id, senderId, null);
          }
        }
        const cloneState = getCloneState(socket.id);
        if (cloneState?.status === 'buffering' && audioBase64) {
          const readyToClone = addChunkToCloneBuffer(socket.id, audioBase64, mimeType);
          if (readyToClone) {
            performVoiceClone(socket.id)
              .then(voiceId => socket.emit('clone-ready', {
                status: 'ready', voiceId, message: 'Your voice has been cloned!',
              }))
              .catch(err => {
                const isLimitError = err.message.includes('VOICE_LIMIT_REACHED');
                socket.emit('clone-failed', {
                  status:  'failed',
                  reason:  isLimitError ? 'VOICE_LIMIT_REACHED' : 'CLONE_FAILED',
                  message: isLimitError ? 'Voice limit reached.' : 'Voice cloning failed.',
                });
              });
          }
        }
      }

      try {
        const text = await transcribeAudio(audioBase64, languageCode, mimeType);
        if (!text.trim()) return;

        console.log(`[Meeting STT] ${senderId}: "${text}"`);
        socket.emit('meeting-speech-transcript', { text });

        // Read cloneVoiceId after potential clone completion above
        const freshCloneId = getClonedVoiceId(socket.id);

        // ── Per-listener routing + cloning decision ──────────────────────────
        // CASE 1 (sender ON, listener OFF) + CASE 3 (both ON): use sender's clone.
        // CASE 2 (sender OFF, listener ON) + CASE 4 (both OFF): Google TTS.
        // hearLang is guaranteed non-null here (filtered above).
        const listenerMeta = joined.map(r => {
          const listenerCloningEnabled = !!r.voiceCloningEnabled;
          const useClonedVoice =
            senderCloningEnabled &&
            !!freshCloneId &&
            !isVoiceLimitReached(socket.id);
          const needsTranslation = speakLang !== r.hearLang;
          console.log(
            `[Route] ${senderId}(${speakLang}) → ${r.userId}(${r.hearLang}) | ` +
            `translate=${needsTranslation} clone=${useClonedVoice}`,
          );
          return { ...r, listenerCloningEnabled, useClonedVoice };
        });

        // Deduplicate TTS work by (hearLang, useClonedVoice, listenerCloningEnabled)
        const ttsWorkMap = new Map();
        listenerMeta.forEach(r => {
          const key = `${r.hearLang}|${r.useClonedVoice}|${r.listenerCloningEnabled}`;
          if (!ttsWorkMap.has(key)) {
            ttsWorkMap.set(key, {
              hearLang:              r.hearLang,
              useClonedVoice:        r.useClonedVoice,
              listenerCloningEnabled: r.listenerCloningEnabled,
            });
          }
        });

        const ttsResults = await Promise.all(
          [...ttsWorkMap.entries()].map(async ([key, { hearLang, useClonedVoice, listenerCloningEnabled }]) => {
            const translationResult = await translateText(text, speakLang, hearLang);
            if (!translationResult.success) {
              console.warn(`[Meeting] Translation to ${hearLang} failed`);
              return [key, null];
            }

            const locale = LOCALE_MAP[hearLang] ?? 'en-US';
            let ttsAudio = null;
            try {
              ttsAudio = await getTtsForUser({
                text:                   translationResult.text,
                locale,
                speakerUserId:          senderId,
                clonedVoiceId:          useClonedVoice ? freshCloneId : null,
                cloningEnabled:         useClonedVoice && senderCloningEnabled,
                listenerCloningEnabled,
              });
            } catch (ttsErr) {
              console.warn('[Meeting TTS] skipped:', ttsErr.message);
            }
            return [key, { text: translationResult.text, audioBase64: ttsAudio }];
          })
        );

        const ttsCache = new Map(ttsResults);

        listenerMeta.forEach(r => {
          const key   = `${r.hearLang}|${r.useClonedVoice}|${r.listenerCloningEnabled}`;
          const entry = ttsCache.get(key);
          if (entry) {
            io.to(r.socketId).emit('meeting-translated', {
              text:        entry.text,
              audioBase64: entry.audioBase64,
              fromUserId:  senderId,
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

    // ── Bridge Messenger ─────────────────────────────────────────────────────

    socket.on('joinRoom', (chatId) => {
      if (!socket.rooms.has(chatId)) {
        socket.join(chatId);
      }
      console.log(`[Chat] socket ${socket.id} joined room ${chatId}`);
    });

    socket.on('leaveRoom', (chatId) => {
      socket.leave(chatId);
      console.log(`[Chat] socket ${socket.id} left room ${chatId}`);
    });

    socket.on('message', async (data) => {
      const { sender, receiver, message, customId, userName } = data;
      if (!receiver) return;

      const receiverSockets = await io.in(receiver).fetchSockets();
      const isReceiverInRoom = receiverSockets.length > 0;
      const payload = {
        sender,
        receiver,
        message,
        customId,
        userName,
        isReceiverInRoom,
        // UI me time show karne ke liye receiver-side ko bhi timestamp chahiye.
        // Mongoose schema me timestamps: true hai, lekin realtime emit me createdAt include nahi tha.
        createdAt: new Date().toISOString(),
      };

      io.to(receiver).emit('newMessage', payload);
      try {
        await Chat.create({ customId, sender, receiver, message, userName, isReceiverInRoom });
      } catch (error) {
        console.error('[Chat] message save failed:', error.message);
      }
    });

    socket.on('userMsg', ({ sender, receiver }) => {
      if (!sender || !receiver) return;
      io.to(receiver).emit('userMsg', sender);
    });

    socket.on('delete', async (data) => {
      const { customId, receiver } = data;
      if (!customId || !receiver) return;
      io.to(receiver).emit('deleteMsg', customId);
      try {
        await Chat.findOneAndDelete({ customId });
      } catch (error) {
        console.error('[Chat] message delete failed:', error.message);
      }
    });

    socket.on('edit', async (data) => {
      const { customId, receiver, message } = data;
      if (!receiver || !customId) return;
      io.to(receiver).emit('editMsg', { receiver, message, customId });
      try {
        await Chat.findOneAndUpdate({ customId }, { message });
      } catch (error) {
        console.error('[Chat] message edit failed:', error.message);
      }
    });

    // ── disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const userId = socket.data.userId;
      if (userId) {
        // Only unregister if THIS socket is still the current one for this userId.
        // Guard against the reconnect race: new socket registers → old disconnect
        // fires → would wrongly delete the new registration.
        if (getSocketIdForUser(userId) === socket.id) {
          unregisterUser(userId);
          io.emit('getOnlineUser', getOnlineUserIds());
        }
        removeDiscoverableUser(userId);
        // Clean up any pending outbound call this user initiated
        pendingCalls.delete(userId);
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


  // ── Voice Cloning: buffer audio for pending clone (runs BEFORE STT) ──