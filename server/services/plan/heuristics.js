import { normalizeScenePlan } from "../../../src/ai/planSchema.js";
import { defaultPositionForShape, defaultParamsForShape } from "../../../src/scene/schema.js";

const DEFAULT_COLORS = ["#7cf7e4", "#48c9ff", "#ffd966", "#ff7ca8", "#b088f9"];

function extractNumber(text, patterns, fallback) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return fallback;
}

function inferQuestionType(question) {
  const lower = question.toLowerCase();
  if (lower.includes("surface area")) return "surface_area";
  if (lower.includes("volume")) return "volume";
  if (lower.includes("compare") || lower.includes("greater")) return "comparison";
  if (lower.includes("composite") || lower.includes("together")) return "composite";
  if (
    lower.includes("distance")
    || lower.includes("angle")
    || lower.includes("intersect")
    || lower.includes("projection")
    || lower.includes("vector")
    || lower.includes("plane")
    || lower.includes("line")
  ) {
    return "spatial";
  }
  return "spatial";
}

function inferShape(question) {
  const lower = question.toLowerCase();
  if (lower.includes("rectangular prism") || lower.includes("cuboid")) return "cuboid";
  if (lower.includes("cylinder")) return "cylinder";
  if (lower.includes("sphere")) return "sphere";
  if (lower.includes("cone")) return "cone";
  if (lower.includes("pyramid")) return "pyramid";
  if (lower.includes("vector") || lower.includes("line")) return "line";
  if (lower.includes("plane")) return "plane";
  if (lower.includes("point")) return "pointMarker";
  if (lower.includes("cube")) return "cube";
  return "plane";
}

function inferSupportingSolid(question) {
  const lower = question.toLowerCase();
  if (lower.includes("rectangular prism") || lower.includes("cuboid")) return "cuboid";
  if (lower.includes("cylinder")) return "cylinder";
  if (lower.includes("sphere")) return "sphere";
  if (lower.includes("cone")) return "cone";
  if (lower.includes("pyramid")) return "pyramid";
  if (lower.includes("cube")) return "cube";
  if (lower.includes("line")) return "line";
  return null;
}

function buildPrimaryObject(question, shape) {
  const color = DEFAULT_COLORS[0];
  const params = defaultParamsForShape(shape);

  switch (shape) {
    case "cube":
      params.size = extractNumber(question, [/side(?: length)?\s*(?:of|=)?\s*(-?\d+(?:\.\d+)?)/i], params.size);
      break;
    case "cuboid":
      params.width = extractNumber(question, [/width\s*(?:of|=)?\s*(-?\d+(?:\.\d+)?)/i], params.width);
      params.height = extractNumber(question, [/height\s*(?:of|=)?\s*(-?\d+(?:\.\d+)?)/i], params.height);
      params.depth = extractNumber(question, [/(?:depth|length)\s*(?:of|=)?\s*(-?\d+(?:\.\d+)?)/i], params.depth);
      break;
    case "sphere":
      params.radius = extractNumber(question, [/radius\s*(?:of|=)?\s*(-?\d+(?:\.\d+)?)/i], params.radius);
      break;
    case "cylinder":
    case "cone":
      params.radius = extractNumber(question, [/radius\s*(?:of|=)?\s*(-?\d+(?:\.\d+)?)/i], params.radius);
      params.height = extractNumber(question, [/height\s*(?:of|=)?\s*(-?\d+(?:\.\d+)?)/i], params.height);
      break;
    case "pyramid":
      params.base = extractNumber(question, [/(?:base|side(?: length)?)\s*(?:of|=)?\s*(-?\d+(?:\.\d+)?)/i], params.base);
      params.height = extractNumber(question, [/height\s*(?:of|=)?\s*(-?\d+(?:\.\d+)?)/i], params.height);
      break;
    case "plane":
      params.width = extractNumber(question, [/width\s*(?:of|=)?\s*(-?\d+(?:\.\d+)?)/i], params.width);
      params.depth = extractNumber(question, [/(?:depth|length)\s*(?:of|=)?\s*(-?\d+(?:\.\d+)?)/i], params.depth);
      break;
    case "line":
      params.start = [0, 0.03, 0];
      params.end = [extractNumber(question, [/(?:length|magnitude)\s*(?:of|=)?\s*(-?\d+(?:\.\d+)?)/i], 1.4), 0.03, 0];
      params.thickness = 0.08;
      break;
    case "pointMarker":
      params.radius = 0.1;
      break;
    default:
      break;
  }

  return {
    id: "primary-object",
    label: shape === "pointMarker" ? "P" : "A",
    shape,
    color,
    position: defaultPositionForShape(shape, params),
    rotation: [0, 0, 0],
    params,
    metadata: { role: "primary", roles: ["primary", shape === "pointMarker" ? "point" : shape] },
  };
}

