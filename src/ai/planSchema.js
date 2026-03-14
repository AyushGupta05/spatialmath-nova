import { normalizeSceneObject } from "../scene/schema.js";

const VALID_QUESTION_TYPES = ["volume", "surface_area", "composite", "spatial", "comparison"];
const VALID_LIVE_CHALLENGE_METRICS = ["volume", "surfaceArea"];
const VALID_STEP_ACTIONS = ["add", "verify", "adjust", "observe", "answer"];
const VALID_INPUT_MODES = ["text", "image", "multimodal"];
const LESSON_STAGES = ["orient", "build", "predict", "check", "reflect", "challenge"];
const VALID_EXPERIENCE_MODES = ["builder", "analytic_auto"];
const VALID_TUTOR_ACTION_KINDS = [
  "start-guided-build",
  "build-manually",
  "preview-required-object",
  "confirm-preview",
  "cancel-preview",
  "explain-stage",
  "skip-stage",
  "continue-stage",
  "show-mistake",
  "highlight-key-idea",
  "show-formula",
  "reveal-next-step",
  "reveal-full-solution",
  "reset-view",
  "start-suggested-question",
];

function normalizeString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => normalizeString(value).trim()).filter(Boolean))];
}

function normalizeQuestionType(value) {
  return VALID_QUESTION_TYPES.includes(value) ? value : "spatial";
}

function normalizeInputMode(value, fallback = "text") {
  return VALID_INPUT_MODES.includes(value) ? value : fallback;
}

function normalizeExperienceMode(value, fallback = "builder") {
  return VALID_EXPERIENCE_MODES.includes(value) ? value : fallback;
}

function normalizeLessonStage(value, fallback = "orient") {
  return LESSON_STAGES.includes(value) ? value : fallback;
}

function normalizeTutorActionKind(value, fallback = "continue-stage") {
  return VALID_TUTOR_ACTION_KINDS.includes(value) ? value : fallback;
}

function normalizeSourceSummary(summary = {}, fallbackQuestion = "") {
  const rawQuestion = normalizeString(summary.rawQuestion, fallbackQuestion);
  const cleanedQuestion = normalizeString(summary.cleanedQuestion, rawQuestion);
  const hasImageContent = normalizeString(summary.diagramSummary).length > 0
    || normalizeArray(summary.labels).length > 0
    || normalizeArray(summary.relationships).length > 0;
  const fallbackMode = rawQuestion && hasImageContent ? "multimodal" : rawQuestion ? "text" : "image";

  return {
    inputMode: normalizeInputMode(summary.inputMode, fallbackMode),
    rawQuestion,
    cleanedQuestion: cleanedQuestion || rawQuestion,
    givens: uniqueStrings(summary.givens),
    labels: uniqueStrings(summary.labels),
    relationships: uniqueStrings(summary.relationships),
    diagramSummary: normalizeString(summary.diagramSummary, ""),
    conflicts: uniqueStrings(summary.conflicts),
  };
}

function normalizeSourceEvidence(sourceEvidence = {}, sourceSummary = {}) {
  return {
    inputMode: normalizeInputMode(sourceEvidence.inputMode, sourceSummary.inputMode || "text"),
    givens: uniqueStrings(sourceEvidence.givens?.length ? sourceEvidence.givens : sourceSummary.givens),
    diagramSummary: normalizeString(sourceEvidence.diagramSummary, sourceSummary.diagramSummary || ""),
    conflicts: uniqueStrings(sourceEvidence.conflicts?.length ? sourceEvidence.conflicts : sourceSummary.conflicts),
  };
}

function normalizeAgentTraceItem(item = {}, index = 0) {
  return {
    id: normalizeString(item.id, `agent-${index + 1}`),
    label: normalizeString(item.label, `Agent ${index + 1}`),
    status: normalizeString(item.status, "ready"),
    summary: normalizeString(item.summary, ""),
  };
}

function normalizeAgentTrace(items = []) {
  return normalizeArray(items).map((item, index) => normalizeAgentTraceItem(item, index));
}

