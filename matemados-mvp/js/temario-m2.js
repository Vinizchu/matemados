// Taxonomía operativa basada en el temario PAES Regular M2, Admisión 2027.
// Se usa para clasificar preguntas, detectar debilidades y filtrar práctica.
export const HABILIDADES = [
  "Resolver problemas",
  "Modelar",
  "Representar",
  "Argumentar",
];

export const TEMARIO_M2 = {
  "Números": [
    "Números reales",
    "Matemática financiera",
    "Logaritmos",
  ],
  "Álgebra y funciones": [
    "Expresiones algebraicas",
    "Ecuaciones e inecuaciones",
    "Sistemas de ecuaciones lineales 2x2",
    "Función lineal y afín",
    "Función cuadrática",
    "Función potencia",
    "Función exponencial",
    "Función logarítmica",
    "Funciones trigonométricas seno y coseno",
  ],
  "Geometría": [
    "Geometría plana",
    "Homotecia",
    "Razones trigonométricas",
    "Relaciones métricas en la circunferencia",
    "Rectas en el plano",
    "Esferas: superficie y volumen",
  ],
  "Probabilidad y estadística": [
    "Representación de datos",
    "Medidas de tendencia central",
    "Medidas de dispersión",
    "Probabilidad condicional",
    "Permutación y combinatoria",
    "Modelo binomial",
    "Distribución normal",
  ],
};

export const EJES = Object.keys(TEMARIO_M2);

export function populateSelect(select, values, placeholder = "Selecciona") {
  select.innerHTML = `<option value="">${placeholder}</option>` + values
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join("");
}

export function updateUnitSelect(axisSelect, unitSelect) {
  const units = TEMARIO_M2[axisSelect.value] || [];
  populateSelect(unitSelect, units, units.length ? "Selecciona una unidad" : "Primero elige un eje");
  unitSelect.disabled = units.length === 0;
}

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
