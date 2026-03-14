import test from "node:test";
import assert from "node:assert/strict";

import {
  clearWorkingModelCache,
  getWorkingModelId,
} from "../server/services/modelRouter.js";
import {
  converseStreamWithModelFailover,
  runWithModelFailover,
} from "../server/services/modelInvoker.js";

test.beforeEach(() => {
  clearWorkingModelCache();
});

test("runWithModelFailover falls through to a working candidate and caches it", async () => {
  const attempted = [];
  const result = await runWithModelFailover("text", async (modelId) => {
    attempted.push(modelId);
    if (modelId === "bad-model") {
      throw new Error("The provided model identifier is invalid.");
    }
    return `ok:${modelId}`;
  }, {
    modelIds: ["bad-model", "good-model"],
  });

  assert.equal(result, "ok:good-model");
  assert.deepEqual(attempted, ["bad-model", "good-model"]);
  assert.equal(getWorkingModelId("text"), "good-model");
});

test("converseStreamWithModelFailover retries a bad primary candidate before streaming", async () => {
  const attempted = [];
  const chunks = [];
  for await (const chunk of converseStreamWithModelFailover("text", "system", [], {}, {
    modelIds: ["bad-model", "good-model"],
    converseNovaStream: async function* fakeStream(modelId) {
      attempted.push(modelId);
      if (modelId === "bad-model") {
        throw new Error("The provided model identifier is invalid.");
      }
      yield "hello";
      yield " world";
    },
  })) {
    chunks.push(chunk);
  }

  assert.deepEqual(attempted, ["bad-model", "good-model"]);
  assert.deepEqual(chunks, ["hello", " world"]);
  assert.equal(getWorkingModelId("text"), "good-model");
});
