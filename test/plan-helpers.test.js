import test from "node:test";
import assert from "node:assert/strict";

import { normalizeScenePlan } from "../src/ai/planSchema.js";
import { heuristicPlan, heuristicSourceSummary } from "../server/services/plan/heuristics.js";
import { mergeGeneratedPlan } from "../server/services/plan/mergePlan.js";

test("heuristicSourceSummary infers core metadata from text-only input", () => {
  const summary = heuristicSourceSummary({
    questionText: "Find the volume of a cylinder with radius 3 and height 7.",
    imageAsset: null,
  });

  assert.equal(summary.inputMode, "text");
  assert.match(summary.cleanedQuestion, /volume of a cylinder/i);
  assert.ok(summary.givens.some((value) => /radius/i.test(value)));
});

test("heuristicPlan builds a normalized volume lesson scaffold", () => {
  const sourceSummary = heuristicSourceSummary({
    questionText: "Find the volume of a cylinder with radius 3 and height 7.",
    imageAsset: null,
  });
  const plan = heuristicPlan(sourceSummary.cleanedQuestion, "guided", sourceSummary);

  assert.equal(plan.problem.questionType, "volume");
  assert.equal(plan.problem.mode, "guided");
  assert.equal(plan.answerScaffold.formula, "V = pi r^2 h");
  assert.equal(plan.objectSuggestions[0].id, "primary-object");
  assert.ok(plan.objectSuggestions.some((item) => item.id === "radius-helper"));
  assert.ok(plan.objectSuggestions.some((item) => item.id === "height-helper"));
  assert.equal(plan.buildSteps.length, 3);
  assert.equal(plan.liveChallenge?.metric, "volume");
});

test("mergeGeneratedPlan preserves merge precedence from baseline and nova plans", () => {
  const baseline = heuristicPlan("Find the volume of a cylinder with radius 3 and height 7.", "guided");
  const novaPlan = normalizeScenePlan({
    problem: {
      id: "nova-id",
      question: "ignored question",
      questionType: "volume",
      summary: "Nova summary",
      mode: "manual",
    },
    overview: "Nova overview",
    sourceSummary: {
      inputMode: "text",
      rawQuestion: "raw",
      cleanedQuestion: "cleaned",
      givens: ["g1"],
      labels: [],
      relationships: [],
      diagramSummary: "",
    },
    sceneFocus: {
      concept: "nova concept",
      primaryInsight: "nova insight",
      focusPrompt: "nova prompt",
      judgeSummary: "nova judge",
    },
    learningMoments: {
      orient: { title: "Nova orient" },
    },
    objectSuggestions: [baseline.objectSuggestions[0]],
    buildSteps: [
      ...baseline.buildSteps,
      {
        id: "step-extra",
        title: "Extra step",
        instruction: "Extra",
        action: "observe",
        suggestedObjectIds: [],
        requiredObjectIds: [],
      },
    ],
    cameraBookmarks: [{
      id: "nova-camera",
      label: "Nova camera",
      position: [4, 4, 4],
      target: [0, 0, 0],
    }],
    answerScaffold: {
      formula: "Nova formula",
    },
    challengePrompts: [{
      id: "nova-challenge",
      prompt: "Nova challenge",
      expectedKind: "numeric",
      expectedAnswer: null,
      tolerance: 0.1,
    }],
    liveChallenge: {
      id: "nova-live",
      title: "Nova live",
      metric: "volume",
      multiplier: 2,
      prompt: "Nova live prompt",
      tolerance: 0.04,
    },
  });

  const merged = mergeGeneratedPlan({
    baselinePlan: baseline,
    novaPlan,
    workingQuestion: "Final working question",
    mode: "guided",
  });

  assert.equal(merged.problem.question, "Final working question");
  assert.equal(merged.problem.mode, "guided");
  assert.equal(merged.overview, "Nova overview");
  assert.equal(merged.objectSuggestions.length, baseline.objectSuggestions.length);
  assert.equal(merged.buildSteps.length, baseline.buildSteps.length + 1);
  assert.equal(merged.cameraBookmarks[0].id, "nova-camera");
  assert.equal(merged.answerScaffold.formula, "Nova formula");
  assert.equal(merged.challengePrompts[0].id, "nova-challenge");
  assert.equal(merged.liveChallenge?.id, "nova-live");
});
