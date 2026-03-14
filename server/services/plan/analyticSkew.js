import { normalizeScenePlan } from "../../../src/ai/planSchema.js";
import {
  EPSILON,
  add,
  buildAnalyticLessonStages,
  buildAnalyticMoments,
  buildBaseQuestionFields,
  buildCommonAnalyticActions,
  buildCoordinateBounds,
  cameraForBounds,
  cross,
  dot,
  formatLineEquation,
  formatNumber,
  formatVector,
  lineSegmentFromPointDirection,
  magnitude,
  parseParametricLines,
  round,
  roundVec,
  scale,
  sub,
} from "./analyticMath.js";

function buildMomentSteps(sceneMoments) {
  return sceneMoments.map((moment, index) => ({
    id: moment.id,
    title: moment.title,
    instruction: moment.goal,
    hint: moment.prompt,
    action: index < 2 ? "observe" : "answer",
    focusConcept: "skew lines distance",
    coachPrompt: moment.prompt,
    suggestedObjectIds: moment.visibleObjectIds,
    requiredObjectIds: [],
    cameraBookmarkId: moment.cameraBookmarkId,
    highlightObjectIds: moment.focusTargets,
  }));
}

function closestPointsBetweenLines(p1, v1, p2, v2) {
  const w0 = sub(p1, p2);
  const a = dot(v1, v1);
  const b = dot(v1, v2);
  const c = dot(v2, v2);
  const d = dot(v1, w0);
  const e = dot(v2, w0);
  const denominator = (a * c) - (b * b);
  if (Math.abs(denominator) <= EPSILON) return null;
  const t = ((b * e) - (c * d)) / denominator;
  const s = ((a * e) - (b * d)) / denominator;
  return {
    t,
    s,
    point1: add(p1, scale(v1, t)),
    point2: add(p2, scale(v2, s)),
  };
}

