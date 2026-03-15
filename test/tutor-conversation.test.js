import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSuggestedQuestionActions,
  isStandaloneMathProblem,
  looksLikeShortFollowUp,
  normalizeTutorReplyText,
  shouldStartLessonFromComposer,
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

test("shouldStartLessonFromComposer bootstraps a lesson on the first lower-chat math prompt", () => {
  assert.equal(shouldStartLessonFromComposer({
    text: "Find the volume of a cylinder with radius 3 and height 7.",
    hasPlan: false,
    lessonComplete: false,
  }), true);
  assert.equal(shouldStartLessonFromComposer({
    text: "show me something cool",
    hasPlan: false,
    lessonComplete: false,
  }), false);
  assert.equal(shouldStartLessonFromComposer({
    text: "Find the angle between the line and the plane.",
    hasPlan: true,
    lessonComplete: false,
  }), false);
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

test("normalizeTutorReplyText converts solved replies into a clean heading and bullets", () => {
  const normalized = normalizeTutorReplyText("**Correct!** That's the acute angle between the line and the plane. Notice how the line leans almost parallel to the plane. What do you notice about the normal?");

  assert.equal(normalized, [
    "**Correct!",
    "- ** That's the acute angle between the line and the plane.",
    "- Notice how the line leans almost parallel to the plane.",
    "What do you notice about the normal?",
  ].join("\n"));
});

test("normalizeTutorReplyText scaffolds regular tutor replies into a clear scan-friendly shape", () => {
  const normalized = normalizeTutorReplyText("Start with the cylinder. The radius controls both the top circle and the wrapped rectangle. Which part of the net uses the radius twice?");

  assert.equal(normalized, [
    "Start with the cylinder.",
    "- The radius controls both the top circle and the wrapped rectangle.",
    "Which part of the net uses the radius twice?",
  ].join("\n"));
});
