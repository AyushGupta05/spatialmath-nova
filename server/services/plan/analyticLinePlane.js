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
  dot,
  formatNumber,
  formatVector,
  lineSegmentFromPointDirection,
  magnitude,
  normalize,
  parseDirectionVector,
  parseLineThroughPointDirection,
  parsePlaneEquation,
  planeSizeFromPoints,
  pointOnPlane,
  round,
  roundVec,
  scale,
  sub,
} from "./analyticMath.js";

function commonLearningMoments(sceneMoments, focusInsight, explainInsight) {
  return {
    orient: {
      title: "Observe",
      coachMessage: sceneMoments[0].prompt,
      goal: sceneMoments[0].goal,
      prompt: sceneMoments[0].prompt,
      insight: "",
      whyItMatters: "Seeing the scene first makes the algebra easier to follow.",
    },
    build: {
      title: "Visual Walkthrough",
      coachMessage: sceneMoments[0].prompt,
      goal: sceneMoments[0].goal,
      prompt: sceneMoments[0].prompt,
      insight: "",
      whyItMatters: "The scene is already built, so the learner can focus on reasoning.",
    },
    predict: {
      title: "Relate",
      coachMessage: sceneMoments[1].prompt,
      goal: sceneMoments[1].goal,
      prompt: sceneMoments[1].prompt,
      insight: focusInsight,
      whyItMatters: "This connects the picture to the method.",
    },
    check: {
      title: "Formula",
      coachMessage: sceneMoments[2].prompt,
      goal: sceneMoments[2].goal,
      prompt: sceneMoments[2].prompt,
      insight: "",
      whyItMatters: "This is the bridge from the picture to the algebra.",
    },
    reflect: {
      title: "Explain",
      coachMessage: sceneMoments[4].prompt,
      goal: sceneMoments[4].goal,
      prompt: sceneMoments[4].prompt,
      insight: explainInsight,
      whyItMatters: "Reflection turns the animation into a reusable idea.",
    },
    challenge: {
      title: "Ask More",
      coachMessage: "Ask about any visible vector, point, formula step, or cue.",
      goal: "Keep the explanation grounded in the visible scene.",
      prompt: "What should the tutor zoom in on next?",
      insight: "",
      whyItMatters: "Follow-up questions stay tied to what the learner can see.",
    },
  };
}

function buildMomentSteps(sceneMoments, focusConcept) {
  return sceneMoments.map((moment, index) => ({
    id: moment.id,
    title: moment.title,
    instruction: moment.goal,
    hint: moment.prompt,
    action: index < 2 ? "observe" : "answer",
    focusConcept,
    coachPrompt: moment.prompt,
    suggestedObjectIds: moment.visibleObjectIds,
    requiredObjectIds: [],
    cameraBookmarkId: moment.cameraBookmarkId,
    highlightObjectIds: moment.focusTargets,
  }));
}