function buildLineSuggestion({ id, title, purpose, color, start, end, roles, optional = false }) {
  return {
    id,
    title,
    purpose,
    optional,
    tags: ["helper", "measurement"],
    roles,
    object: {
      id: `${id}-object`,
      label: title,
      shape: "line",
      color,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      params: {
        start,
        end,
        thickness: 0.08,
      },
      metadata: { role: roles[0], roles },
    },
  };
}

function buildPointSuggestion({ id, label, position, color = DEFAULT_COLORS[3], optional = true, purpose = "Mark a reference point to talk about the scene.", roles = ["point", "reference"] }) {
  return {
    id,
    title: `${label} point`,
    purpose,
    optional,
    tags: ["helper"],
    roles,
    object: {
      id: `${id}-object`,
      label,
      shape: "pointMarker",
      color,
      position,
      rotation: [0, 0, 0],
      params: { radius: 0.08 },
      metadata: { role: roles[0], roles },
    },
  };
}

function buildHelperSuggestions(primaryObject, question, questionType) {
  const helpers = [];
  const { shape, params, position } = primaryObject;
  const lower = question.toLowerCase();

  if (["cylinder", "cone", "sphere"].includes(shape)) {
    const radius = params.radius || 0.5;
    helpers.push(buildLineSuggestion({
      id: "radius-helper",
      title: "Radius marker",
      purpose: "Show the radius so the learner can connect the visible measurement to the formula.",
      color: DEFAULT_COLORS[1],
      start: [position[0], position[1], position[2]],
      end: [position[0] + radius, position[1], position[2]],
      roles: ["radius", "measurement"],
    }));
  }

  if (["cylinder", "cone", "pyramid", "cuboid"].includes(shape)) {
    const height = params.height || 1;
    helpers.push(buildLineSuggestion({
      id: "height-helper",
      title: "Height marker",
      purpose: "Make the vertical measurement explicit before solving.",
      color: DEFAULT_COLORS[2],
      start: [position[0], 0, position[2]],
      end: [position[0], height, position[2]],
      roles: ["height", "measurement"],
    }));
  }

  if (shape === "plane" || lower.includes("normal")) {
    helpers.push(buildLineSuggestion({
      id: "normal-helper",
      title: "Normal guide",
      purpose: "Use this line to show which direction is perpendicular to the plane.",
      color: DEFAULT_COLORS[4],
      start: [position[0], position[1], position[2]],
      end: [position[0], position[1] + 1.6, position[2]],
      roles: ["normal", "reference"],
      optional: !lower.includes("normal"),
    }));
  }

  if (shape === "line" || questionType === "spatial" || lower.includes("point") || lower.includes("projection") || lower.includes("intersect")) {
    helpers.push(buildPointSuggestion({
      id: "anchor-point",
      label: "P",
      position: [0.2, 0.12, 0.2],
      optional: false,
      purpose: "Mark a reference point so the tutor can talk about intersections, projections, or distances.",
      roles: ["point", "reference"],
    }));
  }

  if (lower.includes("projection")) {
    helpers.push(buildLineSuggestion({
      id: "projection-helper",
      title: "Projection guide",
      purpose: "Use this helper to compare the original direction with its projected direction.",
      color: DEFAULT_COLORS[2],
      start: [0, 0.03, 0],
      end: [1.2, 0.03, 1.2],
      roles: ["projection", "reference"],
      optional: true,
    }));
  }

  return helpers;
}

function formulaForShape(shape, questionType) {
  if (questionType === "surface_area") {
    switch (shape) {
      case "cube": return "SA = 6s^2";
      case "cuboid": return "SA = 2(wh + wd + hd)";
      case "sphere": return "SA = 4pi r^2";
      case "cylinder": return "SA = 2pi r(r + h)";
      case "cone": return "SA = pi r(r + sqrt(r^2 + h^2))";
      case "pyramid": return "SA = b^2 + 2bl";
      case "plane": return "A = width * depth";
      default: return "";
    }
  }

  switch (shape) {
    case "cube": return "V = s^3";
    case "cuboid": return "V = w * h * d";
    case "sphere": return "V = (4/3)pi r^3";
    case "cylinder": return "V = pi r^2 h";
    case "cone": return "V = (1/3)pi r^2 h";
    case "pyramid": return "V = (1/3)b^2 h";
    default: return "";
  }
}

