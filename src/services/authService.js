import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged as firebaseOnAuthStateChanged,
} from 'firebase/auth';
import { getFirebaseAuth } from '../config/firebase.js';

/**
 * 新規アカウント作成
 * @param {string} email
 * @param {string} password
 * @returns {Promise<import('firebase/auth').UserCredential>}
 */
export async function signUp(email, password) {
  const auth = getFirebaseAuth();
  return createUserWithEmailAndPassword(auth, email, password);
}

/**
 * ログイン
 * @param {string} email
 * @param {string} password
 * @returns {Promise<import('firebase/auth').UserCredential>}
 */
export async function signIn(email, password) {
  const auth = getFirebaseAuth();
  return signInWithEmailAndPassword(auth, email, password);
}

/**
 * ログアウト
 * @returns {Promise<void>}
 */
export async function signOut() {
  const auth = getFirebaseAuth();
  return firebaseSignOut(auth);
}

/**
 * 認証状態の変化を監視する
 * @param {Function} callback - (user | null) を受け取るコールバック
 * @returns {Function} unsubscribe 関数
 */
export function onAuthStateChanged(callback) {
  const auth = getFirebaseAuth();
  return firebaseOnAuthStateChanged(auth, callback);
}