function normalizeDemoPreset(preset = {}, sceneFocus = {}, sourceSummary = {}) {
  return {
    title: normalizeString(preset.title, sourceSummary.cleanedQuestion || sceneFocus.concept || "Nova Prism demo"),
    scriptBeat: normalizeString(
      preset.scriptBeat,
      sceneFocus.judgeSummary || sceneFocus.primaryInsight || "Turn the worksheet into a live 3D lesson and coach the learner through it."
    ),
    recommendedCategory: normalizeString(preset.recommendedCategory, "Best of Multimodal Understanding"),
  };
}

function normalizeSceneFocus(sceneFocus = {}, question = "") {
  const concept = normalizeString(sceneFocus.concept, question ? "Spatial relationship" : "");
  const primaryInsight = normalizeString(
    sceneFocus.primaryInsight,
    concept ? `Use the scene to make ${concept.toLowerCase()} visible before solving.` : ""
  );

  return {
    concept,
    primaryInsight,
    focusPrompt: normalizeString(sceneFocus.focusPrompt, primaryInsight),
    judgeSummary: normalizeString(
      sceneFocus.judgeSummary,
      "The student acts on the scene, and Nova responds to that action."
    ),
  };
}

function normalizeLearningMoment(moment = {}, stage, defaults = {}) {
  return {
    stage: normalizeLessonStage(moment.stage, stage),
    title: normalizeString(moment.title, defaults.title || stage),
    coachMessage: normalizeString(moment.coachMessage, defaults.coachMessage || ""),
    goal: normalizeString(moment.goal, defaults.goal || ""),
    prompt: normalizeString(moment.prompt, defaults.prompt || ""),
    insight: normalizeString(moment.insight, defaults.insight || ""),
    whyItMatters: normalizeString(moment.whyItMatters, defaults.whyItMatters || ""),
  };
}

function normalizeTutorAction(action = {}, fallback = {}) {
  return {
    id: normalizeString(action.id, fallback.id || "tutor-action"),
    label: normalizeString(action.label, fallback.label || "Continue"),
    kind: normalizeTutorActionKind(action.kind, fallback.kind || "continue-stage"),
    payload: action.payload && typeof action.payload === "object"
      ? structuredClone(action.payload)
      : structuredClone(fallback.payload || {}),
  };
}

function stageActionsForStep(step, suggestionsById, stageIndex = 0) {
  const primarySuggestion = (step.requiredObjectIds || [])
    .map((id) => suggestionsById.get(id))
    .find(Boolean)
    || (step.suggestedObjectIds || []).map((id) => suggestionsById.get(id)).find(Boolean)
    || null;

  const actions = [];
  if (primarySuggestion) {
    actions.push(normalizeTutorAction({
      id: `${step.id}-preview`,
      label: `Preview ${primarySuggestion.title}`,
      kind: "preview-required-object",
      payload: {
        stageId: step.id,
        suggestionId: primarySuggestion.id,
        objectSpec: primarySuggestion.object,
        highlightTargets: [primarySuggestion.object.id],
      },
    }));
  }
  actions.push(
    normalizeTutorAction({
      id: `${step.id}-explain`,
      label: stageIndex === 0 ? "Explain the Scene" : "Explain This Step",
      kind: "explain-stage",
      payload: { stageId: step.id },
    }),
    normalizeTutorAction({
      id: `${step.id}-continue`,
      label: "Continue",
      kind: "continue-stage",
      payload: { stageId: step.id },
    }),
  );

  return actions.slice(0, 3);
}

