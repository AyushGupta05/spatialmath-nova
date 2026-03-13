import test from "node:test";
import assert from "node:assert/strict";

import { normalizeScenePlan } from "../src/ai/planSchema.js";

test("normalizeScenePlan preserves lesson metadata and fills defaults", () => {
  const plan = normalizeScenePlan({
    problem: {
      question: "Find the volume of a cylinder with radius 3 and height 7.",
      questionType: "volume",
    },
    sourceSummary: {
      inputMode: "multimodal",
      rawQuestion: "Volume of cylinder",
      cleanedQuestion: "Find the volume of a cylinder with radius 3 and height 7.",
      givens: ["radius = 3", "height = 7"],
      labels: ["r", "h"],
      relationships: ["radius and height belong to the same cylinder"],
      diagramSummary: "A labelled cylinder diagram.",
      conflicts: ["Image labels radius as 4, but text says 3."],
    },
    sourceEvidence: {
      inputMode: "multimodal",
      givens: ["radius = 3", "height = 7"],
      diagramSummary: "A labelled cylinder diagram.",
      conflicts: ["Image labels radius as 4, but text says 3."],
    },
    sceneFocus: {
      concept: "radius vs height",
      primaryInsight: "Radius and height play different roles in the volume formula.",
      focusPrompt: "Focus on which measurement is radial and which is vertical.",
    },
    agentTrace: [{
      id: "source-interpreter",
      label: "Source Interpreter",
      status: "multimodal",
      summary: "Parsed text and image.",
    }],
    demoPreset: {
      title: "Judge demo",
      scriptBeat: "Turn the diagram into a scene.",
      recommendedCategory: "Best of Multimodal Understanding",
    },
    learningMoments: {
      predict: {
        prompt: "Which visible value is the radius?",
      },
    },
    objectSuggestions: [{
      id: "primary-object",
      title: "Cylinder model",
      roles: ["primary", "cylinder"],
      object: {
        id: "primary-object",
        shape: "cylinder",
        params: { radius: 3, height: 7 },
        metadata: { role: "primary" },
      },
    }],
    buildSteps: [{
      id: "step-main",
      title: "Place the cylinder",
      instruction: "Place the main cylinder.",
      action: "add",
      suggestedObjectIds: ["primary-object"],
      requiredObjectIds: ["primary-object"],
    }],
  });

  assert.equal(plan.sourceSummary.inputMode, "multimodal");
  assert.deepEqual(plan.sourceSummary.givens, ["radius = 3", "height = 7"]);
  assert.deepEqual(plan.sourceEvidence.conflicts, ["Image labels radius as 4, but text says 3."]);
  assert.equal(plan.sceneFocus.concept, "radius vs height");
  assert.equal(plan.objectSuggestions[0].roles[0], "primary");
  assert.deepEqual(plan.objectSuggestions[0].object.metadata.roles, ["primary", "cylinder"]);
  assert.equal(plan.learningMoments.predict.prompt, "Which visible value is the radius?");
  assert.equal(plan.learningMoments.reflect.title, "Reflect");
  assert.ok(plan.learningMoments.challenge.whyItMatters.length > 0);
  assert.equal(plan.agentTrace[0].id, "source-interpreter");
  assert.equal(plan.demoPreset.recommendedCategory, "Best of Multimodal Understanding");
  assert.equal(plan.lessonStages.length, 1);
  assert.equal(plan.lessonStages[0].id, "step-main");
  assert.equal(plan.lessonStages[0].title, "Place the cylinder");
  assert.equal(plan.lessonStages[0].checkpointPrompt, "Does this look correct?");
  assert.ok(plan.lessonStages[0].suggestedActions.some((action) => action.kind === "preview-required-object"));
  assert.ok(plan.lessonStages[0].suggestedActions.some((action) => action.kind === "build-manually"));
});