export function buildLinePlaneIntersectionPlan(questionText, sourceSummary = {}) {
  const line = parseLineThroughPointDirection(questionText);
  const plane = parsePlaneEquation(questionText);
  if (!line || !plane) return null;

  const denominator = dot(plane.normal, line.direction);
  if (Math.abs(denominator) <= EPSILON) return null;

  const parameterValue = (plane.constant - dot(plane.normal, line.point)) / denominator;
  const intersection = add(line.point, scale(line.direction, parameterValue));
  const planeCenter = magnitude(sub(intersection, line.point)) <= 0.8
    ? intersection
    : pointOnPlane(plane.normal, plane.constant);
  const normalUnit = normalize(plane.normal);
  const lineSegment = lineSegmentFromPointDirection(line.point, line.direction);
  const planeSize = planeSizeFromPoints([line.point, intersection, planeCenter, lineSegment.start, lineSegment.end]);
  const normalEnd = add(planeCenter, scale(normalUnit, Math.max(2.2, planeSize * 0.28)));
  const bounds = buildCoordinateBounds([line.point, intersection, lineSegment.start, lineSegment.end, planeCenter, normalEnd], 2);
  const overview = "Auto-draw the line, plane, and normal so the learner can see why the line already meets the plane at P.";

  const objectSuggestions = [
    {
      id: "line-main",
      title: "Line",
      purpose: "Use the line direction and anchor point to see the path through space.",
      optional: false,
      tags: ["primary", "line"],
      roles: ["primary", "line"],
      object: {
        id: "line-main",
        label: "Line",
        shape: "line",
        color: "#48c9ff",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        params: { start: lineSegment.start, end: lineSegment.end, thickness: 0.08 },
        metadata: { role: "line", roles: ["primary", "line"], direction: roundVec(line.direction, 4) },
      },
    },
    {
      id: "plane-main",
      title: "Plane",
      purpose: "Use the plane patch and its normal to understand orientation.",
      optional: false,
      tags: ["plane", "primary"],
      roles: ["plane", "reference"],
      object: {
        id: "plane-main",
        label: "Plane",
        shape: "plane",
        color: "#7cf7e4",
        position: roundVec(planeCenter, 4),
        rotation: [0, 0, 0],
        params: { width: planeSize, depth: planeSize },
        metadata: { role: "plane", roles: ["plane", "reference"], normal: roundVec(plane.normal, 4), equation: plane.equation },
      },
    },
    {
      id: "point-anchor",
      title: `${line.label} point`,
      purpose: "Mark the point the line passes through.",
      optional: false,
      tags: ["point"],
      roles: ["point", "reference"],
      object: {
        id: "point-anchor",
        label: line.label,
        shape: "pointMarker",
        color: "#ff7ca8",
        position: roundVec(line.point, 4),
        rotation: [0, 0, 0],
        params: { radius: 0.12 },
        metadata: { role: "point", roles: ["point", "reference"], coordinates: roundVec(line.point, 4) },
      },
    },
    {
      id: "normal-guide",
      title: "Normal",
      purpose: "The plane normal shows the direction perpendicular to the plane.",
      optional: false,
      tags: ["helper", "normal"],
      roles: ["normal", "reference"],
      object: {
        id: "normal-guide",
        label: "Normal",
        shape: "line",
        color: "#ffd966",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        params: { start: roundVec(planeCenter, 4), end: roundVec(normalEnd, 4), thickness: 0.06 },
        metadata: { role: "normal", roles: ["normal", "reference"], direction: roundVec(plane.normal, 4) },
      },
    },
    {
      id: "intersection-point",
      title: "Intersection",
      purpose: "Reveal the exact intersection after substitution.",
      optional: true,
      tags: ["helper", "result"],
      roles: ["point", "result"],
      object: {
        id: "intersection-point",
        label: "Intersection",
        shape: "pointMarker",
        color: "#ffd966",
        position: roundVec(intersection, 4),
        rotation: [0, 0, 0],
        params: { radius: 0.13 },
        metadata: { role: "result", roles: ["point", "result"], coordinates: roundVec(intersection, 4) },
      },
    },
  ];

  const solutionSteps = [
    {
      id: "step-line-equation",
      title: "Write the line equation",
      formula: `x = ${formatNumber(line.point[0])} + ${formatNumber(line.direction[0])}t, y = ${formatNumber(line.point[1])} + ${formatNumber(line.direction[1])}t, z = ${formatNumber(line.point[2])} + ${formatNumber(line.direction[2])}t`,
      explanation: `The line passes through ${line.label}${formatVector(line.point)} with direction ${formatVector(line.direction)}.`,
    },
    {
      id: "step-substitute",
      title: "Substitute into the plane",
      formula: `Put the line's x, y, and z expressions into ${plane.equation}.`,
      explanation: "Use the plane equation to test which point on the line lies on the plane.",
    },
    {
      id: "step-solve-parameter",
      title: "Solve for t",
      formula: `t = ${formatNumber(parameterValue, 4)}`,
      explanation: `Solving the substituted equation gives t = ${formatNumber(parameterValue, 4)}.`,
    },
    {
      id: "step-back-substitute",
      title: "Back-substitute",
      formula: `Intersection = ${formatVector(roundVec(intersection, 4), 4)}`,
      explanation: "Substitute the value of t back into the line equation to get the intersection point.",
    },
  ];

  const sceneOverlays = [
    { id: "analytic-axes", type: "coordinate-frame", bounds },
    { id: "line-direction-label", type: "object-label", targetObjectId: "line-main", text: `d = ${formatVector(line.direction, 3)}`, offset: [0.2, 0.4, 0.2], style: "name" },
    { id: "plane-equation-label", type: "text", position: roundVec(add(planeCenter, [0, Math.max(1.2, planeSize * 0.18), 0]), 4), text: plane.equation, style: "formula" },
    { id: "point-anchor-label", type: "point-label", position: roundVec(add(line.point, [0.2, 0.35, 0.2]), 4), text: `${line.label}${formatVector(line.point, 3)}`, style: "name" },
    { id: "normal-label", type: "object-label", targetObjectId: "normal-guide", text: `n = ${formatVector(plane.normal, 3)}`, offset: [0.2, 0.4, 0.2], style: "annotation" },
    { id: "normal-pointer", type: "arrow", origin: roundVec(add(planeCenter, scale(normalUnit, planeSize * 0.22)), 4), target: roundVec(add(planeCenter, scale(normalUnit, planeSize * 0.52)), 4), text: "The normal sets the plane's orientation", style: "annotation", color: "#ffd966" },
    { id: "substitution-pointer", type: "arrow", origin: roundVec(add(intersection, [1.5, 1.3, 1.5]), 4), target: roundVec(intersection, 4), text: "Substituting shows the line already hits the plane here", style: "annotation", color: "#ffd966" },
    { id: "intersection-label", type: "point-label", position: roundVec(add(intersection, [0.25, 0.45, 0.25]), 4), text: `Intersection = ${formatVector(roundVec(intersection, 3), 3)}`, style: "formula" },
  ];

  const cameraBookmarks = [
    { id: "overview", label: "Overview", description: "See the line, plane, and point together.", ...cameraForBounds(bounds) },
    { id: "normal-view", label: "Normal", description: "Frame the plane normal and plane patch.", position: roundVec(add(planeCenter, [planeSize * 0.9, planeSize * 0.8, planeSize * 0.9]), 4), target: roundVec(planeCenter, 4) },
    { id: "intersection-view", label: "Intersection", description: "Frame the line-plane contact point.", position: roundVec(add(intersection, [planeSize * 0.6, planeSize * 0.5, planeSize * 0.6]), 4), target: roundVec(intersection, 4) },
  ];

  const sceneMoments = buildAnalyticMoments([
    { id: "observe", title: "Observe", prompt: "Here's the line and the plane. Rotate the scene and notice how the line sits relative to the plane before we reveal any helpers.", goal: "See the two main objects clearly: one line and one plane.", focusTargets: ["line-main", "plane-main"], visibleObjectIds: ["line-main", "plane-main"], visibleOverlayIds: ["line-direction-label", "plane-equation-label"], cameraBookmarkId: "overview" },
    { id: "relate", title: "Relate", prompt: "Now reveal the anchor point and the plane's normal. The point shows where the line starts, and the normal shows how the plane is oriented.", goal: "Connect the line's direction and anchor point to the plane's orientation.", focusTargets: ["point-anchor", "normal-guide", "plane-main"], visibleObjectIds: ["line-main", "plane-main", "point-anchor", "normal-guide"], visibleOverlayIds: ["analytic-axes", "line-direction-label", "plane-equation-label", "point-anchor-label", "normal-label", "normal-pointer"], cameraBookmarkId: "normal-view" },
    { id: "formula", title: "Formula", prompt: "First write the vector equation of the line, then substitute those x, y, and z expressions into the plane equation.", goal: "Use substitution to turn the 3D picture into a one-variable equation.", focusTargets: ["line-main", "point-anchor"], visibleObjectIds: ["line-main", "plane-main", "point-anchor", "normal-guide"], visibleOverlayIds: ["analytic-axes", "line-direction-label", "plane-equation-label", "point-anchor-label", "normal-label"], cameraBookmarkId: "overview", revealFormula: true },
    { id: "solve", title: "Solve", prompt: "Solve for t, then look back at the scene. The highlighted point is where the line satisfies the plane equation.", goal: "Match the solved value of t to the actual point in 3D.", focusTargets: ["intersection-point", "point-anchor", "line-main"], visibleObjectIds: ["line-main", "plane-main", "point-anchor", "normal-guide", "intersection-point"], visibleOverlayIds: ["analytic-axes", "line-direction-label", "plane-equation-label", "point-anchor-label", "intersection-label", "substitution-pointer"], cameraBookmarkId: "intersection-view", revealFormula: true },
    { id: "explain", title: "Explain", prompt: "Explain why the answer makes sense from the picture: the line already passes through a point that lies on the plane.", goal: "State the geometric meaning of the algebra in one sentence.", focusTargets: ["intersection-point", "plane-main", "line-main"], visibleObjectIds: ["line-main", "plane-main", "point-anchor", "normal-guide", "intersection-point"], visibleOverlayIds: ["analytic-axes", "line-direction-label", "plane-equation-label", "point-anchor-label", "intersection-label"], cameraBookmarkId: "intersection-view", revealFormula: true, revealFullSolution: true },
  ]);

  const lessonStages = buildAnalyticLessonStages(sceneMoments).map((stage, index) => ({ ...stage, suggestedActions: buildCommonAnalyticActions(index < sceneMoments.length - 1) }));

  return normalizeScenePlan({
    ...buildBaseQuestionFields(questionText, "line_plane_intersection", sourceSummary, overview),
    sceneFocus: {
      concept: "line-plane intersection",
      primaryInsight: "The line intersects the plane exactly where its parametric coordinates satisfy the plane equation.",
      focusPrompt: "Notice how the line direction and plane normal control the contact point.",
      judgeSummary: "The learner rotates the scene, sees the plane normal, and connects substitution to the highlighted intersection point.",
    },
    learningMoments: commonLearningMoments(sceneMoments, "The plane normal is the orientation clue.", "The line already contains a point that lies on the plane."),
    objectSuggestions,
    buildSteps: buildMomentSteps(sceneMoments, "line-plane intersection"),
    lessonStages,
    cameraBookmarks,
    answerScaffold: {
      finalAnswer: formatVector(roundVec(intersection, 4), 4),
      unit: "",
      formula: `n · (${formatVector(line.point)} + t${formatVector(line.direction)}) = ${formatNumber(plane.constant)}`,
      explanation: "Write the line parametrically, substitute into the plane equation, solve for t, then substitute back for the intersection point.",
      checks: ["Write the vector equation of the line.", "Substitute x, y, and z into the plane equation.", "Solve for t and substitute back into the line."],
    },
    analyticContext: {
      subtype: "line_plane_intersection",
      entities: {
        points: [{ id: "point-anchor", label: line.label, coordinates: roundVec(line.point, 4) }],
        lines: [{ id: "line-main", label: "Line", point: roundVec(line.point, 4), direction: roundVec(line.direction, 4) }],
        planes: [{ id: "plane-main", label: "Plane", normal: roundVec(plane.normal, 4), constant: round(plane.constant, 4) }],
      },
      derivedValues: { parameterValue: round(parameterValue, 6), intersection: roundVec(intersection, 4) },
      formulaCard: {
        title: "Line-Plane Intersection",
        formula: `n · (${formatVector(line.point)} + t${formatVector(line.direction)}) = ${formatNumber(plane.constant)}`,
        explanation: "Visually, this tracks the moving point on the line until it lands on the plane. The value of t picks the exact spot where the line finally satisfies the plane equation.",
      },
      solutionSteps,
    },
    sceneMoments,
    sceneOverlays,
    challengePrompts: [{ id: "analytic-follow-up", prompt: "How can you tell from the scene that the line already contains a point on the plane?", expectedKind: "text", expectedAnswer: null, tolerance: 0 }],
    liveChallenge: null,
  });
}

