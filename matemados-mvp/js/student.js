import { requireAuth, logout } from "./auth.js";
import { db } from "./firebase-config.js";
import { EJES, HABILIDADES, TEMARIO_M2, populateSelect, updateUnitSelect, escapeHtml } from "./temario-m2.js";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const user = await requireAuth({ role: "student" });
const $ = (id) => document.getElementById(id);

$("userBadge").textContent = user.displayName || user.email;
$("userBadge").classList.remove("loading-line");
$("welcomeLine").textContent = `Hola, ${user.displayName || user.email.split("@")[0]}.`;
$("logoutBtn").addEventListener("click", logout);
$("mobileMenuBtn").addEventListener("click", () => $("sidebar").classList.toggle("open"));

const titles = {
  inicio: "Mi entrenamiento",
  contenido: "Practicar por contenido",
  debilidades: "Practicar debilidades",
  ensayo: "Miniensayo M2",
  habilidades: "Mapa de habilidades",
  estadisticas: "Estadísticas",
};

const viewButtons = [...document.querySelectorAll("[data-student-view]")];
const viewPanels = [...document.querySelectorAll("[data-student-panel]")];
viewButtons.forEach((button) => button.addEventListener("click", () => showView(button.dataset.studentView)));

function showView(view) {
  $("practiceRunner").hidden = true;
  viewButtons.forEach((button) => button.classList.toggle("active", button.dataset.studentView === view));
  viewPanels.forEach((panel) => panel.classList.toggle("active", panel.dataset.studentPanel === view));
  $("pageTitle").textContent = titles[view] || "Matemados M2";
  $("sidebar").classList.remove("open");
}

function showRunner() {
  viewPanels.forEach((panel) => panel.classList.remove("active"));
  viewButtons.forEach((button) => button.classList.remove("active"));
  $("practiceRunner").hidden = false;
  $("pageTitle").textContent = "Sesión de práctica";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

populateSelect($("contentAxis"), EJES, "Selecciona un eje");
$("contentAxis").addEventListener("change", () => updateUnitSelect($("contentAxis"), $("contentUnit")));

let questions = [];
let attempts = [];
let session = null;
let questionShownAt = 0;

function timeValue(value) {
  if (value instanceof Date) return value.getTime();
  return value?.toMillis?.() || value?.seconds * 1000 || 0;
}

function renderMath(root = document.body) {
  if (!window.renderMathInElement) return;
  window.renderMathInElement(root, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
    ],
    throwOnError: false,
  });
}

// ---------- Datos en tiempo real ----------
const questionsQuery = query(collection(db, "preguntas"), where("publicada", "==", true));
onSnapshot(questionsQuery, (snapshot) => {
  questions = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  renderDashboard();
}, (error) => {
  $("recommendationTitle").textContent = "No se pudo cargar el banco";
  $("recommendationText").textContent = error.message;
  $("startRecommendedBtn").disabled = true;
});

const attemptsQuery = query(
  collection(db, "usuarios", user.uid, "intentos"),
  orderBy("creadoEn", "desc"),
  limit(300)
);
onSnapshot(attemptsQuery, (snapshot) => {
  attempts = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  renderDashboard();
  persistSummary();
}, (error) => {
  console.error("No se pudieron cargar los intentos", error);
});

// ---------- Estadísticas ----------
function groupedStats(field) {
  const map = new Map();
  attempts.forEach((attempt) => {
    const key = attempt[field] || "Sin clasificar";
    const current = map.get(key) || { total: 0, correctas: 0, weightedTotal: 0, weightedCorrect: 0, tiempo: 0 };
    const weight = Math.max(1, Number(attempt.dificultad) || 3);
    current.total += 1;
    current.correctas += attempt.correcta ? 1 : 0;
    current.weightedTotal += weight;
    current.weightedCorrect += attempt.correcta ? weight : 0;
    current.tiempo += Number(attempt.tiempoSegundos) || 0;
    map.set(key, current);
  });

  map.forEach((stat) => {
    const raw = stat.weightedTotal ? stat.weightedCorrect / stat.weightedTotal : 0.5;
    const confidence = Math.min(1, stat.total / 6);
    stat.mastery = 0.5 + (raw - 0.5) * confidence;
    stat.accuracy = stat.total ? stat.correctas / stat.total : 0;
  });
  return map;
}

