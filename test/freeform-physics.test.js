import test from "node:test";
import assert from "node:assert/strict";

import { generateFreeformTutorTurn } from "../server/services/freeformTutor.js";

test("generateFreeformTutorTurn can load an electric-field scene without an active lesson", async () => {
  const turn = await generateFreeformTutorTurn({
    sceneSnapshot: { objects: [], selectedObjectId: null },
    sceneContext: null,
    learningState: {},
    userMessage: "Show me an electric field with opposite charges.",
  });

  const replaceScene = turn.meta.sceneCommand.operations.find((operation) => operation.kind === "replace_scene");
  assert.ok(replaceScene);
  assert.ok(replaceScene.objects.some((objectSpec) => objectSpec.metadata?.physics?.kind === "charge"));
  assert.match(turn.text, /field/i);
});
