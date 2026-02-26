import { Platform } from 'react-native';
import type { AuthUser } from '@/api/auth';

const AUTH_USER_KEY = 'voice_bridge_user';

// In-memory fallback for React Native (no sessionStorage on native)
let memoryStore: string | null = null;

function getSessionStorage(): Storage | null {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.sessionStorage) {
    return window.sessionStorage;
  }
  return null;
}

export function getSessionUser(): AuthUser | null {
  try {
    const storage = getSessionStorage();
    const raw = storage ? storage.getItem(AUTH_USER_KEY) : memoryStore;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.userId === 'string' && typeof parsed.name === 'string') {
      return { 
        _id: parsed._id || '', 
        userId: parsed.userId, 
        name: parsed.name 
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function setSessionUser(user: AuthUser): void {
  const raw = JSON.stringify(user);
  const storage = getSessionStorage();
  if (storage) {
    storage.setItem(AUTH_USER_KEY, raw);
  } else {
    memoryStore = raw;
  }
}

export function clearSessionUser(): void {
  const storage = getSessionStorage();
  if (storage) {
    storage.removeItem(AUTH_USER_KEY);
  } else {
    memoryStore = null;
  }
}
