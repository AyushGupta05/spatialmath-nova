export const EPSILON = 1e-8;

export function normalizePromptText(value = "") {
  return String(value)
    .replaceAll("\u2212", "-")
    .replaceAll("\u2013", "-")
    .replaceAll("\u2014", "-")
    .replaceAll("−", "-")
    .replaceAll("–", "-")
    .replaceAll("—", "-")
    .replaceAll("π", "Pi")
    .replaceAll("Π", "Pi")
    .replaceAll("₀", "0")
    .replaceAll("₁", "1")
    .replaceAll("₂", "2")
    .replaceAll("₃", "3")
    .replaceAll("₄", "4")
    .replaceAll("₅", "5")
    .replaceAll("₆", "6")
    .replaceAll("₇", "7")
    .replaceAll("₈", "8")
    .replaceAll("₉", "9")
    .replace(/\s+/g, " ")
    .trim();
}

export function toNumber(value) {
  const next = Number(String(value || "").trim());
  return Number.isFinite(next) ? next : null;
}

export function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

export function roundVec(vector, digits = 4) {
  return vector.map((value) => round(value, digits));
}

export function add(a, b) {
  return a.map((value, index) => value + b[index]);
}

export function sub(a, b) {
  return a.map((value, index) => value - b[index]);
}

export function scale(vector, scalar) {
  return vector.map((value) => value * scalar);
}

export function dot(a, b) {
  return a.reduce((sum, value, index) => sum + (value * b[index]), 0);
}

export function cross(a, b) {
  return [
    (a[1] * b[2]) - (a[2] * b[1]),
    (a[2] * b[0]) - (a[0] * b[2]),
    (a[0] * b[1]) - (a[1] * b[0]),
  ];
}

export function magnitude(vector) {
  return Math.sqrt(dot(vector, vector));
}

export function normalize(vector) {
  const length = magnitude(vector);
  if (length <= EPSILON) return [0, 0, 0];
  return scale(vector, 1 / length);
}

export function parseVector(value = "") {
  const parts = String(value)
    .split(",")
    .map((item) => toNumber(item))
    .filter((item) => item != null);
  return parts.length === 3 ? parts : null;
}

export function formatNumber(value, digits = 3) {
  if (!Number.isFinite(value)) return String(value);
  const rounded = round(value, digits);
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function formatVector(vector, digits = 3) {
  return `(${vector.map((value) => formatNumber(value, digits)).join(", ")})`;
}

function formatEquationTerm(coefficient, symbol) {
  if (Math.abs(coefficient) <= EPSILON) return "";
  const sign = coefficient < 0 ? "-" : "+";
  const magnitudeValue = Math.abs(coefficient);
  const magnitudeText = Math.abs(magnitudeValue - 1) <= EPSILON ? "" : formatNumber(magnitudeValue);
  return `${sign}${magnitudeText}${symbol}`;
}

export function formatPlaneEquation(normalVector, constantValue) {
  const raw = [
    formatEquationTerm(normalVector[0], "x"),
    formatEquationTerm(normalVector[1], "y"),
    formatEquationTerm(normalVector[2], "z"),
  ].filter(Boolean).join("");
  const left = raw.startsWith("+") ? raw.slice(1) : raw;
  return `${left} = ${formatNumber(constantValue)}`;
}

export function formatLineEquation(point, direction, parameterName = "t") {
  return `r = ${formatVector(point)} + ${parameterName}${formatVector(direction)}`;
}

export function parsePlaneEquation(questionText = "") {
  const normalized = normalizePromptText(questionText).replace(/\s+/g, "");
  const match = normalized.match(/([+\-\d.]*x[+\-\d.]*y[+\-\d.]*z)=([+-]?\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const left = match[1];
  const right = toNumber(match[2]);
  if (right == null) return null;

  const terms = left.replace(/-/g, "+-").split("+").filter(Boolean);
  const coefficients = { x: 0, y: 0, z: 0 };
  for (const term of terms) {
    const symbol = ["x", "y", "z"].find((candidate) => term.includes(candidate));
    if (!symbol) continue;
    const coefficientText = term.replace(symbol, "");
    if (coefficientText === "" || coefficientText === "+") coefficients[symbol] += 1;
    else if (coefficientText === "-") coefficients[symbol] -= 1;
    else coefficients[symbol] += Number(coefficientText);
  }

  return {
    normal: [coefficients.x, coefficients.y, coefficients.z],
    constant: right,
    equation: formatPlaneEquation([coefficients.x, coefficients.y, coefficients.z], right),
  };
}

export function parseLineThroughPointDirection(questionText = "") {
  const normalized = normalizePromptText(questionText);
  const patterns = [
    /point\s+([A-Za-z])?\s*\(([^)]+)\).*?direction(?:\s+vector)?\s*[A-Za-z]?\s*=\s*\(([^)]+)\)/i,
    /passes\s+through\s+(?:the\s+)?point\s+([A-Za-z])?\s*\(([^)]+)\).*?direction(?:\s+of)?(?:\s+the)?(?:\s+vector)?\s*\(([^)]+)\)/i,
    /passes\s+through\s+(?:the\s+)?point\s*\(([^)]+)\).*?direction(?:\s+of)?(?:\s+the)?(?:\s+vector)?\s*\(([^)]+)\)/i,
    /point\s*\(([^)]+)\).*?direction(?:\s+of)?(?:\s+the)?(?:\s+vector)?\s*\(([^)]+)\)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;

    const hasLabel = match.length === 4;
    const label = hasLabel ? (match[1] || "P") : "P";
    const point = parseVector(hasLabel ? match[2] : match[1]);
    const direction = parseVector(hasLabel ? match[3] : match[2]);
    if (!point || !direction) continue;
    return { label, point, direction };
  }

  return null;
}

