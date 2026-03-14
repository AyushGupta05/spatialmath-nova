import { buildSceneSnapshotFromSuggestions } from "../../src/ai/planSchema.js";
import { computeGeometry } from "../../src/core/geometry.js";
import { normalizeSceneObject, normalizeSceneSnapshot } from "../../src/scene/schema.js";
import { buildAnalyticPlan } from "./plan/analytic.js";
import { cleanupJson } from "./plan/shared.js";
import { converseWithModelFailover } from "./modelInvoker.js";
import { hasAwsCredentials } from "./modelRouter.js";

const FREEFORM_TUTOR_SYSTEM_PROMPT = `You are Nova Prism, a scene-aware chat companion inside a 3D spatial sandbox.

Return ONLY valid JSON with this exact structure:
{
  "reply": "string",
  "sceneCommand": null | {
    "summary": "string",
    "operations": [
      {
        "kind": "replace_scene" | "merge_objects" | "remove_objects" | "select_object" | "focus_objects" | "clear_scene" | "clear_focus" | "reset_view",
        "...": "operation-specific fields"
      }
    ]
  }
}

Rules:
- You can answer normal conversation directly. You are not limited to lesson tutoring.
- When the user asks about the current scene, explain it using concrete object labels, dimensions, or relations.
- When the user asks you to create, change, clear, focus, or select something in the scene, use sceneCommand.
- If no scene change is needed, set sceneCommand to null.
- Keep reply to 1-3 short sentences.
- Sound warm, clear, and concrete.
- Prefer merge_objects for additive changes to the current scene.
- Prefer replace_scene only when the user asked for a fresh build, a surprise, or a complete rebuild.
- Keep generated scenes compact: usually 1-6 objects near the origin.
- Use simple ids like "sphere-a", "plane-main", or "line-bridge".
- Every object must follow this schema:
  {
    "id": "string",
    "label": "string",
    "shape": "cube" | "cuboid" | "sphere" | "cylinder" | "cone" | "pyramid" | "plane" | "line" | "pointMarker",
    "color": "#RRGGBB",
    "position": [x, y, z],
    "rotation": [x, y, z],
    "params": { "shape-specific numeric params" }
  }
- Shape params:
  cube -> { "size": number }
  cuboid -> { "width": number, "height": number, "depth": number }
  sphere -> { "radius": number }
  cylinder -> { "radius": number, "height": number }
  cone -> { "radius": number, "height": number }
  pyramid -> { "base": number, "height": number }
  plane -> { "width": number, "depth": number }
  line -> { "start": [x, y, z], "end": [x, y, z], "thickness": number }
  pointMarker -> { "radius": number }
- When you add or replace objects, you may follow up with focus_objects or select_object using ids that exist after the edit.
- Do not invent operation kinds.
- Do not wrap the JSON in markdown fences.`;

const SHOWCASE_CONFIGS = [
  {
    id: "skew-lines-bridge",
    title: "Skew Lines Hidden Bridge",
    prompt: "Two lines in space are given by r1 = (1,2,0) + t(2,-1,3), r2 = (4,-1,2) + s(1,2,-1). Find the shortest distance between the two skew lines.",
    momentId: "solve",
    reply: "I loaded a skew-lines scene: the short connector is the common perpendicular, so its length is the hidden shortest distance. Orbit around it and notice how every other connector sneaks some motion along one line or the other.",
  },
  {
    id: "line-plane-intersection",
    title: "Line-Plane Collision Point",
    prompt: "A line passes through the point P(1, -2, 3) with direction d = (2, 1, -1). The plane Pi has equation 2x - y + z = 7. Find the coordinates of the point where the line intersects the plane.",
    momentId: "solve",
    reply: "I swapped in a line-plane scene where the highlighted point is the instant algebra turns into geometry. Rotate it and notice how that point belongs to the line and the plane at the same time.",
  },
  {
    id: "line-plane-angle",
    title: "Angle Through the Normal",
    prompt: "A line has direction vector (3, -2, 1) and a plane has equation 2x + y - 2z = 6. Find the angle between the line and the plane.",
    momentId: "solve",
    reply: "Here is a line-plane angle scene: the trick is that the plane's normal quietly controls the whole angle story. Spin the view and watch how the line's tilt relative to that normal sets the angle to the plane.",
  },
];

