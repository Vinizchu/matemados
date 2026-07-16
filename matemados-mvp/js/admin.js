import { requireAuth, logout } from "./auth.js";
import { auth, db } from "./firebase-config.js";
import { EJES, HABILIDADES, populateSelect, updateUnitSelect, escapeHtml } from "./temario-m2.js";
import { SEED_QUESTIONS } from "./seed-questions.js";
import {
  collection,
  addDoc,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const user = await requireAuth({ role: "admin" });
const $ = (id) => document.getElementById(id);

$("userBadge").textContent = user.displayName || user.email;
$("userBadge").classList.remove("loading-line");
$("welcomeLine").textContent = `Sesión activa: ${user.email}`;
$("logoutBtn").addEventListener("click", logout);

// ---------- Navegación ----------
const adminTabs = [...document.querySelectorAll("[data-admin-tab]")];
const adminPanels = [...document.querySelectorAll("[data-admin-panel]")];
adminTabs.forEach((tab) => tab.addEventListener("click", () => {
  const target = tab.dataset.adminTab;
  adminTabs.forEach((item) => item.classList.toggle("active", item === tab));
  adminPanels.forEach((panel) => panel.classList.toggle("active", panel.dataset.adminPanel === target));
  $("sidebar").classList.remove("open");
}));
$("mobileMenuBtn").addEventListener("click", () => $("sidebar").classList.toggle("open"));

// ---------- Selectores de temario ----------
populateSelect($("axisSelect"), EJES, "Selecciona un eje");
populateSelect($("skillSelect"), HABILIDADES, "Selecciona una habilidad");
$("axisSelect").addEventListener("change", () => updateUnitSelect($("axisSelect"), $("unitSelect")));

let materialsCache = [];
let questionsCache = [];

function timestampValue(value) {
  return value?.toMillis?.() || value?.seconds * 1000 || 0;
}

function renderMath(root = document.body) {
  if (window.renderMathInElement) {
    window.renderMathInElement(root, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
    });
  }
}

function humanSize(bytes = 0) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(status) {
  return {
    pendiente_analisis: "Pendiente de análisis",
    analizando: "Analizando con IA",
    analizado: "Analizado",
    error: "Error",
  }[status] || status || "Sin estado";
}

function updateDashboardStats() {
  $("statMaterials").textContent = materialsCache.length;
  $("statQuestions").textContent = questionsCache.length;
  $("statPublished").textContent = questionsCache.filter((q) => q.publicada).length;
  $("statPending").textContent =
    materialsCache.filter((m) => ["pendiente_analisis", "error"].includes(m.estado)).length +
    questionsCache.filter((q) => !q.publicada).length;
}

// ---------- Materiales ----------
onSnapshot(collection(db, "materiales"), (snapshot) => {
  materialsCache = snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => timestampValue(b.subidoEn) - timestampValue(a.subidoEn));
  renderMaterials();
  updateDashboardStats();
}, (error) => {
  $("materialesList").innerHTML = `<div class="error-banner">No se pudieron leer los materiales: ${escapeHtml(error.message)}</div>`;
});

function renderMaterials() {
  const container = $("materialesList");
  if (!materialsCache.length) {
    container.innerHTML = `<div class="empty-state"><h3>Aún no hay materiales</h3><p>Sube uno o más ensayos para iniciar el pipeline de análisis.</p></div>`;
    return;
  }

  container.innerHTML = materialsCache.map((m) => {
    const canAnalyze = ["pendiente_analisis", "error"].includes(m.estado);
    const dotClass = m.estado === "error" ? "danger" : m.estado === "analizando" ? "warning" : "";
    return `
      <article class="list-card">
        <div class="list-card-main">
          <div class="file-icon">${m.contentType === "application/pdf" ? "PDF" : "IMG"}</div>
          <div>
            <h3>${escapeHtml(m.nombre)}</h3>
            <p>${escapeHtml(m.contentType || "archivo")} · ${humanSize(m.tamano)} · ${m.preguntasExtraidasCantidad || 0} preguntas extraídas</p>
            ${m.errorAnalisis ? `<div class="mini-error">${escapeHtml(m.errorAnalisis)}</div>` : ""}
          </div>
        </div>
        <div class="list-card-actions">
          <span class="pill"><span class="pill-dot ${dotClass}"></span>${escapeHtml(statusLabel(m.estado))}</span>
          ${canAnalyze ? `<button class="btn btn-primary btn-small" data-material-action="analyze" data-id="${m.id}">Analizar con IA</button>` : ""}
        </div>
      </article>`;
  }).join("");
}

$("materialesList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-material-action='analyze']");
  if (!button) return;
  const material = materialsCache.find((item) => item.id === button.dataset.id);
  if (!material) return;
  button.disabled = true;
  button.textContent = "Analizando…";
  await analyzeMaterial(material).catch(() => {});
});

