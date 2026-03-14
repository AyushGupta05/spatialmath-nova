const PHASES = [
  "idle",
  "parsing",
  "plan_ready",
  "guided_build",
  "manual_build",
  "explore",
  "challenge",
  "answer",
  "complete",
];

const LEARNING_STAGES = ["orient", "build", "predict", "check", "reflect", "challenge"];

export class TutorState extends EventTarget {
  constructor() {
    super();
    this._state = {
      phase: "idle",
      mode: "guided",
      currentStep: 0,
      hintsUsed: 0,
      maxHints: 3,
      history: [],
      plan: null,
      latestAssessment: null,
      challengeId: null,
      score: 0,
      streak: 0,
      completionState: {
        complete: false,
        reason: null,
      },
      similarQuestions: [],
      learningStage: "orient",
      predictionState: {
        prompt: "",
        response: "",
        submitted: false,
      },
      transcriptCollapsed: true,
      followUpCollapsed: true,
      error: null,
    };
  }

  get phase() { return this._state.phase; }
  get mode() { return this._state.mode; }
  get currentStep() { return this._state.currentStep; }
  get hintsUsed() { return this._state.hintsUsed; }
  get maxHints() { return this._state.maxHints; }
  get history() { return this._state.history; }
  get plan() { return this._state.plan; }
  get latestAssessment() { return this._state.latestAssessment; }
  get challengeId() { return this._state.challengeId; }
  get score() { return this._state.score; }
  get streak() { return this._state.streak; }
  get completionState() { return this._state.completionState; }
  get similarQuestions() { return this._state.similarQuestions; }
  get learningStage() { return this._state.learningStage; }
  get predictionState() { return this._state.predictionState; }
  get transcriptCollapsed() { return this._state.transcriptCollapsed; }
  get followUpCollapsed() { return this._state.followUpCollapsed; }
  get error() { return this._state.error; }
  get totalSteps() { return this._state.plan?.buildSteps?.length || 0; }

  snapshot() {
    return {
      ...this._state,
      history: [...this._state.history],
      completionState: { ...this._state.completionState },
      similarQuestions: [...this._state.similarQuestions],
    };
  }

  setPhase(phase) {
    if (!PHASES.includes(phase)) return;
    const prev = this._state.phase;
    this._state.phase = phase;
    this._emit("phase", { phase, prev });
  }

  setPlan(plan, options = {}) {
    this._state.plan = plan;
    this._state.mode = options.mode || plan?.problem?.mode || "guided";
    this._state.currentStep = 0;
    this._state.hintsUsed = 0;
    this._state.latestAssessment = null;
    this._state.learningStage = "orient";
    this._state.completionState = {
      complete: false,
      reason: null,
    };
    this._state.similarQuestions = [];
    this._state.predictionState = {
      prompt: plan?.learningMoments?.predict?.prompt || "",
      response: "",
      submitted: false,
    };
    this._state.transcriptCollapsed = true;
    this._state.followUpCollapsed = true;
    this._state.error = null;
    this._emit("plan", { plan: this._state.plan });
  }

  setMode(mode) {
    this._state.mode = mode;
    this._emit("mode", { mode });
  }

  setAssessment(assessment) {
    this._state.latestAssessment = assessment;
    this._emit("assessment", { assessment });
  }

  setCompletionState(completionState = { complete: false, reason: null }) {
    this._state.completionState = {
      complete: Boolean(completionState?.complete),
      reason: completionState?.complete ? completionState?.reason || "correct-answer" : null,
    };
    this._emit("completion", { completionState: this._state.completionState });
  }

  setSimilarQuestions(suggestions = []) {
    this._state.similarQuestions = Array.isArray(suggestions) ? [...suggestions] : [];
    this._emit("similar-questions", { similarQuestions: this._state.similarQuestions });
  }

  setLearningStage(stage) {
    if (!LEARNING_STAGES.includes(stage)) return;
    this._state.learningStage = stage;
    this._emit("learning-stage", { learningStage: stage });
  }