let cachedShowcases = null;

function formatNumber(value, digits = 3) {
  const next = Number(value);
  if (!Number.isFinite(next)) return "0";
  return next.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function uniqueStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
}

function stableHash(input = "") {
  let hash = 0;
  for (const char of String(input || "")) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0);
    hash |= 0;
  }
  return Math.abs(hash);
}

function buildShowcases() {
  if (cachedShowcases) return cachedShowcases;

  cachedShowcases = SHOWCASE_CONFIGS.map((config) => {
    const plan = buildAnalyticPlan(config.prompt, {
      cleanedQuestion: config.prompt,
      inputMode: "text",
    });
    const sceneMoments = plan?.sceneMoments || [];
    const sceneMoment = sceneMoments.find((moment) => moment.id === config.momentId)
      || sceneMoments[sceneMoments.length - 1]
      || null;
    const snapshot = plan
      ? buildSceneSnapshotFromSuggestions(plan, sceneMoment?.visibleObjectIds || [])
      : { objects: [], selectedObjectId: null };
    return {
      ...config,
      snapshot,
      focusTargets: sceneMoment?.focusTargets || [],
    };
  }).filter((showcase) => showcase.snapshot?.objects?.length);

  return cachedShowcases;
}

function selectedObjectSummary(sceneSnapshot = {}, sceneContext = {}) {
  const selectedId = sceneContext?.selection?.id || sceneSnapshot?.selectedObjectId || null;
  if (!selectedId) return null;

  const fromSnapshot = (sceneSnapshot.objects || []).find((objectSpec) => objectSpec.id === selectedId) || null;
  const selection = sceneContext?.selection || fromSnapshot;
  if (!selection) return null;

  const metrics = selection.metrics || computeGeometry(selection.shape, selection.params || {});
  return {
    id: selection.id || selectedId,
    label: selection.label || selection.shape || selectedId,
    shape: selection.shape || fromSnapshot?.shape || "object",
    params: selection.params || fromSnapshot?.params || {},
    metrics,
  };
}

function summarizeScene(sceneSnapshot = {}, sceneContext = {}) {
  const objects = sceneSnapshot.objects || [];
  if (!objects.length) {
    return "Scene objects: none.";
  }

  const lines = objects.slice(0, 8).map((objectSpec) => {
    const metrics = computeGeometry(objectSpec.shape, objectSpec.params || {});
    const dims = Object.entries(objectSpec.params || {})
      .map(([key, value]) => `${key}=${Array.isArray(value) ? `(${value.join(", ")})` : value}`)
      .join(", ");
    const facts = [];
    if (Number.isFinite(metrics.volume) && metrics.volume > 0) facts.push(`V=${formatNumber(metrics.volume)}`);
    if (Number.isFinite(metrics.surfaceArea) && metrics.surfaceArea > 0) facts.push(`SA=${formatNumber(metrics.surfaceArea)}`);
    return `- ${objectSpec.label || objectSpec.id || objectSpec.shape}: ${objectSpec.shape}${dims ? ` [${dims}]` : ""}${facts.length ? ` (${facts.join(", ")})` : ""}`;
  });

  const selected = selectedObjectSummary(sceneSnapshot, sceneContext);
  if (selected) {
    lines.push(`Selected object: ${selected.label} (${selected.shape}) with params ${JSON.stringify(selected.params)}.`);
  } else {
    lines.push("Selected object: none.");
  }

  return lines.join("\n");
}

function applyObjectsIntoSnapshot(snapshot, objects = []) {
  const nextObjects = [...(snapshot.objects || [])];
  const byId = new Map(nextObjects.map((objectSpec) => [objectSpec.id, objectSpec]));
  for (const objectSpec of objects) {
    byId.set(objectSpec.id, objectSpec);
  }
  return {
    ...snapshot,
    objects: [...byId.values()],
  };
}