function normalizeLessonStageEntry(stage = {}, index = 0, context = {}) {
  const step = context.buildSteps?.[index] || null;
  const currentMoment = context.learningMoments?.build || {};
  const defaultTargets = step?.highlightObjectIds?.length
    ? step.highlightObjectIds
    : (step?.requiredObjectIds || [])
      .map((id) => context.suggestionsById.get(id)?.object?.id)
      .filter(Boolean);
  const fallbackActions = step
    ? stageActionsForStep(step, context.suggestionsById, index)
    : [normalizeTutorAction({
      id: `stage-${index + 1}-continue`,
      label: "Continue",
      kind: "continue-stage",
      payload: { stageId: `stage-${index + 1}` },
    })];

  const providedActions = normalizeArray(stage.suggestedActions).map((action, actionIndex) => {
    const fallback = fallbackActions[actionIndex] || fallbackActions[0];
    const normalizedAction = normalizeTutorAction(action, fallback);
    if (
      normalizedAction.kind === "preview-required-object"
      && normalizedAction.payload?.suggestionId
      && !normalizedAction.payload?.objectSpec
    ) {
      const suggestion = context.suggestionsById.get(normalizedAction.payload.suggestionId);
      if (suggestion) {
        normalizedAction.payload.objectSpec = suggestion.object;
      }
    }
    return normalizedAction;
  });

  return {
    id: normalizeString(stage.id, step?.id || `stage-${index + 1}`),
    title: normalizeString(stage.title, step?.title || `Stage ${index + 1}`),
    goal: normalizeString(stage.goal, step?.instruction || currentMoment.goal || ""),
    tutorIntro: normalizeString(
      stage.tutorIntro,
      step?.coachPrompt || step?.hint || currentMoment.coachMessage || "Let's build the next important relationship in the scene."
    ),
    successCheck: normalizeString(
      stage.successCheck,
      step?.requiredObjectIds?.length
        ? `This stage is complete when ${step.requiredObjectIds.length === 1 ? "the key object is" : "the key objects are"} visible in the scene.`
        : "This stage is complete when the key idea is visible in the scene."
    ),
    highlightTargets: uniqueStrings(stage.highlightTargets?.length ? stage.highlightTargets : defaultTargets),
    suggestedActions: providedActions.length ? providedActions : fallbackActions,
    checkpointPrompt: normalizeString(stage.checkpointPrompt, "Does this look correct?"),
    freeQuestionAnchor: normalizeString(stage.freeQuestionAnchor, step?.focusConcept || context.sceneFocus?.primaryInsight || ""),
    mistakeProbe: normalizeString(
      stage.mistakeProbe,
      "Show me the mistake in this stage and explain what should be different."
    ),
  };
}

function defaultLessonStages({ buildSteps = [], suggestionsById = new Map(), learningMoments = {}, sceneFocus = {} }) {
  return buildSteps.map((step, index) => normalizeLessonStageEntry({}, index, {
    buildSteps,
    suggestionsById,
    learningMoments,
    sceneFocus,
  }));
}

function defaultLearningMoments({ question = "", answerScaffold = {}, sceneFocus = {}, buildSteps = [], liveChallenge = null }) {
  const currentBuildStep = buildSteps[0] || null;
  const formula = normalizeString(answerScaffold.formula, "");
  const concept = sceneFocus.concept || question || "the key spatial idea";
  const insight = sceneFocus.primaryInsight || `Use the scene to make ${concept.toLowerCase()} easier to see.`;

  return {
    orient: normalizeLearningMoment({}, "orient", {
      title: "Orient",
      coachMessage: `Start by spotting the main object or relationship in the problem.`,
      goal: sceneFocus.focusPrompt || `Focus on ${concept.toLowerCase()}.`,
      whyItMatters: insight,
    }),
    build: normalizeLearningMoment({}, "build", {
      title: "Build / Inspect",
      coachMessage: currentBuildStep?.instruction || "Build the scene one meaningful piece at a time.",
      goal: currentBuildStep?.title || "Place the main object and the key helper objects.",
      whyItMatters: "Building the scene makes the hidden structure visible before calculation.",
    }),
    predict: normalizeLearningMoment({}, "predict", {
      title: "Predict",
      coachMessage: "Pause before solving and make a short prediction from the scene.",
      goal: "Name the measurement, relationship, or change you expect to matter most.",
      prompt: buildPredictionPrompt({ sceneFocus, answerScaffold, liveChallenge }),
      whyItMatters: "Prediction turns the scene into reasoning practice instead of passive watching.",
    }),
    check: normalizeLearningMoment({}, "check", {
      title: "Check",
      coachMessage: "Manipulate or inspect the scene to test your prediction.",
      goal: "Rotate, select, or adjust the scene and look for evidence.",
      whyItMatters: "Checking ties the abstract rule back to something you can see.",
    }),
    reflect: normalizeLearningMoment({}, "reflect", {
      title: "Reflect",
      coachMessage: "Capture the main idea in one sentence.",
      goal: formula ? `Connect what you saw to ${formula}.` : "Summarize the key spatial insight.",
      insight,
      whyItMatters: "A short reflection helps the concept stick after the interaction.",
    }),
    challenge: normalizeLearningMoment({}, "challenge", {
      title: "Challenge",
      coachMessage: liveChallenge?.prompt || "Try one small follow-up to reinforce the same idea.",
      goal: liveChallenge?.title || "Apply the same spatial idea in one more move.",
      prompt: liveChallenge?.prompt || "Change one parameter and predict what happens next.",
      whyItMatters: "A short challenge shows whether the understanding transfers.",
    }),
  };
}

