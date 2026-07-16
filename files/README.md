# PAES M2 · Entrenador Inteligente — Setup base

Estructura inicial del proyecto: frontend vanilla (HTML/CSS/JS), autenticación
y separación de roles (estudiante/admin) sobre Firebase, lista para desplegar
en Cloudflare Pages.

## Estructura

```
paes-m2-app/
├── index.html            # Login / registro (página pública)
├── pages/
│   ├── student.html      # Dashboard estudiante (protegido)
│   └── admin.html        # Dashboard admin (protegido, solo role=admin)
├── css/
│   └── styles.css        # Sistema de diseño (tokens, componentes)
├── js/
│   ├── firebase-config.js  # Configuración de Firebase (poner tus claves)
│   └── auth.js              # Registro, login, logout, guard de rutas
├── firestore.rules       # Reglas de seguridad de Firestore
└── README.md
```

## 1. Configurar Firebase

1. Crea un proyecto en [Firebase Console](https://console.firebase.google.com).
2. **Authentication** → Sign-in method → habilita **Correo/contraseña**.
3. **Firestore Database** → crear en modo producción (las reglas ya están en
   `firestore.rules`; publícalas desde la consola o con `firebase deploy --only firestore:rules`
   si usas Firebase CLI).
4. **Storage** → habilítalo (se usará para subir PDFs/imágenes de ensayos).
5. **Project settings → General → Your apps → Web app**: copia el objeto
   `firebaseConfig` y pégalo en `js/firebase-config.js`.

## 2. Cómo funciona el control de acceso

- Al registrarse, cada usuario crea un documento en `usuarios/{uid}` con
  `role: "student"` por defecto.
- Para crear un usuario **admin**, agrega su correo a `ADMIN_EMAILS` en
  `js/auth.js` **antes** de que se registre (o edita el campo `role` a
  `"admin"` directamente en Firestore console después).
- `requireAuth({ role: "admin" })` protege `pages/admin.html`; si un
  estudiante intenta entrar, se le redirige a su propio panel.

> Nota: la lista `ADMIN_EMAILS` es un mecanismo temporal para este setup
> inicial. Cuando construyamos el módulo de administración de usuarios,
> conviene mover esto a una gestión desde Firestore con reglas más finas.

## 2.5. Configurar Supabase Storage (almacenamiento de ensayos, sin tarjeta)

En vez de Firebase Storage o Cloudflare R2 (ambos exigen ahora vincular una
tarjeta para activarse, aunque el uso se mantenga gratis), los PDFs/imágenes
de ensayos se guardan en **Supabase Storage** — 1 GB gratis, confirmado que
**no pide método de pago** para el plan free.

1. Crea una cuenta en [supabase.com](https://supabase.com) (con GitHub o
   correo) y un proyecto nuevo. No te pedirá tarjeta.
2. Dentro del proyecto, ve a **Storage** (menú lateral) → **New bucket**.
3. Nómbralo exactamente `materiales`, y déjalo **privado** (no marques
   "Public bucket") — nadie accede directo, solo a través de la Pages
   Function.
4. Ve a **Project Settings → API**. Ahí copias dos valores:
   - **Project URL** → lo pegarás como `SUPABASE_URL`.
   - **service_role key** (no la "anon/public") → este es secreto, nunca lo
     pongas en el código ni en `wrangler.toml`.
5. En tu **proyecto de Cloudflare Pages** → **Settings → Environment
   variables**, agrega:
   - `FIREBASE_PROJECT_ID`: el Project ID de tu proyecto Firebase.
   - `ADMIN_EMAILS`: tu correo (debe coincidir con `js/auth.js`).
   - `SUPABASE_URL`: el Project URL que copiaste.
   - `SUPABASE_SERVICE_ROLE_KEY`: la service_role key — márcala como
     **"Secret"** (o "Encrypt") al agregarla, para que no quede visible.
6. Vuelve a desplegar el proyecto para que tome las nuevas variables.

> ⚠️ La `service_role key` de Supabase se salta todas las reglas de acceso
> — por eso solo debe vivir en la Function (servidor), nunca en el
> navegador. El código ya está armado así: el cliente nunca la ve.

### Cómo funciona el flujo de subida

1. El admin selecciona un archivo en `pages/admin.html`.
2. El navegador llama a `POST /api/materiales` (una Pages Function, en
   `functions/api/materiales.js`) enviando su ID token de Firebase.
3. La función verifica el token **sin el Admin SDK** (no es compatible con
   el entorno de Workers), usando las claves públicas de Google directamente
   — ver `functions/_lib/verifyFirebaseToken.js`.
4. Si el correo del usuario está en `ADMIN_EMAILS`, el archivo se sube a
   Supabase Storage usando la `service_role key` (que solo la Function
   conoce).
5. El navegador registra el material en la colección `materiales` de
   Firestore con estado `pendiente_analisis`, listo para el siguiente paso:
   el pipeline de análisis con IA.

## 3. Probar en local

Si solo estás trabajando en las páginas estáticas (sin subir archivos), sirve
la carpeta con cualquier servidor estático:

```bash
npx serve paes-m2-app
# o
python3 -m http.server 5500 --directory paes-m2-app
```

Si necesitas probar la subida de archivos (`/api/materiales`), usa Wrangler,
que sí ejecuta las Pages Functions localmente. Primero define el secreto:

```bash
cd paes-m2-app
npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler pages dev .
```

Abre la URL que te muestre la terminal (normalmente `http://localhost:8788`).

## 4. Desplegar en Cloudflare Pages

1. Sube esta carpeta a un repositorio de GitHub/GitLab.
2. En Cloudflare Pages → **Create a project** → conecta el repo.
3. Build command: (vacío, no hay build)
   Output directory: `/` (raíz del proyecto, o `paes-m2-app` según cómo
   estructures el repo).
4. Deploy. Cloudflare te da una URL `*.pages.dev`.

## Próximos pasos sugeridos

- [ ] Módulo admin: subir PDF/imágenes de ensayos a Storage.
- [ ] Función de análisis IA (extracción de preguntas, alternativas, clasificación).
- [ ] Colección `preguntas` en Firestore poblada desde el análisis.
- [ ] Módulo estudiante: resolver preguntas con KaTeX.
- [ ] Registro de intentos y cálculo de estadísticas por estudiante.