export function parseDirectionVector(questionText = "") {
  const normalized = normalizePromptText(questionText);
  const match = normalized.match(/direction(?:\s+vector)?(?:\s+[A-Za-z])?\s*(?:=\s*)?\(([^)]+)\)/i);
  if (!match) return null;
  return parseVector(match[1]);
}

export function parseParametricLine(questionText = "", label = "r1") {
  const normalized = normalizePromptText(questionText);
  const escapedLabel = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escapedLabel}\\s*=\\s*\\(([^)]+)\\)\\s*\\+\\s*([A-Za-z])\\s*\\(([^)]+)\\)`, "i");
  const match = normalized.match(pattern);
  if (match) {
    const point = parseVector(match[1]);
    const direction = parseVector(match[3]);
    if (point && direction) {
      return { label, parameter: match[2], point, direction };
    }
  }

  const lines = parseParametricLines(questionText);
  if (!lines.length) return null;

  const labeled = lines.find((line) => String(line.label || "").toLowerCase() === String(label).toLowerCase());
  if (labeled) return labeled;

  const trailingIndex = String(label).match(/(\d+)$/);
  if (trailingIndex) {
    const index = Math.max(0, Number(trailingIndex[1]) - 1);
    return lines[index] || null;
  }

  return lines[0] || null;
}

export function parseParametricLines(questionText = "") {
  const normalized = normalizePromptText(questionText);
  const pattern = /(?:\b([A-Za-z][A-Za-z0-9]*)\s*=\s*)?\(([^)]+)\)\s*\+\s*([A-Za-z])\s*\(([^)]+)\)/gi;
  const lines = [];

  for (const match of normalized.matchAll(pattern)) {
    const point = parseVector(match[2]);
    const direction = parseVector(match[4]);
    if (!point || !direction) continue;
    lines.push({
      label: match[1] || `r${lines.length + 1}`,
      parameter: match[3],
      point,
      direction,
    });
  }

  return lines;
}

export function analyticSubtypeForQuestion(questionText = "") {
  const normalized = normalizePromptText(questionText).toLowerCase();
  if (/shortest distance/.test(normalized) && parseParametricLines(questionText).length >= 2) {
    return "skew_lines_distance";
  }
  if (
    /angle between/.test(normalized)
    && /line/.test(normalized)
    && /plane/.test(normalized)
    && parseDirectionVector(questionText)
    && parsePlaneEquation(questionText)
  ) {
    return "line_plane_angle";
  }
  if (
    parseLineThroughPointDirection(questionText)
    && parsePlaneEquation(questionText)
    && (/intersect/.test(normalized) || /coordinates/.test(normalized) || /point where the line intersects the plane/.test(normalized))
  ) {
    return "line_plane_intersection";
  }
  return null;
}

export function lineSegmentFromPointDirection(point, direction, span = 4.2) {
  const unit = normalize(direction);
  return {
    start: roundVec(sub(point, scale(unit, span)), 4),
    end: roundVec(add(point, scale(unit, span)), 4),
  };
}

export function pointOnPlane(normalVector, constantValue) {
  const denominator = dot(normalVector, normalVector);
  if (denominator <= EPSILON) return [0, 0, 0];
  return scale(normalVector, constantValue / denominator);
}

export function planeSizeFromPoints(points = []) {
  if (!points.length) return 8;
  const extents = { x: [], y: [], z: [] };
  for (const point of points) {
    extents.x.push(point[0]);
    extents.y.push(point[1]);
    extents.z.push(point[2]);
  }
  const span = Math.max(
    (Math.max(...extents.x) - Math.min(...extents.x)) || 0,
    (Math.max(...extents.y) - Math.min(...extents.y)) || 0,
    (Math.max(...extents.z) - Math.min(...extents.z)) || 0,
    4,
  );
  return round(Math.min(14, Math.max(6, span + 4)), 3);
}

export function buildCoordinateBounds(points = [], extraPadding = 1) {
  const flattened = points.flat();
  if (!flattened.length) {
    return {
      x: [-4, 4],
      y: [-4, 4],
      z: [-4, 4],
      tickStep: 1,
    };
  }

  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const zs = points.map((point) => point[2]);
  const bounds = {
    x: [Math.floor(Math.min(...xs)) - extraPadding, Math.ceil(Math.max(...xs)) + extraPadding],
    y: [Math.floor(Math.min(...ys)) - extraPadding, Math.ceil(Math.max(...ys)) + extraPadding],
    z: [Math.floor(Math.min(...zs)) - extraPadding, Math.ceil(Math.max(...zs)) + extraPadding],
  };
  const widest = Math.max(
    bounds.x[1] - bounds.x[0],
    bounds.y[1] - bounds.y[0],
    bounds.z[1] - bounds.z[0],
  );
  return {
    ...bounds,
    tickStep: widest > 12 ? 2 : 1,
  };
}

export function cameraForBounds(bounds) {
  const center = [
    round((bounds.x[0] + bounds.x[1]) * 0.5, 3),
    round((bounds.y[0] + bounds.y[1]) * 0.5, 3),
    round((bounds.z[0] + bounds.z[1]) * 0.5, 3),
  ];
  const maxSpan = Math.max(bounds.x[1] - bounds.x[0], bounds.y[1] - bounds.y[0], bounds.z[1] - bounds.z[0], 8);
  return {
    position: [
      round(center[0] + (maxSpan * 1.4), 3),
      round(center[1] + (maxSpan * 0.9), 3),
      round(center[2] + (maxSpan * 1.2), 3),
    ],
    target: center,
  };
}

export function buildBaseQuestionFields(questionText, subtype, sourceSummary = {}, overview) {
  return {
    problem: {
      id: `analytic-${subtype}`,
      question: sourceSummary.cleanedQuestion || questionText,
      questionType: "spatial",
      summary: overview,
      mode: "guided",
    },
    overview,
    sourceSummary: {
      ...sourceSummary,
      cleanedQuestion: sourceSummary.cleanedQuestion || questionText,
    },
    experienceMode: "analytic_auto",
  };
}

export function buildAnalyticLessonStages(sceneMoments = []) {
  return sceneMoments.map((moment, index) => ({
    id: moment.id,
    title: moment.title,
    goal: moment.goal,
    tutorIntro: moment.prompt,
    successCheck: index === sceneMoments.length - 1
      ? "Use the visible scene, formula, and explanation to state the idea in your own words."
      : "Use the scene cues, then move to the next visual step when the relationship is clear.",
    highlightTargets: moment.focusTargets || [],
    suggestedActions: [],
    checkpointPrompt: "Does that visual make sense?",
    freeQuestionAnchor: moment.goal || moment.prompt || "",
    mistakeProbe: moment.mistakeProbe || "Point to the visual step that feels confusing and explain why.",
  }));
}

export function buildAnalyticMoments(momentSpecs = []) {
  return momentSpecs.map((moment) => ({
    id: moment.id,
    title: moment.title,
    prompt: moment.prompt,
    goal: moment.goal,
    focusTargets: moment.focusTargets || [],
    visibleObjectIds: moment.visibleObjectIds || [],
    visibleOverlayIds: moment.visibleOverlayIds || [],
    cameraBookmarkId: moment.cameraBookmarkId || "",
    revealFormula: Boolean(moment.revealFormula),
    revealFullSolution: Boolean(moment.revealFullSolution),
  }));
}

export function buildCommonAnalyticActions(includeNext = true) {
  const actions = [
    {
      id: "analytic-formula",
      label: "Show Formula",
      kind: "show-formula",
      payload: {},
    },
  ];
  if (includeNext) {
    actions.push({
      id: "analytic-next-step",
      label: "Next Visual Step",
      kind: "reveal-next-step",
      payload: {},
    });
  }
  actions.push({
    id: "analytic-solution",
    label: "Reveal Full Solution",
    kind: "reveal-full-solution",
    payload: {},
  });
  return actions;
}
