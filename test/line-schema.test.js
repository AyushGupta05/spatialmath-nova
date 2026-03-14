import test from "node:test";
import assert from "node:assert/strict";

import {
  baseSizeToParams,
  defaultParamsForShape,
  paramsToBaseSize,
} from "../src/scene/schema.js";

test("baseSizeToParams keeps line thickness decoupled from generic size", () => {
  const defaults = defaultParamsForShape("line");
  const params = baseSizeToParams("line", 6);

  assert.deepEqual(params.start, [0, 0.03, 0]);
  assert.deepEqual(params.end, [6, 0.03, 0]);
  assert.equal(params.thickness, defaults.thickness);
});

test("paramsToBaseSize for lines still tracks the visible span", () => {
  const baseSize = paramsToBaseSize("line", {
    start: [0, 0.03, 0],
    end: [4.5, 0.03, 0],
    thickness: 0.08,
  });

  assert.equal(baseSize, 4.5);
});
