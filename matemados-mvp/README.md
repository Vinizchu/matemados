# Matemados · Entrenador inteligente PAES M2

MVP funcional para practicar PAES Competencia Matemática 2 mediante un banco de
preguntas clasificadas, sesiones adaptativas y análisis de ensayos con IA.

## Lo que ya incluye

- Registro e inicio de sesión con Firebase Authentication.
- Roles `student` y `admin` protegidos por Firestore Rules.
- Carga múltiple de PDF/imágenes a un bucket privado de Supabase Storage.
- Análisis de materiales con OpenAI Responses API y salida JSON estructurada.
- Revisión editorial: las preguntas extraídas por IA quedan como borrador.
- Creación manual, publicación, despublicación y eliminación de preguntas.
- Banco original de 15 preguntas demo para probar el flujo sin usar la API.
- Práctica por contenido, debilidades, sesión adaptativa y miniensayo.
- Retroalimentación paso a paso, error común, historial y mapa de habilidades.
- Estimación interna de rendimiento. No corresponde a una tabla oficial DEMRE.

## Estructura

```text
matemados-mvp/
├── index.html
├── pages/
│   ├── admin.html
│   └── student.html
├── css/styles.css
├── js/
│   ├── admin.js
│   ├── auth.js
│   ├── firebase-config.js
│   ├── seed-questions.js
│   ├── student.js
│   └── temario-m2.js
├── functions/
│   ├── _lib/
│   │   ├── adminAuth.js
│   │   └── verifyFirebaseToken.js
│   └── api/
│       ├── analizar-material.js
│       └── materiales.js
├── firestore.rules
└── wrangler.toml
```

## 1. Firebase

1. Crea o abre tu proyecto Firebase.
2. Habilita Authentication → Correo/contraseña.
3. Crea Firestore en modo producción.
4. Copia la configuración web en `js/firebase-config.js`.
5. Publica `firestore.rules` desde Firebase Console o Firebase CLI.
6. Verifica el Project ID real de Firebase y reemplaza
   `REEMPLAZAR_FIREBASE_PROJECT_ID` en `wrangler.toml` y en Cloudflare.

Importante: el valor anterior `nurqpfpatxxewcetzdvt` tiene formato de referencia
de Supabase y no debe usarse como Project ID de Firebase salvo que realmente
coincida con tu proyecto Firebase.

## 2. Supabase Storage

Crea un bucket privado llamado exactamente `materiales`. La `service_role key`
solo se usa en Pages Functions y nunca llega al navegador.

Configura en Cloudflare:

- `SUPABASE_URL`
- secreto `SUPABASE_SERVICE_ROLE_KEY`

## 3. OpenAI

Configura en Cloudflare el secreto:

```bash
npx wrangler pages secret put OPENAI_API_KEY
```

El modelo se controla con `OPENAI_MODEL`. El valor inicial es
`gpt-5.6-luna`; puedes cambiarlo sin modificar el código.

El análisis acepta PDF e imágenes. Los PDF se envían con detalle visual alto
para reconocer fórmulas, gráficos y diagramas. El endpoint devuelve preguntas
estructuradas y el cliente las registra como borradores en Firestore.

## 4. Administrador inicial

El correo inicial está sincronizado en tres lugares:

- `js/auth.js`
- `firestore.rules`
- `ADMIN_EMAILS` de Cloudflare / `wrangler.toml`

Actualmente es `vicentebasoalto2@gmail.com`. Si lo cambias, actualiza los tres.

El correo administrador debe estar verificado en Firebase Authentication. Al
registrarlo, la app envía un enlace y no habilita el rol hasta que la verificación
se complete. Esto evita que otra persona se apropie del rol registrando primero
un correo que no controla.

## 5. Probar localmente

Crea `.dev.vars` en la raíz, sin subirlo a Git:

```env
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=...
```

Luego:

```bash
npx wrangler pages dev .
```

Abre la URL local indicada por Wrangler. Para una prueba rápida:

1. Regístrate con el correo administrador.
2. En Resumen, pulsa “Agregar 15 preguntas demo”.
3. Cierra sesión y registra otro correo como estudiante.
4. Inicia una sesión adaptativa.

## 6. Despliegue en Cloudflare Pages

- Build command: vacío.
- Output directory: `.`
- Agrega las variables y secretos tanto en Production como Preview si usarás
  despliegues de prueba.
- Después de cambiar variables, ejecuta un nuevo deployment.

## Modelo de datos principal

### `preguntas/{id}`

`enunciado`, `alternativas`, `correcta`, `eje`, `unidad`, `habilidad`,
`dificultad`, `explicacion`, `pasos`, `errorComun`, `publicada`, `origen`.

### `materiales/{id}`

`nombre`, `storageKey`, `contentType`, `tamano`, `estado`,
`preguntasExtraidasCantidad`, `errorAnalisis`.

### `usuarios/{uid}/intentos/{id}`

`preguntaId`, `seleccionada`, `respuestaCorrecta`, `correcta`, clasificación,
dificultad, tiempo, modo y fecha.

## Próximos desarrollos

- Editor completo de preguntas ya creadas.
- Recorte y almacenamiento de gráficos por pregunta.
- Ensayo de 55 preguntas con cronómetro de 2 h 20 min.
- Repetición espaciada y modelo de dominio por concepto.
- Detección automática del tipo de error usando la respuesta del estudiante.
- Panel de cobertura del temario y control de preguntas duplicadas.
