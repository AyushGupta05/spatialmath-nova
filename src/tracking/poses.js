export function lmkDist(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function palmScale(hand) {
  if (!hand) return 1;
  // stable hand size reference
  return Math.max(1e-4, lmkDist(hand[0], hand[9]));
}

function midpoint(a, b) {
  if (!a || !b) return null;
  return {
    x: (a.x + b.x) * 0.5,
    y: (a.y + b.y) * 0.5,
    z: (a.z + b.z) * 0.5,
  };
}

export function isFistPose(hand) {
  if (!hand) return false;
  const scale = palmScale(hand);
  const wrist = hand[0];

  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  const mcps = [5, 9, 13, 17];

  // 1) Fingertips should sit close to palm center/wrist for a fist
  const tipToWrist = tips.map((i) => lmkDist(hand[i], wrist) / scale);
  const avgTipToWrist = tipToWrist.reduce((a, b) => a + b, 0) / tipToWrist.length;

  // 2) Fingers should be tightly curled: tip not farther than pip/mcp from wrist
  let curledCount = 0;
  for (let i = 0; i < tips.length; i += 1) {
    const td = lmkDist(hand[tips[i]], wrist);
    const pd = lmkDist(hand[pips[i]], wrist);
    const md = lmkDist(hand[mcps[i]], wrist);
    if (td <= Math.max(pd, md) * 1.02) curledCount += 1;
  }

  // 2b) Fingertips must be drawn inward toward palm center (not semi-open)
  const palmCenter = {
    x: (hand[0].x + hand[5].x + hand[9].x + hand[13].x + hand[17].x) / 5,
    y: (hand[0].y + hand[5].y + hand[9].y + hand[13].y + hand[17].y) / 5,
    z: (hand[0].z + hand[5].z + hand[9].z + hand[13].z + hand[17].z) / 5,
  };
  const avgTipToPalm = tips
    .map((i) => lmkDist(hand[i], palmCenter) / scale)
    .reduce((a, b) => a + b, 0) / tips.length;

  // 2c) Knuckle-fist silhouette: each fingertip should be close to/behind its MCP in extension direction.
  // In MediaPipe image coords, more open fingers usually have noticeably smaller y at tips.
  // For fist, tip y tends to be near or greater than MCP y (folded back toward palm).
  let foldedSilhouetteCount = 0;
  for (let i = 0; i < tips.length; i += 1) {
    const tip = hand[tips[i]];
    const mcp = hand[mcps[i]];
    if ((tip.y - mcp.y) > -0.02) foldedSilhouetteCount += 1;
  }

  // 3) Thumb should also be tucked (tip close to palm)
  const thumbToPalm = lmkDist(hand[4], palmCenter) / scale;
  const thumbTucked = (lmkDist(hand[4], wrist) / scale) < 1.24 && thumbToPalm < 0.98;

  // Slightly relaxed closed-fist gate so delete doesn't require a perfect fist.
  return (
    avgTipToWrist < 1.14 &&
    avgTipToPalm < 0.95 &&
    curledCount >= 3 &&
    foldedSilhouetteCount >= 2 &&
    thumbTucked
  );
}

export function isThumbsUpPose(hand) {
  if (!hand) return false;
  const scale = palmScale(hand);
  const wrist = hand[0];
  const palmCenter = {
    x: (hand[0].x + hand[5].x + hand[9].x + hand[13].x + hand[17].x) / 5,
    y: (hand[0].y + hand[5].y + hand[9].y + hand[13].y + hand[17].y) / 5,
    z: (hand[0].z + hand[5].z + hand[9].z + hand[13].z + hand[17].z) / 5,
  };
  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  const mcps = [5, 9, 13, 17];

  let curledCount = 0;
  for (let i = 0; i < tips.length; i += 1) {
    const tip = hand[tips[i]];
    const tipToPalm = lmkDist(tip, palmCenter) / scale;
    const tipToWrist = lmkDist(tip, wrist);
    const pipToWrist = lmkDist(hand[pips[i]], wrist);
    const mcpToWrist = lmkDist(hand[mcps[i]], wrist);
    if (tipToPalm < 0.96 && tipToWrist <= Math.max(pipToWrist, mcpToWrist) * 1.05) {
      curledCount += 1;
    }
  }

  const thumbTip = hand[4];
  const thumbIp = hand[3];
  const thumbMcp = hand[2];
  const thumbExtended =
    (lmkDist(thumbTip, wrist) / scale) > 1.35 &&
    (lmkDist(thumbTip, palmCenter) / scale) > 1.08 &&
    (lmkDist(thumbTip, thumbMcp) / scale) > 0.52 &&
    lmkDist(thumbTip, wrist) > lmkDist(thumbIp, wrist) * 1.08;
  const thumbAbovePalm = thumbTip.y < palmCenter.y - 0.02;
  const thumbAboveFingers = thumbTip.y < (Math.min(...tips.map((idx) => hand[idx].y)) - 0.01);

  return thumbExtended && curledCount >= 3 && thumbAbovePalm && thumbAboveFingers;
}

export function isThumbsDownPose(hand) {
  if (!hand) return false;
  const scale = palmScale(hand);
  const wrist = hand[0];
  const palmCenter = {
    x: (hand[0].x + hand[5].x + hand[9].x + hand[13].x + hand[17].x) / 5,
    y: (hand[0].y + hand[5].y + hand[9].y + hand[13].y + hand[17].y) / 5,
    z: (hand[0].z + hand[5].z + hand[9].z + hand[13].z + hand[17].z) / 5,
  };
  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  const mcps = [5, 9, 13, 17];

  let curledCount = 0;
  for (let i = 0; i < tips.length; i += 1) {
    const tip = hand[tips[i]];
    const tipToPalm = lmkDist(tip, palmCenter) / scale;
    const tipToWrist = lmkDist(tip, wrist);
    const pipToWrist = lmkDist(hand[pips[i]], wrist);
    const mcpToWrist = lmkDist(hand[mcps[i]], wrist);
    if (tipToPalm < 0.98 && tipToWrist <= Math.max(pipToWrist, mcpToWrist) * 1.06) {
      curledCount += 1;
    }
  }

  const thumbTip = hand[4];
  const thumbIp = hand[3];
  const thumbMcp = hand[2];
  const thumbExtended =
    (lmkDist(thumbTip, wrist) / scale) > 1.32 &&
    (lmkDist(thumbTip, palmCenter) / scale) > 1.04 &&
    (lmkDist(thumbTip, thumbMcp) / scale) > 0.48 &&
    lmkDist(thumbTip, wrist) > lmkDist(thumbIp, wrist) * 1.05;
  const thumbBelowPalm = thumbTip.y > palmCenter.y + 0.025;
  const thumbBelowFingers = thumbTip.y > (Math.max(...tips.map((idx) => hand[idx].y)) + 0.01);

  return thumbExtended && curledCount >= 3 && thumbBelowPalm && thumbBelowFingers;
}

export function isDirectPinchPose(hand) {
  if (!hand) return false;
  const scale = palmScale(hand);
  const wrist = hand[0];
  const palmCenter = {
    x: (hand[0].x + hand[5].x + hand[9].x + hand[13].x + hand[17].x) / 5,
    y: (hand[0].y + hand[5].y + hand[9].y + hand[13].y + hand[17].y) / 5,
    z: (hand[0].z + hand[5].z + hand[9].z + hand[13].z + hand[17].z) / 5,
  };
  const thumbTip = hand[4];
  const indexTip = hand[8];
  const thumbIp = hand[3];
  const indexDip = hand[7];
  const pinchMid = midpoint(thumbTip, indexTip);
  const pinchRatio = lmkDist(thumbTip, indexTip) / scale;
  const pinchFrontOfPalm = pinchMid ? (lmkDist(pinchMid, palmCenter) / scale) > 0.4 : false;
  const thumbLeading = lmkDist(thumbTip, wrist) >= lmkDist(thumbIp, wrist) * 0.98;
  const indexLeading = lmkDist(indexTip, wrist) >= lmkDist(indexDip, wrist) * 0.98;
  return pinchRatio < 0.28 && pinchFrontOfPalm && thumbLeading && indexLeading;
}

/**
 * Compute the wrist twist angle from the knuckle line (index MCP → pinky MCP).
 * Returns a value in [-π, π] that changes as the wrist pronates/supinates.
 */
export function computeWristAngle(hand) {
  if (!hand) return null;
  const indexMcp = hand[5];
  const pinkyMcp = hand[17];
  if (!indexMcp || !pinkyMcp) return null;
  return Math.atan2(pinkyMcp.y - indexMcp.y, pinkyMcp.x - indexMcp.x);
}

/**
 * Palm-open pose: hand is visible but not fisting and not pinching.
 * Used to activate wrist-rotation mode for a selected object.
 */
export function isPalmOpenPose(hand) {
  if (!hand) return false;
  return !isFistPose(hand) && !isDirectPinchPose(hand);
}

export function isLinePointPinchPose(hand) {
  if (!hand) return false;
  const scale = palmScale(hand);
  const wrist = hand[0];
  const palmCenter = {
    x: (hand[0].x + hand[5].x + hand[9].x + hand[13].x + hand[17].x) / 5,
    y: (hand[0].y + hand[5].y + hand[9].y + hand[13].y + hand[17].y) / 5,
    z: (hand[0].z + hand[5].z + hand[9].z + hand[13].z + hand[17].z) / 5,
  };
  const thumbTip = hand[4];
  const indexTip = hand[8];
  const thumbIp = hand[3];
  const indexDip = hand[7];
  const pinchMid = midpoint(thumbTip, indexTip);
  const pinchRatio = lmkDist(thumbTip, indexTip) / scale;
  const pinchFrontOfPalm = pinchMid ? (lmkDist(pinchMid, palmCenter) / scale) > 0.34 : false;
  const thumbReady = lmkDist(thumbTip, wrist) >= lmkDist(thumbIp, wrist) * 0.95;
  const indexReady = lmkDist(indexTip, wrist) >= lmkDist(indexDip, wrist) * 0.97;
  return pinchRatio < 0.34 && pinchFrontOfPalm && thumbReady && indexReady;
}

export function isPointPose(hand) {
  if (!hand) return false;
  const scale = palmScale(hand);
  const wrist = hand[0];
  const palmCenter = {
    x: (hand[0].x + hand[5].x + hand[9].x + hand[13].x + hand[17].x) / 5,
    y: (hand[0].y + hand[5].y + hand[9].y + hand[13].y + hand[17].y) / 5,
    z: (hand[0].z + hand[5].z + hand[9].z + hand[13].z + hand[17].z) / 5,
  };
  const curledTips = [12, 16, 20];
  const curledPips = [10, 14, 18];
  const curledMcps = [9, 13, 17];

  let curledCount = 0;
  for (let i = 0; i < curledTips.length; i += 1) {
    const tip = hand[curledTips[i]];
    const tipToPalm = lmkDist(tip, palmCenter) / scale;
    const tipToWrist = lmkDist(tip, wrist);
    const pipToWrist = lmkDist(hand[curledPips[i]], wrist);
    const mcpToWrist = lmkDist(hand[curledMcps[i]], wrist);
    if (tipToPalm < 1 && tipToWrist <= Math.max(pipToWrist, mcpToWrist) * 1.06) {
      curledCount += 1;
    }
  }

  const indexTip = hand[8];
  const indexPip = hand[6];
  const indexMcp = hand[5];
  const indexExtended =
    (lmkDist(indexTip, palmCenter) / scale) > 1.08 &&
    (lmkDist(indexTip, wrist) / scale) > 1.42 &&
    lmkDist(indexTip, wrist) > lmkDist(indexPip, wrist) * 1.12 &&
    indexTip.y < indexPip.y - 0.03 &&
    indexTip.y < indexMcp.y - 0.06;

  const thumbTip = hand[4];
  const thumbRelaxed = (lmkDist(thumbTip, palmCenter) / scale) < 1.2;

  return indexExtended && curledCount >= 3 && thumbRelaxed;
}

export function isRotatePose(hand) {
  if (!hand) return false;
  const scale = palmScale(hand);
  const wrist = hand[0];
  const palmCenter = {
    x: (hand[0].x + hand[5].x + hand[9].x + hand[13].x + hand[17].x) / 5,
    y: (hand[0].y + hand[5].y + hand[9].y + hand[13].y + hand[17].y) / 5,
    z: (hand[0].z + hand[5].z + hand[9].z + hand[13].z + hand[17].z) / 5,
  };
  const indexTip = hand[8];
  const indexPip = hand[6];
  const indexMcp = hand[5];
  const middleTip = hand[12];
  const middlePip = hand[10];
  const middleMcp = hand[9];
  const ringTip = hand[16];
  const ringPip = hand[14];
  const ringMcp = hand[13];
  const pinkyTip = hand[20];
  const pinkyPip = hand[18];
  const pinkyMcp = hand[17];
  const thumbTip = hand[4];
  const thumbIp = hand[3];
  const thumbMcp = hand[2];

  const indexExtended =
    (lmkDist(indexTip, palmCenter) / scale) > 1.02 &&
    lmkDist(indexTip, wrist) > lmkDist(indexPip, wrist) * 1.08 &&
    lmkDist(indexTip, wrist) > lmkDist(indexMcp, wrist) * 1.18;
  const middleExtended =
    (lmkDist(middleTip, palmCenter) / scale) > 1.02 &&
    lmkDist(middleTip, wrist) > lmkDist(middlePip, wrist) * 1.08 &&
    lmkDist(middleTip, wrist) > lmkDist(middleMcp, wrist) * 1.18;
  const ringExtended =
    (lmkDist(ringTip, palmCenter) / scale) > 0.96 &&
    lmkDist(ringTip, wrist) > lmkDist(ringPip, wrist) * 1.05 &&
    lmkDist(ringTip, wrist) > lmkDist(ringMcp, wrist) * 1.12;
  const pinkyExtended =
    (lmkDist(pinkyTip, palmCenter) / scale) > 0.92 &&
    lmkDist(pinkyTip, wrist) > lmkDist(pinkyPip, wrist) * 1.04 &&
    lmkDist(pinkyTip, wrist) > lmkDist(pinkyMcp, wrist) * 1.08;
  const spreadDistances = [
    lmkDist(indexTip, middleTip) / scale,
    lmkDist(middleTip, ringTip) / scale,
    lmkDist(ringTip, pinkyTip) / scale,
  ];
  const spreadCount = spreadDistances.filter((distance) => distance > 0.2).length;
  const thumbOpen =
    (lmkDist(thumbTip, palmCenter) / scale) > 0.92 &&
    (lmkDist(thumbTip, thumbMcp) / scale) > 0.48 &&
    lmkDist(thumbTip, wrist) > lmkDist(thumbIp, wrist) * 1.04;
  const extendedCount = [indexExtended, middleExtended, ringExtended, pinkyExtended].filter(Boolean).length;

  return indexExtended && middleExtended && extendedCount >= 3 && spreadCount >= 2 && thumbOpen;
}
