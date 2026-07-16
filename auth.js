// =========================================================
// Autenticación y control de acceso por rol
// =========================================================
import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Lista temporal de correos con rol admin.
// TODO: reemplazar por un campo gestionado desde Firestore/console
// una vez exista el panel de administración de usuarios.
const ADMIN_EMAILS = [
  // "tu-correo-admin@ejemplo.com",
];

/**
 * Crea una cuenta nueva y su documento de perfil en Firestore.
 */
export async function registerStudent(email, password, displayName) {
  const credentials = await createUserWithEmailAndPassword(auth, email, password);
  const role = ADMIN_EMAILS.includes(email) ? "admin" : "student";

  await setDoc(doc(db, "usuarios", credentials.user.uid), {
    email,
    displayName: displayName || email.split("@")[0],
    role,
    puntajeEstimado: null,
    creadoEn: serverTimestamp(),
    ultimaConexion: serverTimestamp(),
  });

  return { uid: credentials.user.uid, role };
}

/**
 * Inicia sesión y devuelve el rol del usuario para poder redirigir.
 */
export async function login(email, password) {
  const credentials = await signInWithEmailAndPassword(auth, email, password);
  const profile = await getDoc(doc(db, "usuarios", credentials.user.uid));

  if (!profile.exists()) {
    // Perfil no encontrado (cuenta creada fuera del flujo normal): se crea uno base.
    const role = ADMIN_EMAILS.includes(email) ? "admin" : "student";
    await setDoc(doc(db, "usuarios", credentials.user.uid), {
      email,
      displayName: email.split("@")[0],
      role,
      puntajeEstimado: null,
      creadoEn: serverTimestamp(),
      ultimaConexion: serverTimestamp(),
    });
    return { uid: credentials.user.uid, role };
  }

  return { uid: credentials.user.uid, role: profile.data().role || "student" };
}

export async function logout() {
  await signOut(auth);
  window.location.href = "/index.html";
}

/**
 * Protege una página: exige sesión activa y, opcionalmente, un rol específico.
 * Uso en pages/student.html o pages/admin.html:
 *   requireAuth({ role: "admin" }).then(user => { ... });
 */
export function requireAuth({ role } = {}) {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = "/index.html";
        return;
      }
      const profile = await getDoc(doc(db, "usuarios", user.uid));
      const userRole = profile.exists() ? profile.data().role : "student";

      if (role && userRole !== role) {
        // Redirige a su panel correspondiente en vez de mostrar acceso denegado en seco.
        window.location.href = userRole === "admin" ? "/pages/admin.html" : "/pages/student.html";
        return;
      }

      resolve({ uid: user.uid, email: user.email, role: userRole, ...profile.data() });
    });
  });
}

export function redirectByRole(role) {
  window.location.href = role === "admin" ? "/pages/admin.html" : "/pages/student.html";
}
