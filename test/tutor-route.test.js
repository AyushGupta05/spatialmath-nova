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
  assert.ok(meta.actions.some((action) => action.kind === "start-guided-build"));
  assert.ok(meta.actions.some((action) => action.kind === "build-manually"));
  assert.deepEqual(meta.focusTargets, ["primary-cylinder"]);
  assert.match(meta.systemContextMessage, /Givens: radius = 3, height = 7\./);
  assert.equal(text, "Let's start.");
  assert.ok(assessment.summary);
});
