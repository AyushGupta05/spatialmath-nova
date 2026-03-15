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
    experienceMode: "analytic_auto",
    learningMoments: {
      predict: {
        prompt: "Which visible value is the radius?",
      },
    },
    analyticContext: {
      subtype: "line_plane_intersection",
      entities: {
        points: [{ id: "p", label: "P", coordinates: [1, -2, 3] }],
        lines: [{ id: "line", label: "Line", point: [1, -2, 3], direction: [2, 1, -1] }],
        planes: [{ id: "plane", label: "Plane", normal: [2, -1, 1], constant: 7 }],
      },
      derivedValues: { parameterValue: 0 },
      formulaCard: {
        title: "Line-Plane Intersection",
        formula: "n · (p + td) = c",
        explanation: "Substitute the line into the plane.",
      },
      solutionSteps: [{
        id: "analytic-step-1",
        title: "Write the line equation",
        formula: "r = p + td",
        explanation: "Start with the vector equation of the line.",
      }],
    },
    sceneMoments: [{
      id: "observe",
      title: "Observe",
      prompt: "Rotate the scene.",
      goal: "Spot the line and plane.",
      focusTargets: ["primary-object"],
      visibleObjectIds: ["primary-object"],
      visibleOverlayIds: ["analytic-axes"],
      cameraBookmarkId: "camera-1",
      revealFormula: false,
      revealFullSolution: false,
    }],
    sceneOverlays: [{
      id: "analytic-axes",
      type: "coordinate-frame",
      bounds: {
        x: [-4, 4],
        y: [-4, 4],
        z: [-4, 4],
        tickStep: 1,
      },
    }],
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
  assert.equal(plan.experienceMode, "analytic_auto");
  assert.equal(plan.representationMode, "3d");
  assert.equal(plan.objectSuggestions[0].roles[0], "primary");
  assert.deepEqual(plan.objectSuggestions[0].object.metadata.roles, ["primary", "cylinder"]);
  assert.equal(plan.learningMoments.predict.prompt, "Which visible value is the radius?");
  assert.equal(plan.analyticContext?.formulaCard?.formula, "n · (p + td) = c");
  assert.equal(plan.sceneMoments[0].id, "observe");
  assert.equal(plan.sceneOverlays[0].type, "coordinate-frame");
  assert.equal(plan.learningMoments.reflect.title, "Reflect");
  assert.ok(plan.learningMoments.challenge.whyItMatters.length > 0);
  assert.equal(plan.agentTrace[0].id, "source-interpreter");
  assert.equal(plan.demoPreset.recommendedCategory, "Best of Multimodal Understanding");
  assert.equal(plan.lessonStages.length, 1);
  assert.equal(plan.lessonStages[0].id, "step-main");
  assert.equal(plan.lessonStages[0].title, "Place the cylinder");
  assert.equal(plan.lessonStages[0].checkpointPrompt, "Does this look correct?");
  assert.ok(plan.lessonStages[0].suggestedActions.some((action) => action.kind === "preview-required-object"));
  assert.ok(plan.lessonStages[0].suggestedActions.some((action) => action.kind === "explain-stage"));
  assert.ok(plan.lessonStages[0].suggestedActions.some((action) => action.kind === "continue-stage"));
});

test("normalizeScenePlan infers a 2D companion mode for surface area and full 2D mode for nets", () => {
  const splitPlan = normalizeScenePlan({
    problem: {
      question: "Find the surface area of a cylinder with radius 3 and height 7.",
      questionType: "surface_area",
    },
    objectSuggestions: [{
      id: "primary-cylinder",
      object: {
        id: "cylinder-main",
        shape: "cylinder",
        params: { radius: 3, height: 7 },
      },
    }],
  });
  const flatPlan = normalizeScenePlan({
    problem: {
      question: "Draw the net of a cone with radius 4 and height 6.",
      questionType: "surface_area",
    },
    objectSuggestions: [{
      id: "primary-cone",
      object: {
        id: "cone-main",
        shape: "cone",
        params: { radius: 4, height: 6 },
      },
    }],
  });

  assert.equal(splitPlan.representationMode, "split_2d");
  assert.equal(flatPlan.representationMode, "2d");
});

test("normalizeScenePlan repairs named line endpoints and removes false origin narration", () => {
  const plan = normalizeScenePlan({
    problem: {
      question: "Find the angle between vectors AB and AC.",
      questionType: "spatial",
    },
    sourceSummary: {
      inputMode: "text",
      rawQuestion: "Given points A(1,1,0), B(5,1,0), and C(1,4,0), find the angle between AB and AC.",
      cleanedQuestion: "Find the angle between vectors AB and AC.",
      givens: [
        "A = (1,1,0)",
        "B = (5,1,0)",
        "C = (1,4,0)",
      ],
      labels: ["A", "B", "C"],
      relationships: [
        "AB and AC both start from A at the origin of the plane's coordinate system.",
      ],
      diagramSummary: "With A at the origin of the plane's coordinate system, B lies to the right and C lies above A.",
      conflicts: [],
    },
    sceneFocus: {
      concept: "Angle at A",
      primaryInsight: "Treat A as the origin before comparing the two vectors.",
      focusPrompt: "Use the shared start point to compare AB and AC.",
      judgeSummary: "A sits at the origin of the plane in the staged scene.",
    },
    objectSuggestions: [
      {
        id: "point-a",
        title: "Point A",
        object: {
          id: "point-a-object",
          label: "A",
          shape: "pointMarker",
          position: [1, 1, 0],
          params: { radius: 0.1 },
        },
      },
      {
        id: "point-b",
        title: "Point B",
        object: {
          id: "point-b-object",
          label: "B",
          shape: "pointMarker",
          position: [5, 1, 0],
          params: { radius: 0.1 },
        },
      },
      {
        id: "point-c",
        title: "Point C",
        object: {
          id: "point-c-object",
          label: "C",
          shape: "pointMarker",
          position: [1, 4, 0],
          params: { radius: 0.1 },
        },
      },
      {
        id: "vector-ab",
        title: "Vector AB",
        object: {
          id: "vector-ab-object",
          label: "AB",
          shape: "line",
          params: {
            start: [0, 0, 0],
            end: [4, 0, 0],
            thickness: 0.08,
          },
        },
      },
    ],
  });

  assert.deepEqual(plan.objectSuggestions.find((item) => item.id === "vector-ab")?.object?.params?.start, [1, 1, 0]);
  assert.deepEqual(plan.objectSuggestions.find((item) => item.id === "vector-ab")?.object?.params?.end, [5, 1, 0]);
  assert.doesNotMatch(plan.sourceSummary.diagramSummary, /\bA at the origin\b/i);
  assert.doesNotMatch(plan.sourceSummary.relationships[0], /\bA .* origin\b/i);
  assert.match(plan.sourceSummary.diagramSummary, /shared anchor point/i);
  assert.doesNotMatch(plan.sceneFocus.primaryInsight, /\bA .* origin\b/i);
  assert.match(plan.sceneFocus.primaryInsight, /shared anchor point/i);
});
