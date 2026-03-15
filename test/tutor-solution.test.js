import test from "node:test";
import assert from "node:assert/strict";

import { buildSolutionRevealText, formatPlanFinalAnswer, isExplicitSolutionRequest } from "../src/core/tutorSolution.js";

test("formatPlanFinalAnswer avoids duplicating degree units", () => {
  const formatted = formatPlanFinalAnswer({
    answerScaffold: {
      finalAnswer: "90°",
      unit: "degrees",
    },
  });

  assert.equal(formatted.text, "90°");
});

test("buildSolutionRevealText includes the formula and final answer", () => {
  const text = buildSolutionRevealText({
    answerScaffold: {
      formula: "sin(theta) = |d · n| / (|d||n|)",
      finalAnswer: "78.51°",
      unit: "degrees",
    },
    analyticContext: {
      solutionSteps: [{
        title: "Compute the angle",
        formula: "theta ≈ 78.51°",
        explanation: "Compare the dot product result with the acute angle in the scene.",
      }],
    },
  });

  assert.match(text, /Formula:/);
  assert.match(text, /Final answer:/);
  assert.match(text, /78\.51/);
});

test("isExplicitSolutionRequest detects direct answer asks", () => {
  assert.equal(isExplicitSolutionRequest("show me the final answer"), true);
  assert.equal(isExplicitSolutionRequest("what should I notice first?"), false);
});