// ---------- Subida múltiple ----------
$("uploadBtn").addEventListener("click", async () => {
  const files = [...$("fileInput").files];
  $("uploadError").textContent = "";
  $("uploadStatus").innerHTML = "";

  if (!files.length) {
    $("uploadError").textContent = "Selecciona al menos un archivo.";
    return;
  }

  const allowed = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
  const invalid = files.find((file) => !allowed.has(file.type) || file.size > 20 * 1024 * 1024);
  if (invalid) {
    $("uploadError").textContent = `${invalid.name}: formato no permitido o supera 20 MB.`;
    return;
  }

  $("uploadBtn").disabled = true;
  let completed = 0;
  const errors = [];

  for (const file of files) {
    setUploadStatus(files, completed, `Subiendo ${file.name}…`);
    try {
      await uploadFile(file);
      completed += 1;
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`);
      completed += 1;
    }
  }

  setUploadStatus(files, completed, errors.length
    ? `Proceso finalizado con ${errors.length} error(es).`
    : "Todos los archivos quedaron en la cola de análisis.");
  $("uploadError").textContent = errors.join(" · ");
  $("fileInput").value = "";
  $("uploadBtn").disabled = false;
});

function setUploadStatus(files, completed, message) {
  const pct = Math.round((completed / files.length) * 100);
  $("uploadStatus").innerHTML = `
    <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
    <span>${escapeHtml(message)} (${completed}/${files.length})</span>`;
}

async function uploadFile(file) {
  const idToken = await auth.currentUser.getIdToken();
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/materiales", {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}` },
    body: formData,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "No se pudo subir el archivo");

  await addDoc(collection(db, "materiales"), {
    nombre: result.name,
    storageKey: result.key,
    contentType: result.contentType,
    tamano: result.size,
    estado: "pendiente_analisis",
    subidoPorUid: user.uid,
    subidoPorEmail: user.email,
    subidoEn: serverTimestamp(),
    preguntasExtraidasCantidad: 0,
  });
}

async function analyzeMaterial(material) {
  const ref = doc(db, "materiales", material.id);
  await updateDoc(ref, {
    estado: "analizando",
    errorAnalisis: null,
    analisisIniciadoEn: serverTimestamp(),
  });

  try {
    const idToken = await auth.currentUser.getIdToken(true);
    const response = await fetch("/api/analizar-material", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        materialId: material.id,
        key: material.storageKey || material.r2Key,
        name: material.nombre,
        contentType: material.contentType,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "La IA no pudo analizar el material");

    const questions = Array.isArray(result.preguntas) ? result.preguntas : [];
    if (!questions.length) throw new Error("El análisis terminó, pero no detectó preguntas válidas.");

    // Las preguntas de IA quedan como borrador: un administrador debe revisarlas.
    for (let start = 0; start < questions.length; start += 400) {
      const batch = writeBatch(db);
      questions.slice(start, start + 400).forEach((question) => {
        const questionRef = doc(collection(db, "preguntas"));
        batch.set(questionRef, {
          ...question,
          publicada: false,
          origen: "ia",
          fuenteMaterialId: material.id,
          fuenteNombre: material.nombre,
          creadoPorUid: user.uid,
          creadoEn: serverTimestamp(),
          actualizadoEn: serverTimestamp(),
        });
      });
      await batch.commit();
    }

    await updateDoc(ref, {
      estado: "analizado",
      preguntasExtraidasCantidad: questions.length,
      analizadoEn: serverTimestamp(),
      modeloAnalisis: result.modelo || null,
      errorAnalisis: null,
    });
  } catch (error) {
    await updateDoc(ref, {
      estado: "error",
      errorAnalisis: error.message.slice(0, 500),
      analizadoEn: serverTimestamp(),
    });
    throw error;
  }
}

// ---------- Crear pregunta manual ----------
$("questionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("questionError").textContent = "";
  $("questionStatus").textContent = "";

  const alternatives = ["A", "B", "C", "D", "E"]
    .map((id) => ({ id, texto: $(`alt${id}`).value.trim() }))
    .filter((item) => item.texto);
  const correct = $("correctAnswer").value;

  if (!alternatives.some((item) => item.id === correct)) {
    $("questionError").textContent = "La alternativa correcta seleccionada está vacía.";
    return;
  }

  $("saveQuestionBtn").disabled = true;
  $("questionStatus").textContent = "Guardando…";
  try {
    await addDoc(collection(db, "preguntas"), {
      enunciado: $("questionText").value.trim(),
      alternativas: alternatives,
      correcta: correct,
      eje: $("axisSelect").value,
      unidad: $("unitSelect").value,
      habilidad: $("skillSelect").value,
      dificultad: Number($("difficulty").value),
      fuenteNombre: $("sourceName").value.trim() || "Creación propia",
      explicacion: $("explanation").value.trim(),
      pasos: $("steps").value.split("\n").map((s) => s.trim()).filter(Boolean),
      errorComun: $("commonError").value.trim(),
      publicada: $("publishNow").checked,
      origen: "manual",
      creadoPorUid: user.uid,
      creadoEn: serverTimestamp(),
      actualizadoEn: serverTimestamp(),
    });
    $("questionForm").reset();
    populateSelect($("axisSelect"), EJES, "Selecciona un eje");
    populateSelect($("skillSelect"), HABILIDADES, "Selecciona una habilidad");
    $("unitSelect").innerHTML = '<option value="">Primero elige un eje</option>';
    $("unitSelect").disabled = true;
    $("difficulty").value = "3";
    $("questionStatus").textContent = "Pregunta guardada.";
  } catch (error) {
    $("questionError").textContent = error.message;
    $("questionStatus").textContent = "";
  } finally {
    $("saveQuestionBtn").disabled = false;
  }
});

