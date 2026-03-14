import test from "node:test";
import assert from "node:assert/strict";

import { normalizeScenePlan } from "../src/ai/planSchema.js";
import { createTutorRoute } from "../server/routes/tutor.js";

function buildPlan() {
  return normalizeScenePlan({
    problem: {
      question: "Find the volume of a cylinder with radius 3 and height 7.",
      questionType: "volume",
      mode: "guided",
    },
    sourceEvidence: {
      inputMode: "multimodal",
      givens: ["radius = 3", "height = 7"],
      diagramSummary: "A labeled cylinder worksheet diagram.",
      conflicts: [],
    },
    objectSuggestions: [{
      id: "primary-object",
      title: "Cylinder",
      object: {
        id: "primary-cylinder",
        shape: "cylinder",
        label: "Cylinder",
        params: { radius: 3, height: 7 },
      },
    }],
    buildSteps: [{
      id: "step-1",
      title: "Place the cylinder",
      instruction: "Place the main cylinder.",
      action: "add",
      suggestedObjectIds: ["primary-object"],
      requiredObjectIds: ["primary-object"],
    }],
  });
}

function buildAnalyticPlan() {
  return normalizeScenePlan({
    problem: {
      question: "Line-plane intersection",
      questionType: "spatial",
      mode: "guided",
    },
    experienceMode: "analytic_auto",
    sourceEvidence: {
      inputMode: "text",
      givens: ["P(1,-2,3)", "d=(2,1,-1)", "2x-y+z=7"],
      diagramSummary: "",
      conflicts: [],
    },
    analyticContext: {
      subtype: "line_plane_intersection",
      formulaCard: {
        title: "Line-Plane Intersection",
        formula: "n · (p + td) = c",
        explanation: "Substitute the line into the plane.",
      },
      solutionSteps: [{
        id: "step-1",
        title: "Write the line equation",
        formula: "r = p + td",
        explanation: "Start with the line equation.",
      }],
    },
    objectSuggestions: [{
      id: "line-main",
      title: "Line",
      object: {
        id: "line-main",
        shape: "line",
        label: "Line",
        params: { start: [0, 0, 0], end: [1, 1, 1], thickness: 0.08 },
      },
    }],
    buildSteps: [{
      id: "observe",
      title: "Observe",
      instruction: "Rotate the scene.",
      action: "observe",
      suggestedObjectIds: ["line-main"],
      requiredObjectIds: [],
    }],
    lessonStages: [{
      id: "observe",
      title: "Observe",
      goal: "Spot the line and plane.",
      tutorIntro: "Rotate the scene.",
      highlightTargets: ["line-main"],
      suggestedActions: [{
        id: "observe-formula",
        label: "Show Formula",
        kind: "show-formula",
      }],
    }],
    cameraBookmarks: [{
      id: "overview",
      label: "Overview",
      position: [8, 6, 8],
      target: [0, 0, 0],
    }],
    sceneMoments: [{
      id: "observe",
      title: "Observe",
      prompt: "Rotate the scene.",
      goal: "Spot the line and plane.",
      focusTargets: ["line-main"],
      visibleObjectIds: ["line-main"],
      visibleOverlayIds: ["analytic-axes"],
      cameraBookmarkId: "overview",
      revealFormula: false,
      revealFullSolution: false,
    }],
    sceneOverlays: [{
      id: "analytic-axes",
      type: "coordinate-frame",
      bounds: { x: [-4, 4], y: [-4, 4], z: [-4, 4], tickStep: 1 },
    }],
  });
}

function parseSsePayloads(bodyText) {
  return bodyText
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
}

test("POST /api/tutor streams lesson metadata before tutor text", async () => {
  const plan = buildPlan();
  const tutorRoute = createTutorRoute({
    streamModel: async function* streamTutor() {
      yield "Let's ";
      yield "start.";
    },
  });

  const response = await tutorRoute.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan,
      sceneSnapshot: { objects: [], selectedObjectId: null },
      learningState: { currentStep: 0, learningStage: "orient", history: [] },
      userMessage: "Help me start",
      contextStepId: "step-1",
    }),
  });

  assert.equal(response.status, 200);
  const payloads = parseSsePayloads(await response.text());
  const meta = payloads.find((entry) => entry.type === "meta")?.content;
  const text = payloads.filter((entry) => entry.type === "text").map((entry) => entry.content).join("");
  const assessment = payloads.find((entry) => entry.type === "assessment")?.content;

  assert.ok(meta);
  assert.equal(meta.stageStatus.currentStageId, "step-1");
  assert.equal(meta.stageStatus.canAdvance, false);
  assert.ok(meta.actions.some((action) => action.kind === "explain-stage"));
  assert.ok(meta.actions.some((action) => action.kind === "continue-stage"));
  assert.deepEqual(meta.focusTargets, ["primary-cylinder"]);
  assert.match(meta.systemContextMessage, /Givens: radius = 3, height = 7\./);
  assert.equal(text, "Let's start.");
  assert.ok(assessment.summary);
});

test("POST /api/tutor includes scene directives for analytic lessons", async () => {
  const plan = buildAnalyticPlan();
  const tutorRoute = createTutorRoute({
    streamModel: async function* streamTutor() {
      yield "Rotate ";
      yield "the scene.";
    },
  });

  const response = await tutorRoute.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan,
      sceneSnapshot: { objects: [], selectedObjectId: null },
      learningState: { currentStep: 0, learningStage: "build", history: [] },
      userMessage: "What should I notice first?",
      contextStepId: "observe",
    }),
  });

  const payloads = parseSsePayloads(await response.text());
  const meta = payloads.find((entry) => entry.type === "meta")?.content;

  assert.ok(meta?.sceneDirective);
  assert.equal(meta.sceneDirective.stageId, "observe");
  assert.equal(meta.sceneDirective.cameraBookmarkId, "overview");
  assert.deepEqual(meta.sceneDirective.visibleOverlayIds, ["analytic-axes"]);
  assert.ok(meta.actions.some((action) => action.kind === "show-formula"));
  assert.ok(meta.actions.some((action) => action.kind === "reveal-full-solution"));
});
