import { json, requireAdmin } from "../_lib/adminAuth.js";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const BUCKET = "materiales";

function sanitizeFileName(name) {
  return String(name || "archivo")
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 120);
}

export async function onRequestPost({ request, env }) {
  try {
    const user = await requireAdmin(request, env);
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: "Supabase Storage no está configurado en Cloudflare" }, 500);
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "No se pudo leer el formulario enviado" }, 400);
    }

    const file = form.get("file");
    if (!file || typeof file === "string") return json({ error: "No se incluyó ningún archivo" }, 400);
    if (!ALLOWED_TYPES.has(file.type)) return json({ error: `Tipo no permitido: ${file.type || "desconocido"}` }, 400);
    if (!file.size) return json({ error: "El archivo está vacío" }, 400);
    if (file.size > MAX_FILE_SIZE) return json({ error: "El archivo supera el límite de 20 MB" }, 400);

    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
    const uploadUrl = `${env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`;
    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": file.type,
        "x-upsert": "false",
      },
      body: file.stream(),
    });

    if (!uploadResponse.ok) {
      const detail = await uploadResponse.text().catch(() => "");
      return json({ error: `Supabase rechazó la subida: ${detail.slice(0, 500)}` }, 502);
    }

    return json({
      key: `${BUCKET}/${path}`,
      name: file.name,
      size: file.size,
      contentType: file.type,
      subidoPorUid: user.uid,
      subidoPorEmail: user.email,
    });
  } catch (error) {
    return json({ error: error.message }, error.status || 500);
  }
}

export function onRequestGet() {
  return json({ error: "Usa POST multipart/form-data" }, 405);
}
