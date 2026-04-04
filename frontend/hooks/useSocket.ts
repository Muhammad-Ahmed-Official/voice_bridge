import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

function getBackendUrl(): string {
  // Priority 1: explicit env var (production / APK builds)
  if (process.env.EXPO_PUBLIC_API_URL) {
    try {
      const url = new URL(process.env.EXPO_PUBLIC_API_URL);
      const origin = `${url.protocol}//${url.host}`;
      console.log('[Socket] Using backend from EXPO_PUBLIC_API_URL:', origin);
      return origin;
    } catch {
      // malformed URL — fall through
    }
  }

  // Priority 2: native dev (Expo Go on physical device / emulator)
  // Metro's hostUri is always the LAN IP of the dev machine, so using the same
  // host for the socket ensures it reaches the locally-running backend.
  if (Platform.OS !== 'web') {
    const hostUri = Constants.expoConfig?.hostUri;
    if (hostUri) {
      const ip = hostUri.split(':')[0];
      console.log('[Socket] Auto-detected backend IP from Metro hostUri:', ip);
      return `http://${ip}:3000`;
    }
  }

  // Priority 3: web browser or last-resort fallback
  return 'http://localhost:3000';
}

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