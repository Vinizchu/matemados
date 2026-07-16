// =========================================================
// Verifica un ID token de Firebase Auth dentro de un Worker,
// sin depender del Admin SDK (que usa APIs de Node no disponibles aquí).
//
// Sigue el mismo algoritmo que documenta Firebase para verificar
// tokens con una librería JWT de terceros:
// https://firebase.google.com/docs/auth/admin/verify-id-tokens
// =========================================================

const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/[email protected]";

function base64UrlToUint8Array(base64Url) {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function base64UrlToJson(base64Url) {
  const bytes = base64UrlToUint8Array(base64Url);
  return JSON.parse(new TextDecoder().decode(bytes));
}

let cachedJwks = null;
let cachedJwksAt = 0;

async function getJwks() {
  const ONE_HOUR = 60 * 60 * 1000;
  if (cachedJwks && Date.now() - cachedJwksAt < ONE_HOUR) return cachedJwks;

  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error("No se pudo obtener las claves públicas de Firebase");
  const { keys } = await res.json();
  cachedJwks = keys;
  cachedJwksAt = Date.now();
  return keys;
}

/**
 * Verifica un ID token de Firebase Auth.
 * @param {string} idToken
 * @param {string} projectId - tu Project ID de Firebase
 * @returns {Promise<{uid: string, email: string, [key: string]: any}>}
 * @throws si el token es inválido, expiró, o no corresponde al proyecto.
 */
export async function verifyFirebaseToken(idToken, projectId) {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Token con formato inválido");
  const [headerB64, payloadB64, signatureB64] = parts;

  const header = base64UrlToJson(headerB64);
  const payload = base64UrlToJson(payloadB64);

  if (header.alg !== "RS256") throw new Error("Algoritmo de firma inesperado");

  const keys = await getJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("No se encontró la clave pública para este token");

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToUint8Array(signatureB64);

  const isValid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, data);
  if (!isValid) throw new Error("Firma del token inválida");

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error("Token expirado");
  if (payload.iat > now) throw new Error("Token con fecha de emisión futura");
  if (payload.aud !== projectId) throw new Error("Token no corresponde a este proyecto");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error("Emisor del token inválido");
  }
  if (!payload.sub) throw new Error("Token sin identificador de usuario");

  return { uid: payload.sub, email: payload.email, ...payload };
}
