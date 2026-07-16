// Verificación de Firebase ID tokens para Cloudflare Workers/Pages Functions.
// No usa Firebase Admin SDK porque ese SDK depende de APIs de Node.
const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

function base64UrlToUint8Array(base64Url) {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function base64UrlToJson(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(value)));
}

let cachedJwks = null;
let cacheExpiresAt = 0;

async function getJwks() {
  if (cachedJwks && Date.now() < cacheExpiresAt) return cachedJwks;

  const response = await fetch(JWKS_URL);
  if (!response.ok) throw new Error("No se pudieron obtener las claves públicas de Firebase");
  const payload = await response.json();
  if (!Array.isArray(payload.keys)) throw new Error("Respuesta JWKS inesperada");

  const cacheControl = response.headers.get("cache-control") || "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] || 3600);
  cachedJwks = payload.keys;
  cacheExpiresAt = Date.now() + maxAge * 1000;
  return cachedJwks;
}

export async function verifyFirebaseToken(idToken, projectId) {
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID no está configurado");
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("Token con formato inválido");

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = base64UrlToJson(headerB64);
  const payload = base64UrlToJson(payloadB64);
  if (header.alg !== "RS256" || !header.kid) throw new Error("Cabecera JWT inválida");

  const keys = await getJwks();
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("No se encontró la clave pública del token");

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToUint8Array(signatureB64);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    signature,
    signedData
  );
  if (!valid) throw new Error("Firma del token inválida");

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) throw new Error("Token expirado");
  if (!payload.iat || payload.iat > now + 60) throw new Error("Fecha de emisión inválida");
  if (payload.auth_time && payload.auth_time > now + 60) throw new Error("Fecha de autenticación inválida");
  if (payload.aud !== projectId) throw new Error("Token de otro proyecto Firebase");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("Emisor inválido");
  if (!payload.sub || payload.sub.length > 128) throw new Error("Identificador de usuario inválido");

  return { uid: payload.sub, email: payload.email, ...payload };
}
