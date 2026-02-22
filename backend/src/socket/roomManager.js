// In-memory state — cleared on server restart
const userSocketMap = new Map(); // userId → socketId
const rooms = new Map();         // roomId → { userA, userB }
const socketRoomMap = new Map(); // socketId → roomId
const discoverableUsers = new Map(); // userId → { socketId, name }

export function registerUser(userId, socketId) {
  userSocketMap.set(userId, socketId);
}

export function unregisterUser(userId) {
  userSocketMap.delete(userId);
}

export function getSocketIdForUser(userId) {
  return userSocketMap.get(userId) ?? null;
}

export function createRoom(roomId, userA, userB) {
  rooms.set(roomId, { userA, userB });
  socketRoomMap.set(userA.socketId, roomId);
  socketRoomMap.set(userB.socketId, roomId);
}

export function getRoom(roomId) {
  return rooms.get(roomId) ?? null;
}

export function deleteRoom(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    socketRoomMap.delete(room.userA.socketId);
    socketRoomMap.delete(room.userB.socketId);
    rooms.delete(roomId);
  }
}

export function getRoomForSocket(socketId) {
  return socketRoomMap.get(socketId) ?? null;
}

export function getOtherParticipant(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  if (room.userA.socketId === socketId) return room.userB;
  if (room.userB.socketId === socketId) return room.userA;
  return null;
}

export function addDiscoverableUser(userId, socketId, name) {
  discoverableUsers.set(userId, { socketId, name });
}

export function removeDiscoverableUser(userId) {
  discoverableUsers.delete(userId);
}

export function getAllDiscoverableUsers() {
  const list = [];
  discoverableUsers.forEach((val, uid) => {
    list.push({ userId: uid, name: val.name, socketId: val.socketId });
  });
  return list;
}
