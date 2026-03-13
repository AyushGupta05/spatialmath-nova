import { converseNova, MODEL_IDS } from "../middleware/bedrock.js";
import { normalizeScenePlan } from "../../src/ai/planSchema.js";
import { defaultPositionForShape, defaultParamsForShape } from "../../src/scene/schema.js";

const DEFAULT_COLORS = ["#7cf7e4", "#48c9ff", "#ffd966", "#ff7ca8", "#b088f9"];

const PLAN_SYSTEM_PROMPT = `You are designing an interactive spatial reasoning tutor experience.

Return ONLY valid JSON with this exact top-level structure:
{
  "problem": {
    "id": "string",
    "question": "string",
    "questionType": "volume" | "surface_area" | "composite" | "spatial" | "comparison",
    "summary": "string",
    "mode": "guided" | "manual"
  },
  "overview": "short product-oriented overview",
  "objectSuggestions": [
    {
      "id": "string",
      "title": "string",
      "purpose": "string",
      "optional": false,
      "tags": ["primary" | "helper" | "measurement" | "plane" | "challenge"],
      "object": {
        "id": "string",
        "label": "string",
        "shape": "cube" | "cuboid" | "sphere" | "cylinder" | "cone" | "pyramid" | "plane" | "line" | "pointMarker",
        "color": "#hex",
        "position": [x, y, z],
        "rotation": [x, y, z],
        "params": {}
      }
    }
  ],
  "buildSteps": [
    {
      "id": "string",
      "title": "string",
      "instruction": "string",
      "hint": "string",
      "action": "add" | "verify" | "adjust" | "observe" | "answer",
      "suggestedObjectIds": ["string"],
      "requiredObjectIds": ["string"],
      "cameraBookmarkId": "string"
    }
  ],
  "cameraBookmarks": [
    {
      "id": "string",
      "label": "string",
      "description": "string",
      "position": [x, y, z],
      "target": [x, y, z]
    }
  ],
  "answerScaffold": {
    "finalAnswer": null,
    "unit": "string",
    "formula": "string",
    "explanation": "string",
    "checks": ["string"]
  },
  "challengePrompts": [
    {
      "id": "string",
      "prompt": "string",
      "expectedKind": "numeric" | "text",
      "expectedAnswer": null,
      "tolerance": 0.05
    }
  ],
  "liveChallenge": {
    "id": "string",
    "title": "string",
    "metric": "volume" | "surfaceArea",
    "multiplier": 2,
    "prompt": "string",
    "tolerance": 0.04
  }
}

Rules:
- This is a collaborative tutor, not an auto-solver. Propose an interactive build, not a locked final scene.
- Prefer one primary solid plus helper lines, point markers, or planes that a learner can add or inspect.
- Keep objects editable and geometrically meaningful.
- Use canonical params: cube.size, cuboid.width/height/depth, sphere.radius, cylinder.radius/height, cone.radius/height, pyramid.base/height, plane.width/depth, line.start/end/thickness, pointMarker.radius.
- Rest solids on the ground plane and keep the scene compact around the origin.
- Include at least one helper or measurement suggestion when the problem mentions dimensions.
- Build steps should feel like a tutor-led construction sequence.
- Return only JSON.`;

function extractNumber(question, patterns, fallback) {
  for (const pattern of patterns) {
    const match = question.match(pattern);
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
  return "spatial";
}

function inferShape(question) {
  const lower = question.toLowerCase();
  if (lower.includes("rectangular prism") || lower.includes("cuboid")) return "cuboid";
  if (lower.includes("cylinder")) return "cylinder";
  if (lower.includes("sphere")) return "sphere";
  if (lower.includes("cone")) return "cone";
  if (lower.includes("pyramid")) return "pyramid";
  if (lower.includes("plane")) return "plane";
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
    default:
      break;
  }

  return {
    id: "primary-solid",
    label: "A",
    shape,
    color,
    position: defaultPositionForShape(shape, params),
    rotation: [0, 0, 0],
    params,
    metadata: { role: "primary" },
  };
}

