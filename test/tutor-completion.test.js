import test from "node:test";
import assert from "node:assert/strict";

import { normalizeScenePlan } from "../src/ai/planSchema.js";
import { evaluateTutorCompletion } from "../server/services/tutorCompletion.js";

test("evaluateTutorCompletion marks numeric answers correct with tolerance", () => {
  const plan = normalizeScenePlan({
    answerScaffold: {
      finalAnswer: "78.51°",
    },
  });

  const completion = evaluateTutorCompletion({
    plan,
    userMessage: "The acute angle is 78.5 degrees.",
  });

  assert.deepEqual(completion, { complete: true, reason: "correct-answer" });
});

test("evaluateTutorCompletion compares tuple-style answers component-wise", () => {
  const plan = normalizeScenePlan({
    answerScaffold: {
      finalAnswer: "(1, -2, 3)",
    },
  });

  const completion = evaluateTutorCompletion({
    plan,
    userMessage: "The intersection is (1, -2, 3).",
  });

  assert.deepEqual(completion, { complete: true, reason: "correct-answer" });
});

test("evaluateTutorCompletion keeps incorrect answers incomplete", () => {
  const plan = normalizeScenePlan({
    answerScaffold: {
      finalAnswer: "21",
    },
  });

  const completion = evaluateTutorCompletion({
    plan,
    userMessage: "I think it is 19.",
  });

  assert.deepEqual(completion, { complete: false, reason: null });
});