function projectSceneSnapshot(sceneSnapshot = {}, sceneCommand = null) {
  let nextSnapshot = normalizeSceneSnapshot(sceneSnapshot);
  const operations = sceneCommand?.operations || [];

  for (const operation of operations) {
    switch (operation.kind) {
      case "replace_scene":
        nextSnapshot = normalizeSceneSnapshot({
          objects: operation.objects || [],
          selectedObjectId: operation.selectedObjectId || null,
        });
        break;
      case "merge_objects":
        nextSnapshot = applyObjectsIntoSnapshot(nextSnapshot, operation.objects || []);
        break;
      case "remove_objects":
        nextSnapshot = {
          ...nextSnapshot,
          objects: nextSnapshot.objects.filter((objectSpec) => !(operation.objectIds || []).includes(objectSpec.id)),
          selectedObjectId: (operation.objectIds || []).includes(nextSnapshot.selectedObjectId)
            ? null
            : nextSnapshot.selectedObjectId,
        };
        break;
      case "select_object":
        nextSnapshot = {
          ...nextSnapshot,
          selectedObjectId: operation.objectId || null,
        };
        break;
      case "clear_scene":
        nextSnapshot = {
          objects: [],
          selectedObjectId: null,
        };
        break;
      default:
        break;
    }
  }

  return nextSnapshot;
}

function buildFreeformActions(sceneSnapshot = {}) {
  const hasObjects = Boolean(sceneSnapshot.objects?.length);
  if (!hasObjects) {
    return [
      {
        id: "freeform-showcase",
        label: "Show me something cool",
        kind: "freeform-prompt",
        payload: { prompt: "Show me something cool in math." },
      },
      {
        id: "freeform-capabilities",
        label: "What can you do?",
        kind: "freeform-prompt",
        payload: { prompt: "What can you do with the scene right now?" },
      },
      {
        id: "freeform-build",
        label: "Build a scene",
        kind: "freeform-prompt",
        payload: { prompt: "Build a striking math scene and explain why it matters." },
      },
    ];
  }

  return [
    {
      id: "freeform-explain",
      label: "Explain this scene",
      kind: "freeform-prompt",
      payload: { prompt: "Explain what is interesting about the current scene." },
    },
    {
      id: "freeform-showcase",
      label: "Show me something cool",
      kind: "freeform-prompt",
      payload: { prompt: "Show me something cool in math." },
    },
    {
      id: "freeform-clear",
      label: "Clear scene",
      kind: "clear-scene",
      payload: {},
    },
  ];
}

function focusTargetsFromSceneCommand(sceneCommand = null, projectedSnapshot = {}) {
  if (!sceneCommand?.operations?.length) return [];

  const explicitFocus = sceneCommand.operations
    .filter((operation) => operation.kind === "focus_objects")
    .flatMap((operation) => operation.targetIds || []);
  if (explicitFocus.length) return uniqueStrings(explicitFocus);

  const explicitSelection = sceneCommand.operations
    .filter((operation) => operation.kind === "select_object")
    .map((operation) => operation.objectId)
    .filter(Boolean);
  if (explicitSelection.length) return uniqueStrings(explicitSelection);

  if (projectedSnapshot.selectedObjectId) {
    return [projectedSnapshot.selectedObjectId];
  }

  return [];
}

function buildFreeformResponseMeta(sceneSnapshot = {}, sceneCommand = null) {
  const projectedSnapshot = projectSceneSnapshot(sceneSnapshot, sceneCommand);
  return {
    mode: "freeform",
    actions: buildFreeformActions(projectedSnapshot),
    focusTargets: focusTargetsFromSceneCommand(sceneCommand, projectedSnapshot),
    systemContextMessage: projectedSnapshot.objects.length
      ? `Freeform scene chat with ${projectedSnapshot.objects.length} object${projectedSnapshot.objects.length === 1 ? "" : "s"} ready.`
      : "Freeform scene chat ready.",
    sceneCommand,
    checkpoint: null,
    stageStatus: null,
    sceneDirective: null,
  };
}

