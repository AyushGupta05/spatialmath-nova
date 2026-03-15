import test from "node:test";
import assert from "node:assert/strict";

import { evaluateConcept, isTrivialInteraction } from "../server/services/conceptEvaluator.js";

test("isTrivialInteraction returns true for orient stage", () => {
  assert.equal(isTrivialInteraction("orient", "ok"), true);
  assert.equal(isTrivialInteraction("orient", "I think the surface area is 24"), true);
});

test("isTrivialInteraction returns true for short build messages without math", () => {
  assert.equal(isTrivialInteraction("build", "ok"), true);
  assert.equal(isTrivialInteraction("build", "got it"), true);
  assert.equal(isTrivialInteraction("build", "yes"), true);
  assert.equal(isTrivialInteraction("build", "I see"), true);
});

test("isTrivialInteraction returns false for substantive build messages", () => {
  assert.equal(isTrivialInteraction("build", "I think the area of each face is length times width"), false);
  assert.equal(isTrivialInteraction("build", "the formula uses $lw + lh + wh$"), false);
  assert.equal(isTrivialInteraction("build", "maybe around 42"), false);
});

test("isTrivialInteraction returns false for predict/check/reflect/challenge", () => {
  assert.equal(isTrivialInteraction("predict", "ok"), false);
  assert.equal(isTrivialInteraction("check", "yes"), false);
  assert.equal(isTrivialInteraction("reflect", "I see"), false);
  assert.equal(isTrivialInteraction("challenge", "got it"), false);
});

test("evaluateConcept returns CORRECT for confident correct verdict", async () => {
  const result = await evaluateConcept(
    {
      stageGoal: "understand surface area",
      learnerInput: "surface area is the total area of all faces",
      lessonContext: {},
      prediction: "",
      learnerHistory: [],
    },
    {
      converseWithModelFailover: async () => JSON.stringify({
        verdict: "CORRECT",
        confidence: 0.92,
        what_was_right: "Correctly identified surface area as total face area",
        gap: null,
        misconception_type: null,
        scene_cue: null,
        tutor_tone: "encouraging",
      }),
    },
  );

  assert.equal(result.verdict, "CORRECT");
  assert.equal(result.confidence, 0.92);
  assert.equal(result.what_was_right, "Correctly identified surface area as total face area");
});

test("evaluateConcept downgrades CORRECT to PARTIAL when confidence < 0.65", async () => {
  const result = await evaluateConcept(
    {
      stageGoal: "understand surface area",
      learnerInput: "something about faces",
      lessonContext: {},
      prediction: "",
      learnerHistory: [],
    },
    {
      converseWithModelFailover: async () => JSON.stringify({
        verdict: "CORRECT",
        confidence: 0.55,
        what_was_right: "Mentioned faces",
        gap: "Vague understanding",
        misconception_type: null,
        scene_cue: null,
        tutor_tone: "encouraging",
      }),
    },
  );

  assert.equal(result.verdict, "PARTIAL");
  assert.equal(result.confidence, 0.55);
});

test("evaluateConcept returns STUCK verdict", async () => {
  const result = await evaluateConcept(
    {
      stageGoal: "understand surface area",
      learnerInput: "I have no idea",
      lessonContext: {},
      prediction: "",
      learnerHistory: [],
    },
    {
      converseWithModelFailover: async () => JSON.stringify({
        verdict: "STUCK",
        confidence: 0.88,
        what_was_right: "",
        gap: "No understanding demonstrated",
        misconception_type: "no_attempt",
        scene_cue: "highlight_net_faces",
        tutor_tone: "supportive",
      }),
    },
  );

  assert.equal(result.verdict, "STUCK");
  assert.equal(result.scene_cue, "highlight_net_faces");
  assert.equal(result.tutor_tone, "supportive");
});

test("evaluateConcept falls back to PARTIAL on LLM error", async () => {
  const result = await evaluateConcept(
    {
      stageGoal: "understand surface area",
      learnerInput: "test",
      lessonContext: {},
      prediction: "",
      learnerHistory: [],
    },
    {
      converseWithModelFailover: async () => {
        throw new Error("model unavailable");
      },
    },
  );

  assert.equal(result.verdict, "PARTIAL");
  assert.equal(result.confidence, 0.5);
});

test("evaluateConcept falls back to PARTIAL on malformed JSON", async () => {
  const result = await evaluateConcept(
    {
      stageGoal: "understand surface area",
      learnerInput: "test",
      lessonContext: {},
      prediction: "",
      learnerHistory: [],
    },
    {
      converseWithModelFailover: async () => "this is not json at all",
    },
  );

  assert.equal(result.verdict, "PARTIAL");
  assert.equal(result.confidence, 0.5);
});

test("evaluateConcept normalizes unknown verdict to PARTIAL", async () => {
  const result = await evaluateConcept(
    {
      stageGoal: "test",
      learnerInput: "test",
      lessonContext: {},
      prediction: "",
      learnerHistory: [],
    },
    {
      converseWithModelFailover: async () => JSON.stringify({
        verdict: "UNKNOWN",
        confidence: 0.8,
        what_was_right: "",
      }),
    },
  );

  assert.equal(result.verdict, "PARTIAL");
});

test("evaluateConcept strips markdown code fences from response", async () => {
  const result = await evaluateConcept(
    {
      stageGoal: "test",
      learnerInput: "test",
      lessonContext: {},
      prediction: "",
      learnerHistory: [],
    },
    {
      converseWithModelFailover: async () => "```json\n" + JSON.stringify({
        verdict: "CORRECT",
        confidence: 0.9,
        what_was_right: "Good answer",
        gap: null,
      }) + "\n```",
    },
  );

  assert.equal(result.verdict, "CORRECT");
  assert.equal(result.what_was_right, "Good answer");
});