function inferSceneFocus(question, shape, questionType, sourceSummary, helperSuggestions = []) {
  const lower = question.toLowerCase();
  if (lower.includes("radius") && lower.includes("height")) {
    return {
      concept: "radius vs height",
      primaryInsight: "Radius and height affect the same formula in different ways.",
      focusPrompt: "Focus on which visible measurement is radial and which is vertical.",
      judgeSummary: "The student identifies the right measurements in the 3D scene before solving.",
    };
  }
  if (lower.includes("normal")) {
    return {
      concept: "plane normal direction",
      primaryInsight: "The normal shows the plane's orientation and helps with angles and distances.",
      focusPrompt: "Focus on the direction perpendicular to the plane.",
      judgeSummary: "The scene makes the plane orientation visible instead of leaving it abstract.",
    };
  }
  if (lower.includes("projection")) {
    return {
      concept: "projection",
      primaryInsight: "Compare the original direction with the shadow it casts onto the reference object.",
      focusPrompt: "Focus on what stays and what disappears in the projection.",
      judgeSummary: "The student predicts a projection, then checks it in the scene.",
    };
  }
  if (lower.includes("intersect") || (lower.includes("line") && lower.includes("plane"))) {
    return {
      concept: "intersection geometry",
      primaryInsight: "The key idea is where two spatial objects meet and what direction controls that meeting.",
      focusPrompt: "Focus on the contact point or overlap between the objects.",
      judgeSummary: "The student builds the scene and checks the spatial relationship directly.",
    };
  }
  if (questionType === "comparison") {
    return {
      concept: "parameter effect",
      primaryInsight: "Compare which visible change has the bigger effect before you calculate.",
      focusPrompt: "Focus on the parameter that changes the result most strongly.",
      judgeSummary: "The demo shows prediction first, then scene feedback on the parameter change.",
    };
  }
  if (questionType === "volume") {
    return {
      concept: `${shape} volume`,
      primaryInsight: helperSuggestions.some((item) => item.roles?.includes("radius"))
        ? "Use the helper measurements to see how the formula maps onto the 3D object."
        : "Match each visible dimension to the factor it contributes to the volume.",
      focusPrompt: "Focus on the measurement labels before substituting into the formula.",
      judgeSummary: "The learner builds the object, identifies the right measurements, then predicts before calculating.",
    };
  }
  if (questionType === "surface_area") {
    return {
      concept: `${shape} surface area`,
      primaryInsight: "Surface area depends on the visible faces or curved surfaces, not just the outer size.",
      focusPrompt: "Focus on which surfaces are being counted.",
      judgeSummary: "The scene shows what is being measured, not just the final number.",
    };
  }
  return {
    concept: sourceSummary.diagramSummary ? "spatial relationship" : `${shape} structure`,
    primaryInsight: "Use the scene to make the important spatial relationship visible.",
    focusPrompt: "Focus on the one relationship that would be hardest to see on paper.",
    judgeSummary: "The student acts on a scene and Nova responds to that specific action.",
  };
}

function buildLearningMoments({ question, sceneFocus, answerScaffold, buildSteps, liveChallenge }) {
  const firstStep = buildSteps[0] || null;
  const secondStep = buildSteps[1] || null;

  return {
    orient: {
      title: "Orient",
      coachMessage: "Start by naming the main object or relationship in the problem.",
      goal: sceneFocus.focusPrompt,
      prompt: "",
      insight: "",
      whyItMatters: sceneFocus.primaryInsight,
    },
    build: {
      title: "Build / Inspect",
      coachMessage: firstStep?.instruction || "Build or inspect the scene one piece at a time.",
      goal: secondStep?.title || firstStep?.title || "Place the key objects and helpers.",
      prompt: "",
      insight: "",
      whyItMatters: "A clean scene makes the math visible before calculation starts.",
    },
    predict: {
      title: "Predict",
      coachMessage: "Pause before explaining and make a short prediction from the scene.",
      goal: "Use what you can see to make one concrete claim.",
      prompt: liveChallenge?.prompt || sceneFocus.focusPrompt || `What matters most in ${question}?`,
      insight: "",
      whyItMatters: "Prediction turns the scene into active reasoning instead of passive viewing.",
    },
    check: {
      title: "Check",
      coachMessage: "Manipulate or inspect the scene to test your prediction.",
      goal: "Select, rotate, or adjust the object that controls the idea.",
      prompt: "",
      insight: "",
      whyItMatters: "Checking gives immediate evidence from the scene.",
    },
    reflect: {
      title: "Reflect",
      coachMessage: "Capture the key idea in one short sentence.",
      goal: answerScaffold.formula
        ? `Connect the scene to ${answerScaffold.formula}.`
        : "State the main spatial relationship you just confirmed.",
      prompt: "",
      insight: sceneFocus.primaryInsight,
      whyItMatters: "Reflection helps the visual pattern become reusable knowledge.",
    },
    challenge: {
      title: "Challenge",
      coachMessage: liveChallenge?.prompt || "Try one short follow-up that reinforces the same idea.",
      goal: liveChallenge?.title || "Transfer the same idea to a small variation.",
      prompt: liveChallenge?.prompt || "Change one parameter and predict what happens next.",
      insight: "",
      whyItMatters: "A small challenge shows whether the understanding transfers.",
    },
  };
}

