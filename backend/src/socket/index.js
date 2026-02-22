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

const LOCALE_MAP = { UR: 'ur-PK', EN: 'en-US', AR: 'ar-SA' };

function broadcastDiscoverableList(io) {
  const all = getAllDiscoverableUsers();
  all.forEach(({ userId, socketId }) => {
    const others = all
      .filter(u => u.userId !== userId)
      .map(({ userId, name }) => ({ userId, name }));
    io.to(socketId).emit('discoverable-users', others);
  });
}

export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, cb) => {
        if (
          !origin ||
          origin.startsWith('http://localhost:') ||
          origin.startsWith('http://127.0.0.1:')
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
    socket.on('register', ({ userId }) => {
      socket.data.userId = userId;
      registerUser(userId, socket.id);
      console.log(`[socket] registered: ${userId} → ${socket.id}`);
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
      const targetSocketId = getSocketIdForUser(targetUserId);
      if (!targetSocketId) {
        socket.emit('call-error', { message: `User "${targetUserId}" is not online.` });
        return;
      }
      // Persist caller's lang prefs so accept-call can read them
      socket.data.speakLang = speakLang;
      socket.data.hearLang = hearLang;

      io.to(targetSocketId).emit('incoming-call', {
        callerId: socket.data.userId,
        callerName: callerName || socket.data.userId,
      });
    });

    // ── accept-call ──────────────────────────────────────────────────────────
    socket.on('accept-call', ({ callerId, speakLang, hearLang }) => {
      const callerSocketId = getSocketIdForUser(callerId);
      if (!callerSocketId) {
        socket.emit('call-error', { message: 'Caller is no longer online.' });
        return;
      }

      const callerSocket = io.sockets.sockets.get(callerSocketId);
      const roomId = `${callerId}_${socket.data.userId}_${Date.now()}`;

      const userA = {
        socketId: callerSocketId,
        userId: callerId,
        speakLang: callerSocket?.data.speakLang || 'EN',
        hearLang: callerSocket?.data.hearLang || 'UR',
      };
      const userB = {
        socketId: socket.id,
        userId: socket.data.userId,
        speakLang,
        hearLang,
      };

      createRoom(roomId, userA, userB);

      // Remove both users from discoverable list when a call starts
      removeDiscoverableUser(callerId);
      removeDiscoverableUser(socket.data.userId);
      broadcastDiscoverableList(io);

      // Notify caller
      io.to(callerSocketId).emit('call-accepted', {
        roomId,
        peerUserId: userB.userId,
        peerSpeakLang: userB.speakLang,
        peerHearLang: userB.hearLang,
      });

      // Notify accepter
      socket.emit('call-accepted', {
        roomId,
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

    // ── speech-text → translate → peer ───────────────────────────────────────
    socket.on('speech-text', async ({ roomId, text }) => {
      console.log(`[pipeline] speech-text received from ${socket.data.userId}: "${text}"`);

      const room = getRoom(roomId);
      if (!room) { console.warn('[pipeline] room not found:', roomId); return; }

      const other = getOtherParticipant(roomId, socket.id);
      if (!other) { console.warn('[pipeline] other participant not found'); return; }

      const isUserA = room.userA.socketId === socket.id;
      const fromLang = isUserA ? room.userA.speakLang : room.userB.speakLang;
      const toLang   = isUserA ? room.userB.hearLang  : room.userA.hearLang;

      console.log(`[pipeline] translating "${text}" from ${fromLang} → ${toLang}`);

      try {
        const translated = await translateText(text, fromLang, toLang);
        console.log(`[pipeline] translated: "${translated}" → emitting to ${other.userId}`);
        io.to(other.socketId).emit('translated-text', {
          text: translated,
          fromUserId: socket.data.userId,
        });
      } catch (err) {
        console.error('[translate] error:', err.message);
      }
    });

    // ── audio-chunk → Google STT → translate → peer ───────────────────────────
    // Frontend sends 4-second audio blobs (base64). Backend transcribes with
    // Google Cloud Speech-to-Text, then translates and forwards to peer.
    socket.on('audio-chunk', async ({ roomId, audioBase64, mimeType }) => {
      const room = getRoom(roomId);
      if (!room) { console.warn('[Google STT] room not found:', roomId); return; }

      const other = getOtherParticipant(roomId, socket.id);
      if (!other) { console.warn('[Google STT] peer not found'); return; }

      const isUserA    = room.userA.socketId === socket.id;
      const speakLang  = isUserA ? room.userA.speakLang : room.userB.speakLang;
      const toLang     = isUserA ? room.userB.hearLang  : room.userA.hearLang;

      const languageCode = LOCALE_MAP[speakLang] ?? 'en-US';

      try {
        const text = await transcribeAudio(audioBase64, languageCode, mimeType);
        if (!text.trim()) return; // silence / nothing heard

        console.log(`[Google STT] heard: "${text}" (${languageCode})`);

        // Echo raw transcript back to sender so they see what was recognised
        socket.emit('speech-transcript', { text });

        // Translate and forward to peer
        const translated = await translateText(text, speakLang, toLang);
        console.log(`[pipeline] translated: "${translated}" → ${other.userId}`);
        io.to(other.socketId).emit('translated-text', {
          text: translated,
          fromUserId: socket.data.userId,
        });
      } catch (err) {
        console.error('[Google STT] error:', err.message);
      }
    });

    // ── end-call ──────────────────────────────────────────────────────────────
    socket.on('end-call', ({ roomId }) => {
      const other = getOtherParticipant(roomId, socket.id);
      if (other) {
        io.to(other.socketId).emit('call-ended');
      }
      deleteRoom(roomId);
      console.log(`[socket] room deleted: ${roomId}`);
    });

    // ── create-meeting ────────────────────────────────────────────────────────
    socket.on('create-meeting', ({ meetingId, hostSpeakLang, hostHearLang, invitees }) => {
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
          uniqueLangs.map(lang =>
            translateText(text, fromLang, lang).then(t => [lang, t])
          )
        );
        const cache = new Map(pairs);
        joined.forEach(r => {
          io.to(r.socketId).emit('meeting-translated', {
            text: cache.get(r.hearLang),
            fromUserId: senderId,
            meetingId,
          });
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
          uniqueLangs.map(lang =>
            translateText(text, speakLang, lang).then(t => [lang, t])
          )
        );
        const cache = new Map(pairs);
        joined.forEach(r => {
          io.to(r.socketId).emit('meeting-translated', {
            text: cache.get(r.hearLang),
            fromUserId: senderId,
            meetingId,
          });
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
      broadcastDiscoverableList(io);

      const roomId = getRoomForSocket(socket.id);
      if (roomId) {
        const other = getOtherParticipant(roomId, socket.id);
        if (other) {
          io.to(other.socketId).emit('peer-disconnected');
        }
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
