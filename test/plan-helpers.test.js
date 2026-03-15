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

test("mergeGeneratedPlan keeps a Nova analytic scaffold intact", () => {
  const baseline = normalizeScenePlan({
    problem: {
      question: "Find the angle between vectors AB and AC.",
      questionType: "spatial",
      mode: "guided",
    },
    objectSuggestions: [
      {
        id: "baseline-a",
        object: {
          id: "baseline-a-object",
          shape: "pointMarker",
          label: "A",
          position: [0, 0, 0],
          params: { radius: 0.1 },
        },
      },
      {
        id: "baseline-b",
        object: {
          id: "baseline-b-object",
          shape: "pointMarker",
          label: "B",
          position: [1, 0, 0],
          params: { radius: 0.1 },
        },
      },
      {
        id: "baseline-c",
        object: {
          id: "baseline-c-object",
          shape: "pointMarker",
          label: "C",
          position: [0, 1, 0],
          params: { radius: 0.1 },
        },
      },
      {
        id: "baseline-ab",
        object: {
          id: "baseline-ab-object",
          shape: "line",
          label: "AB",
          params: { start: [0, 0, 0], end: [1, 0, 0], thickness: 0.08 },
        },
      },
    ],
    buildSteps: [{
      id: "baseline-step",
      title: "Baseline step",
      instruction: "Inspect the baseline scene.",
      action: "observe",
      suggestedObjectIds: ["baseline-a", "baseline-b", "baseline-c", "baseline-ab"],
      requiredObjectIds: ["baseline-a", "baseline-b", "baseline-c", "baseline-ab"],
    }],
  });

  const novaPlan = normalizeScenePlan({
    problem: {
      id: "nova-analytic",
      question: "ignored",
      questionType: "spatial",
      mode: "guided",
    },
    experienceMode: "analytic_auto",
    objectSuggestions: [
      {
        id: "nova-a",
        object: {
          id: "nova-a-object",
          shape: "pointMarker",
          label: "A",
          position: [1, 1, 0],
          params: { radius: 0.1 },
        },
      },
      {
        id: "nova-b",
        object: {
          id: "nova-b-object",
          shape: "pointMarker",
          label: "B",
          position: [5, 1, 0],
          params: { radius: 0.1 },
        },
      },
    ],
    buildSteps: [{
      id: "observe",
      title: "Observe",
      instruction: "Look at the points first.",
      action: "observe",
      suggestedObjectIds: ["nova-a", "nova-b"],
      requiredObjectIds: [],
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
      prompt: "Look at the plotted points.",
      goal: "See the givens first.",
      focusTargets: ["nova-a-object", "nova-b-object"],
      visibleObjectIds: ["nova-a", "nova-b"],
      visibleOverlayIds: ["analytic-axes"],
      cameraBookmarkId: "overview",
      revealFormula: false,
      revealFullSolution: false,
    }],
    answerScaffold: {
      formula: "cos(theta) = (AB · AC) / (|AB||AC|)",
    },
    analyticContext: {
      subtype: "angle_between_vectors",
      formulaCard: {
        title: "Angle Between Vectors",
        formula: "cos(theta) = (AB · AC) / (|AB||AC|)",
        explanation: "Compare the two vectors from the same anchor point.",
      },
      solutionSteps: [{
        id: "step-1",
        title: "Build the vectors",
        formula: "AB = B - A, AC = C - A",
        explanation: "Turn the points into vectors from the same anchor.",
      }],
    },
  });

  const merged = mergeGeneratedPlan({
    baselinePlan: baseline,
    novaPlan,
    workingQuestion: "Find the angle between vectors AB and AC.",
    mode: "guided",
  });

  assert.equal(merged.experienceMode, "analytic_auto");
  assert.equal(merged.objectSuggestions[0].id, "nova-a");
  assert.equal(merged.buildSteps[0].id, "observe");
  assert.equal(merged.sceneMoments[0].id, "observe");
  assert.equal(merged.answerScaffold.formula, "cos(theta) = (AB · AC) / (|AB||AC|)");
});
