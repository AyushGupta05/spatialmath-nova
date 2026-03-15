import { normalizeScenePlan } from "../../../src/ai/planSchema.js";
import {
  buildAnalyticLessonStages,
  buildCommonAnalyticActions,
  buildCoordinateBounds,
  cameraForBounds,
  normalizePromptText,
  round,
  roundVec,
} from "./analyticMath.js";

const ANALYTIC_HINT_PATTERN = /\b(vector|vectors|dot product|cross product|projection|project|position vector|unit vector|coordinates?|grid|point|points|midpoint|triangle|parallelogram|line|lines|plane|planes|normal|distance|angle|parametric|direction)\b/i;

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
}

function slugify(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function formatList(labels = []) {
  const clean = uniqueStrings(labels);
  if (clean.length <= 1) return clean[0] || "";
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

function includesWord(text = "", pattern) {
  return pattern.test(String(text || ""));
}

function isSceneShape(shape = "") {
  return ["line", "pointMarker", "plane", "cube", "cuboid", "sphere", "cylinder", "cone", "pyramid"].includes(shape);
}

function hasAnalyticFormula(plan) {
  return Boolean(
    plan?.answerScaffold?.formula
    || plan?.analyticContext?.formulaCard?.formula
    || plan?.analyticContext?.solutionSteps?.some((step) => step.formula)
  );
}

function hasAnalyticSceneObjects(plan) {
  return (plan?.objectSuggestions || []).some((suggestion) => {
    const shape = suggestion?.object?.shape || "";
    const roles = suggestion?.roles || suggestion?.object?.metadata?.roles || [];
    return isSceneShape(shape)
      && (
        ["line", "pointMarker", "plane"].includes(shape)
        || roles.some((role) => ["point", "line", "plane", "normal", "projection", "reference"].includes(role))
      );
  });
}

function shouldPromoteToAnalyticAuto(plan, questionText = "", sourceSummary = {}) {
  if (plan?.experienceMode === "analytic_auto") {
    return true;
  }

  const question = normalizePromptText(sourceSummary?.cleanedQuestion || questionText || plan?.problem?.question || "");
  if (!question || plan?.problem?.questionType !== "spatial") {
    return false;
  }

  if (!ANALYTIC_HINT_PATTERN.test(question)) {
    return false;
  }

  if (!hasAnalyticFormula(plan)) {
    return false;
  }

  return hasAnalyticSceneObjects(plan) && (plan?.buildSteps?.length >= 2 || plan?.objectSuggestions?.length >= 3);
}

function objectPoints(objectSpec = {}) {
  if (!objectSpec || typeof objectSpec !== "object") return [];
  if (objectSpec.shape === "line") {
    const start = Array.isArray(objectSpec.params?.start) ? objectSpec.params.start : null;
    const end = Array.isArray(objectSpec.params?.end) ? objectSpec.params.end : null;
    return [start, end].filter((point) => Array.isArray(point) && point.length === 3);
  }

  const position = Array.isArray(objectSpec.position) && objectSpec.position.length === 3
    ? objectSpec.position
    : null;
  return position ? [position] : [];
}

function buildBounds(plan) {
  const points = (plan?.objectSuggestions || [])
    .flatMap((suggestion) => objectPoints(suggestion.object))
    .filter((point) => Array.isArray(point) && point.length === 3);
  return buildCoordinateBounds(points.length ? points : [[0, 0, 0]], 2);
}

function buildCameraBookmarks(plan, bounds) {
  const normalized = Array.isArray(plan?.cameraBookmarks) ? plan.cameraBookmarks.filter(Boolean) : [];
  if (normalized.length) {
    return normalized;
  }

  return [{
    id: "overview",
    label: "Overview",
    description: "Frame the staged analytic scene.",
    ...cameraForBounds(bounds),
  }];
}

function defaultCameraId(cameraBookmarks = []) {
  return cameraBookmarks[0]?.id || "overview";
}

function overlayLabelForSuggestion(suggestion = {}) {
  return String(
    suggestion?.object?.label
    || suggestion?.title
    || suggestion?.id
    || suggestion?.object?.id
    || "Object"
  ).trim();
}

function buildGeneratedOverlays(plan, bounds) {
  const center = [
    round((bounds.x[0] + bounds.x[1]) * 0.5, 3),
    round((bounds.y[0] + bounds.y[1]) * 0.5, 3),
    round((bounds.z[0] + bounds.z[1]) * 0.5, 3),
  ];
  const labelOverlayIdsBySuggestionId = new Map();
  const overlays = [{
    id: "analytic-axes",
    type: "coordinate-frame",
    bounds,
  }];

  for (const suggestion of plan.objectSuggestions || []) {
    if (!suggestion?.object?.id) continue;
    const overlayId = `label-${suggestion.id}`;
    labelOverlayIdsBySuggestionId.set(suggestion.id, overlayId);
    overlays.push({
      id: overlayId,
      type: "object-label",
      targetObjectId: suggestion.object.id,
      text: overlayLabelForSuggestion(suggestion),
      offset: suggestion.object.shape === "line" ? [0, 0.3, 0] : [0, 0.5, 0],
      style: suggestion.object.shape === "line" ? "formula" : "name",
    });
  }

  const formulaText = String(plan.answerScaffold?.formula || plan.analyticContext?.formulaCard?.formula || "").trim();
  if (formulaText) {
    overlays.push({
      id: "analytic-formula",
      type: "text",
      position: roundVec([center[0], bounds.y[1] + 1.1, center[2]], 3),
      text: formulaText,
      style: "formula",
    });
  }

  const finalAnswer = plan.answerScaffold?.finalAnswer;
  if (finalAnswer != null && String(finalAnswer).trim()) {
    overlays.push({
      id: "analytic-answer",
      type: "text",
      position: roundVec([center[0], bounds.y[0] - 0.6, center[2]], 3),
      text: `Answer: ${String(finalAnswer).trim()}`,
      style: "formula",
    });
  }

  return {
    overlays,
    labelOverlayIdsBySuggestionId,
    hasFormulaOverlay: overlays.some((overlay) => overlay.id === "analytic-formula"),
    hasAnswerOverlay: overlays.some((overlay) => overlay.id === "analytic-answer"),
  };
}

function samePoint(a = [], b = [], tolerance = 0.001) {
  return Array.isArray(a)
    && Array.isArray(b)
    && a.length === 3
    && b.length === 3
    && a.every((value, index) => Math.abs(Number(value) - Number(b[index])) <= tolerance);
}

function stageSceneInfo(plan, visibleSuggestionIds = []) {
  const suggestionsById = new Map((plan.objectSuggestions || []).map((suggestion) => [suggestion.id, suggestion]));
  const suggestions = visibleSuggestionIds
    .map((id) => suggestionsById.get(id))
    .filter(Boolean);
  const points = suggestions.filter((suggestion) => suggestion.object?.shape === "pointMarker");
  const lines = suggestions.filter((suggestion) => suggestion.object?.shape === "line");
  const planes = suggestions.filter((suggestion) => suggestion.object?.shape === "plane");
  const pointLabels = points.map((suggestion) => suggestion.object?.label || suggestion.title || suggestion.id);
  const lineLabels = lines.map((suggestion) => suggestion.object?.label || suggestion.title || suggestion.id);
  const planeLabels = planes.map((suggestion) => suggestion.object?.label || suggestion.title || suggestion.id);
  let sharedAnchor = "";

  if (points.length && lines.length) {
    for (const point of points) {
      const pointPosition = point.object?.position || [];
      const lineStartsAtPoint = lines.filter((line) => samePoint(line.object?.params?.start, pointPosition));
      if (lineStartsAtPoint.length >= 2) {
        sharedAnchor = point.object?.label || point.title || point.id;
        break;
      }
    }
  }

  return {
    pointLabels: uniqueStrings(pointLabels),
    lineLabels: uniqueStrings(lineLabels),
    planeLabels: uniqueStrings(planeLabels),
    sharedAnchor,
  };
}

function analyticCalculationFocus(plan = {}) {
  const question = normalizePromptText(plan.problem?.question || "");
  if (includesWord(question, /\bangle\b/i)) return "angle";
  if (includesWord(question, /\bdistance\b/i)) return "distance";
  if (includesWord(question, /\bprojection\b/i)) return "projection";
  if (includesWord(question, /\bdot product\b/i)) return "dot product";
  if (includesWord(question, /\bmidpoint\b/i)) return "midpoint";
  return "result";
}

function analyticStageCopy(plan, stage = {}, index = 0, total = 0) {
  const info = stageSceneInfo(plan, stage.visibleObjectIds || []);
  const formula = String(plan.answerScaffold?.formula || plan.analyticContext?.formulaCard?.formula || "").trim();
  const focus = analyticCalculationFocus(plan);
  const pointList = formatList(info.pointLabels);
  const lineList = formatList(info.lineLabels);
  const planeList = formatList(info.planeLabels);
  const anchorText = info.sharedAnchor ? ` from ${info.sharedAnchor}` : "";

  if (stage.revealFullSolution) {
    return {
      prompt: `Finish the ${focus} calculation and compare the result with the scene.`,
      goal: "Connect the completed calculation back to the picture.",
    };
  }

  if (stage.revealFormula) {
    return {
      prompt: formula
        ? `Use the visible scene to apply ${formula}.`
        : `Use the visible scene to complete the ${focus} calculation.`,
      goal: formula
        ? `Map the formula directly onto the revealed objects.`
        : `Use the revealed objects to complete the calculation.`,
    };
  }

  if (info.pointLabels.length && !info.lineLabels.length && !info.planeLabels.length) {
    return {
      prompt: `Points ${pointList} are shown on the grid. Read the givens first and identify what you need for the ${focus} calculation.`,
      goal: "Use the plotted givens to set up the calculation.",
    };
  }

  if (info.lineLabels.length && info.pointLabels.length) {
    return {
      prompt: focus === "angle"
        ? `Vectors ${lineList} are now shown${anchorText}. Focus on the angle they make before calculating.`
        : `Lines or vectors ${lineList} are now shown with the points. Focus on the relationship they create before calculating.`,
      goal: "Use the revealed lines and points to understand the relationship you will calculate.",
    };
  }

  if (info.lineLabels.length && info.planeLabels.length) {
    return {
      prompt: `The key objects ${formatList([...info.lineLabels, ...info.planeLabels])} are shown. Focus on their spatial relationship before calculating.`,
      goal: "Use the revealed objects to understand the spatial relationship you will calculate.",
    };
  }

  if (info.lineLabels.length) {
    return {
      prompt: `The key lines ${lineList} are now shown. Focus on what they tell you before calculating.`,
      goal: "Use the revealed lines to set up the calculation.",
    };
  }

  if (info.planeLabels.length) {
    return {
      prompt: `The reference plane${info.planeLabels.length > 1 ? "s" : ""} ${planeList} ${info.planeLabels.length > 1 ? "are" : "is"} shown. Use ${info.planeLabels.length > 1 ? "them" : "it"} to frame the calculation.`,
      goal: "Use the revealed plane view to set up the calculation.",
    };
  }

  return {
    prompt: index === 0
      ? "The givens are shown in the scene. Read them first, then set up the calculation."
      : index === total - 1
        ? "Use the revealed scene to finish the calculation."
        : "Use the newly revealed scene elements to continue the calculation.",
    goal: "Keep the calculation tied to what is visible in the scene.",
  };
}

function rewriteAnalyticStages(plan, sourceStages = []) {
  return sourceStages.map((stage, index) => {
    const rewritten = analyticStageCopy(plan, stage, index, sourceStages.length);
    return {
      ...stage,
      prompt: rewritten.prompt,
      goal: rewritten.goal,
    };
  });
}

function overlayIdsForStage(visibleSuggestionIds = [], overlayContext = {}, options = {}) {
  const overlayIds = ["analytic-axes"];
  for (const suggestionId of visibleSuggestionIds) {
    const labelId = overlayContext.labelOverlayIdsBySuggestionId?.get?.(suggestionId);
    if (labelId) overlayIds.push(labelId);
  }
  if (options.includeFormula && overlayContext.hasFormulaOverlay) {
    overlayIds.push("analytic-formula");
  }
  if (options.includeAnswer && overlayContext.hasAnswerOverlay) {
    overlayIds.push("analytic-answer");
  }
  return uniqueStrings(overlayIds);
}

function suggestionIdsForStep(step = {}, suggestionIdByObjectId = new Map()) {
  const explicitIds = uniqueStrings([
    ...(step?.suggestedObjectIds || []),
    ...(step?.requiredObjectIds || []),
  ]);
  if (explicitIds.length) return explicitIds;
  return uniqueStrings(
    (step?.highlightObjectIds || [])
      .map((objectId) => suggestionIdByObjectId.get(objectId))
      .filter(Boolean)
  );
}

function focusTargetsForStep(step = {}, stepSuggestionIds = [], suggestionsById = new Map()) {
  if (step?.highlightObjectIds?.length) {
    return uniqueStrings(step.highlightObjectIds);
  }
  return uniqueStrings(
    stepSuggestionIds
      .map((suggestionId) => suggestionsById.get(suggestionId)?.object?.id)
      .filter(Boolean)
  );
}

function buildStageSpecsFromBuildSteps(plan, cameraId) {
  const suggestionsById = new Map((plan.objectSuggestions || []).map((suggestion) => [suggestion.id, suggestion]));
  const suggestionIdByObjectId = new Map((plan.objectSuggestions || []).map((suggestion) => [suggestion.object?.id, suggestion.id]));
  const cumulativeSuggestionIds = new Set();
  const steps = Array.isArray(plan.buildSteps) ? plan.buildSteps : [];

  return steps.map((step, index) => {
    const stepSuggestionIds = suggestionIdsForStep(step, suggestionIdByObjectId);
    const resolvedIds = stepSuggestionIds.length
      ? stepSuggestionIds
      : (index === 0 && plan.objectSuggestions[0]?.id)
        ? [plan.objectSuggestions[0].id]
        : [];
    resolvedIds.forEach((suggestionId) => cumulativeSuggestionIds.add(suggestionId));
    const visibleObjectIds = [...cumulativeSuggestionIds];

    return {
      id: step.id || `moment-${index + 1}`,
      title: step.title || `Step ${index + 1}`,
      prompt: step.coachPrompt || step.hint || step.instruction || "Look closely at the staged scene.",
      goal: step.instruction || step.title || "Use the current scene to reason about the problem.",
      focusTargets: focusTargetsForStep(step, resolvedIds, suggestionsById),
      visibleObjectIds: visibleObjectIds.length ? visibleObjectIds : resolvedIds,
      cameraBookmarkId: step.cameraBookmarkId || cameraId,
    };
  }).filter((stage) => stage.visibleObjectIds.length);
}

function buildSceneMoments(stageSpecs = [], overlayContext = {}) {
  const total = stageSpecs.length;
  return stageSpecs.map((stage, index) => {
    const revealFormula = total > 1 && index >= Math.max(1, total - 2);
    const revealFullSolution = index === total - 1;
    return {
      id: stage.id,
      title: stage.title,
      prompt: stage.prompt,
      goal: stage.goal,
      focusTargets: stage.focusTargets,
      visibleObjectIds: stage.visibleObjectIds,
      visibleOverlayIds: overlayIdsForStage(stage.visibleObjectIds, overlayContext, {
        includeFormula: revealFormula,
        includeAnswer: revealFullSolution,
      }),
      cameraBookmarkId: stage.cameraBookmarkId,
      revealFormula,
      revealFullSolution,
    };
  });
}

function buildAnalyticBuildSteps(sceneMoments = [], sceneFocus = {}) {
  return sceneMoments.map((moment, index) => ({
    id: moment.id,
    title: moment.title,
    instruction: moment.goal,
    hint: moment.prompt,
    action: index < Math.max(sceneMoments.length - 2, 1) ? "observe" : "answer",
    focusConcept: sceneFocus?.concept || "guided analytic scene",
    coachPrompt: moment.prompt,
    suggestedObjectIds: moment.visibleObjectIds,
    requiredObjectIds: [],
    cameraBookmarkId: moment.cameraBookmarkId,
    highlightObjectIds: moment.focusTargets,
  }));
}

function vectorFromLineObject(objectSpec = {}) {
  const start = Array.isArray(objectSpec.params?.start) ? objectSpec.params.start : null;
  const end = Array.isArray(objectSpec.params?.end) ? objectSpec.params.end : null;
  if (!start || !end) return null;
  return roundVec([
    Number(end[0]) - Number(start[0]),
    Number(end[1]) - Number(start[1]),
    Number(end[2]) - Number(start[2]),
  ], 4);
}

function buildAnalyticContext(plan, sourceSteps = []) {
  const subtypeSource = plan.sceneFocus?.concept || plan.problem?.question || "nova guided lesson";
  const solutionSteps = sourceSteps.map((step, index) => ({
    id: step.id || `analytic-step-${index + 1}`,
    title: step.title || `Step ${index + 1}`,
    formula: String(step.hint || (index === sourceSteps.length - 1 ? plan.answerScaffold?.formula || "" : "")).trim(),
    explanation: String(step.instruction || step.goal || step.coachPrompt || step.prompt || "").trim(),
  }));

  const points = (plan.objectSuggestions || [])
    .filter((suggestion) => suggestion.object?.shape === "pointMarker")
    .map((suggestion, index) => ({
      id: suggestion.object.id || `analytic-point-${index + 1}`,
      label: suggestion.object.label || suggestion.title || `P${index + 1}`,
      coordinates: roundVec(suggestion.object.position || [0, 0, 0], 4),
    }));

  const lines = (plan.objectSuggestions || [])
    .filter((suggestion) => suggestion.object?.shape === "line")
    .map((suggestion, index) => ({
      id: suggestion.object.id || `analytic-line-${index + 1}`,
      label: suggestion.object.label || suggestion.title || `Line ${index + 1}`,
      point: roundVec(suggestion.object.params?.start || suggestion.object.position || [0, 0, 0], 4),
      direction: vectorFromLineObject(suggestion.object) || roundVec(suggestion.object.metadata?.direction || [1, 0, 0], 4),
    }));

  const planes = (plan.objectSuggestions || [])
    .filter((suggestion) => suggestion.object?.shape === "plane")
    .map((suggestion, index) => ({
      id: suggestion.object.id || `analytic-plane-${index + 1}`,
      label: suggestion.object.label || suggestion.title || `Plane ${index + 1}`,
      normal: roundVec(suggestion.object.metadata?.normal || [0, 1, 0], 4),
      constant: Number(suggestion.object.metadata?.constant) || 0,
    }));

  return {
    subtype: slugify(subtypeSource) || "nova_guided_lesson",
    entities: {
      points,
      lines,
      planes,
    },
    derivedValues: {
      suggestedObjectCount: plan.objectSuggestions?.length || 0,
      stagedMomentCount: sourceSteps.length,
    },
    formulaCard: {
      title: plan.sceneFocus?.concept || "Nova-guided formula walkthrough",
      formula: plan.answerScaffold?.formula || "",
      explanation: plan.answerScaffold?.explanation || plan.overview || "Use the staged scene to connect the visible structure to the calculation.",
    },
    solutionSteps,
  };
}

function analyticLessonStages(sceneMoments = []) {
  return buildAnalyticLessonStages(sceneMoments).map((stage, index) => ({
    ...stage,
    suggestedActions: buildCommonAnalyticActions(index < sceneMoments.length - 1),
  }));
}

export function promoteNovaPlanToAnalyticAuto(rawPlan, options = {}) {
  const plan = normalizeScenePlan(rawPlan);
  if (!shouldPromoteToAnalyticAuto(plan, options.questionText, options.sourceSummary || plan.sourceSummary)) {
    return plan;
  }

  const bounds = buildBounds(plan);
  const cameraBookmarks = buildCameraBookmarks(plan, bounds);
  const fallbackCameraId = defaultCameraId(cameraBookmarks);
  const overlayContext = buildGeneratedOverlays(plan, bounds);

  const hasProvidedMoments = Array.isArray(plan.sceneMoments) && plan.sceneMoments.length >= 2;
  const rawSourceStages = hasProvidedMoments
    ? plan.sceneMoments.map((moment) => ({
      id: moment.id,
      title: moment.title,
      prompt: moment.prompt,
      goal: moment.goal,
      focusTargets: uniqueStrings(moment.focusTargets || []),
      visibleObjectIds: uniqueStrings(moment.visibleObjectIds || []),
      cameraBookmarkId: moment.cameraBookmarkId || fallbackCameraId,
      revealFormula: Boolean(moment.revealFormula),
      revealFullSolution: Boolean(moment.revealFullSolution),
    }))
    : buildStageSpecsFromBuildSteps(plan, fallbackCameraId);

  if (!rawSourceStages.length) {
    return plan;
  }

  const sourceStages = rewriteAnalyticStages(plan, rawSourceStages);

  const sceneMoments = hasProvidedMoments
    ? sourceStages.map((stage) => ({
      ...stage,
      visibleOverlayIds: uniqueStrings(
        stage.visibleOverlayIds?.length
          ? stage.visibleOverlayIds
          : overlayIdsForStage(stage.visibleObjectIds, overlayContext, {
            includeFormula: stage.revealFormula,
            includeAnswer: stage.revealFullSolution,
          })
      ),
    }))
    : buildSceneMoments(sourceStages, overlayContext);

  const analyticBuildSteps = buildAnalyticBuildSteps(sceneMoments, plan.sceneFocus);
  const sceneOverlays = plan.sceneOverlays?.length
    ? [...plan.sceneOverlays, ...overlayContext.overlays.filter((overlay) => !plan.sceneOverlays.some((item) => item.id === overlay.id))]
    : overlayContext.overlays;

  return normalizeScenePlan({
    ...plan,
    experienceMode: "analytic_auto",
    buildSteps: analyticBuildSteps,
    lessonStages: analyticLessonStages(sceneMoments),
    sceneMoments,
    sceneOverlays,
    cameraBookmarks,
    analyticContext: buildAnalyticContext(plan, hasProvidedMoments ? sourceStages : plan.buildSteps),
  });
}
