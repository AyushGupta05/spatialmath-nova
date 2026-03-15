import test from "node:test";
import assert from "node:assert/strict";

import {
  sceneObjectBaseOpacity,
  shouldAccentIntersectionPoint,
  shouldAccentNormalLine,
} from "../src/scene/sceneVisuals.js";

test("manual planes stay opaque until they need fading", () => {
  const opacity = sceneObjectBaseOpacity({
    id: "user-plane",
    label: "Plane",
    shape: "plane",
    color: "#7cf7e4",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    params: { width: 6, depth: 6 },
    metadata: {},
  });

  assert.equal(opacity, 1);
});

test("analytic reference planes keep the translucent teaching style", () => {
  const opacity = sceneObjectBaseOpacity({
    id: "plane-main",
    label: "Plane",
    shape: "plane",
    color: "#7cf7e4",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    params: { width: 6, depth: 6 },
    metadata: {
      role: "plane",
      roles: ["plane", "reference"],
      normal: [2, -1, 2],
      equation: "2x - y + 2z = 7",
    },
  });

  assert.equal(opacity, 0.28);
});

test("teaching lines use a translucent always-visible style", () => {
  const opacity = sceneObjectBaseOpacity({
    id: "vector-ab",
    label: "AB",
    shape: "line",
    color: "#7cf7e4",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    params: {
      start: [1, 1, 0],
      end: [5, 1, 0],
      thickness: 0.08,
    },
    metadata: {
      role: "vector",
      roles: ["line", "vector"],
    },
  });

  assert.equal(opacity, 0.78);
});

test("intersection points are detected for highlight accents", () => {
  const accent = shouldAccentIntersectionPoint({
    id: "intersection-point",
    label: "Intersection",
    shape: "pointMarker",
    color: "#ffd966",
    position: [1, -2, 3],
    rotation: [0, 0, 0],
    params: { radius: 0.13 },
    metadata: { role: "result", roles: ["point", "result"] },
  });

  assert.equal(accent, true);
});

test("normal guide lines are detected for accent styling", () => {
  const accent = shouldAccentNormalLine({
    id: "normal-guide",
    label: "Normal",
    shape: "line",
    color: "#ffd966",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    params: {
      start: [0, 0, 0],
      end: [0, 3, 0],
      thickness: 0.06,
    },
    metadata: { role: "normal", roles: ["normal", "reference"] },
  });

  assert.equal(accent, true);
});
