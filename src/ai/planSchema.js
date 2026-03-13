import { normalizeSceneObject } from "../scene/schema.js";

const VALID_QUESTION_TYPES = ["volume", "surface_area", "composite", "spatial", "comparison"];
const VALID_LIVE_CHALLENGE_METRICS = ["volume", "surfaceArea"];
const VALID_STEP_ACTIONS = ["add", "verify", "adjust", "observe", "answer"];

function normalizeString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeQuestionType(value) {
  return VALID_QUESTION_TYPES.includes(value) ? value : "spatial";
}

function normalizeObjectSuggestion(suggestion = {}, index = 0) {
  const object = normalizeSceneObject(suggestion.object || suggestion.sceneObject || suggestion);
  const id = suggestion.id || object.id || `suggestion-${index + 1}`;
  object.id = object.id || `${id}-object`;
  return {
    id,
    title: normalizeString(suggestion.title, object.label || `${object.shape} ${index + 1}`),
    purpose: normalizeString(suggestion.purpose, `Use this ${object.shape} to reason about the problem.`),
    optional: Boolean(suggestion.optional),
    tags: normalizeArray(suggestion.tags).map((tag) => normalizeString(tag)).filter(Boolean),
    object,
  };
}

function normalizeCameraBookmark(bookmark = {}, index = 0) {
  const position = Array.isArray(bookmark.position) ? bookmark.position : [8, 6, 8];
  const target = Array.isArray(bookmark.target) ? bookmark.target : [0, 0, 0];
  return {
    id: bookmark.id || `camera-${index + 1}`,
    label: normalizeString(bookmark.label, `View ${index + 1}`),
    description: normalizeString(bookmark.description, ""),
    position: [
      Number(position[0]) || 8,
      Number(position[1]) || 6,
      Number(position[2]) || 8,
    ],
    target: [
      Number(target[0]) || 0,
      Number(target[1]) || 0,
      Number(target[2]) || 0,
    ],
  };
}

function normalizeBuildStep(step = {}, index = 0, suggestions = []) {
  const suggestionIds = new Set(suggestions.map((suggestion) => suggestion.id));
  const suggestedObjectIds = normalizeArray(step.suggestedObjectIds)
    .map((id) => normalizeString(id))
    .filter((id) => suggestionIds.has(id));
  const requiredObjectIds = normalizeArray(step.requiredObjectIds)
    .map((id) => normalizeString(id))
    .filter((id) => suggestionIds.has(id));
  const action = VALID_STEP_ACTIONS.includes(step.action) ? step.action : "observe";

  return {
    id: step.id || `step-${index + 1}`,
    title: normalizeString(step.title, `Step ${index + 1}`),
    instruction: normalizeString(step.instruction, step.text || ""),
    hint: normalizeString(step.hint, ""),
    action,
    suggestedObjectIds,
    requiredObjectIds: requiredObjectIds.length ? requiredObjectIds : suggestedObjectIds,
    cameraBookmarkId: normalizeString(step.cameraBookmarkId, ""),
    highlightObjectIds: normalizeArray(step.highlightObjectIds || step.highlightObjects)
      .map((id) => normalizeString(id))
      .filter(Boolean),
    challengePromptId: normalizeString(step.challengePromptId, ""),
  };
}

function normalizeAnswerScaffold(answer = {}) {
  return {
    finalAnswer: answer.finalAnswer ?? answer.value ?? null,
    unit: normalizeString(answer.unit, ""),
    formula: normalizeString(answer.formula, ""),
    explanation: normalizeString(answer.explanation, ""),
    checks: normalizeArray(answer.checks).map((check) => normalizeString(check)).filter(Boolean),
  };
}

function normalizeChallengePrompt(prompt = {}, index = 0) {
  return {
    id: prompt.id || `challenge-${index + 1}`,
    prompt: normalizeString(prompt.prompt || prompt.text, ""),
    expectedKind: normalizeString(prompt.expectedKind, "numeric"),
    expectedAnswer: prompt.expectedAnswer ?? null,
    tolerance: Number(prompt.tolerance) || 0.01,
  };
}