// ---------- Semilla demo ----------
$("seedBtn").addEventListener("click", async () => {
  $("seedBtn").disabled = true;
  $("seedStatus").textContent = "Agregando preguntas…";
  try {
    const batch = writeBatch(db);
    SEED_QUESTIONS.forEach((question) => {
      batch.set(doc(collection(db, "preguntas")), {
        ...question,
        publicada: true,
        origen: "demo",
        fuenteNombre: "Banco original de demostración",
        creadoPorUid: user.uid,
        creadoEn: serverTimestamp(),
        actualizadoEn: serverTimestamp(),
      });
    });
    await batch.commit();
    $("seedStatus").textContent = "Banco demo agregado y publicado.";
  } catch (error) {
    $("seedStatus").textContent = `Error: ${error.message}`;
    $("seedBtn").disabled = false;
  }
});

// ---------- Banco de preguntas ----------
onSnapshot(collection(db, "preguntas"), (snapshot) => {
  questionsCache = snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => timestampValue(b.creadoEn) - timestampValue(a.creadoEn));
  renderQuestions();
  updateDashboardStats();
}, (error) => {
  $("questionsList").innerHTML = `<div class="error-banner">No se pudo leer el banco: ${escapeHtml(error.message)}</div>`;
});

$("questionSearch").addEventListener("input", renderQuestions);
$("questionStatusFilter").addEventListener("change", renderQuestions);

function renderQuestions() {
  const queryText = $("questionSearch").value.trim().toLowerCase();
  const status = $("questionStatusFilter").value;
  const filtered = questionsCache.filter((question) => {
    const haystack = `${question.enunciado} ${question.eje} ${question.unidad}`.toLowerCase();
    const matchesText = !queryText || haystack.includes(queryText);
    const matchesStatus = status === "all" ||
      (status === "published" && question.publicada) ||
      (status === "draft" && !question.publicada);
    return matchesText && matchesStatus;
  });

  if (!filtered.length) {
    $("questionsList").innerHTML = `<div class="empty-state"><h3>No hay preguntas que coincidan</h3><p>Cambia los filtros o agrega preguntas al banco.</p></div>`;
    return;
  }

  $("questionsList").innerHTML = filtered.map((question) => `
    <article class="question-bank-card">
      <div class="question-bank-top">
        <div class="tag-row">
          <span class="tag">${escapeHtml(question.eje || "Sin eje")}</span>
          <span class="tag">${escapeHtml(question.unidad || "Sin unidad")}</span>
          <span class="tag">Dificultad ${Number(question.dificultad) || 3}</span>
        </div>
        <span class="status-badge ${question.publicada ? "published" : "draft"}">${question.publicada ? "Publicada" : "Borrador"}</span>
      </div>
      <div class="bank-question-text">${escapeHtml(question.enunciado || "Sin enunciado")}</div>
      <div class="bank-answer">Correcta: <strong>${escapeHtml(question.correcta || "—")}</strong> · ${escapeHtml(question.habilidad || "Sin habilidad")}</div>
      <div class="question-bank-actions">
        <button class="btn btn-ghost btn-small" data-question-action="toggle" data-id="${question.id}">${question.publicada ? "Despublicar" : "Publicar"}</button>
        <button class="btn btn-danger btn-small" data-question-action="delete" data-id="${question.id}">Eliminar</button>
      </div>
    </article>`).join("");
  renderMath($("questionsList"));
}

$("questionsList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-question-action]");
  if (!button) return;
  const question = questionsCache.find((item) => item.id === button.dataset.id);
  if (!question) return;

  button.disabled = true;
  try {
    if (button.dataset.questionAction === "toggle") {
      await updateDoc(doc(db, "preguntas", question.id), {
        publicada: !question.publicada,
        actualizadoEn: serverTimestamp(),
      });
    } else if (button.dataset.questionAction === "delete") {
      const confirmed = window.confirm("¿Eliminar esta pregunta de forma permanente?");
      if (!confirmed) {
        button.disabled = false;
        return;
      }
      await deleteDoc(doc(db, "preguntas", question.id));
    }
  } catch (error) {
    window.alert(`No se pudo completar la acción: ${error.message}`);
    button.disabled = false;
  }
});
