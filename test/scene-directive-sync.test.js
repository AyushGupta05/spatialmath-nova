import test from "node:test";
import assert from "node:assert/strict";

import { mergeRequiredSceneObjects, shouldSyncAnalyticScene } from "../src/ui/sceneDirectiveSync.js";

test("shouldSyncAnalyticScene does not rebuild the scene for same-stage tutor chat when required objects are present", () => {
  const shouldSync = shouldSyncAnalyticScene({
    stageId: "solve",
    lastAppliedStageId: "solve",
    snapshotObjects: [
      { id: "line-main" },
      { id: "plane-main" },
      { id: "intersection-point" },
      { id: "student-helper" },
    ],
    requiredObjects: [
      { id: "line-main" },
      { id: "plane-main" },
      { id: "intersection-point" },
    ],
  });

  assert.equal(shouldSync, false);
});

test("shouldSyncAnalyticScene rebuilds the scene when the lesson advances to a new analytic stage", () => {
  const shouldSync = shouldSyncAnalyticScene({
    stageId: "explain",
    lastAppliedStageId: "solve",
    snapshotObjects: [
      { id: "line-main" },
      { id: "plane-main" },
      { id: "intersection-point" },
    ],
    requiredObjects: [
      { id: "line-main" },
      { id: "plane-main" },
      { id: "intersection-point" },
      { id: "normal-guide" },
    ],
  });

  assert.equal(shouldSync, true);
});

test("shouldSyncAnalyticScene rebuilds the scene when a required analytic object has gone missing", () => {
  const shouldSync = shouldSyncAnalyticScene({
    stageId: "solve",
    lastAppliedStageId: "solve",
    snapshotObjects: [
      { id: "line-main" },
      { id: "plane-main" },
    ],
    requiredObjects: [
      { id: "line-main" },
      { id: "plane-main" },
      { id: "intersection-point" },
    ],
  });

  assert.equal(shouldSync, true);
});

test("mergeRequiredSceneObjects preserves the learner's current scene while adding missing analytic objects", () => {
  const merged = mergeRequiredSceneObjects(
    [
      { id: "line-main", position: [4, 5, 6] },
      { id: "student-helper", position: [9, 9, 9] },
    ],
    [
      { id: "line-main", position: [1, 2, 3] },
      { id: "plane-main", position: [0, 0, 0] },
    ]
  );

  assert.deepEqual(merged, [
    { id: "line-main", position: [4, 5, 6] },
    { id: "plane-main", position: [0, 0, 0] },
    { id: "student-helper", position: [9, 9, 9] },
  ]);
});