function normalizeLiveChallenge(liveChallenge = {}) {
  if (!liveChallenge || typeof liveChallenge !== "object") return null;
  const metric = VALID_LIVE_CHALLENGE_METRICS.includes(liveChallenge.metric)
    ? liveChallenge.metric
    : null;
  if (!metric) return null;

  return {
    id: liveChallenge.id || `live-${metric}`,
    title: normalizeString(liveChallenge.title, ""),
    metric,
    multiplier: Math.max(1, Number(liveChallenge.multiplier) || 1),
    prompt: normalizeString(liveChallenge.prompt, ""),
    tolerance: Number(liveChallenge.tolerance) || 0.03,
  };
}

export function normalizeScenePlan(plan = {}) {
  const objectSuggestions = normalizeArray(plan.objectSuggestions || plan.objects)
    .map((suggestion, index) => normalizeObjectSuggestion(suggestion, index));
  const buildSteps = normalizeArray(plan.buildSteps || plan.steps)
    .map((step, index) => normalizeBuildStep(step, index, objectSuggestions));
  const rawCameraBookmarks = normalizeArray(plan.cameraBookmarks);
  if (!rawCameraBookmarks.length && plan.camera) {
    rawCameraBookmarks.push(plan.camera);
  }
  const cameraBookmarks = rawCameraBookmarks
    .map((bookmark, index) => normalizeCameraBookmark(bookmark, index));
  const challengePrompts = normalizeArray(plan.challengePrompts)
    .map((prompt, index) => normalizeChallengePrompt(prompt, index));
  const liveChallenge = normalizeLiveChallenge(plan.liveChallenge);

  return {
    problem: {
      id: plan.problem?.id || plan.id || "scene-plan",
      question: normalizeString(plan.problem?.question || plan.question, ""),
      questionType: normalizeQuestionType(plan.problem?.questionType || plan.questionType),
      summary: normalizeString(plan.problem?.summary || plan.summary || plan.question, ""),
      mode: normalizeString(plan.problem?.mode || plan.mode, "guided"),
    },
    overview: normalizeString(plan.overview, ""),
    objectSuggestions,
    buildSteps,
    cameraBookmarks,
    answerScaffold: normalizeAnswerScaffold(plan.answerScaffold || plan.answer || {}),
    challengePrompts,
    liveChallenge,
  };
}