function buildHelperSuggestions(primaryObject, questionType) {
  const helpers = [];
  const { shape, params } = primaryObject;

  if (["cylinder", "cone", "sphere"].includes(shape)) {
    const radius = params.radius || 0.5;
    helpers.push({
      id: "radius-helper",
      title: "Radius marker",
      purpose: "Show the radius so the learner can connect the measurement to the formula.",
      optional: false,
      tags: ["helper", "measurement"],
      object: {
        id: "radius-line",
        label: "r",
        shape: "line",
        color: DEFAULT_COLORS[1],
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        params: {
          start: [primaryObject.position[0], primaryObject.position[1], primaryObject.position[2]],
          end: [primaryObject.position[0] + radius, primaryObject.position[1], primaryObject.position[2]],
          thickness: 0.08,
        },
        metadata: { role: "helper", dimension: "radius" },
      },
    });
  }

  if (["cylinder", "cone", "pyramid", "cuboid"].includes(shape)) {
    const height = params.height || 1;
    helpers.push({
      id: "height-helper",
      title: "Height marker",
      purpose: "Make the vertical dimension explicit before solving.",
      optional: false,
      tags: ["helper", "measurement"],
      object: {
        id: "height-line",
        label: "h",
        shape: "line",
        color: DEFAULT_COLORS[2],
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        params: {
          start: [primaryObject.position[0], 0, primaryObject.position[2]],
          end: [primaryObject.position[0], height, primaryObject.position[2]],
          thickness: 0.08,
        },
        metadata: { role: "helper", dimension: "height" },
      },
    });
  }

  if (shape === "plane" || questionType === "spatial") {
    helpers.push({
      id: "anchor-point",
      title: "Anchor point",
      purpose: "Mark a reference point to discuss intersections, projections, or distances.",
      optional: true,
      tags: ["helper", "challenge"],
      object: {
        id: "anchor-point-object",
        label: "P",
        shape: "pointMarker",
        color: DEFAULT_COLORS[3],
        position: [0, 0.08, 0],
        rotation: [0, 0, 0],
        params: { radius: 0.08 },
        metadata: { role: "helper", dimension: "point" },
      },
    });
  }

  return helpers;
}

function formulaForShape(shape, questionType) {
  if (questionType === "surface_area") {
    switch (shape) {
      case "cube": return "SA = 6s^2";
      case "cuboid": return "SA = 2(w h + w d + h d)";
      case "sphere": return "SA = 4 pi r^2";
      case "cylinder": return "SA = 2 pi r (r + h)";
      case "cone": return "SA = pi r (r + sqrt(r^2 + h^2))";
      case "pyramid": return "SA = b^2 + 2 b l";
      case "plane": return "A = width * depth";
      default: return "";
    }
  }

  switch (shape) {
    case "cube": return "V = s^3";
    case "cuboid": return "V = w * h * d";
    case "sphere": return "V = (4/3) pi r^3";
    case "cylinder": return "V = pi r^2 h";
    case "cone": return "V = (1/3) pi r^2 h";
    case "pyramid": return "V = (1/3) b^2 h";
    default: return "";
  }
}

