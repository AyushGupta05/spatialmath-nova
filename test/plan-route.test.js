import test from "node:test";
import assert from "node:assert/strict";

import { createPlanRoute } from "../server/routes/plan.js";

test("POST /api/plan multipart requests pass image and scene snapshot to the plan generator", async () => {
  let capturedPayload = null;
  const planRoute = createPlanRoute({
    planGenerator: async (payload) => {
      capturedPayload = payload;
      return {
        scenePlan: {
          problem: {
            question: payload.questionText || "diagram only",
            questionType: "spatial",
          },
          objectSuggestions: [],
          buildSteps: [],
        },
        sourceEvidence: {
          inputMode: "multimodal",
          givens: ["radius = 3"],
          diagramSummary: "Worksheet diagram",
          conflicts: [],
        },
        agentTrace: [{
          id: "source-interpreter",
          label: "Source Interpreter",
          status: "multimodal",
          summary: "Parsed worksheet data.",
        }],
        demoPreset: {
          title: "Judge demo",
          scriptBeat: "Diagram to 3D lesson",
          recommendedCategory: "Best of Multimodal Understanding",
        },
      };
    },
  });

  const form = new FormData();
  form.set("question", "Interpret this diagram");
  form.set("mode", "guided");
  form.set("sceneSnapshot", JSON.stringify({ objects: [], selectedObjectId: null }));
  form.set("image", new File([Uint8Array.from([137, 80, 78, 71])], "diagram.png", { type: "image/png" }));

  const response = await planRoute.request("/", {
    method: "POST",
    body: form,
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.scenePlan.problem.question, "Interpret this diagram");
  assert.equal(payload.sourceEvidence.inputMode, "multimodal");
  assert.equal(payload.agentTrace[0].id, "source-interpreter");
  assert.equal(payload.demoPreset.recommendedCategory, "Best of Multimodal Understanding");
  assert.equal(capturedPayload.questionText, "Interpret this diagram");
  assert.equal(capturedPayload.mode, "guided");
  assert.deepEqual(capturedPayload.sceneSnapshot, { objects: [], selectedObjectId: null });
  assert.equal(capturedPayload.imageAsset.format, "png");
  assert.equal(capturedPayload.imageAsset.mimeType, "image/png");
  assert.ok(capturedPayload.imageAsset.bytes instanceof Uint8Array);
});
