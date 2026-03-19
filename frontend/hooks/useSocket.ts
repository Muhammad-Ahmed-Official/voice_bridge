import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Platform } from 'react-native';

function getBackendUrl(): string {
  // 1) If EXPO_PUBLIC_API_URL is set, derive socket origin from it
  if (process.env.EXPO_PUBLIC_API_URL) {
    try {
      const url = new URL(process.env.EXPO_PUBLIC_API_URL);
      const origin = `${url.protocol}//${url.host}`;
      console.log('[Socket] Using backend from EXPO_PUBLIC_API_URL:', origin);
      return origin;
    } catch {
      // fall through
    }
  }

  // 2) Default: use deployed backend origin
  // return 'https://voice-bridge-backend-xq5w.onrender.com';
  return 'http://localhost:3000';
}

// Module-level singleton — one socket for the entire app lifetime
let socketSingleton: Socket | null = null;

function getSocket(): Socket {
  if (!socketSingleton) {
    const backendUrl = getBackendUrl();
    socketSingleton = io(backendUrl, {
      transports: ['websocket'],
      autoConnect: false,
    });
  }
  return socketSingleton;
}

export function useSocket(userId: string | null, odId?: string | null) {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!userId) return;

    const socket = getSocket();

    const handleConnect = () => {
      setIsConnected(true);
      socket.emit('register', { userId, odId });
    };
    const handleDisconnect = () => setIsConnected(false);

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    if (!socket.connected) {
      socket.connect();
    } else {
      handleConnect();
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, [userId, odId]);

  return { socket: getSocket(), isConnected };
}
