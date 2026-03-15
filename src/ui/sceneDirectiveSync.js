function objectIds(objects = []) {
  return (objects || [])
    .map((objectSpec) => objectSpec?.id || null)
    .filter(Boolean);
}

export function shouldSyncAnalyticScene({
  stageId = null,
  lastAppliedStageId = null,
  snapshotObjects = [],
  requiredObjects = [],
} = {}) {
  const snapshotIds = new Set(objectIds(snapshotObjects));
  if (!snapshotIds.size) return true;
  if (stageId && stageId !== lastAppliedStageId) return true;

  return objectIds(requiredObjects).some((id) => !snapshotIds.has(id));
}

export function mergeRequiredSceneObjects(existingObjects = [], requiredObjects = []) {
  const byId = new Map();

  (requiredObjects || []).forEach((objectSpec) => {
    if (!objectSpec?.id) return;
    byId.set(objectSpec.id, objectSpec);
  });

  // Preserve the current scene version for any object the learner has already moved or edited.
  (existingObjects || []).forEach((objectSpec) => {
    if (!objectSpec?.id) return;
    byId.set(objectSpec.id, objectSpec);
  });

  return [...byId.values()];
}
