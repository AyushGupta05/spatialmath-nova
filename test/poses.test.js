import test from "node:test";
import assert from "node:assert/strict";

import { computeWristAngle } from "../src/tracking/poses.js";

function makeHand({ wrist, indexMcp, middleMcp, pinkyMcp }) {
  const hand = new Array(21).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));
  hand[0] = wrist;
  hand[5] = indexMcp;
  hand[9] = middleMcp;
  hand[17] = pinkyMcp;
  return hand;
}

test("computeWristAngle responds to wrist twist around the forearm axis", () => {
  const openPalm = makeHand({
    wrist: { x: 0, y: 0, z: 0 },
    middleMcp: { x: 0, y: 1, z: 0 },
    indexMcp: { x: -1, y: 1, z: 0 },
    pinkyMcp: { x: 1, y: 1, z: 0 },
  });
  const twistedPalm = makeHand({
    wrist: { x: 0, y: 0, z: 0 },
    middleMcp: { x: 0, y: 1, z: 0 },
    indexMcp: { x: 0, y: 1, z: -1 },
    pinkyMcp: { x: 0, y: 1, z: 1 },
  });

  const baseAngle = computeWristAngle(openPalm);
  const twistedAngle = computeWristAngle(twistedPalm);

  assert.ok(Number.isFinite(baseAngle));
  assert.ok(Number.isFinite(twistedAngle));
  assert.ok(Math.abs(twistedAngle - baseAngle) > 1);
});
