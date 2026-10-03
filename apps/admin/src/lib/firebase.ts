import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth, type Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId,
);

// Deferred init: a missing/placeholder config must not crash the whole app at module
// load, only the actual sign-in attempt (mirrors the backend's FirebaseAdminProvider).
let cachedAuth: Auth | null = null;

export function getFirebaseAuth(): Auth {
  if (!isFirebaseConfigured) {
    throw new Error('Firebase is not configured - see apps/admin/.env.example');
  }
  if (!cachedAuth) {
    cachedAuth = getAuth(initializeApp(firebaseConfig));
  }
  return cachedAuth;
}

export const googleProvider = new GoogleAuthProvider();