export function buildSkewLinesDistancePlan(questionText, sourceSummary = {}) {
  const [line1, line2] = parseParametricLines(questionText);
  if (!line1 || !line2) return null;

  const crossProduct = cross(line1.direction, line2.direction);
  const crossMagnitude = magnitude(crossProduct);
  if (crossMagnitude <= EPSILON) return null;

  const delta = sub(line2.point, line1.point);
  const distanceValue = Math.abs(dot(delta, crossProduct)) / crossMagnitude;
  const closest = closestPointsBetweenLines(line1.point, line1.direction, line2.point, line2.direction);
  if (!closest) return null;

  const segment1 = lineSegmentFromPointDirection(line1.point, line1.direction, 5);
  const segment2 = lineSegmentFromPointDirection(line2.point, line2.direction, 5);
  const bounds = buildCoordinateBounds([
    line1.point,
    line2.point,
    segment1.start,
    segment1.end,
    segment2.start,
    segment2.end,
    closest.point1,
    closest.point2,
  ], 2);
  const overview = "Auto-draw the two skew lines and reveal the common perpendicular so the shortest distance formula has a visible meaning.";

  const objectSuggestions = [
    {
      id: "line-one",
      title: "Line r1",
      purpose: "The first skew line.",
      optional: false,
      tags: ["primary", "line"],
      roles: ["primary", "line"],
      object: {
        id: "line-one",
        label: line1.label || "r1",
        shape: "line",
        color: "#48c9ff",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        params: { start: segment1.start, end: segment1.end, thickness: 0.08 },
        metadata: { role: "line", roles: ["primary", "line"], direction: roundVec(line1.direction, 4) },
      },
    },
    {
      id: "line-two",
      title: "Line r2",
      purpose: "The second skew line.",
      optional: false,
      tags: ["primary", "line"],
      roles: ["primary", "line"],
      object: {
        id: "line-two",
        label: line2.label || "r2",
        shape: "line",
        color: "#ff7ca8",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        params: { start: segment2.start, end: segment2.end, thickness: 0.08 },
        metadata: { role: "line", roles: ["primary", "line"], direction: roundVec(line2.direction, 4) },
      },
    },
    {
      id: "closest-point-one",
      title: "Closest point on r1",
      purpose: "One endpoint of the shortest connector.",
      optional: true,
      tags: ["helper", "result"],
      roles: ["point", "result"],
      object: {
        id: "closest-point-one",
        label: "A",
        shape: "pointMarker",
        color: "#ffd966",
        position: roundVec(closest.point1, 4),
        rotation: [0, 0, 0],
        params: { radius: 0.12 },
        metadata: { role: "result", roles: ["point", "result"], coordinates: roundVec(closest.point1, 4) },
      },
    },
    {
      id: "closest-point-two",
      title: "Closest point on r2",
      purpose: "The other endpoint of the shortest connector.",
      optional: true,
      tags: ["helper", "result"],
      roles: ["point", "result"],
      object: {
        id: "closest-point-two",
        label: "B",
        shape: "pointMarker",
        color: "#ffd966",
        position: roundVec(closest.point2, 4),
        rotation: [0, 0, 0],
        params: { radius: 0.12 },
        metadata: { role: "result", roles: ["point", "result"], coordinates: roundVec(closest.point2, 4) },
      },
    },
    {
      id: "shortest-segment",
      title: "Shortest distance segment",
      purpose: "The common perpendicular between the skew lines.",
      optional: true,
      tags: ["helper", "measurement"],
      roles: ["measurement", "result"],
      object: {
        id: "shortest-segment",
        label: "Shortest distance",
        shape: "line",
        color: "#ffd966",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        params: { start: roundVec(closest.point1, 4), end: roundVec(closest.point2, 4), thickness: 0.06 },
        metadata: { role: "measurement", roles: ["measurement", "result"] },
      },
    },
  ];

  const sceneOverlays = [
    { id: "analytic-axes", type: "coordinate-frame", bounds },
    { id: "line-one-label", type: "object-label", targetObjectId: "line-one", text: `${line1.label || "r1"}: ${formatLineEquation(line1.point, line1.direction, line1.parameter || "t")}`, offset: [0.3, 0.45, 0.25], style: "name" },
    { id: "line-two-label", type: "object-label", targetObjectId: "line-two", text: `${line2.label || "r2"}: ${formatLineEquation(line2.point, line2.direction, line2.parameter || "s")}`, offset: [0.3, 0.45, 0.25], style: "name" },
    { id: "cross-pointer", type: "arrow", origin: roundVec(add(closest.point1, [1.8, 1.3, 1.4]), 4), target: roundVec(closest.point1, 4), text: "The shortest segment is perpendicular to both skew lines", style: "annotation", color: "#ffd966" },
    { id: "distance-label", type: "text", position: roundVec(add(scale(add(closest.point1, closest.point2), 0.5), [0.3, 0.5, 0.3]), 4), text: `Distance = ${formatNumber(distanceValue, 4)}`, style: "formula" },
  ];

  const cameraBookmarks = [
    { id: "overview", label: "Overview", description: "See both skew lines in the same frame.", ...cameraForBounds(bounds) },
    { id: "connector-view", label: "Shortest Segment", description: "Focus on the common perpendicular.", position: roundVec(add(scale(add(closest.point1, closest.point2), 0.5), [3.5, 3, 3.5]), 4), target: roundVec(scale(add(closest.point1, closest.point2), 0.5), 4) },
  ];

  const sceneMoments = buildAnalyticMoments([
    { id: "observe", title: "Observe", prompt: "Rotate the scene. These two lines never meet and they are not parallel, so the shortest distance is not obvious from a flat picture.", goal: "Notice that the lines are skew: separate, non-parallel, and non-intersecting.", focusTargets: ["line-one", "line-two"], visibleObjectIds: ["line-one", "line-two"], visibleOverlayIds: ["analytic-axes", "line-one-label", "line-two-label"], cameraBookmarkId: "overview" },
    { id: "relate", title: "Relate", prompt: "The shortest distance comes from the common perpendicular. It must be perpendicular to both direction vectors at once.", goal: "Connect the shortest segment to a direction perpendicular to both lines.", focusTargets: ["line-one", "line-two"], visibleObjectIds: ["line-one", "line-two"], visibleOverlayIds: ["analytic-axes", "line-one-label", "line-two-label", "cross-pointer"], cameraBookmarkId: "overview" },
    { id: "formula", title: "Formula", prompt: "Use v1 x v2 to get a direction perpendicular to both lines, then project the separation vector onto that perpendicular direction.", goal: "Map the common perpendicular idea onto the cross-product distance formula.", focusTargets: ["line-one", "line-two"], visibleObjectIds: ["line-one", "line-two"], visibleOverlayIds: ["analytic-axes", "line-one-label", "line-two-label"], cameraBookmarkId: "overview", revealFormula: true },
    { id: "solve", title: "Solve", prompt: "Now reveal the actual shortest segment. It lands at the closest points on each line and its length matches the formula result.", goal: "Compare the computed distance to the visible common perpendicular.", focusTargets: ["shortest-segment", "closest-point-one", "closest-point-two"], visibleObjectIds: ["line-one", "line-two", "closest-point-one", "closest-point-two", "shortest-segment"], visibleOverlayIds: ["analytic-axes", "line-one-label", "line-two-label", "cross-pointer", "distance-label"], cameraBookmarkId: "connector-view", revealFormula: true },
    { id: "explain", title: "Explain", prompt: "Explain why the connector segment is the shortest one: every other segment would include some extra movement along the skew lines instead of only between them.", goal: "State why the common perpendicular gives the minimum distance.", focusTargets: ["shortest-segment", "line-one", "line-two"], visibleObjectIds: ["line-one", "line-two", "closest-point-one", "closest-point-two", "shortest-segment"], visibleOverlayIds: ["analytic-axes", "line-one-label", "line-two-label", "distance-label"], cameraBookmarkId: "connector-view", revealFormula: true, revealFullSolution: true },
  ]);

  const lessonStages = buildAnalyticLessonStages(sceneMoments).map((stage, index) => ({ ...stage, suggestedActions: buildCommonAnalyticActions(index < sceneMoments.length - 1) }));
  const solutionSteps = [
    { id: "step-cross-product", title: "Find a common perpendicular direction", formula: `v1 x v2 = ${formatVector(roundVec(crossProduct, 4), 4)}`, explanation: "The cross product points in a direction perpendicular to both skew lines." },
    { id: "step-separation", title: "Build the separation vector", formula: `p2 - p1 = ${formatVector(roundVec(delta, 4), 4)}`, explanation: "This vector measures how the two lines are offset from each other." },
    { id: "step-distance-formula", title: "Project onto the perpendicular direction", formula: "distance = |(p2 - p1) · (v1 x v2)| / |v1 x v2|", explanation: "Projecting the separation onto the common perpendicular isolates the shortest gap." },
    { id: "step-answer", title: "Evaluate", formula: `distance = ${formatNumber(distanceValue, 4)}`, explanation: "That value matches the length of the highlighted connector segment." },
  ];

  return normalizeScenePlan({
    ...buildBaseQuestionFields(questionText, "skew_lines_distance", sourceSummary, overview),
    sceneFocus: {
      concept: "skew lines distance",
      primaryInsight: "The shortest distance between skew lines is the length of their common perpendicular.",
      focusPrompt: "Look for the segment that is perpendicular to both lines at the same time.",
      judgeSummary: "The learner rotates the scene, reveals the common perpendicular, and maps it to the cross-product formula.",
    },
    learningMoments: {
      orient: { title: "Observe", coachMessage: sceneMoments[0].prompt, goal: sceneMoments[0].goal, prompt: sceneMoments[0].prompt, insight: "", whyItMatters: "Skew lines are hard to understand from a single 2D sketch." },
      build: { title: "Visual Walkthrough", coachMessage: sceneMoments[0].prompt, goal: sceneMoments[0].goal, prompt: sceneMoments[0].prompt, insight: "", whyItMatters: "The scene is already built so the learner can inspect the relationship directly." },
      predict: { title: "Relate", coachMessage: sceneMoments[1].prompt, goal: sceneMoments[1].goal, prompt: sceneMoments[1].prompt, insight: "The common perpendicular is the geometric idea behind the formula.", whyItMatters: "This is the visual pattern behind the algebra." },
      check: { title: "Formula", coachMessage: sceneMoments[2].prompt, goal: sceneMoments[2].goal, prompt: sceneMoments[2].prompt, insight: "", whyItMatters: "The cross product creates the needed perpendicular direction." },
      reflect: { title: "Explain", coachMessage: sceneMoments[4].prompt, goal: sceneMoments[4].goal, prompt: sceneMoments[4].prompt, insight: "The common perpendicular removes any extra movement along either line.", whyItMatters: "Reflection links the picture to the formula." },
      challenge: { title: "Ask More", coachMessage: "Ask which vector or point the tutor should highlight again.", goal: "Keep the explanation grounded in the shortest segment.", prompt: "What should the tutor zoom in on next?", insight: "", whyItMatters: "The scene stays interactive." },
    },
    objectSuggestions,
    buildSteps: buildMomentSteps(sceneMoments),
    lessonStages,
    cameraBookmarks,
    answerScaffold: {
      finalAnswer: formatNumber(distanceValue, 4),
      unit: "units",
      formula: "distance = |(p2 - p1) · (v1 x v2)| / |v1 x v2|",
      explanation: "Use the cross product to build the common perpendicular direction, then project the separation vector onto it.",
      checks: ["Compute v1 x v2.", "Compute p2 - p1.", "Apply the distance formula and compare it to the connector segment."],
    },
    analyticContext: {
      subtype: "skew_lines_distance",
      entities: {
        points: [
          { id: "closest-point-one", label: "A", coordinates: roundVec(closest.point1, 4) },
          { id: "closest-point-two", label: "B", coordinates: roundVec(closest.point2, 4) },
        ],
        lines: [
          { id: "line-one", label: line1.label || "r1", point: roundVec(line1.point, 4), direction: roundVec(line1.direction, 4) },
          { id: "line-two", label: line2.label || "r2", point: roundVec(line2.point, 4), direction: roundVec(line2.direction, 4) },
        ],
        planes: [],
      },
      derivedValues: {
        crossProduct: roundVec(crossProduct, 6),
        distance: round(distanceValue, 6),
        t: round(closest.t, 6),
        s: round(closest.s, 6),
        closestPointLine1: roundVec(closest.point1, 4),
        closestPointLine2: roundVec(closest.point2, 4),
      },
      formulaCard: {
        title: "Shortest Distance Between Skew Lines",
        formula: "distance = |(p2 - p1) · (v1 x v2)| / |v1 x v2|",
        explanation: "Visually, v1 x v2 points in the only direction perpendicular to both lines. Projecting the separation vector onto that direction measures just the gap between the lines, not any sliding along them.",
      },
      solutionSteps,
    },
    sceneMoments,
    sceneOverlays,
    challengePrompts: [{ id: "analytic-follow-up", prompt: "Why does the shortest segment have to be perpendicular to both skew lines?", expectedKind: "text", expectedAnswer: null, tolerance: 0 }],
    liveChallenge: null,
  });
}
