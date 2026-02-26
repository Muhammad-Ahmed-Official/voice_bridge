import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

function getBackendUrl(): string {
  if (Platform.OS === 'web') {
    return 'http://localhost:3000';
  }

  // For mobile: extract IP from Expo's hostUri (e.g., "192.168.0.105:8081")
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const ip = hostUri.split(':')[0];
    console.log('[Socket] Using backend IP:', ip);
    return `http://${ip}:3000`;
  }

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