function normalizeObjectSuggestion(suggestion = {}, index = 0) {
  const object = normalizeSceneObject(suggestion.object || suggestion.sceneObject || suggestion);
  const id = suggestion.id || object.id || `suggestion-${index + 1}`;
  const roles = uniqueStrings([
    ...(normalizeArray(suggestion.roles)),
    ...(normalizeArray(suggestion.semanticRoles)),
    ...(normalizeArray(object.metadata?.roles)),
    normalizeString(suggestion.role),
    normalizeString(object.metadata?.role),
  ]);

  object.id = object.id || `${id}-object`;
  object.metadata = {
    ...(object.metadata || {}),
    role: normalizeString(object.metadata?.role || roles[0], object.metadata?.role || ""),
    roles,
  };

  return {
    id,
    title: normalizeString(suggestion.title, object.label || `${object.shape} ${index + 1}`),
    purpose: normalizeString(suggestion.purpose, `Use this ${object.shape} to reason about the problem.`),
    optional: Boolean(suggestion.optional),
    tags: uniqueStrings(suggestion.tags),
    roles,
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

function normalizeSceneMoment(moment = {}, index = 0) {
  return {
    id: normalizeString(moment.id, `moment-${index + 1}`),
    title: normalizeString(moment.title, `Step ${index + 1}`),
    prompt: normalizeString(moment.prompt, ""),
    goal: normalizeString(moment.goal, ""),
    focusTargets: uniqueStrings(moment.focusTargets),
    visibleObjectIds: uniqueStrings(moment.visibleObjectIds),
    visibleOverlayIds: uniqueStrings(moment.visibleOverlayIds),
    cameraBookmarkId: normalizeString(moment.cameraBookmarkId, ""),
    revealFormula: Boolean(moment.revealFormula),
    revealFullSolution: Boolean(moment.revealFullSolution),
  };
}

function normalizeSceneOverlay(overlay = {}, index = 0) {
  const position = Array.isArray(overlay.position) ? overlay.position : null;
  const origin = Array.isArray(overlay.origin) ? overlay.origin : null;
  const target = Array.isArray(overlay.target) ? overlay.target : null;
  const offset = Array.isArray(overlay.offset) ? overlay.offset : null;
  const bounds = overlay.bounds && typeof overlay.bounds === "object"
    ? {
      x: Array.isArray(overlay.bounds.x) ? overlay.bounds.x : [-4, 4],
      y: Array.isArray(overlay.bounds.y) ? overlay.bounds.y : [-4, 4],
      z: Array.isArray(overlay.bounds.z) ? overlay.bounds.z : [-4, 4],
      tickStep: Number(overlay.bounds.tickStep) || 1,
    }
    : null;

  return {
    id: normalizeString(overlay.id, `overlay-${index + 1}`),
    type: normalizeString(overlay.type, "text"),
    targetObjectId: normalizeString(overlay.targetObjectId, ""),
    text: normalizeString(overlay.text, ""),
    style: normalizeString(overlay.style, "annotation"),
    color: normalizeString(overlay.color, ""),
    position,
    origin,
    target,
    offset,
    bounds,
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
    focusConcept: normalizeString(step.focusConcept, ""),
    coachPrompt: normalizeString(step.coachPrompt, ""),
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

function normalizeAnalyticContext(analytic = {}) {
  if (!analytic || typeof analytic !== "object") return null;
  const entities = analytic.entities && typeof analytic.entities === "object"
    ? {
      points: normalizeArray(analytic.entities.points).map((point, index) => ({
        id: normalizeString(point.id, `analytic-point-${index + 1}`),
        label: normalizeString(point.label, `P${index + 1}`),
        coordinates: Array.isArray(point.coordinates) ? point.coordinates.map((value) => Number(value) || 0) : [0, 0, 0],
      })),
      lines: normalizeArray(analytic.entities.lines).map((line, index) => ({
        id: normalizeString(line.id, `analytic-line-${index + 1}`),
        label: normalizeString(line.label, `Line ${index + 1}`),
        point: Array.isArray(line.point) ? line.point.map((value) => Number(value) || 0) : [0, 0, 0],
        direction: Array.isArray(line.direction) ? line.direction.map((value) => Number(value) || 0) : [1, 0, 0],
      })),
      planes: normalizeArray(analytic.entities.planes).map((plane, index) => ({
        id: normalizeString(plane.id, `analytic-plane-${index + 1}`),
        label: normalizeString(plane.label, `Plane ${index + 1}`),
        normal: Array.isArray(plane.normal) ? plane.normal.map((value) => Number(value) || 0) : [0, 1, 0],
        constant: Number(plane.constant) || 0,
      })),
    }
    : { points: [], lines: [], planes: [] };

  return {
    subtype: normalizeString(analytic.subtype, ""),
    entities,
    derivedValues: analytic.derivedValues && typeof analytic.derivedValues === "object"
      ? structuredClone(analytic.derivedValues)
      : {},
    formulaCard: analytic.formulaCard && typeof analytic.formulaCard === "object"
      ? {
        title: normalizeString(analytic.formulaCard.title, ""),
        formula: normalizeString(analytic.formulaCard.formula, ""),
        explanation: normalizeString(analytic.formulaCard.explanation, ""),
      }
      : { title: "", formula: "", explanation: "" },
    solutionSteps: normalizeArray(analytic.solutionSteps).map((step, index) => ({
      id: normalizeString(step.id, `analytic-step-${index + 1}`),
      title: normalizeString(step.title, `Step ${index + 1}`),
      formula: normalizeString(step.formula, ""),
      explanation: normalizeString(step.explanation, ""),
    })),
  };
}

function buildPredictionPrompt({ sceneFocus = {}, answerScaffold = {}, liveChallenge = null }) {
  if (liveChallenge?.prompt) {
    return liveChallenge.prompt;
  }
  if (sceneFocus.primaryInsight) {
    return `Before solving, what do you expect to notice about ${sceneFocus.primaryInsight.toLowerCase()}?`;
  }
  if (answerScaffold.formula) {
    return `Which visible value in the scene belongs in ${answerScaffold.formula} first?`;
  }
  return "Before solving, what do you think matters most in the scene?";
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
  const question = normalizeString(plan.problem?.question || plan.question, "");
  const experienceMode = normalizeExperienceMode(plan.experienceMode, plan.analyticContext ? "analytic_auto" : "builder");
  const answerScaffold = normalizeAnswerScaffold(plan.answerScaffold || plan.answer || {});
  const sourceSummary = normalizeSourceSummary(plan.sourceSummary, question);
  const sceneFocus = normalizeSceneFocus(plan.sceneFocus, sourceSummary.cleanedQuestion || question);
  const sourceEvidence = normalizeSourceEvidence(plan.sourceEvidence, sourceSummary);
  const analyticContext = normalizeAnalyticContext(plan.analyticContext);
  const sceneMoments = normalizeArray(plan.sceneMoments).map((moment, index) => normalizeSceneMoment(moment, index));
  const sceneOverlays = normalizeArray(plan.sceneOverlays).map((overlay, index) => normalizeSceneOverlay(overlay, index));
  const fallbackMoments = defaultLearningMoments({
    question: sourceSummary.cleanedQuestion || question,
    answerScaffold,
    sceneFocus,
    buildSteps,
    liveChallenge,
  });
  const learningMoments = Object.fromEntries(LESSON_STAGES.map((stage) => [
    stage,
    normalizeLearningMoment(plan.learningMoments?.[stage] || {}, stage, fallbackMoments[stage]),
  ]));
  const suggestionsById = new Map(objectSuggestions.map((suggestion) => [suggestion.id, suggestion]));
  const fallbackLessonStages = defaultLessonStages({
    buildSteps,
    suggestionsById,
    learningMoments,
    sceneFocus,
  });
  const lessonStages = normalizeArray(plan.lessonStages).length
    ? normalizeArray(plan.lessonStages).map((stage, index) => normalizeLessonStageEntry(stage, index, {
      buildSteps,
      suggestionsById,
      learningMoments,
      sceneFocus,
    }))
    : fallbackLessonStages;

  return {
    problem: {
      id: plan.problem?.id || plan.id || "scene-plan",
      question,
      questionType: normalizeQuestionType(plan.problem?.questionType || plan.questionType),
      summary: normalizeString(plan.problem?.summary || plan.summary || question, ""),
      mode: normalizeString(plan.problem?.mode || plan.mode, "guided"),
    },
    experienceMode,
    overview: normalizeString(plan.overview, ""),
    sourceSummary,
    sceneFocus,
    learningMoments,
    objectSuggestions,
    buildSteps,
    cameraBookmarks,
    answerScaffold,
    challengePrompts,
    liveChallenge,
    sourceEvidence,
    lessonStages,
    analyticContext,
    sceneMoments,
    sceneOverlays,
    agentTrace: normalizeAgentTrace(plan.agentTrace),
    demoPreset: normalizeDemoPreset(plan.demoPreset, sceneFocus, sourceSummary),
  };
}

export function sceneSpecToPlan(sceneSpec = {}, options = {}) {
  const objectSuggestions = normalizeArray(sceneSpec.objects).map((objectSpec, index) => normalizeObjectSuggestion({
    id: objectSpec.id || `suggestion-${index + 1}`,
    title: objectSpec.id ? `${objectSpec.id}: ${objectSpec.shape}` : objectSpec.shape,
    purpose: objectSpec.highlight ? "Important object for the explanation." : "Use this object in the scene.",
    roles: objectSpec.highlight ? ["primary"] : [],
    object: objectSpec,
  }, index));
  const dimensionSuggestions = normalizeArray(sceneSpec.dimensions).map((dimension, index) => normalizeObjectSuggestion({
    id: `dimension-${index + 1}`,
    title: dimension.label || `Measurement ${index + 1}`,
    purpose: "Use this helper to show the measurement in the 3D scene.",
    roles: ["measurement"],
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
      metadata: { role: "measurement", roles: ["measurement", "helper"], kind: "dimension" },
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
    sourceSummary: {
      inputMode: "text",
      rawQuestion: sceneSpec.question || "",
      cleanedQuestion: sceneSpec.question || "",
      givens: normalizeArray(sceneSpec.labels).map((label) => label.text).filter(Boolean),
      labels: normalizeArray(sceneSpec.labels).map((label) => label.attachTo).filter(Boolean),
      relationships: [],
      diagramSummary: "",
    },
    sceneFocus: {
      concept: sceneSpec.questionType === "spatial" ? "spatial relationship" : "key dimensions",
      primaryInsight: options.overview || "Use the scene to connect the visible dimensions to the problem.",
      focusPrompt: "Focus on the main object and its labeled measurements.",
      judgeSummary: "The student builds the scene, then explains the visible relationship.",
    },
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

export { LESSON_STAGES };
