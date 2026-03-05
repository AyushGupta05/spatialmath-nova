import { clamp, ema, dist3, angle2 } from "../core/math.js";

export class InteractionPipeline {
  constructor(options = {}) {
    this.alpha = options.alpha ?? 0.38;
    this.pinchOn = options.pinchOn ?? 0.03;
    this.pinchOff = options.pinchOff ?? 0.042;
    this.prevResize = 0;
    this.prevRotation = 0;
    this.prevJitter = 0;
    this.prevIndex = null;
    this.pinch = false;
    this.pinchOnFrames = options.pinchOnFrames ?? 1;
    this.pinchOffFrames = options.pinchOffFrames ?? 2;
    this._pinchOnCounter = 0;
    this._pinchOffCounter = 0;
    this.pinchDist = 0;
  }

  setAlpha(alpha) {
    this.alpha = clamp(alpha, 0.08, 0.9);
  }

  setProfile(profile) {
    if (profile === "stable") {
      this.pinchOn = 0.045;
      this.pinchOff = 0.066;
      this.pinchOnFrames = 3;
      this.pinchOffFrames = 3;
      this.setAlpha(0.52);
      return;
    }

    if (profile === "responsive") {
      this.pinchOn = 0.052;
      this.pinchOff = 0.061;
      this.pinchOnFrames = 1;
      this.pinchOffFrames = 1;
      this.setAlpha(0.24);
      return;
    }

    // balanced
    this.pinchOn = 0.048;
    this.pinchOff = 0.062;
    this.pinchOnFrames = 2;
    this.pinchOffFrames = 2;
  }

  update(hand, secondHand = null) {
    if (!hand) {
      return {
        handsDetected: false,
        resize: this.prevResize,
        rotation: this.prevRotation,
        pinch: false,
        jitter: this.prevJitter,
      };
    }

    const thumb = hand[4];
    const index = hand[8];
    const wrist = hand[0];
    const middle = hand[12];

    const pinchDist = dist3(thumb, index);
    this.pinchDist = pinchDist;
    if (!this.pinch && pinchDist <= this.pinchOn) {
      this._pinchOnCounter += 1;
      this._pinchOffCounter = 0;
      if (this._pinchOnCounter >= this.pinchOnFrames) {
        this.pinch = true;
        this._pinchOnCounter = 0;
      }
    } else if (this.pinch && pinchDist >= this.pinchOff) {
      this._pinchOffCounter += 1;
      this._pinchOnCounter = 0;
      if (this._pinchOffCounter >= this.pinchOffFrames) {
        this.pinch = false;
        this._pinchOffCounter = 0;
      }
    } else {
      this._pinchOnCounter = 0;
      this._pinchOffCounter = 0;
    }

    const span = dist3(index, middle);
    const wristToIndex = dist3(wrist, index);

    const rawResize = clamp(span * 8.5, 0, 1);
    const rotation = angle2(wrist, index);

    const jitterRaw = this.prevIndex ? dist3(index, this.prevIndex) : 0;
    this.prevIndex = { ...index };

    const resize = ema(this.prevResize, rawResize, this.alpha);
    const rot = ema(this.prevRotation, rotation, this.alpha);
    const jitter = ema(this.prevJitter, jitterRaw, 0.25);

    this.prevResize = resize;
    this.prevRotation = rot;
    this.prevJitter = jitter;

    // optional two-hand influence
    const twoHandBoost = secondHand ? clamp(dist3(secondHand[8], index) * 0.7, 0, 1) : null;

    return {
      handsDetected: true,
      resize,
      rotation: rot,
      pinch: this.pinch,
      pinchDist,
      pinchStrength: clamp((this.pinchOff - pinchDist) / Math.max(0.0001, (this.pinchOff - this.pinchOn)), 0, 1),
      jitter,
      wristToIndex,
      twoHandBoost,
    };
  }
}
