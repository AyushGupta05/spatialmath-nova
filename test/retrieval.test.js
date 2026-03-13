import test from "node:test";
import assert from "node:assert/strict";

import { retrieveLessonExemplar } from "../server/services/plan/retrieval.js";

test("retrieveLessonExemplar uses stable fallback retrieval for a cylinder worksheet prompt", async () => {
  const result = await retrieveLessonExemplar({
    questionText: "A student uploads a cylinder worksheet diagram and asks what happens to the volume when the radius doubles.",
    sourceSummary: {
      cleanedQuestion: "A student uploads a cylinder worksheet diagram and asks what happens to the volume when the radius doubles.",
    },
  });

  assert.equal(result.exemplar.id, "diagram-cylinder");
  assert.ok(["default", "embeddings", "lexical"].includes(result.strategy));
});
