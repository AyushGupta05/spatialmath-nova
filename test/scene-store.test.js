import test from "node:test";
import assert from "node:assert/strict";

import { createSceneStore } from "../src/scene/sceneStore.js";

test("scene store on() unsubscribe detaches listener", () => {
  const store = createSceneStore();
  const events = [];

  const unsubscribe = store.on("objects", (detail) => {
    events.push(detail.reason);
  });

  store.replaceObjects([], "first");
  unsubscribe();
  store.replaceObjects([], "second");

  assert.deepEqual(events, ["first"]);
});