function summary() {
  const total = attempts.length;
  const correct = attempts.filter((a) => a.correcta).length;
  const weightedTotal = attempts.reduce((sum, a) => sum + Math.max(1, Number(a.dificultad) || 3), 0);
  const weightedCorrect = attempts.reduce((sum, a) => sum + (a.correcta ? Math.max(1, Number(a.dificultad) || 3) : 0), 0);
  const mastery = weightedTotal ? weightedCorrect / weightedTotal : null;
  const score = total >= 10 ? Math.max(100, Math.min(1000, Math.round(100 + 900 * mastery))) : null;
  const avgTime = total ? attempts.reduce((sum, a) => sum + (Number(a.tiempoSegundos) || 0), 0) / total : null;

  let streak = 0;
  for (const attempt of attempts) {
    if (!attempt.correcta) break;
    streak += 1;
  }

  return { total, correct, incorrect: total - correct, mastery, score, avgTime, streak };
}

async function persistSummary() {
  const stats = summary();
  try {
    await updateDoc(doc(db, "usuarios", user.uid), {
      totalIntentos: stats.total,
      dominioGlobal: stats.mastery === null ? 0 : Math.round(stats.mastery * 100),
      puntajeEstimado: stats.score,
      resumenActualizadoEn: serverTimestamp(),
    });
  } catch (error) {
    console.warn("No se pudo actualizar el resumen del perfil", error);
  }
}

function renderDashboard() {
  const stats = summary();
  const axisStats = groupedStats("eje");
  const unitStats = groupedStats("unidad");
  const skillStats = groupedStats("habilidad");

  $("masteryStat").textContent = stats.mastery === null ? "—" : `${Math.round(stats.mastery * 100)}%`;
  $("attemptsStat").textContent = stats.total;
  $("accuracyStat").textContent = stats.total ? `${Math.round((stats.correct / stats.total) * 100)}%` : "—";
  $("streakStat").textContent = stats.streak;
  $("scorePill").textContent = stats.score || "—";

  $("correctStat").textContent = stats.correct;
  $("incorrectStat").textContent = stats.incorrect;
  $("avgTimeStat").textContent = stats.avgTime === null ? "—" : `${Math.round(stats.avgTime)} s`;
  $("unitsSeenStat").textContent = new Set(attempts.map((a) => a.unidad).filter(Boolean)).size;

  renderAxisProgress(axisStats);
  renderRecommendation(unitStats);
  renderRecentAttempts();
  renderWeaknesses(unitStats);
  renderSkillMap(skillStats);
  renderUnitStats(unitStats);
}

function renderAxisProgress(axisStats) {
  $("axisProgress").innerHTML = EJES.map((axis) => {
    const stat = axisStats.get(axis);
    const pct = stat ? Math.round(stat.mastery * 100) : 0;
    return `
      <div class="progress-row">
        <div><span>${escapeHtml(axis)}</span><strong>${stat ? `${pct}%` : "Sin datos"}</strong></div>
        <div class="progress-track"><div class="progress-fill ${pct < 45 && stat ? "weak-fill" : ""}" style="width:${pct}%"></div></div>
      </div>`;
  }).join("");
}

function availableUnits() {
  return [...new Set(questions.map((q) => q.unidad).filter(Boolean))];
}

function weakestUnits(unitStats, count = 3) {
  return availableUnits()
    .map((unit) => ({ unit, stat: unitStats.get(unit), mastery: unitStats.get(unit)?.mastery ?? 0.45 }))
    .sort((a, b) => a.mastery - b.mastery || (a.stat?.total || 0) - (b.stat?.total || 0))
    .slice(0, count);
}

function renderRecommendation(unitStats) {
  const button = $("startRecommendedBtn");
  button.disabled = questions.length === 0;

  if (!questions.length) {
    $("recommendationTitle").textContent = "Todavía no hay preguntas publicadas";
    $("recommendationText").textContent = "El administrador debe publicar preguntas desde el banco para activar el entrenamiento.";
    return;
  }

  if (attempts.length < 5) {
    $("recommendationTitle").textContent = "Diagnóstico inicial";
    $("recommendationText").textContent = "Responde una mezcla de ejes y dificultades para construir tu primer mapa de dominio.";
    return;
  }

  const weakest = weakestUnits(unitStats, 1)[0];
  $("recommendationTitle").textContent = weakest ? `Reforzar: ${weakest.unit}` : "Sesión adaptativa";
  $("recommendationText").textContent = weakest
    ? `Tu dominio estimado en esta unidad es ${Math.round(weakest.mastery * 100)}%. La sesión priorizará este contenido sin dejar de mezclar repaso.`
    : "La sesión elegirá preguntas según tu historial reciente.";
}

