// In-memory meeting room state — cleared on server restart
// meetingId → { hostId, hostSocketId, status, participants: Map<userId, entry> }
// entry = { userId, socketId, speakLang, hearLang, status: 'invited'|'joined'|'left' }
const meetingRooms = new Map();
const socketMeetingMap = new Map(); // socketId → meetingId (O(1) disconnect lookup)

export function createMeeting(meetingId, hostEntry) {
  const participants = new Map();
  const entry = { ...hostEntry, status: 'joined' };
  participants.set(hostEntry.userId, entry);
  meetingRooms.set(meetingId, {
    hostId: hostEntry.userId,
    hostSocketId: hostEntry.socketId,
    status: 'active',
    participants,
  });
  socketMeetingMap.set(hostEntry.socketId, meetingId);
}

export function addInvitedParticipant(meetingId, userId, speakLang, hearLang) {
  const room = meetingRooms.get(meetingId);
  if (!room) return;
  room.participants.set(userId, {
    userId,
    socketId: null,
    speakLang,
    hearLang,
    status: 'invited',
  });
}

export function participantJoined(meetingId, userId, socketId, speakLang, hearLang) {
  const room = meetingRooms.get(meetingId);
  if (!room) return;
  const entry = room.participants.get(userId);
  if (!entry) return;
  entry.socketId = socketId;
  entry.speakLang = speakLang;
  entry.hearLang = hearLang;
  entry.status = 'joined';
  socketMeetingMap.set(socketId, meetingId);
}

export function participantLeft(meetingId, userId) {
  const room = meetingRooms.get(meetingId);
  if (!room) return;
  const entry = room.participants.get(userId);
  if (!entry) return;
  if (entry.socketId) socketMeetingMap.delete(entry.socketId);
  entry.status = 'left';
  entry.socketId = null;
}

export function getMeeting(meetingId) {
  return meetingRooms.get(meetingId) ?? null;
}

export function getMeetingForSocket(socketId) {
  return socketMeetingMap.get(socketId) ?? null;
}

export function getJoinedParticipants(meetingId) {
  const room = meetingRooms.get(meetingId);
  if (!room) return [];
  const result = [];
  room.participants.forEach((entry) => {
    if (entry.status === 'joined') result.push(entry);
  });
  return result;
}

export function getAllParticipantEntries(meetingId) {
  const room = meetingRooms.get(meetingId);
  if (!room) return [];
  const result = [];
  room.participants.forEach((entry) => result.push(entry));
  return result;
}

export function deleteMeeting(meetingId) {
  const room = meetingRooms.get(meetingId);
  if (!room) return;
  room.participants.forEach((entry) => {
    if (entry.socketId) socketMeetingMap.delete(entry.socketId);
  });
  // Also clean up host socket entry (already in participants, but guard anyway)
  socketMeetingMap.delete(room.hostSocketId);
  meetingRooms.delete(meetingId);
}

export function isHost(meetingId, socketId) {
  const room = meetingRooms.get(meetingId);
  return room ? room.hostSocketId === socketId : false;
}
