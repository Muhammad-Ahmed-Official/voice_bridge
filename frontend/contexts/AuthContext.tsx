import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { AuthUser } from '@/api/auth';
import { signInApi, signUpApi } from '@/api/auth';

type AuthContextType = {
  user: AuthUser | null;
  isLoading: boolean;
  signIn: (userId: string, password: string) => Promise<{ success: boolean; message: string }>;
  signUp: (userId: string, password: string) => Promise<{ success: boolean; message: string }>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const signIn = useCallback(async (userId: string, password: string) => {
    setIsLoading(true);
    try {
      const res = await signInApi({ userId, password });
      if (res.status && res.user) {
        setUser(res.user);
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

  const signUp = useCallback(async (userId: string, password: string) => {
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

  const logout = useCallback(() => {
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signUp, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
