import { verifyFirebaseToken } from "./verifyFirebaseToken.js";

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function requireAdmin(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!idToken) throw Object.assign(new Error("Falta el token de autenticación"), { status: 401 });

  let user;
  try {
    user = await verifyFirebaseToken(idToken, env.FIREBASE_PROJECT_ID);
  } catch (error) {
    throw Object.assign(new Error(`Token inválido: ${error.message}`), { status: 401 });
  }

  const adminEmails = String(env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (!user.email || !adminEmails.includes(user.email.toLowerCase())) {
    throw Object.assign(new Error("Esta acción requiere permisos de administrador"), { status: 403 });
  }
  if (user.email_verified !== true) {
    throw Object.assign(new Error("El correo administrador todavía no está verificado"), { status: 403 });
  }
  return user;
}
