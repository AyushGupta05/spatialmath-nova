import test from "node:test";
import assert from "node:assert/strict";

import { promoteNovaPlanToAnalyticAuto } from "../server/services/plan/novaAnalyticAuto.js";

test("promoteNovaPlanToAnalyticAuto upgrades staged vector lessons into analytic auto mode", () => {
  const question = "Given points A(1, 1, 0), B(5, 1, 0), and C(1, 4, 0), find the angle between vectors AB and AC.";
  const promoted = promoteNovaPlanToAnalyticAuto({
    problem: {
      id: "nova-angle",
      question,
      questionType: "spatial",
      mode: "guided",
    },
    overview: "Build the point scene first, then connect the vectors before using the dot product formula.",
    sceneFocus: {
      concept: "angle between vectors",
      primaryInsight: "The angle at A comes from comparing how vectors AB and AC point away from the same anchor.",
      focusPrompt: "Start from the shared anchor point A, then compare the two vector directions.",
      judgeSummary: "The learner first plots the points, then reveals the vectors, then connects them to the formula.",
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
          rotation: [0, 0, 0],
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
          rotation: [0, 0, 0],
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
          rotation: [0, 0, 0],
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
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          params: {
            start: [1, 1, 0],
            end: [5, 1, 0],
            thickness: 0.06,
          },
          metadata: {
            role: "line",
            roles: ["line", "vector"],
          },
        },
      },
      {
        id: "vector-ac",
        title: "Vector AC",
        object: {
          id: "vector-ac-object",
          label: "AC",
          shape: "line",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          params: {
            start: [1, 1, 0],
            end: [1, 4, 0],
            thickness: 0.06,
          },
          metadata: {
            role: "line",
            roles: ["line", "vector"],
          },
        },
      },
    ],
    buildSteps: [
      {
        id: "plot-points",
        title: "Plot the points",
        instruction: "Start by placing A, B, and C on the coordinate grid.",
        hint: "The coordinates give the exact positions of the three points.",
        action: "observe",
        suggestedObjectIds: ["point-a", "point-b", "point-c"],
        requiredObjectIds: ["point-a", "point-b", "point-c"],
        highlightObjectIds: ["point-a-object", "point-b-object", "point-c-object"],
      },
      {
        id: "draw-vectors",
        title: "Draw the vectors",
        instruction: "Connect A to B and A to C so the two vectors are visible from the same anchor.",
        hint: "AB and AC should both begin at A.",
        action: "observe",
        suggestedObjectIds: ["vector-ab", "vector-ac"],
        requiredObjectIds: ["vector-ab", "vector-ac"],
        highlightObjectIds: ["vector-ab-object", "vector-ac-object", "point-a-object"],
      },
      {
        id: "compare-angle",
        title: "Compare the angle",
        instruction: "Use the two visible vectors to reason about the angle before evaluating the formula.",
        hint: "The dot product formula maps directly onto the two vectors in the scene.",
        action: "answer",
        suggestedObjectIds: ["vector-ab", "vector-ac"],
        requiredObjectIds: [],
        highlightObjectIds: ["vector-ab-object", "vector-ac-object"],
      },
    ],
    answerScaffold: {
      finalAnswer: "90°",
      unit: "degrees",
      formula: "cos(theta) = (AB · AC) / (|AB||AC|)",
      explanation: "Compare the two vectors from the same anchor, then use the dot product to compute the angle.",
      checks: ["Find AB.", "Find AC.", "Apply the dot product formula."],
    },
  }, {
    questionText: question,
    sourceSummary: {
      cleanedQuestion: question,
    },
  });

  assert.equal(promoted.experienceMode, "analytic_auto");
  assert.equal(promoted.sceneMoments.length, 3);
  assert.deepEqual(promoted.sceneMoments[0].visibleObjectIds, ["point-a", "point-b", "point-c"]);
  assert.ok(promoted.sceneMoments[1].visibleObjectIds.includes("vector-ab"));
  assert.ok(promoted.sceneMoments[2].revealFormula);
  assert.ok(promoted.sceneMoments[2].revealFullSolution);
  assert.ok(promoted.sceneOverlays.some((overlay) => overlay.id === "analytic-axes"));
  assert.ok(promoted.sceneOverlays.some((overlay) => overlay.id === "analytic-formula"));
  assert.equal(promoted.buildSteps[0].id, "plot-points");
  assert.deepEqual(promoted.buildSteps[0].suggestedObjectIds, ["point-a", "point-b", "point-c"]);
  assert.equal(promoted.analyticContext?.formulaCard?.formula, "cos(theta) = (AB · AC) / (|AB||AC|)");
  assert.deepEqual(promoted.analyticContext?.entities?.points?.[0]?.coordinates, [1, 1, 0]);
  assert.deepEqual(promoted.analyticContext?.entities?.lines?.[0]?.direction, [4, 0, 0]);
});