function renderRecentAttempts() {
  const questionMap = new Map(questions.map((q) => [q.id, q]));
  if (!attempts.length) {
    $("recentAttempts").innerHTML = `<div class="empty-inline">Aún no has respondido preguntas.</div>`;
    return;
  }

  $("recentAttempts").innerHTML = attempts.slice(0, 6).map((attempt) => {
    const question = questionMap.get(attempt.preguntaId);
    const text = attempt.enunciado || question?.enunciado || "Pregunta del banco";
    return `
      <div class="attempt-row">
        <span class="attempt-result ${attempt.correcta ? "correct" : "incorrect"}">${attempt.correcta ? "✓" : "×"}</span>
        <div><strong>${escapeHtml(text)}</strong><small>${escapeHtml(attempt.unidad || "Sin unidad")} · ${Math.round(Number(attempt.tiempoSegundos) || 0)} s</small></div>
      </div>`;
  }).join("");
  renderMath($("recentAttempts"));
}

function renderWeaknesses(unitStats) {
  const weak = weakestUnits(unitStats, 4);
  if (!questions.length) {
    $("weaknessDescription").textContent = "No hay preguntas publicadas para construir una sesión.";
    $("weakUnits").innerHTML = "";
    $("startWeaknessBtn").disabled = true;
    return;
  }

  $("startWeaknessBtn").disabled = false;
  $("weaknessDescription").textContent = attempts.length
    ? "Estas unidades tienen menor dominio estimado o poca evidencia reciente."
    : "Aún no hay historial; comenzaremos con unidades variadas para detectar debilidades.";
  $("weakUnits").innerHTML = weak.map(({ unit, stat, mastery }) =>
    `<span class="weak-chip"><strong>${escapeHtml(unit)}</strong><small>${stat ? `${Math.round(mastery * 100)}% dominio` : "sin evaluar"}</small></span>`
  ).join("");
}

function renderSkillMap(skillStats) {
  $("skillMap").innerHTML = HABILIDADES.map((skill) => {
    const stat = skillStats.get(skill);
    const pct = stat ? Math.round(stat.mastery * 100) : 0;
    return `
      <article class="skill-card">
        <div class="skill-card-head"><h3>${escapeHtml(skill)}</h3><strong>${stat ? `${pct}%` : "—"}</strong></div>
        <div class="progress-track"><div class="progress-fill ${pct < 45 && stat ? "weak-fill" : ""}" style="width:${pct}%"></div></div>
        <p>${stat ? `${stat.correctas} correctas de ${stat.total} intentos` : "Aún sin evidencia suficiente."}</p>
      </article>`;
  }).join("");
}

function renderUnitStats(unitStats) {
  const entries = [...unitStats.entries()].sort((a, b) => a[1].mastery - b[1].mastery);
  if (!entries.length) {
    $("unitStats").innerHTML = `<div class="empty-inline">Completa una sesión para ver el detalle.</div>`;
    return;
  }

  $("unitStats").innerHTML = `
    <div class="table-row table-head"><span>Unidad</span><span>Intentos</span><span>Precisión</span><span>Dominio</span></div>
    ${entries.map(([unit, stat]) => `
      <div class="table-row"><strong>${escapeHtml(unit)}</strong><span>${stat.total}</span><span>${Math.round(stat.accuracy * 100)}%</span><span>${Math.round(stat.mastery * 100)}%</span></div>`).join("")}`;
}

// ---------- Selección adaptativa ----------
function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function weightedSample(pool, count, mode) {
  const unitStats = groupedStats("unidad");
  const recentIds = new Set(attempts.slice(0, 5).map((a) => a.preguntaId));
  const globalMastery = summary().mastery ?? 0.5;
  const targetDifficulty = 1 + Math.round(globalMastery * 4);
  const available = [...pool];
  const selected = [];

  while (available.length && selected.length < count) {
    const weights = available.map((question) => {
      const stat = unitStats.get(question.unidad);
      const mastery = stat?.mastery ?? 0.45;
      const weakness = 1 - mastery;
      const unseenBoost = stat ? 0 : 1.2;
      const repeatPenalty = recentIds.has(question.id) ? 0.2 : 1;
      const diffFit = 1 / (1 + Math.abs((Number(question.dificultad) || 3) - targetDifficulty));
      const modeBoost = mode === "debilidades" ? 1 + weakness * 5 : 1 + weakness * 2.5;
      return Math.max(0.05, modeBoost + unseenBoost + diffFit) * repeatPenalty;
    });

    const total = weights.reduce((sum, value) => sum + value, 0);
    let cursor = Math.random() * total;
    let index = 0;
    for (; index < weights.length; index += 1) {
      cursor -= weights[index];
      if (cursor <= 0) break;
    }
    const safeIndex = Math.min(index, available.length - 1);
    selected.push(available[safeIndex]);
    available.splice(safeIndex, 1);
  }

  return selected;
}

