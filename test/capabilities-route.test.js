import test from "node:test";
import assert from "node:assert/strict";

import capabilitiesRoute from "../server/routes/capabilities.js";

test("GET /api/capabilities returns model and input capability flags", async () => {
  const response = await capabilitiesRoute.request("/");
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(typeof payload.models.text.preferred, "string");
  assert.equal(typeof payload.inputs.camera, "boolean");
  assert.equal(typeof payload.fallbacks.voice, "string");
});
