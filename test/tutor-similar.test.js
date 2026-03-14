import test from "node:test";
import assert from "node:assert/strict";

import { normalizeScenePlan } from "../src/ai/planSchema.js";
import { generateSimilarTutorQuestions, rankChallengeMatches } from "../server/services/tutorSimilar.js";

const challengeBank = [
  {
    id: "cube-volume-1",
    title: "Volume of a Cube",
    category: "volume",
    question: "What is the volume of a cube with side length 4 units?",
  },
  {
    id: "inscribed-1",
    title: "Inscribed Sphere in Cube",
    category: "spatial",
    question: "A sphere is inscribed in a cube of side 6. What fraction of the cube's volume does the sphere occupy?",
  },
];

test("rankChallengeMatches keeps only genuinely close built-in matches", () => {
  const plan = normalizeScenePlan({
    problem: {
      question: "What is the volume of a cube with side length 9 units?",
      questionType: "volume",
    },
  });

  const ranked = rankChallengeMatches(plan, challengeBank);

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].challenge.id, "cube-volume-1");
});

test("generateSimilarTutorQuestions avoids unrelated spatial challenge matches for analytic prompts", async () => {
  const plan = normalizeScenePlan({
    problem: {
      question: "A line passes through A(1, 2, -1) with direction vector (2, -1, 3). A plane has equation 2x - y + 2z = 7. Find the acute angle between the line and the plane.",
      questionType: "spatial",
    },
    analyticContext: {
      subtype: "line_plane_angle",
    },
  });

  const suggestions = await generateSimilarTutorQuestions({
    plan,
    challengeBank,
    aiSuggestionGenerator: async () => [],
  });

  assert.equal(suggestions.length, 3);
  assert.ok(suggestions.every((item) => item.source === "template"));
  assert.ok(suggestions.every((item) => /angle between the line and the plane/i.test(item.prompt)));
});

test("generateSimilarTutorQuestions uses close challenge-bank matches before template fallback", async () => {
  const plan = normalizeScenePlan({
    problem: {
      question: "Find the volume of a cube with side length 10 units.",
      questionType: "volume",
    },
  });

  const suggestions = await generateSimilarTutorQuestions({
    plan,
    challengeBank,
    aiSuggestionGenerator: async () => [],
  });

  assert.equal(suggestions.length, 3);
  assert.equal(suggestions[0].source, "challenge-bank");
  assert.equal(suggestions[0].label, "Volume of a Cube");
});
