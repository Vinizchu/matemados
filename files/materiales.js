// =========================================================
// POST /api/materiales
// Recibe un archivo (PDF o imagen) y lo sube a Supabase Storage
// (elegido porque su free tier no exige tarjeta, a diferencia de
// Firebase Storage y Cloudflare R2).
// Solo accesible para usuarios cuyo correo esté en ADMIN_EMAILS.
//
// Requiere, configurados en el proyecto de Cloudflare Pages:
//   - Variable de entorno:  FIREBASE_PROJECT_ID
//   - Variable de entorno:  ADMIN_EMAILS       (separados por coma)
//   - Variable de entorno:  SUPABASE_URL       (ej: https://xxxx.supabase.co)
//   - Secreto:              SUPABASE_SERVICE_ROLE_KEY
//     (Settings → Environment variables → marcar como "Secret";
//      esta clave NUNCA debe llegar al navegador, por eso todo el
//      flujo pasa por esta Function y no por el cliente directo).
// =========================================================
import { verifyFirebaseToken } from "../_lib/verifyFirebaseToken.js";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const SUPABASE_BUCKET = "materiales";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sanitizeFileName(name) {
  return name
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 120);
}

export async function onRequestPost({ request, env }) {
  // 1. Verificar identidad
  const authHeader = request.headers.get("Authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) return json({ error: "Falta el token de autenticación" }, 401);

  let user;
  try {
    user = await verifyFirebaseToken(idToken, env.FIREBASE_PROJECT_ID);
  } catch (err) {
    return json({ error: `Token inválido: ${err.message}` }, 401);
  }

  // 2. Verificar rol de administrador
  // TODO: migrar a Firebase Custom Claims cuando exista el panel de
  // administración de usuarios; por ahora se sincroniza a mano con
  // ADMIN_EMAILS en js/auth.js.
  const adminEmails = (env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (!user.email || !adminEmails.includes(user.email.toLowerCase())) {
    return json({ error: "Esta acción requiere permisos de administrador" }, 403);
  }

  // 3. Leer el archivo
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "No se pudo leer el archivo enviado" }, 400);
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return json({ error: "No se incluyó ningún archivo" }, 400);
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return json({ error: `Tipo de archivo no permitido: ${file.type}` }, 400);
  }
  if (file.size > MAX_FILE_SIZE) {
    return json({ error: "El archivo supera el límite de 20 MB" }, 400);
  }

  // 4. Subir a Supabase Storage
  const path = `${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
  const uploadUrl = `${env.SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${path}`;

  let uploadRes;
  try {
    uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": file.type,
      },
      body: file.stream(),
    });
  } catch (err) {
    return json({ error: `Error de red subiendo el archivo: ${err.message}` }, 502);
  }

  if (!uploadRes.ok) {
    const detail = await uploadRes.text().catch(() => "");
    return json({ error: `Supabase Storage rechazó la subida: ${detail}` }, 502);
  }

  return json({
    key: `${SUPABASE_BUCKET}/${path}`,
    name: file.name,
    size: file.size,
    contentType: file.type,
    subidoPorUid: user.uid,
    subidoPorEmail: user.email,
  });
}

// Rechaza otros métodos con un mensaje claro en vez de un 404 confuso.
export async function onRequestGet() {
  return json({ error: "Usa POST con multipart/form-data para subir un archivo" }, 405);
}
