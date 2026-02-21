import * as React from 'react';
import { createContext } from 'react';
import type { AuthUser } from '@/api/auth';
import { signInApi, signUpApi } from '@/api/auth';
import { getSessionUser, setSessionUser, clearSessionUser } from '@/utils/sessionStorage';

// Type assertion for React hooks (Expo/RN types may not expose them on React namespace)
const useReact = React as typeof React & {
  useState: <S>(s: S | (() => S)) => [S, (s: S | ((prev: S) => S)) => void];
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => void;
  useCallback: <T>(cb: T, deps: unknown[]) => T;
  useContext: <T>(ctx: React.Context<T | null>) => T | null;
};

type AuthContextType = {
  user: AuthUser | null;
  isLoading: boolean;
  isInitialized: boolean;
  signIn: (userId: string, password: string) => Promise<{ success: boolean; message: string }>;
  signUp: (userId: string, password: string) => Promise<{ success: boolean; message: string }>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

type AuthProviderProps = { children: React.ReactNode };

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useReact.useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useReact.useState(false);
  const [isInitialized, setIsInitialized] = useReact.useState(false);

  useReact.useEffect(() => {
    const stored = getSessionUser();
    if (stored) {
      setUser(stored);
    }
    setIsInitialized(true);
  }, []);

  const signIn = useReact.useCallback(async (userId: string, password: string) => {
    setIsLoading(true);
    try {
      const res = await signInApi({ userId, password });
      if (res.status && res.user) {
        setUser(res.user);
        setSessionUser(res.user);
        return { success: true, message: res.message };
      }
      return { success: false, message: res.message || 'Sign in failed' };
    } catch (err: any) {
      const msg = err.response?.data?.message ?? err.message;
      const message = typeof msg === 'string' ? msg : 'Invalid credentials. Please try again.';
      return { success: false, message };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const signUp = useReact.useCallback(async (userId: string, password: string) => {
    setIsLoading(true);
    try {
      const res = await signUpApi({ userId, password });
      if (res.status) {
        return { success: true, message: res.message };
      }
      return { success: false, message: res.message || 'Sign up failed' };
    } catch (err: any) {
      const message = err.response?.data?.message || err.message || 'Network error';
      return { success: false, message };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useReact.useCallback(() => {
    setUser(null);
    clearSessionUser();
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, isInitialized, signIn, signUp, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useReact.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