function heuristicPlan(question, mode = "guided") {
  const shape = inferShape(question);
  const questionType = inferQuestionType(question);
  const supportingSolid = question.toLowerCase().includes("plane") ? inferSupportingSolid(question) : null;
  const primaryShape = supportingSolid && supportingSolid !== shape ? supportingSolid : shape;
  const primaryObject = buildPrimaryObject(question, primaryShape);
  const helperSuggestions = buildHelperSuggestions(primaryObject, questionType);
  const objectSuggestions = [{
    id: "primary-solid",
    title: `${primaryShape[0].toUpperCase()}${primaryShape.slice(1)} model`,
    purpose: "Start by placing the main object you are reasoning about.",
    optional: false,
    tags: ["primary"],
    object: primaryObject,
  }];

  if (supportingSolid && supportingSolid !== shape) {
    const planeObject = buildPrimaryObject(question, "plane");
    planeObject.id = "cutting-plane";
    planeObject.label = "Plane P";
    planeObject.position = [0, Math.max(1, primaryObject.position[1] || 1), 0];
    planeObject.rotation = [0, 0, Math.PI / 4];
    objectSuggestions.push({
      id: "cutting-plane",
      title: "Cutting plane",
      purpose: "Use the plane with the solid to explore the cross-section or intersection.",
      optional: false,
      tags: ["plane", "helper"],
      object: planeObject,
    });
  }

  objectSuggestions.push(...helperSuggestions);

  const buildSteps = [
    {
      id: "step-main-shape",
      title: "Place the main shape",
      instruction: `Add the ${shape} so the scene matches the problem statement before solving anything.`,
      hint: "Start with the main solid or reference surface.",
      action: "add",
      suggestedObjectIds: ["primary-solid"],
      requiredObjectIds: ["primary-solid"],
      cameraBookmarkId: "camera-main",
      highlightObjectIds: [primaryObject.id],
    },
    {
      id: "step-measurements",
      title: "Add the key measurements",
      instruction: helperSuggestions.length
        ? "Place the helper markers that show the dimensions you will use in the formula."
        : "Inspect the object and identify the dimensions you will need.",
      hint: "The tutor will verify whether the scene includes the measurements mentioned in the problem.",
      action: helperSuggestions.length ? "add" : "observe",
      suggestedObjectIds: helperSuggestions.map((helper) => helper.id),
      requiredObjectIds: helperSuggestions.filter((helper) => !helper.optional).map((helper) => helper.id),
      cameraBookmarkId: "camera-main",
      highlightObjectIds: helperSuggestions.map((helper) => helper.object.id),
    },
    {
      id: "step-reason",
      title: "Connect the scene to the formula",
      instruction: "Once the build looks right, use the tutor to explain which measurements map into the formula.",
      hint: "This is the moment to check the scene against the knowns and unknown.",
      action: "answer",
      suggestedObjectIds: objectSuggestions.map((suggestion) => suggestion.id),
      requiredObjectIds: objectSuggestions.filter((suggestion) => !suggestion.optional).map((suggestion) => suggestion.id),
      cameraBookmarkId: "camera-main",
      highlightObjectIds: objectSuggestions.map((suggestion) => suggestion.object.id),
    },
  ];

  const tolerance = questionType === "surface_area" ? 0.05 : 0.05;
  const liveChallenge = ["volume", "surface_area"].includes(questionType)
    ? {
      id: `${shape}-live-goal`,
      title: questionType === "surface_area" ? "Double the Surface Area" : "Double the Volume",
      metric: questionType === "surface_area" ? "surfaceArea" : "volume",
      multiplier: 2,
      prompt: questionType === "surface_area"
        ? `Adjust the ${primaryShape} until its surface area doubles.`
        : `Adjust the ${primaryShape} until its volume doubles.`,
      tolerance: 0.04,
    }
    : null;

  return normalizeScenePlan({
    problem: {
      id: `heuristic-${shape}`,
      question,
      questionType,
      summary: supportingSolid && supportingSolid !== shape
        ? `Build the ${supportingSolid} and the cutting plane, then reason about the spatial relationship.`
        : `Build the ${shape} and its measurements, then reason about the ${questionType.replace("_", " ")}.`,
      mode,
    },
    overview: "Nova has interpreted the question into an editable build plan. Add the scene gradually, then let the tutor help you reason with it.",
    objectSuggestions,
    buildSteps,
    cameraBookmarks: [{
      id: "camera-main",
      label: "Focus scene",
      description: "Frame the primary object and its helper dimensions.",
      position: [8, 6, 8],
      target: [0, primaryObject.position[1], 0],
    }],
    answerScaffold: {
      finalAnswer: null,
      unit: questionType === "surface_area" ? "square units" : questionType === "volume" ? "cubic units" : "",
      formula: ["volume", "surface_area"].includes(questionType) ? formulaForShape(primaryShape, questionType) : "",
      explanation: ["volume", "surface_area"].includes(questionType)
        ? `Use the ${primaryShape}'s key measurements from the scene to populate the formula.`
        : "Use the build to describe the spatial relationship before answering.",
      checks: [
        `Does the scene include the main ${primaryShape}?`,
        "Are the given dimensions visible or represented by helper markers?",
        "Can you name the formula before computing?",
      ],
    },
    challengePrompts: [{
      id: "final-answer",
      prompt: question,
      expectedKind: "numeric",
      expectedAnswer: null,
      tolerance,
    }],
    liveChallenge,
  });
}

function cleanupJson(text) {
  let cleaned = String(text || "").trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  return cleaned;
}

async function planFromNova(question, mode, sceneSnapshot) {
  const messages = [
    {
      role: "user",
      content: [{
        text: JSON.stringify({
          question,
          mode,
          sceneSnapshot: sceneSnapshot || null,
        }),
      }],
    },
  ];

  const text = await converseNova(MODEL_IDS.NOVA_PRO, PLAN_SYSTEM_PROMPT, messages, {
    maxTokens: 4096,
    temperature: 0.15,
  });
  return normalizeScenePlan(JSON.parse(cleanupJson(text)));
}

export async function generateScenePlan({ question, mode = "guided", sceneSnapshot = null }) {
  const baselinePlan = heuristicPlan(question, mode);
  try {
    const novaPlan = await planFromNova(question, mode, sceneSnapshot);
    return normalizeScenePlan({
      ...baselinePlan,
      ...novaPlan,
      problem: {
        ...baselinePlan.problem,
        ...novaPlan.problem,
        question,
        mode,
      },
      overview: novaPlan.overview || baselinePlan.overview,
      objectSuggestions: (novaPlan.objectSuggestions?.length || 0) >= baselinePlan.objectSuggestions.length
        ? novaPlan.objectSuggestions
        : baselinePlan.objectSuggestions,
      buildSteps: (novaPlan.buildSteps?.length || 0) >= baselinePlan.buildSteps.length
        ? novaPlan.buildSteps
        : baselinePlan.buildSteps,
      cameraBookmarks: (novaPlan.cameraBookmarks?.length || 0) ? novaPlan.cameraBookmarks : baselinePlan.cameraBookmarks,
      answerScaffold: {
        ...baselinePlan.answerScaffold,
        ...novaPlan.answerScaffold,
      },
      challengePrompts: (novaPlan.challengePrompts?.length || 0)
        ? novaPlan.challengePrompts
        : baselinePlan.challengePrompts,
      liveChallenge: novaPlan.liveChallenge || baselinePlan.liveChallenge || null,
    });
  } catch (error) {
    console.warn("Falling back to heuristic scene plan:", error?.message || error);
    return baselinePlan;
  }
}