function buildSessionQuestions(mode, options = {}) {
  let pool = [...questions];
  if (mode === "contenido") {
    pool = pool.filter((q) => q.eje === options.eje && (!options.unidad || q.unidad === options.unidad));
  }
  if (mode === "debilidades") {
    const weakSet = new Set(weakestUnits(groupedStats("unidad"), 4).map((item) => item.unit));
    const weakPool = pool.filter((q) => weakSet.has(q.unidad));
    if (weakPool.length) pool = weakPool;
  }
  if (mode === "ensayo") return shuffle(pool).slice(0, Math.min(options.length || 20, pool.length));
  return weightedSample(pool, Math.min(options.length || 10, pool.length), mode);
}

function startSession(mode, options = {}) {
  const selected = buildSessionQuestions(mode, options);
  if (!selected.length) return false;
  session = {
    mode,
    questions: selected,
    index: 0,
    correctas: 0,
    respuestas: [],
  };
  showRunner();
  renderQuestion();
  return true;
}

$("startRecommendedBtn").addEventListener("click", () => startSession("adaptativa", { length: 10 }));
$("startWeaknessBtn").addEventListener("click", () => startSession("debilidades", { length: 10 }));
$("startExamBtn").addEventListener("click", () => {
  if (!startSession("ensayo", { length: 20 })) window.alert("No hay preguntas publicadas suficientes para iniciar.");
});
$("startContentBtn").addEventListener("click", () => {
  $("contentError").textContent = "";
  const eje = $("contentAxis").value;
  if (!eje) {
    $("contentError").textContent = "Selecciona un eje.";
    return;
  }
  const ok = startSession("contenido", {
    eje,
    unidad: $("contentUnit").value,
    length: Number($("contentLength").value),
  });
  if (!ok) $("contentError").textContent = "No hay preguntas publicadas para ese filtro.";
});

// ---------- Runner ----------
function renderQuestion() {
  const question = session.questions[session.index];
  questionShownAt = Date.now();
  $("runnerLabel").textContent = `Pregunta ${session.index + 1} de ${session.questions.length}`;
  $("runnerProgressBar").style.width = `${(session.index / session.questions.length) * 100}%`;
  $("sessionScore").textContent = `${session.correctas} correctas`;

  $("questionCard").innerHTML = `
    <div class="question-meta">
      <div class="tag-row">
        <span class="tag">${escapeHtml(question.eje || "Sin eje")}</span>
        <span class="tag">${escapeHtml(question.unidad || "Sin unidad")}</span>
        <span class="tag">${escapeHtml(question.habilidad || "Sin habilidad")}</span>
      </div>
      <span class="difficulty-dots" title="Dificultad ${Number(question.dificultad) || 3}">${[1,2,3,4,5].map((n) => `<i class="${n <= (Number(question.dificultad) || 3) ? "filled" : ""}"></i>`).join("")}</span>
    </div>
    <div class="question-text">${escapeHtml(question.enunciado)}</div>
    <div class="answer-grid">
      ${(question.alternativas || []).map((answer) => `
        <button class="answer-option" type="button" data-answer="${escapeHtml(answer.id)}">
          <span>${escapeHtml(answer.id)}</span><div>${escapeHtml(answer.texto)}</div>
        </button>`).join("")}
    </div>
    <div id="feedbackArea"></div>`;

  $("questionCard").querySelectorAll("[data-answer]").forEach((button) => {
    button.addEventListener("click", () => answerQuestion(button.dataset.answer));
  });
  renderMath($("questionCard"));
}

