import { json, requireAdmin } from "../_lib/adminAuth.js";

const AXES = ["Números", "Álgebra y funciones", "Geometría", "Probabilidad y estadística"];
const SKILLS = ["Resolver problemas", "Modelar", "Representar", "Argumentar"];

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function extractOutputText(response) {
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text;
      if (content.type === "refusal") throw new Error(content.refusal || "El modelo rechazó el análisis");
    }
  }
  throw new Error("OpenAI no devolvió una salida de texto estructurada");
}

function normalizeQuestions(value) {
  const source = Array.isArray(value?.preguntas) ? value.preguntas : [];
  return source
    .filter((q) => q && q.enunciado && Array.isArray(q.alternativas))
    .map((q) => ({
      enunciado: String(q.enunciado).trim(),
      alternativas: q.alternativas
        .map((answer) => ({ id: String(answer.id).trim().toUpperCase(), texto: String(answer.texto).trim() }))
        .filter((answer) => /^[A-E]$/.test(answer.id) && answer.texto),
      correcta: String(q.correcta).trim().toUpperCase(),
      eje: AXES.includes(q.eje) ? q.eje : "Álgebra y funciones",
      unidad: String(q.unidad || "Sin clasificar").trim(),
      habilidad: SKILLS.includes(q.habilidad) ? q.habilidad : "Resolver problemas",
      dificultad: Math.max(1, Math.min(5, Number(q.dificultad) || 3)),
      explicacion: String(q.explicacion || "").trim(),
      pasos: Array.isArray(q.pasos) ? q.pasos.map(String).map((s) => s.trim()).filter(Boolean) : [],
      errorComun: String(q.errorComun || "").trim(),
    }))
    .filter((q) => q.alternativas.length >= 4 && q.alternativas.some((a) => a.id === q.correcta));
}

const QUESTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    preguntas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          enunciado: { type: "string" },
          alternativas: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string", enum: ["A", "B", "C", "D", "E"] },
                texto: { type: "string" },
              },
              required: ["id", "texto"],
            },
          },
          correcta: { type: "string", enum: ["A", "B", "C", "D", "E"] },
          eje: { type: "string", enum: AXES },
          unidad: { type: "string" },
          habilidad: { type: "string", enum: SKILLS },
          dificultad: { type: "integer", enum: [1, 2, 3, 4, 5] },
          explicacion: { type: "string" },
          pasos: { type: "array", items: { type: "string" } },
          errorComun: { type: "string" },
        },
        required: [
          "enunciado", "alternativas", "correcta", "eje", "unidad",
          "habilidad", "dificultad", "explicacion", "pasos", "errorComun",
        ],
      },
    },
  },
  required: ["preguntas"],
};

export async function onRequestPost({ request, env }) {
  try {
    await requireAdmin(request, env);
    if (!env.OPENAI_API_KEY) return json({ error: "Falta el secreto OPENAI_API_KEY en Cloudflare" }, 500);
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Supabase no está configurado" }, 500);

    const body = await request.json().catch(() => null);
    if (!body?.key || !body?.contentType) return json({ error: "Faltan key o contentType del material" }, 400);
    if (!String(body.key).startsWith("materiales/")) return json({ error: "Ruta de almacenamiento inválida" }, 400);

    const downloadUrl = `${env.SUPABASE_URL}/storage/v1/object/${body.key}`;
    const fileResponse = await fetch(downloadUrl, {
      headers: {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      },
    });
    if (!fileResponse.ok) {
      const detail = await fileResponse.text().catch(() => "");
      return json({ error: `No se pudo descargar el material: ${detail.slice(0, 400)}` }, 502);
    }

    const bytes = new Uint8Array(await fileResponse.arrayBuffer());
    if (bytes.byteLength > 20 * 1024 * 1024) return json({ error: "El material supera 20 MB" }, 400);
    const dataUrl = `data:${body.contentType};base64,${bytesToBase64(bytes)}`;
    const fileInput = body.contentType === "application/pdf"
      ? { type: "input_file", filename: body.name || "ensayo.pdf", file_data: dataUrl, detail: "high" }
      : { type: "input_image", image_url: dataUrl, detail: "high" };

    const model = env.OPENAI_MODEL || "gpt-5.6-luna";
    const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: "low" },
        instructions: [
          "Eres un analista experto en PAES Competencia Matemática 2 de Chile.",
          "Extrae únicamente preguntas completas y legibles del material adjunto.",
          "Conserva el sentido matemático; usa LaTeX entre signos $ para expresiones.",
          "Identifica la alternativa correcta solo cuando pueda deducirse con seguridad desde el material o resolviendo el ejercicio.",
          "Clasifica cada pregunta según los ejes y habilidades entregados por el esquema.",
          "La unidad debe ser específica, por ejemplo Logaritmos, Rectas en el plano o Probabilidad condicional.",
          "Entrega una explicación pedagógica, pasos breves y el error conceptual más probable.",
          "Omite preguntas incompletas, ilegibles o dependientes de una figura que no pueda interpretarse.",
          "No inventes preguntas que no estén presentes. Devuelve como máximo 40 preguntas.",
        ].join(" "),
        input: [{
          role: "user",
          content: [
            fileInput,
            { type: "input_text", text: "Analiza este ensayo y devuelve las preguntas encontradas en el formato solicitado." },
          ],
        }],
        text: {
          format: {
            type: "json_schema",
            name: "preguntas_paes_m2",
            strict: true,
            schema: QUESTION_SCHEMA,
          },
        },
        max_output_tokens: 18000,
      }),
    });

    const openAIBody = await openAIResponse.json().catch(() => ({}));
    if (!openAIResponse.ok) {
      return json({ error: `OpenAI rechazó el análisis: ${openAIBody.error?.message || "error desconocido"}` }, 502);
    }

    const parsed = JSON.parse(extractOutputText(openAIBody));
    const preguntas = normalizeQuestions(parsed);
    return json({ preguntas, modelo: model, detectadas: preguntas.length });
  } catch (error) {
    return json({ error: error.message }, error.status || 500);
  }
}
