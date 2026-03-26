import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** @type {import('firebase/app').FirebaseApp} */
let app;

/** @type {import('firebase/auth').Auth} */
let auth;

/** @type {import('firebase/firestore').Firestore} */
let db;

/**
 * Firebase を初期化し、Auth / Firestore インスタンスを返す
 */
export function initFirebase(config = firebaseConfig) {
  if (app) return { app, auth, db };

  app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);

  return { app, auth, db };
}

export function getFirebaseApp() {
  if (!app) throw new Error('Firebase not initialized. Call initFirebase() first.');
  return app;
}

export function getFirebaseAuth() {
  if (!auth) throw new Error('Firebase not initialized. Call initFirebase() first.');
  return auth;
}

export function getFirebaseDb() {
  if (!db) throw new Error('Firebase not initialized. Call initFirebase() first.');
  return db;
}