function ensureCommandObjectIds(objects = [], prefix = "assistant-object") {
  const usedIds = new Set();
  return objects.map((objectSpec, index) => {
    const normalized = normalizeSceneObject({
      ...objectSpec,
      metadata: {
        ...(objectSpec?.metadata || {}),
        source: objectSpec?.metadata?.source || "assistant-generated",
      },
    });

    let nextId = String(normalized.id || `${prefix}-${index + 1}`).trim();
    while (usedIds.has(nextId)) {
      nextId = `${nextId}-${usedIds.size + 1}`;
    }
    usedIds.add(nextId);

    return {
      ...normalized,
      id: nextId,
    };
  });
}

function normalizeSceneCommand(rawSceneCommand = null) {
  if (!rawSceneCommand || typeof rawSceneCommand !== "object") return null;

  const operations = (Array.isArray(rawSceneCommand.operations) ? rawSceneCommand.operations : [])
    .map((operation, index) => normalizeSceneOperation(operation, index))
    .filter(Boolean);

  if (!operations.length) return null;

  return {
    summary: String(rawSceneCommand.summary || "").trim(),
    operations,
  };
}

function normalizeSceneOperation(operation = {}, index = 0) {
  const kind = String(operation.kind || "").trim();
  switch (kind) {
    case "replace_scene":
      return {
        kind,
        objects: ensureCommandObjectIds(operation.objects || [], `assistant-replace-${index + 1}`),
        selectedObjectId: operation.selectedObjectId ? String(operation.selectedObjectId) : null,
      };
    case "merge_objects":
      return {
        kind,
        objects: ensureCommandObjectIds(operation.objects || [], `assistant-merge-${index + 1}`),
      };
    case "remove_objects":
      return {
        kind,
        objectIds: uniqueStrings(operation.objectIds || []),
      };
    case "select_object":
      return operation.objectId
        ? {
          kind,
          objectId: String(operation.objectId),
        }
        : null;
    case "focus_objects":
      return {
        kind,
        targetIds: uniqueStrings(operation.targetIds || []),
      };
    case "clear_scene":
    case "clear_focus":
    case "reset_view":
      return { kind };
    default:
      return null;
  }
}

function looksLikeShowcaseRequest(userMessage = "") {
  const lower = String(userMessage || "").toLowerCase();
  return (
    /\bshow me\b.*\bcool\b/.test(lower)
    || /\bsomething cool\b/.test(lower)
    || /\bsurprise me\b/.test(lower)
    || /\bmind[- ]?blowing\b/.test(lower)
    || /\brandom\b/.test(lower) && /\b(math|scene|visual|idea)\b/.test(lower)
  );
}

