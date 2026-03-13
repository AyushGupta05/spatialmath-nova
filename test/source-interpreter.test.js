import test from "node:test";
import assert from "node:assert/strict";

import { contentBlocksForSource } from "../server/services/plan/sourceInterpreter.js";

test("contentBlocksForSource puts the image before text for multimodal parsing", () => {
  const blocks = contentBlocksForSource({
    questionText: "Find the volume of the cylinder.",
    imageAsset: {
      format: "png",
      bytes: Uint8Array.from([137, 80, 78, 71]),
    },
  });

  assert.equal(blocks[0].image.format, "png");
  assert.match(blocks[1].text, /Question text/i);
});