export function heuristicSourceSummary({ questionText = "", imageAsset = null }) {
  const rawQuestion = questionText.trim();
  const givens = [];
  const labels = [];
  const relationships = [];

  const numberMatches = rawQuestion.match(/\b(?:radius|height|width|depth|length|side|angle|distance)\b[^.,;:]*/gi) || [];
  givens.push(...numberMatches);

  const labelMatches = rawQuestion.match(/\b[A-Z](?:\d+)?\b/g) || [];
  labels.push(...labelMatches);

  if (/\bline\b/i.test(rawQuestion) && /\bplane\b/i.test(rawQuestion)) relationships.push("line-plane relationship");
  if (/\bprojection\b/i.test(rawQuestion)) relationships.push("projection relationship");
  if (/\bnormal\b/i.test(rawQuestion)) relationships.push("normal direction");
  if (/\bintersect/i.test(rawQuestion)) relationships.push("intersection point");

  return {
    inputMode: imageAsset ? (rawQuestion ? "multimodal" : "image") : "text",
    rawQuestion,
    cleanedQuestion: rawQuestion || "Interpret the uploaded spatial maths diagram.",
    givens: [...new Set(givens)],
    labels: [...new Set(labels)],
    relationships: [...new Set(relationships)],
    diagramSummary: imageAsset ? "Uploaded worksheet or diagram provided by the learner." : "",
    conflicts: [],
  };
}

