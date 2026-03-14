import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSuggestedQuestionActions,
  isStandaloneMathProblem,
  looksLikeShortFollowUp,
} from "../src/ui/tutorConversation.js";

test("looksLikeShortFollowUp recognizes short post-solution follow-ups", () => {
  assert.equal(looksLikeShortFollowUp("why?"), true);
  assert.equal(looksLikeShortFollowUp("show me the formula"), true);
  assert.equal(looksLikeShortFollowUp("another way?"), true);
});

test("isStandaloneMathProblem distinguishes a fresh math prompt from a follow-up", () => {
  assert.equal(isStandaloneMathProblem("Explain that."), false);
  assert.equal(isStandaloneMathProblem("A line passes through A(1, 2, -1) with direction vector (2, -1, 3). Find the acute angle between the line and the plane 2x - y + 2z = 7."), true);
});

test("buildSuggestedQuestionActions converts similar prompts into lesson-start actions", () => {
  const actions = buildSuggestedQuestionActions([
    {
      label: "New Line-Plane Angle",
      prompt: "Find the acute angle between a line and a plane.",
      source: "template",
    },
  ]);

  assert.deepEqual(actions, [{
    id: "suggested-question-1",
    label: "New Line-Plane Angle",
    kind: "start-suggested-question",
    payload: {
      prompt: "Find the acute angle between a line and a plane.",
      source: "template",
    },
  }]);
});
