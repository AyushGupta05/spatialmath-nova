import test from "node:test";
import assert from "node:assert/strict";

import { extractPlanPayload, MAX_IMAGE_BYTES } from "../server/services/planRequest.js";

test("extractPlanPayload rejects invalid multipart sceneSnapshot JSON", async () => {
  const form = new FormData();
  form.set("question", "Interpret this");
  form.set("sceneSnapshot", "{invalid-json");

  const request = new Request("http://localhost/api/plan", {
    method: "POST",
    body: form,
  });

  await assert.rejects(
    () => extractPlanPayload(request),
    /sceneSnapshot must be valid JSON/i
  );
});

test("extractPlanPayload rejects unsupported image mime types", async () => {
  const form = new FormData();
  form.set("question", "Interpret this");
  form.set("image", new File([Uint8Array.from([1, 2, 3])], "diagram.gif", { type: "image/gif" }));

  const request = new Request("http://localhost/api/plan", {
    method: "POST",
    body: form,
  });

  await assert.rejects(
    () => extractPlanPayload(request),
    /only png, jpeg, and webp images are supported/i
  );
});

test("extractPlanPayload rejects images larger than the maximum bytes limit", async () => {
  const oversized = new Uint8Array(MAX_IMAGE_BYTES + 1);
  const form = new FormData();
  form.set("question", "Interpret this");
  form.set("image", new File([oversized], "diagram.png", { type: "image/png" }));

  const request = new Request("http://localhost/api/plan", {
    method: "POST",
    body: form,
  });

  await assert.rejects(
    () => extractPlanPayload(request),
    /3\.75 MB or smaller/i
  );
});