async function answerQuestion(selected) {
  if (!session || session.answeredCurrent) return;
  session.answeredCurrent = true;
  const question = session.questions[session.index];
  const correct = selected === question.correcta;
  const elapsed = Math.max(1, Math.round((Date.now() - questionShownAt) / 1000));
  if (correct) session.correctas += 1;
  session.respuestas.push({ question, selected, correct, elapsed });
  $("sessionScore").textContent = `${session.correctas} correctas`;

  $("questionCard").querySelectorAll("[data-answer]").forEach((button) => {
    button.disabled = true;
    if (button.dataset.answer === question.correcta) button.classList.add("correct-answer");
    if (button.dataset.answer === selected && !correct) button.classList.add("wrong-answer");
  });

  const feedback = $("feedbackArea");
  feedback.innerHTML = `
    <div class="feedback ${correct ? "feedback-correct" : "feedback-wrong"}">
      <div class="feedback-title">${correct ? "Correcto" : `Incorrecto. La respuesta es ${escapeHtml(question.correcta)}.`}</div>
      <p>${escapeHtml(question.explicacion || "Revisa el procedimiento y vuelve a intentarlo en otra sesión.")}</p>
      ${(question.pasos || []).length ? `<ol>${question.pasos.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>` : ""}
      ${!correct && question.errorComun ? `<div class="common-error"><strong>Error común detectado:</strong> ${escapeHtml(question.errorComun)}</div>` : ""}
      <button class="btn btn-primary" id="nextQuestionBtn" type="button">${session.index + 1 < session.questions.length ? "Siguiente pregunta" : "Ver resultado"}</button>
    </div>`;
  renderMath(feedback);

  $("nextQuestionBtn").addEventListener("click", () => {
    session.index += 1;
    session.answeredCurrent = false;
    if (session.index >= session.questions.length) finishSession();
    else renderQuestion();
  });

  try {
    await addDoc(collection(db, "usuarios", user.uid, "intentos"), {
      preguntaId: question.id,
      enunciado: question.enunciado.slice(0, 300),
      seleccionada: selected,
      respuestaCorrecta: question.correcta,
      correcta: correct,
      eje: question.eje,
      unidad: question.unidad,
      habilidad: question.habilidad,
      dificultad: Number(question.dificultad) || 3,
      tiempoSegundos: elapsed,
      modo: session.mode,
      creadoEn: serverTimestamp(),
    });
  } catch (error) {
    feedback.insertAdjacentHTML("beforeend", `<div class="mini-error">La respuesta se mostró, pero no se pudo guardar: ${escapeHtml(error.message)}</div>`);
  }
}

function finishSession() {
  const total = session.questions.length;
  const pct = total ? Math.round((session.correctas / total) * 100) : 0;
  const wrong = session.respuestas.filter((answer) => !answer.correct);
  const wrongUnits = [...new Set(wrong.map((answer) => answer.question.unidad).filter(Boolean))];
  $("runnerProgressBar").style.width = "100%";
  $("runnerLabel").textContent = "Sesión completada";
  $("questionCard").innerHTML = `
    <div class="session-result">
      <div class="result-ring" style="background:radial-gradient(circle, var(--bg-panel) 55%, transparent 57%), conic-gradient(var(--mastery) 0 ${pct}%, var(--border) ${pct}% 100%);"><strong>${pct}%</strong><span>precisión</span></div>
      <h2>${session.correctas} de ${total} correctas</h2>
      <p>${pct >= 80 ? "Buen dominio en esta sesión." : pct >= 55 ? "Hay una base útil, pero todavía quedan conceptos por consolidar." : "Conviene revisar los procedimientos antes de repetir una sesión similar."}</p>
      ${wrongUnits.length ? `<div class="result-review"><strong>Prioridad de repaso:</strong> ${wrongUnits.map(escapeHtml).join(", ")}</div>` : ""}
      <div class="result-actions">
        <button class="btn btn-primary" id="repeatSessionBtn" type="button">Otra sesión adaptativa</button>
        <button class="btn btn-ghost" id="backHomeBtn" type="button">Volver al panel</button>
      </div>
    </div>`;
  $("repeatSessionBtn").addEventListener("click", () => startSession("adaptativa", { length: 10 }));
  $("backHomeBtn").addEventListener("click", () => showView("inicio"));
}

$("quitSessionBtn").addEventListener("click", () => {
  if (!session || session.index === 0 || window.confirm("¿Salir de la sesión actual? Tus respuestas guardadas no se perderán.")) {
    session = null;
    showView("inicio");
  }
});

renderDashboard();