function heuristicSceneCommand(userMessage = "", sceneSnapshot = {}, sceneContext = {}, learningState = {}) {
  const lower = String(userMessage || "").toLowerCase();
  const selection = selectedObjectSummary(sceneSnapshot, sceneContext);

  if (looksLikeShowcaseRequest(userMessage)) {
    const showcases = buildShowcases();
    if (!showcases.length) return null;
    const offset = stableHash(`${userMessage}:${learningState?.history?.length || 0}:${sceneSnapshot.objects?.length || 0}`);
    const showcase = showcases[offset % showcases.length];
    return {
      text: showcase.reply,
      sceneCommand: {
        summary: `Load showcase: ${showcase.title}`,
        operations: [
          {
            kind: "replace_scene",
            objects: ensureCommandObjectIds(showcase.snapshot.objects || [], showcase.id),
            selectedObjectId: showcase.focusTargets[0] || null,
          },
          {
            kind: "focus_objects",
            targetIds: showcase.focusTargets,
          },
          {
            kind: "reset_view",
          },
        ],
      },
    };
  }

  if (/\bclear\b.*\bscene\b/.test(lower) || /\bstart over\b/.test(lower)) {
    return {
      text: "Scene cleared. Ask me to build something new, or say 'show me something cool.'",
      sceneCommand: { summary: "Clear the scene", operations: [{ kind: "clear_scene" }] },
    };
  }

  if (/\breset\b.*\bview\b/.test(lower) || /\bcenter\b.*\bview\b/.test(lower)) {
    return {
      text: "I reset the camera so the whole scene is easier to inspect.",
      sceneCommand: { summary: "Reset the camera view", operations: [{ kind: "reset_view" }] },
    };
  }

  if ((/\bremove\b/.test(lower) || /\bdelete\b/.test(lower)) && /\bselected\b/.test(lower) && selection?.id) {
    return {
      text: `I removed ${selection.label}. If you want, I can replace it with something more interesting.`,
      sceneCommand: {
        summary: `Remove ${selection.label}`,
        operations: [{ kind: "remove_objects", objectIds: [selection.id] }],
      },
    };
  }

  if ((/\bfocus\b/.test(lower) || /\bhighlight\b/.test(lower)) && selection?.id) {
    return {
      text: `I'm focusing on ${selection.label} so we can inspect it more closely.`,
      sceneCommand: {
        summary: `Focus ${selection.label}`,
        operations: [{ kind: "focus_objects", targetIds: [selection.id] }],
      },
    };
  }

  return null;
}

function shouldAskModelForSceneCommand(userMessage = "") {
  const lower = String(userMessage || "").toLowerCase();
  return /\b(add|build|create|generate|make|show|draw|put|place|remove|delete|clear|focus|highlight|select|replace|change|move|resize|rotate)\b/.test(lower);
}