export function buildLinePlaneAnglePlan(questionText, sourceSummary = {}) {
  const direction = parseDirectionVector(questionText);
  const plane = parsePlaneEquation(questionText);
  if (!direction || !plane) return null;

  const linePoint = [0, 0, 0];
  const lineSegment = lineSegmentFromPointDirection(linePoint, direction, 4.8);
  const planeCenter = pointOnPlane(plane.normal, plane.constant);
  const planeSize = planeSizeFromPoints([linePoint, lineSegment.start, lineSegment.end, planeCenter]);
  const normalUnit = normalize(plane.normal);
  const normalEnd = add(planeCenter, scale(normalUnit, Math.max(2.4, planeSize * 0.3)));
  const sineRatio = Math.abs(dot(direction, plane.normal)) / Math.max(EPSILON, magnitude(direction) * magnitude(plane.normal));
  const angleRadians = Math.asin(Math.min(1, Math.max(0, sineRatio)));
  const angleDegrees = angleRadians * 180 / Math.PI;
  const normalAngleDegrees = 90 - angleDegrees;
  const bounds = buildCoordinateBounds([linePoint, lineSegment.start, lineSegment.end, planeCenter, normalEnd], 3);
  const overview = "Auto-draw the line, plane, and normal so the learner can see that the line-plane angle is the complement of the line-normal angle.";

  const objectSuggestions = [
    {
      id: "line-main",
      title: "Line",
      purpose: "Use the line direction vector to show the line's orientation.",
      optional: false,
      tags: ["primary", "line"],
      roles: ["primary", "line"],
      object: {
        id: "line-main",
        label: "Line",
        shape: "line",
        color: "#48c9ff",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        params: { start: lineSegment.start, end: lineSegment.end, thickness: 0.08 },
        metadata: { role: "line", roles: ["primary", "line"], direction: roundVec(direction, 4) },
      },
    },
    {
      id: "plane-main",
      title: "Plane",
      purpose: "Use the plane patch to understand the reference surface.",
      optional: false,
      tags: ["plane", "primary"],
      roles: ["plane", "reference"],
      object: {
        id: "plane-main",
        label: "Plane",
        shape: "plane",
        color: "#7cf7e4",
        position: roundVec(planeCenter, 4),
        rotation: [0, 0, 0],
        params: { width: planeSize, depth: planeSize },
        metadata: { role: "plane", roles: ["plane", "reference"], normal: roundVec(plane.normal, 4), equation: plane.equation },
      },
    },
    {
      id: "normal-guide",
      title: "Normal",
      purpose: "The normal is the perpendicular reference needed for the angle relationship.",
      optional: false,
      tags: ["helper", "normal"],
      roles: ["normal", "reference"],
      object: {
        id: "normal-guide",
        label: "Normal",
        shape: "line",
        color: "#ffd966",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        params: { start: roundVec(planeCenter, 4), end: roundVec(normalEnd, 4), thickness: 0.06 },
        metadata: { role: "normal", roles: ["normal", "reference"], direction: roundVec(plane.normal, 4) },
      },
    },
  ];

  const sceneOverlays = [
    { id: "analytic-axes", type: "coordinate-frame", bounds },
    { id: "line-direction-label", type: "object-label", targetObjectId: "line-main", text: `d = ${formatVector(direction, 3)}`, offset: [0.2, 0.4, 0.2], style: "name" },
    { id: "plane-equation-label", type: "text", position: roundVec(add(planeCenter, [0, Math.max(1.2, planeSize * 0.18), 0]), 4), text: plane.equation, style: "formula" },
    { id: "normal-label", type: "object-label", targetObjectId: "normal-guide", text: `n = ${formatVector(plane.normal, 3)}`, offset: [0.25, 0.35, 0.2], style: "annotation" },
    { id: "complement-pointer", type: "arrow", origin: roundVec(add(planeCenter, [planeSize * 0.45, planeSize * 0.45, planeSize * 0.45]), 4), target: roundVec(planeCenter, 4), text: "Find the angle to the normal first, then take the complement", style: "annotation", color: "#ffd966" },
    { id: "angle-result-label", type: "text", position: roundVec(add(planeCenter, [0.4, 1.2, 0.4]), 4), text: `Angle with plane ≈ ${formatNumber(angleDegrees, 3)}°`, style: "formula" },
  ];

  const cameraBookmarks = [
    { id: "overview", label: "Overview", description: "See the line, plane, and normal together.", ...cameraForBounds(bounds) },
    { id: "normal-view", label: "Normal", description: "Focus on the line and the plane normal.", position: roundVec(add(planeCenter, [planeSize, planeSize * 0.75, planeSize * 0.9]), 4), target: roundVec(planeCenter, 4) },
  ];

  const sceneMoments = buildAnalyticMoments([
    { id: "observe", title: "Observe", prompt: "Here's the line and the plane. Rotate the scene and notice their orientations before we introduce the normal.", goal: "See the line and plane clearly before adding helper vectors.", focusTargets: ["line-main", "plane-main"], visibleObjectIds: ["line-main", "plane-main"], visibleOverlayIds: ["line-direction-label", "plane-equation-label"], cameraBookmarkId: "overview" },
    { id: "relate", title: "Relate", prompt: "Now reveal the normal. The angle between a line and a plane is understood through the plane's normal, then interpreted as a complement.", goal: "Notice that the line-plane angle is complementary to the line-normal angle.", focusTargets: ["line-main", "normal-guide"], visibleObjectIds: ["line-main", "plane-main", "normal-guide"], visibleOverlayIds: ["analytic-axes", "line-direction-label", "plane-equation-label", "normal-label", "complement-pointer"], cameraBookmarkId: "normal-view" },
    { id: "formula", title: "Formula", prompt: "Use sin(theta) = |d · n| / (|d||n|) for the line-plane angle, or find the angle to the normal and subtract from 90°.", goal: "Connect the dot product to the visible line and normal directions.", focusTargets: ["line-main", "normal-guide"], visibleObjectIds: ["line-main", "plane-main", "normal-guide"], visibleOverlayIds: ["analytic-axes", "line-direction-label", "plane-equation-label", "normal-label"], cameraBookmarkId: "normal-view", revealFormula: true },
    { id: "solve", title: "Solve", prompt: "Compute the dot product and magnitudes, then compare the number to the small acute angle you can see in the scene.", goal: "Use the formula to get the angle numerically.", focusTargets: ["line-main", "normal-guide"], visibleObjectIds: ["line-main", "plane-main", "normal-guide"], visibleOverlayIds: ["analytic-axes", "line-direction-label", "plane-equation-label", "normal-label", "angle-result-label"], cameraBookmarkId: "normal-view", revealFormula: true },
    { id: "explain", title: "Explain", prompt: "Explain why the angle to the plane is small: the line is almost perpendicular to the normal, so it sits nearly along the plane.", goal: "State the complement relationship in your own words.", focusTargets: ["line-main", "plane-main", "normal-guide"], visibleObjectIds: ["line-main", "plane-main", "normal-guide"], visibleOverlayIds: ["analytic-axes", "line-direction-label", "plane-equation-label", "normal-label", "angle-result-label"], cameraBookmarkId: "overview", revealFormula: true, revealFullSolution: true },
  ]);

  const lessonStages = buildAnalyticLessonStages(sceneMoments).map((stage, index) => ({ ...stage, suggestedActions: buildCommonAnalyticActions(index < sceneMoments.length - 1) }));
  const solutionSteps = [
    { id: "step-normal", title: "Read the normal", formula: `n = ${formatVector(plane.normal, 3)}`, explanation: "The coefficients of the plane equation give the normal vector." },
    { id: "step-angle-formula", title: "Choose the formula", formula: "sin(theta) = |d · n| / (|d||n|)", explanation: "This directly gives the acute angle between the line and the plane." },
    { id: "step-substitute", title: "Substitute values", formula: `sin(theta) = ${formatNumber(Math.abs(dot(direction, plane.normal)), 3)} / (${formatNumber(magnitude(direction), 3)} x ${formatNumber(magnitude(plane.normal), 3)})`, explanation: "Use the dot product and vector lengths from the givens." },
    { id: "step-answer", title: "Solve", formula: `theta ≈ ${formatNumber(angleDegrees, 3)}°`, explanation: `The line-plane angle is about ${formatNumber(angleDegrees, 3)} degrees. The angle with the normal is about ${formatNumber(normalAngleDegrees, 3)} degrees.` },
  ];

  return normalizeScenePlan({
    ...buildBaseQuestionFields(questionText, "line_plane_angle", sourceSummary, overview),
    sceneFocus: {
      concept: "line-plane angle",
      primaryInsight: "The angle between a line and a plane is found through the plane's normal, then interpreted as a complement.",
      focusPrompt: "Compare the line direction to the plane normal before using the formula.",
      judgeSummary: "The learner rotates the scene, spots the normal, and then connects the acute angle to the dot-product formula.",
    },
    learningMoments: commonLearningMoments(sceneMoments, "The complement relationship is the key idea.", "The normal is the bridge between the plane and the formula."),
    objectSuggestions,
    buildSteps: buildMomentSteps(sceneMoments, "line-plane angle"),
    lessonStages,
    cameraBookmarks,
    answerScaffold: {
      finalAnswer: `${formatNumber(angleDegrees, 3)}°`,
      unit: "degrees",
      formula: "sin(theta) = |d · n| / (|d||n|)",
      explanation: "Use the plane normal from the equation, then compute the acute line-plane angle with the dot product relationship.",
      checks: ["Find the plane normal.", "Apply the line-plane angle formula.", "Interpret the result as the acute angle to the plane."],
    },
    analyticContext: {
      subtype: "line_plane_angle",
      entities: {
        points: [],
        lines: [{ id: "line-main", label: "Line", point: linePoint, direction: roundVec(direction, 4) }],
        planes: [{ id: "plane-main", label: "Plane", normal: roundVec(plane.normal, 4), constant: round(plane.constant, 4) }],
      },
      derivedValues: { dotProduct: round(dot(direction, plane.normal), 6), sineRatio: round(sineRatio, 6), angleDegrees: round(angleDegrees, 6), normalAngleDegrees: round(normalAngleDegrees, 6) },
      formulaCard: {
        title: "Angle Between a Line and a Plane",
        formula: "sin(theta) = |d · n| / (|d||n|)",
        explanation: "Visually, the normal gives the plane a direction to compare against the line. The dot product measures that alignment, then the acute complement gives the angle to the plane itself.",
      },
      solutionSteps,
    },
    sceneMoments,
    sceneOverlays,
    challengePrompts: [{ id: "analytic-follow-up", prompt: "Why do we use the plane normal instead of the plane equation directly?", expectedKind: "text", expectedAnswer: null, tolerance: 0 }],
    liveChallenge: null,
  });
}
