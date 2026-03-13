import { normalizeSceneObject } from "./schema.js";

export function createSceneStore() {
  const target = new EventTarget();
  let state = {
    objects: [],
    selectedObjectId: null,
    lastChange: null,
  };

  function emit(type, detail) {
    target.dispatchEvent(new CustomEvent(type, { detail }));
    target.dispatchEvent(new CustomEvent("change", { detail: { type, ...detail } }));
  }

  function snapshot() {
    return {
      objects: state.objects.map((objectSpec) => normalizeSceneObject(objectSpec)),
      selectedObjectId: state.selectedObjectId,
      lastChange: state.lastChange,
    };
  }

  function replaceObjects(objects, reason = "replace") {
    state = {
      ...state,
      objects: objects.map((objectSpec) => normalizeSceneObject(objectSpec)),
      lastChange: { reason, at: Date.now() },
    };
    emit("objects", { objects: state.objects, reason });
  }

  function upsertObject(objectSpec, reason = "upsert") {
    const normalized = normalizeSceneObject(objectSpec);
    const existingIndex = state.objects.findIndex((candidate) => candidate.id === normalized.id);
    const nextObjects = [...state.objects];
    if (existingIndex >= 0) nextObjects.splice(existingIndex, 1, normalized);
    else nextObjects.push(normalized);
    state = {
      ...state,
      objects: nextObjects,
      lastChange: { reason, at: Date.now(), id: normalized.id },
    };
    emit("objects", { objects: state.objects, reason, object: normalized });
    return normalized;
  }

  function removeObject(id, reason = "remove") {
    const nextObjects = state.objects.filter((candidate) => candidate.id !== id);
    state = {
      ...state,
      objects: nextObjects,
      selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
      lastChange: { reason, at: Date.now(), id },
    };
    emit("objects", { objects: state.objects, reason, id });
  }

  function setSelection(id) {
    state = {
      ...state,
      selectedObjectId: id || null,
      lastChange: { reason: "selection", at: Date.now(), id: id || null },
    };
    emit("selection", { selectedObjectId: state.selectedObjectId });
  }

  return {
    snapshot,
    replaceObjects,
    upsertObject,
    removeObject,
    setSelection,
    get state() {
      return state;
    },
    on(eventName, handler) {
      const listener = (event) => handler(event.detail);
      target.addEventListener(eventName, listener);
      return () => target.removeEventListener(eventName, listener);
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  };
}
