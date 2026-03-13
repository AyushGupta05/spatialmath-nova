import test from "node:test";
import assert from "node:assert/strict";

import { normalizeScenePlan } from "../src/ai/planSchema.js";
import {
  buildStageConfig,
  computeLiveChallengeState,
  createLiveChallengeState,
} from "../src/ui/tutorLesson.js";

function makePlan() {
  return normalizeScenePlan({
    problem: {
      id: "lesson-1",
      question: "Find cylinder volume",
      questionType: "volume",
      mode: "guided",
    },
    sceneFocus: {
      concept: "cylinder volume",
      primaryInsight: "radius and height control volume",
      focusPrompt: "Focus on radius and height",
    },
    learningMoments: {
      orient: { title: "Orient", coachMessage: "Start", goal: "Goal", whyItMatters: "Why" },
      build: { title: "Build", coachMessage: "Build it", goal: "Build goal" },
      predict: { title: "Predict", coachMessage: "Predict", prompt: "What changes first?" },
      check: { title: "Check", coachMessage: "Check", goal: "Check goal" },
      reflect: { title: "Reflect", goal: "Reflect goal" },
      challenge: { title: "Challenge", prompt: "Challenge prompt", goal: "Challenge goal" },
    },
    objectSuggestions: [{
      id: "primary-object",
      title: "Cylinder",
      optional: false,
      object: {
        id: "primary-object",
        shape: "cylinder",
        label: "Cylinder",
        params: { radius: 1, height: 1 },
      },
    }],
    buildSteps: [{
      id: "step-1",
      title: "Place cylinder",
      instruction: "Place it",
      action: "add",
      suggestedObjectIds: ["primary-object"],
      requiredObjectIds: ["primary-object"],
    }],
    liveChallenge: {
      id: "live-1",
      title: "Double volume",
      metric: "volume",
      multiplier: 2,
      prompt: "Double it",
      tolerance: 0.04,
    },
  });
}

test("computeLiveChallengeState unlocks and marks completion when target is reached", () => {
  const plan = makePlan();
  const initialState = createLiveChallengeState(plan);
  const snapshot = {
    objects: [{
      id: "primary-object",
      shape: "cylinder",
      params: { radius: 1, height: 1 },
      metadata: {},
    }],
    selectedObjectId: null,
  };

  const unlocked = computeLiveChallengeState({
    plan,
    assessment: { answerGate: { allowed: true }, objectAssessments: [] },
    liveChallengeState: initialState,
    snapshot,
    getObject: () => null,
  });

  assert.equal(unlocked.liveChallenge?.unlocked, true);
  assert.ok(Number.isFinite(unlocked.liveChallenge?.baselineValue));
  assert.ok(Number.isFinite(unlocked.liveChallenge?.targetValue));

  const complete = computeLiveChallengeState({
    plan,
    assessment: { answerGate: { allowed: true }, objectAssessments: [] },
    liveChallengeState: unlocked.liveChallengeState,
    snapshot,
    getObject: () => ({
      id: "primary-object",
      shape: "cylinder",
      params: { radius: 1, height: 2 },
    }),
  });

  assert.equal(complete.liveChallenge?.complete, true);
  assert.ok((complete.liveChallenge?.progress || 0) >= 1);
});

test("buildStageConfig returns stage-specific messaging for build and predict stages", () => {
  const plan = makePlan();

  const buildConfig = buildStageConfig({
    plan,
    assessment: { guidance: { missingTitles: ["Radius marker"], coachFeedback: "Add helper", readyForPrediction: false } },
    learningStage: "build",
    currentStep: { title: "Build step", instruction: "Place object" },
    predictionState: { prompt: "", submitted: false },
    selectedObject: null,
    liveChallenge: null,
    lastSceneFeedback: "Feedback",
    activeChallenge: null,
  });

  assert.equal(buildConfig.stage, "build");
  assert.match(buildConfig.message, /still need attention/i);
  assert.equal(buildConfig.advanceLabel, "Keep Building");

  const predictConfig = buildStageConfig({
    plan,
    assessment: { guidance: {} },
    learningStage: "predict",
    currentStep: null,
    predictionState: { prompt: "Predict now", submitted: false },
    selectedObject: { label: "Cylinder" },
    liveChallenge: null,
    lastSceneFeedback: "Feedback",
    activeChallenge: null,
  });

  assert.equal(predictConfig.stage, "predict");
  assert.equal(predictConfig.showPrediction, true);
  assert.match(predictConfig.feedback, /Use Cylinder/i);
  assert.equal(predictConfig.advanceLabel, "Save Prediction");
});
