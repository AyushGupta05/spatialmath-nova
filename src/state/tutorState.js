/**
 * TutorState: manages the learning session state machine.
 * Uses EventTarget for reactive updates without a framework.
 */

const PHASES = ["idle", "question_input", "parsing", "scene_ready", "walkthrough", "practice", "complete"];

export class TutorState extends EventTarget {
  constructor() {
    super();
    this._state = {
      phase: "idle",
      currentStep: 0,
      totalSteps: 0,
      hintsUsed: 0,
      maxHints: 3,
      history: [],
      sceneSpec: null,
      challengeId: null,
      score: 0,
      streak: 0,
      error: null,
    };
  }

  get phase() { return this._state.phase; }
  get currentStep() { return this._state.currentStep; }
  get totalSteps() { return this._state.totalSteps; }
  get hintsUsed() { return this._state.hintsUsed; }
  get maxHints() { return this._state.maxHints; }
  get history() { return this._state.history; }
  get sceneSpec() { return this._state.sceneSpec; }
  get challengeId() { return this._state.challengeId; }
  get score() { return this._state.score; }
  get streak() { return this._state.streak; }
  get error() { return this._state.error; }

  /** Snapshot for serialization */
  snapshot() { return { ...this._state, history: [...this._state.history] }; }

  /** Transition to a new phase */
  setPhase(phase) {
    if (!PHASES.includes(phase)) return;
    const prev = this._state.phase;
    this._state.phase = phase;
    this._emit("phase", { phase, prev });
  }

  /** Set the active scene spec from Nova Pro */
  setSceneSpec(spec) {
    this._state.sceneSpec = spec;
    this._state.totalSteps = spec?.answer?.steps?.length || 0;
    this._state.currentStep = 0;
    this._state.hintsUsed = 0;
    this._state.error = null;
    this._emit("sceneSpec", { spec });
  }

  /** Start a challenge */
  startChallenge(challengeId, sceneSpec) {
    this._state.challengeId = challengeId;
    this.setSceneSpec(sceneSpec);
    this.setPhase("scene_ready");
    this._emit("challengeStart", { challengeId });
  }

  /** Advance to the next walkthrough step */
  nextStep() {
    if (this._state.currentStep < this._state.totalSteps - 1) {
      this._state.currentStep++;
      this._emit("step", { step: this._state.currentStep });
      return true;
    }
    return false;
  }

  /** Go to previous step */
  prevStep() {
    if (this._state.currentStep > 0) {
      this._state.currentStep--;
      this._emit("step", { step: this._state.currentStep });
      return true;
    }
    return false;
  }

  /** Go to a specific step */
  goToStep(index) {
    if (index >= 0 && index < this._state.totalSteps) {
      this._state.currentStep = index;
      this._emit("step", { step: this._state.currentStep });
      return true;
    }
    return false;
  }

  /** Get the current step data */
  getCurrentStepData() {
    return this._state.sceneSpec?.answer?.steps?.[this._state.currentStep] || null;
  }

  /** Use a hint */
  useHint() {
    if (this._state.hintsUsed < this._state.maxHints) {
      this._state.hintsUsed++;
      this._emit("hint", { hintsUsed: this._state.hintsUsed });
      return true;
    }
    return false;
  }

  /** Add a message to conversation history */
  addMessage(role, content) {
    const msg = { role, content, timestamp: Date.now() };
    this._state.history.push(msg);
    this._emit("message", msg);
    return msg;
  }

  /** Record a correct answer */
  recordCorrect() {
    this._state.score += Math.max(10, 30 - this._state.hintsUsed * 10);
    this._state.streak++;
    this._emit("correct", { score: this._state.score, streak: this._state.streak });
  }

  /** Record an incorrect answer */
  recordIncorrect() {
    this._state.streak = 0;
    this._emit("incorrect", { score: this._state.score });
  }

  /** Set error state */
  setError(err) {
    this._state.error = err;
    this._emit("error", { error: err });
  }

  /** Reset to initial state */
  reset() {
    this._state = {
      phase: "idle",
      currentStep: 0,
      totalSteps: 0,
      hintsUsed: 0,
      maxHints: 3,
      history: [],
      sceneSpec: null,
      challengeId: null,
      score: this._state.score, // preserve score across questions
      streak: this._state.streak,
      error: null,
    };
    this._emit("reset", {});
  }

  /** Listen for state changes */
  on(eventName, handler) {
    this.addEventListener(eventName, (e) => handler(e.detail));
    return this; // chainable
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
    // Also emit generic "change" for broad listeners
    this.dispatchEvent(new CustomEvent("change", { detail: { type, ...detail } }));
  }
}

// Singleton instance
export const tutorState = new TutorState();
