// =========================================================
// Autenticación y control de acceso por rol
// =========================================================
import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Lista de arranque. No es un secreto: el servidor vuelve a verificar
// ADMIN_EMAILS antes de aceptar acciones sensibles como subir o analizar.
const ADMIN_EMAILS = new Set([
  "vicentebasoalto2@gmail.com",
]);

function normalizeEmail(email = "") {
  return email.trim().toLowerCase();
}

function isBootstrapAdmin(email) {
  return ADMIN_EMAILS.has(normalizeEmail(email));
}

function defaultRole(user) {
  return isBootstrapAdmin(user.email) && user.emailVerified ? "admin" : "student";
}

async function ensureProfile(user, displayName = "") {
  const profileRef = doc(db, "usuarios", user.uid);
  const snapshot = await getDoc(profileRef);
  const email = normalizeEmail(user.email);

  if (!snapshot.exists()) {
    const role = defaultRole(user);
    const profile = {
      email,
      displayName: displayName || user.displayName || email.split("@")[0],
      role,
      puntajeEstimado: null,
      dominioGlobal: 0,
      totalIntentos: 0,
      creadoEn: serverTimestamp(),
      ultimaConexion: serverTimestamp(),
    };
    await setDoc(profileRef, profile);
    return profile;
  }

  const current = snapshot.data();
  // Permite que el administrador inicial recupere el rol aunque su perfil
  // se haya creado antes de agregar el correo a la lista de arranque.
  const role = defaultRole(user) === "admin" ? "admin" : (current.role || "student");
  await setDoc(profileRef, {
    ultimaConexion: serverTimestamp(),
    email,
    role,
  }, { merge: true });

  return { ...current, email, role };
}

export async function registerStudent(email, password, displayName) {
  const credentials = await createUserWithEmailAndPassword(auth, email, password);
  const profile = await ensureProfile(credentials.user, displayName);

  if (isBootstrapAdmin(email) && !credentials.user.emailVerified) {
    await sendEmailVerification(credentials.user);
    await signOut(auth);
    return {
      uid: credentials.user.uid,
      role: "student",
      requiresEmailVerification: true,
    };
  }

  return { uid: credentials.user.uid, role: profile.role, requiresEmailVerification: false };
}

export async function login(email, password) {
  const credentials = await signInWithEmailAndPassword(auth, email, password);

  if (isBootstrapAdmin(email) && !credentials.user.emailVerified) {
    await sendEmailVerification(credentials.user).catch(() => {});
    await signOut(auth);
    const error = new Error("Debes verificar el correo administrador antes de ingresar.");
    error.code = "auth/admin-email-not-verified";
    throw error;
  }

  const profile = await ensureProfile(credentials.user);
  return { uid: credentials.user.uid, role: profile.role };
}

export async function logout() {
  await signOut(auth);
  window.location.href = "/index.html";
}

export function requireAuth({ role } = {}) {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribe();
      if (!user) {
        window.location.replace("/index.html");
        return;
      }

      try {
        const profile = await ensureProfile(user);
        if (role && profile.role !== role) {
          window.location.replace(
            profile.role === "admin" ? "/pages/admin.html" : "/pages/student.html"
          );
          return;
        }

        resolve({
          uid: user.uid,
          email: user.email,
          role: profile.role,
          ...profile,
        });
      } catch (error) {
        reject(error);
      }
    }, reject);
  });
}

export function redirectByRole(role) {
  window.location.href = role === "admin"
    ? "/pages/admin.html"
    : "/pages/student.html";
}
