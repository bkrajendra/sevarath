import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { FirebaseError } from 'firebase/app';
import { signInWithPopup, signOut } from 'firebase/auth';
import { getFirebaseAuth, googleProvider, isFirebaseConfigured } from '@/lib/firebase';
import { api, setAccessToken } from '@/lib/api-client';

interface AuthUser {
  userId: string;
  role: 'USER' | 'DRIVER' | 'ADMIN' | 'OPERATOR';
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const REFRESH_TOKEN_KEY = 'sevarath.refreshToken';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!storedRefreshToken) {
      setLoading(false);
      return;
    }

    api
      .POST('/api/v1/auth/refresh', { body: { refreshToken: storedRefreshToken } })
      .then(({ data, error: apiError }) => {
        if (apiError || !data) {
          localStorage.removeItem(REFRESH_TOKEN_KEY);
          return;
        }
        setAccessToken(data.accessToken);
        localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
        setUser({ userId: data.userId, role: data.role as AuthUser['role'] });
      })
      .finally(() => setLoading(false));
  }, []);

  async function loginWithGoogle() {
    setError(null);
    if (!isFirebaseConfigured) {
      setError('Firebase is not configured on this deployment yet (see apps/admin/.env.example).');
      return;
    }
    try {
      const credential = await signInWithPopup(getFirebaseAuth(), googleProvider);
      const idToken = await credential.user.getIdToken();

      const { data, error: apiError } = await api.POST('/api/v1/auth/login', {
        body: { idToken },
      });

      if (apiError || !data) {
        setError('Sign-in succeeded with Google but was rejected by the API.');
        return;
      }

      setAccessToken(data.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
      setUser({ userId: data.userId, role: data.role as AuthUser['role'] });
    } catch (err) {
      if (err instanceof FirebaseError && err.code === 'auth/popup-closed-by-user') {
        // User closed the popup themselves - not a real error, no message needed.
        return;
      }
      const detail = err instanceof FirebaseError ? `${err.code}` : 'unknown error';
      setError(`Google sign-in failed (${detail}). See browser console for detail.`);
      console.error('Google sign-in failed:', err);
    }
  }

  async function logout() {
    setAccessToken(null);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    setUser(null);
    if (isFirebaseConfigured) {
      await signOut(getFirebaseAuth());
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, error, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
