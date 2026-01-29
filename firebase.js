import { firebaseConfig } from './firebase-config.js';

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  getDoc, getDocs, onSnapshot, query, orderBy, where, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Secondary auth (لإنشاء حسابات من داخل التطبيق بدون تسجيل خروج المدير)
export function getSecondaryAuth(){
  const name = "secondary";
  let secondaryApp;
  const apps = getApps();
  const found = apps.find(a => a.name === name);
  if(found){
    secondaryApp = getApp(name);
  } else {
    secondaryApp = initializeApp(firebaseConfig, name);
  }
  return getAuth(secondaryApp);
}

// Firestore helpers
export const fs = {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  getDoc, getDocs, onSnapshot, query, orderBy, where, limit, serverTimestamp
};

export const authApi = {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword
};