export function heuristicPlan(question, mode = "guided", sourceSummary = null) {
  const workingQuestion = (sourceSummary?.cleanedQuestion || question || "").trim();
  const shape = inferShape(workingQuestion);
  const questionType = inferQuestionType(workingQuestion);
  const supportingSolid = workingQuestion.toLowerCase().includes("plane") ? inferSupportingSolid(workingQuestion) : null;
  const primaryShape = supportingSolid && supportingSolid !== shape ? supportingSolid : shape;
  const primaryObject = buildPrimaryObject(workingQuestion, primaryShape);
  const helperSuggestions = buildHelperSuggestions(primaryObject, workingQuestion, questionType);
  const objectSuggestions = [{
    id: "primary-object",
    title: `${primaryShape[0].toUpperCase()}${primaryShape.slice(1)} model`,
    purpose: "Start by placing the main object you are reasoning about.",
    optional: false,
    tags: ["primary"],
    roles: ["primary", primaryShape === "pointMarker" ? "point" : primaryShape],
    object: primaryObject,
  }];

  if (supportingSolid && supportingSolid !== shape) {
    const planeObject = buildPrimaryObject(workingQuestion, "plane");
    planeObject.id = "reference-plane";
    planeObject.label = "Plane P";
    planeObject.position = [0, Math.max(1, primaryObject.position[1] || 1), 0];
    planeObject.rotation = [0, 0, Math.PI / 4];
    planeObject.metadata = { role: "plane", roles: ["plane", "reference"] };
    objectSuggestions.push({
      id: "reference-plane",
      title: "Reference plane",
      purpose: "Use the plane with the other object to explore the spatial relationship.",
      optional: false,
      tags: ["plane", "helper"],
      roles: ["plane", "reference"],
      object: planeObject,
    });
  }

  objectSuggestions.push(...helperSuggestions);
  const sceneFocus = inferSceneFocus(workingQuestion, primaryShape, questionType, sourceSummary || {}, helperSuggestions);

  const buildSteps = [
    {
      id: "step-main-object",
      title: "Place the main object",
      instruction: `Add the ${primaryShape === "pointMarker" ? "reference point" : primaryShape} so the scene matches the problem.`,
      hint: "Start with the object or surface named in the problem.",
      action: "add",
      focusConcept: sceneFocus.concept,
      coachPrompt: "Get the main object into the scene first.",
      suggestedObjectIds: ["primary-object"],
      requiredObjectIds: ["primary-object"],
      cameraBookmarkId: "camera-main",
    },
    {
      id: "step-key-helpers",
      title: "Add the key helpers",
      instruction: helperSuggestions.length
        ? "Place the helper markers that make the important spatial relationship visible."
        : "Inspect the object and identify the dimensions or relationships you will need.",
      hint: "The helpers should point at the exact measurement or direction that matters.",
      action: helperSuggestions.length ? "add" : "observe",
      focusConcept: sceneFocus.concept,
      coachPrompt: "Use helpers only where they clarify the idea.",
      suggestedObjectIds: helperSuggestions.map((helper) => helper.id),
      requiredObjectIds: helperSuggestions.filter((helper) => !helper.optional).map((helper) => helper.id),
      cameraBookmarkId: "camera-main",
    },
    {
      id: "step-scene-reasoning",
      title: "Use the scene to reason",
      instruction: "Once the build looks right, predict what matters most before asking for the explanation.",
      hint: "Pause before solving and name the measurement, relationship, or direction that controls the answer.",
      action: "answer",
      focusConcept: sceneFocus.concept,
      coachPrompt: "Prediction should come before explanation.",
      suggestedObjectIds: objectSuggestions.map((suggestion) => suggestion.id),
      requiredObjectIds: objectSuggestions.filter((suggestion) => !suggestion.optional).map((suggestion) => suggestion.id),
      cameraBookmarkId: "camera-main",
    },
  ];

  const liveChallenge = ["volume", "surface_area"].includes(questionType)
    ? {
      id: `${primaryShape}-live-goal`,
      title: questionType === "surface_area" ? "Adjust the surface area" : "Adjust the volume",
      metric: questionType === "surface_area" ? "surfaceArea" : "volume",
      multiplier: 2,
      prompt: questionType === "surface_area"
        ? `Predict how you could change the ${primaryShape} so its surface area doubles.`
        : `Predict how you could change the ${primaryShape} so its volume doubles.`,
      tolerance: 0.04,
    }
    : null;

  const answerScaffold = {
    finalAnswer: null,
    unit: questionType === "surface_area" ? "square units" : questionType === "volume" ? "cubic units" : "",
    formula: ["volume", "surface_area"].includes(questionType) ? formulaForShape(primaryShape, questionType) : "",
    explanation: ["volume", "surface_area"].includes(questionType)
      ? `Use the visible measurements in the scene to populate the ${questionType.replace("_", " ")} formula.`
      : "Use the scene to describe the spatial relationship before computing.",
    checks: [
      `Does the scene include the main ${primaryShape === "pointMarker" ? "point" : primaryShape}?`,
      "Are the important measurements or directions visible?",
      "Can you explain what matters before calculating?",
    ],
  };

  return normalizeScenePlan({
    problem: {
      id: `heuristic-${primaryShape}`,
      question: workingQuestion,
      questionType,
      summary: supportingSolid && supportingSolid !== shape
        ? `Build the ${supportingSolid} with the reference plane, then reason about the spatial relationship.`
        : `Build the ${primaryShape === "pointMarker" ? "reference point" : primaryShape} and the key helpers, then reason from the scene.`,
      mode,
    },
    overview: "Nova turned the question into a guided, editable lesson scene. Build or inspect the scene, make a prediction, then check it in 3D.",
    sourceSummary: sourceSummary || heuristicSourceSummary({ questionText: workingQuestion, imageAsset: null }),
    sceneFocus,
    learningMoments: buildLearningMoments({
      question: workingQuestion,
      sceneFocus,
      answerScaffold,
      buildSteps,
      liveChallenge,
    }),
    objectSuggestions,
    buildSteps,
    cameraBookmarks: [{
      id: "camera-main",
      label: "Focus lesson scene",
      description: "Frame the primary object and its helper markers.",
      position: [8, 6, 8],
      target: [0, primaryObject.position[1], 0],
    }],
    answerScaffold,
    challengePrompts: [{
      id: "final-answer",
      prompt: workingQuestion,
      expectedKind: "numeric",
      expectedAnswer: null,
      tolerance: 0.05,
    }],
    liveChallenge,
  });
}