export function sceneSpecToPlan(sceneSpec = {}, options = {}) {
  const objectSuggestions = normalizeArray(sceneSpec.objects).map((objectSpec, index) => normalizeObjectSuggestion({
    id: objectSpec.id || `suggestion-${index + 1}`,
    title: objectSpec.id ? `${objectSpec.id}: ${objectSpec.shape}` : objectSpec.shape,
    purpose: objectSpec.highlight ? "Important object for the explanation." : "Use this object in the scene.",
    object: objectSpec,
  }, index));
  const dimensionSuggestions = normalizeArray(sceneSpec.dimensions).map((dimension, index) => normalizeObjectSuggestion({
    id: `dimension-${index + 1}`,
    title: dimension.label || `Measurement ${index + 1}`,
    purpose: "Use this helper to show the measurement in the 3D scene.",
    object: {
      id: `dimension-line-${index + 1}`,
      label: dimension.label || `d${index + 1}`,
      shape: "line",
      color: dimension.color || "#ffd966",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      params: {
        start: dimension.from || [0, 0, 0],
        end: dimension.to || [1, 0, 0],
        thickness: 0.08,
      },
      metadata: { role: "helper", kind: "dimension" },
    },
  }, objectSuggestions.length + index));
  const normalizedObjectSuggestions = [...objectSuggestions, ...dimensionSuggestions];

  const answerSteps = normalizeArray(sceneSpec.answer?.steps).map((step, index) => ({
    id: `step-${index + 1}`,
    title: `Step ${index + 1}`,
    instruction: step.text || "",
    hint: step.formula || "",
    action: index < normalizedObjectSuggestions.length ? "verify" : "observe",
    suggestedObjectIds: normalizedObjectSuggestions
      .filter((suggestion) => normalizeArray(step.highlightObjects).includes(suggestion.object.id))
      .map((suggestion) => suggestion.id),
    requiredObjectIds: normalizedObjectSuggestions
      .filter((suggestion) => normalizeArray(step.highlightObjects).includes(suggestion.object.id))
      .map((suggestion) => suggestion.id),
    highlightObjectIds: normalizeArray(step.highlightObjects),
    cameraBookmarkId: "camera-1",
  }));

  if (dimensionSuggestions.length) {
    if (answerSteps[1]) {
      answerSteps[1].suggestedObjectIds = [
        ...new Set([...(answerSteps[1].suggestedObjectIds || []), ...dimensionSuggestions.map((suggestion) => suggestion.id)]),
      ];
      answerSteps[1].requiredObjectIds = [
        ...new Set([...(answerSteps[1].requiredObjectIds || []), ...dimensionSuggestions.map((suggestion) => suggestion.id)]),
      ];
    } else {
      answerSteps.push({
        id: "step-measurements",
        title: "Add the measurements",
        instruction: "Add the dimension helpers so the scene shows the values you will use in the formula.",
        hint: "Each helper line should correspond to a named measurement from the problem.",
        action: "add",
        suggestedObjectIds: dimensionSuggestions.map((suggestion) => suggestion.id),
        requiredObjectIds: dimensionSuggestions.map((suggestion) => suggestion.id),
        highlightObjectIds: dimensionSuggestions.map((suggestion) => suggestion.object.id),
        cameraBookmarkId: "camera-1",
      });
    }
  }

  return normalizeScenePlan({
    problem: {
      id: options.id || sceneSpec.id || "challenge-plan",
      question: sceneSpec.question || "",
      questionType: sceneSpec.questionType || "spatial",
      summary: options.summary || sceneSpec.question || "",
      mode: options.mode || "guided",
    },
    overview: options.overview || sceneSpec.answer?.formula || "",
    objectSuggestions: normalizedObjectSuggestions,
    buildSteps: answerSteps,
    cameraBookmarks: sceneSpec.camera ? [sceneSpec.camera] : [{ id: "camera-1", label: "Scene", position: [8, 6, 8], target: [0, 0, 0] }],
    answerScaffold: {
      finalAnswer: sceneSpec.answer?.value ?? null,
      unit: sceneSpec.answer?.unit || "",
      formula: sceneSpec.answer?.formula || "",
      explanation: normalizeArray(sceneSpec.answer?.steps).map((step) => step.text).join(" "),
    },
    liveChallenge: options.liveChallenge || (["volume", "surface_area"].includes(sceneSpec.questionType)
      ? {
        id: `${options.id || sceneSpec.id || "challenge"}-live-goal`,
        title: sceneSpec.questionType === "surface_area" ? "Double the Surface Area" : "Double the Volume",
        metric: sceneSpec.questionType === "surface_area" ? "surfaceArea" : "volume",
        multiplier: 2,
        prompt: sceneSpec.questionType === "surface_area"
          ? "Adjust the build until the surface area doubles."
          : "Adjust the build until the volume doubles.",
        tolerance: options.tolerance ?? 0.04,
      }
      : null),
    challengePrompts: options.challengePrompts || [{
      id: `${options.id || sceneSpec.id || "challenge"}-answer`,
      prompt: options.challengePrompt || sceneSpec.question || "",
      expectedKind: "numeric",
      expectedAnswer: options.expectedAnswer ?? sceneSpec.answer?.value ?? null,
      tolerance: options.tolerance ?? 0.05,
    }],
  });
}

export function buildSceneSnapshotFromSuggestions(plan, suggestionIds = []) {
  const normalizedPlan = normalizeScenePlan(plan);
  const activeIds = suggestionIds.length
    ? new Set(suggestionIds)
    : new Set(normalizedPlan.objectSuggestions.map((suggestion) => suggestion.id));
  return {
    objects: normalizedPlan.objectSuggestions
      .filter((suggestion) => activeIds.has(suggestion.id))
      .map((suggestion) => suggestion.object),
    selectedObjectId: null,
  };
}