function freeformFallbackReply(sceneSnapshot = {}, sceneContext = {}, userMessage = "", sceneCommand = null) {
  const lower = String(userMessage || "").toLowerCase();
  const selection = selectedObjectSummary(sceneSnapshot, sceneContext);
  const objectCount = sceneSnapshot.objects?.length || 0;

  if (sceneCommand?.operations?.some((operation) => operation.kind === "replace_scene")) {
    return "I loaded a fresh scene. Rotate around it and tell me which object or relationship you want to inspect first.";
  }
  if (sceneCommand?.operations?.some((operation) => operation.kind === "merge_objects")) {
    return "I added to the scene. Take a look from a couple of angles and tell me what stands out.";
  }
  if (sceneCommand?.operations?.some((operation) => operation.kind === "clear_scene")) {
    return "The scene is blank again. Ask me to build something, explain an idea, or surprise you.";
  }
  if (selection && /\b(explain|what is|what's happening|why)\b/.test(lower)) {
    return `${selection.label} is a ${selection.shape} with volume ${formatNumber(selection.metrics?.volume)} and surface area ${formatNumber(selection.metrics?.surfaceArea)}. What relationship do you want to inspect around it?`;
  }

  // For conversational or educational questions, give a helpful reply instead of scene-centric defaults
  const isQuestion = /\b(what|how|why|where|when|who|can you|could you|tell me|explain|describe|is it|are there|do you)\b/.test(lower);
  if (isQuestion && !shouldAskModelForSceneCommand(userMessage)) {
    return "I'm having trouble reaching my AI backend right now. Try again in a moment, or ask me to build a scene — I can handle that offline!";
  }

  if (!objectCount) {
    return "The scene is blank right now. Ask me to build something, explain a concept, or say 'show me something cool.'";
  }
  if (selection) {
    return `You're looking at ${selection.label}. I can explain it, change it, or build something around it.`;
  }
  return `There are ${objectCount} objects in the scene. Ask me to explain them, remix them, or build a fresh math visual.`;
}

function buildModelMessages(sceneSnapshot = {}, sceneContext = {}, learningState = {}, userMessage = "") {
  const history = Array.isArray(learningState.history) ? learningState.history : [];
  const messages = [];

  for (const message of history.slice(-6)) {
    const role = message.role === "tutor" ? "assistant" : message.role;
    if (!["user", "assistant"].includes(role)) continue;
    const content = String(message.content || "").trim();
    if (!content) continue;
    // Skip consecutive messages with the same role to satisfy Bedrock alternation requirement
    if (messages.length && messages[messages.length - 1].role === role) continue;
    messages.push({ role, content: [{ text: content }] });
  }

  // Ensure the conversation starts with a user message (Bedrock requirement)
  while (messages.length && messages[0].role !== "user") {
    messages.shift();
  }

  const sceneSummary = summarizeScene(sceneSnapshot, sceneContext);
  const selected = selectedObjectSummary(sceneSnapshot, sceneContext);

  // If the last message is already "user", replace it with the enriched user message;
  // otherwise append as a new user message.
  const userContent = {
    role: "user",
    content: [{
      text: [
        `User request: ${String(userMessage || "").trim() || "No request provided."}`,
        "",
        sceneSummary,
        "",
        `Scene object count: ${sceneSnapshot.objects?.length || 0}.`,
        `Scene focus hint: ${sceneContext?.sceneFocus?.primaryInsight || "none"}.`,
        `Current guidance hint: ${sceneContext?.guidance?.coachFeedback || "none"}.`,
        `Selected object detail: ${selected ? JSON.stringify(selected) : "none"}.`,
        "If the user did not ask for a scene edit, return sceneCommand as null.",
      ].join("\n"),
    }],
  };

  if (messages.length && messages[messages.length - 1].role === "user") {
    messages[messages.length - 1] = userContent;
  } else {
    messages.push(userContent);
  }

  return messages;
}

async function modelFreeformTurn(sceneSnapshot = {}, sceneContext = {}, learningState = {}, userMessage = "") {
  if (!hasAwsCredentials()) return null;

  const text = await converseWithModelFailover(
    "text",
    FREEFORM_TUTOR_SYSTEM_PROMPT,
    buildModelMessages(sceneSnapshot, sceneContext, learningState, userMessage),
    {
      maxTokens: 1400,
      temperature: 0.35,
    }
  );

  const parsed = JSON.parse(cleanupJson(text));
  return {
    text: String(parsed.reply || "").trim(),
    sceneCommand: shouldAskModelForSceneCommand(userMessage)
      ? normalizeSceneCommand(parsed.sceneCommand)
      : null,
  };
}

export function buildFallbackFreeformTurn({
  sceneSnapshot,
  sceneContext = null,
  userMessage = "",
  sceneCommand = null,
}) {
  const normalizedSnapshot = normalizeSceneSnapshot(sceneSnapshot);
  return {
    text: freeformFallbackReply(normalizedSnapshot, sceneContext || {}, userMessage, sceneCommand),
    meta: buildFreeformResponseMeta(normalizedSnapshot, sceneCommand),
  };
}

export async function generateFreeformTutorTurn({
  sceneSnapshot,
  sceneContext = null,
  learningState = {},
  userMessage,
}) {
  const normalizedSnapshot = normalizeSceneSnapshot(sceneSnapshot);
  const heuristicTurn = heuristicSceneCommand(userMessage, normalizedSnapshot, sceneContext || {}, learningState);

  if (heuristicTurn) {
    return {
      text: heuristicTurn.text,
      meta: buildFreeformResponseMeta(normalizedSnapshot, heuristicTurn.sceneCommand),
    };
  }

  try {
    const turn = await modelFreeformTurn(normalizedSnapshot, sceneContext || {}, learningState, userMessage);
    const text = turn?.text || freeformFallbackReply(normalizedSnapshot, sceneContext || {}, userMessage, turn?.sceneCommand || null);
    return {
      text,
      meta: buildFreeformResponseMeta(normalizedSnapshot, turn?.sceneCommand || null),
    };
  } catch (error) {
    console.warn("Freeform tutor fallback:", error?.message || error);
    return buildFallbackFreeformTurn({
      sceneSnapshot: normalizedSnapshot,
      sceneContext,
      userMessage,
    });
  }
}