  setPredictionPrompt(prompt = "") {
    this._state.predictionState = {
      ...this._state.predictionState,
      prompt,
    };
    this._emit("prediction", { predictionState: this._state.predictionState });
  }

  setPredictionResponse(response = "") {
    this._state.predictionState = {
      ...this._state.predictionState,
      response,
    };
    this._emit("prediction", { predictionState: this._state.predictionState });
  }

  submitPrediction(response = this._state.predictionState.response) {
    this._state.predictionState = {
      ...this._state.predictionState,
      response,
      submitted: true,
    };
    this._emit("prediction", { predictionState: this._state.predictionState });
  }

  resetPrediction(prompt = this._state.predictionState.prompt) {
    this._state.predictionState = {
      prompt,
      response: "",
      submitted: false,
    };
    this._emit("prediction", { predictionState: this._state.predictionState });
  }

  setTranscriptCollapsed(collapsed) {
    this._state.transcriptCollapsed = Boolean(collapsed);
    this._emit("transcript", { transcriptCollapsed: this._state.transcriptCollapsed });
  }

  setFollowUpCollapsed(collapsed) {
    this._state.followUpCollapsed = Boolean(collapsed);
    this._emit("follow-up", { followUpCollapsed: this._state.followUpCollapsed });
  }

  startChallenge(challengeId, plan) {
    this._state.challengeId = challengeId;
    this.setPlan(plan, { mode: "guided" });
    this.setPhase("challenge");
    this._emit("challenge", { challengeId, plan });
  }

  nextStep() {
    if (this._state.currentStep < this.totalSteps - 1) {
      this._state.currentStep += 1;
      this._emit("step", { step: this._state.currentStep });
      return true;
    }
    return false;
  }

  prevStep() {
    if (this._state.currentStep > 0) {
      this._state.currentStep -= 1;
      this._emit("step", { step: this._state.currentStep });
      return true;
    }
    return false;
  }

  goToStep(index) {
    if (index >= 0 && index < this.totalSteps) {
      this._state.currentStep = index;
      this._emit("step", { step: this._state.currentStep });
      return true;
    }
    return false;
  }

  getCurrentStep() {
    return this._state.plan?.buildSteps?.[this._state.currentStep] || null;
  }

  useHint() {
    if (this._state.hintsUsed >= this._state.maxHints) return false;
    this._state.hintsUsed += 1;
    this._emit("hint", { hintsUsed: this._state.hintsUsed });
    return true;
  }

  addMessage(role, content) {
    const entry = { role, content, timestamp: Date.now() };
    this._state.history.push(entry);
    this._emit("message", entry);
    return entry;
  }

  recordCorrect(points = 20) {
    this._state.score += points;
    this._state.streak += 1;
    this._emit("correct", { score: this._state.score, streak: this._state.streak });
  }

  recordIncorrect() {
    this._state.streak = 0;
    this._emit("incorrect", { score: this._state.score, streak: this._state.streak });
  }

  setError(error) {
    this._state.error = error;
    this._emit("error", { error });
  }

  reset() {
    const score = this._state.score;
    const streak = this._state.streak;
    this._state = {
      phase: "idle",
      mode: "guided",
      currentStep: 0,
      hintsUsed: 0,
      maxHints: 3,
      history: [],
      plan: null,
      latestAssessment: null,
      challengeId: null,
      score,
      streak,
      completionState: {
        complete: false,
        reason: null,
      },
      similarQuestions: [],
      learningStage: "orient",
      predictionState: {
        prompt: "",
        response: "",
        submitted: false,
      },
      transcriptCollapsed: true,
      followUpCollapsed: true,
      error: null,
    };
    this._emit("reset", {});
  }

  on(eventName, handler) {
    this.addEventListener(eventName, (event) => handler(event.detail));
    return this;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
    this.dispatchEvent(new CustomEvent("change", { detail: { type, ...detail } }));
  }
}

export const tutorState = new TutorState();
export { LEARNING_STAGES };
