import {
  requestScenePlan,
  evaluateBuild,
  askTutor,
  requestVoiceResponse,
  fetchChallenges,
  checkChallenge,
} from "../ai/client.js";
import { buildSceneSnapshotFromSuggestions, normalizeScenePlan } from "../ai/planSchema.js";
import { computeGeometry } from "../core/geometry.js";
import { initLabelRenderer, renderLabels, addLabel, clearLabels } from "../render/labels.js";
import { CameraDirector } from "../render/cameraDirector.js";
import { tutorState } from "../state/tutorState.js";
import { initUnfoldDrawer, syncUnfoldDrawer } from "./unfoldDrawer.js";

let appContext = null;
let world = null;
let sceneApi = null;
let cameraDirector = null;
let assessmentTimer = null;
let voiceEnabled = false;
let activeChallenge = null;
let liveChallengeState = null;
let questionImageFile = null;
let questionImagePreviewUrl = null;
let lastSceneFeedback = "Nova will react to what you do in the scene.";

let questionInput;
let questionSubmit;
let questionStatus;
let questionImageInput;
let questionImageMeta;
let questionImagePreview;
let questionImageThumb;
let questionImageClear;
let scenePlanSection;
let planSummary;
let buildSummary;
let planObjects;
let addAllBtn;
let stepByStepBtn;
let buildManuallyBtn;
let lessonSection;
let lessonStagePill;
let lessonHeadline;
let lessonMessage;
let lessonGoal;
let lessonFeedback;
let predictionPanel;
let predictionPrompt;
let predictionInput;
let predictionSubmit;
let challengePromptCard;
let challengePromptText;
let hintBtn;
let hintCount;
let explainBtn;
let advanceStageBtn;
let voiceToggle;
let whyDetails;
let whyText;
let transcriptDetails;
let chatMessages;
let followUpDetails;
let chatInput;
let chatSend;
let answerSection;
let answerInput;
let answerSubmit;
let answerFeedback;
let challengeList;
let scoreDisplay;
let sceneInfo;
let sceneValidation;
let cameraBookmarkList;
let objectCount;
let stepIndicator;
let stepLabel;
let stepPrev;
let stepNext;

function activePlan() {
  return tutorState.plan;
}

function currentSnapshot() {
  return sceneApi?.snapshot?.() || { objects: [], selectedObjectId: null };
}

function formatNumber(value, digits = 2) {
  const next = Number(value);
  if (!Number.isFinite(next)) return "0";
  return next.toFixed(digits).replace(/\.00$/, "");
}

function formatMetricName(metric) {
  return metric === "surfaceArea" ? "surface area" : metric || "metric";
}

function currentStepAssessment(assessment) {
  const step = tutorState.getCurrentStep();
  if (!step || !assessment) return null;
  return assessment.stepAssessments?.find((item) => item.stepId === step.id) || null;
}

function selectedSceneObject(snapshot = currentSnapshot()) {
  const objectId = snapshot?.selectedObjectId || sceneApi?.getSelection?.() || null;
  return objectId ? sceneApi?.getObject?.(objectId) || null : null;
}

function selectedObjectContext(snapshot = currentSnapshot()) {
  const objectSpec = selectedSceneObject(snapshot);
  if (!objectSpec) return null;
  const metrics = computeGeometry(objectSpec.shape, objectSpec.params);
  return {
    id: objectSpec.id,
    label: objectSpec.label || objectSpec.shape,
    shape: objectSpec.shape,
    params: objectSpec.params,
    metrics,
  };
}

function addTranscriptMessage(role, content) {
  if (!chatMessages) return null;
  chatMessages.querySelector(".chat-welcome")?.remove();
  const message = document.createElement("div");
  message.className = `chat-msg is-${role}`;
  message.textContent = content;
  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return message;
}

function clearTranscript() {
  if (!chatMessages) return;
  chatMessages.innerHTML = `
    <div class="chat-welcome">
      <p class="chat-welcome-title">Lesson transcript</p>
      <p class="chat-welcome-text">Tutor replies, hints, and follow-up answers will collect here only when needed.</p>
    </div>
  `;
}

function updateHintCount() {
  if (hintCount) {
    const remaining = tutorState.maxHints - tutorState.hintsUsed;
    hintCount.textContent = `(${remaining} left)`;
  }
  if (hintBtn) hintBtn.disabled = tutorState.hintsUsed >= tutorState.maxHints;
}

function switchToTab(tabName) {
  document.querySelectorAll(".panel-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-content").forEach((content) => {
    content.classList.toggle("active", content.dataset.content === tabName);
  });
}

function showAnswerSection(visible) {
  answerSection?.classList.toggle("hidden", !visible);
}

function showAnswerFeedback(text, correct = false) {
  if (!answerFeedback) return;
  answerFeedback.textContent = text;
  answerFeedback.className = `answer-feedback ${correct ? "is-correct" : "is-incorrect"}`;
  answerFeedback.classList.remove("hidden");
}

function renderSceneInfo() {
  if (!sceneInfo || !objectCount) return;
  const snapshot = currentSnapshot();
  const plan = activePlan();
  const selected = selectedObjectContext(snapshot);
  const count = snapshot.objects.length;

  objectCount.textContent = String(count);

  if (!plan) {
    sceneInfo.innerHTML = `<p class="muted-text">Create a lesson or choose a practice challenge to generate a 3D scene.</p>`;
    return;
  }

  const selectionMarkup = selected
    ? `
      <p class="muted-text" style="margin:8px 0 0">
        Selected: <strong>${selected.label}</strong>
        <span class="formula">V = ${formatNumber(selected.metrics.volume)}, SA = ${formatNumber(selected.metrics.surfaceArea)}</span>
      </p>
    `
    : `<p class="muted-text" style="margin:8px 0 0">Select an object in the scene to inspect its role and dimensions.</p>`;

  sceneInfo.innerHTML = `
    <p style="margin:0 0 6px"><strong>${plan.sourceSummary.cleanedQuestion || plan.problem.question}</strong></p>
    <p class="muted-text">${count} object${count === 1 ? "" : "s"} currently in the world</p>
    <p class="muted-text">Focus: <span class="formula">${plan.sceneFocus.primaryInsight || plan.sceneFocus.focusPrompt || "Build the scene and inspect the key relationship."}</span></p>
    ${selectionMarkup}
  `;
}

function renderCameraBookmarks(plan) {
  if (!cameraBookmarkList) return;
  cameraBookmarkList.innerHTML = "";
  (plan?.cameraBookmarks || []).forEach((bookmark) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "camera-bookmark-btn";
    button.textContent = bookmark.label;
    button.addEventListener("click", () => {
      cameraDirector.animateTo(bookmark.position, bookmark.target, 900);
    });
    cameraBookmarkList.appendChild(button);
  });
}

function renderAnnotations() {
  clearLabels(world.scene);
  const snapshot = currentSnapshot();
  snapshot.objects.forEach((objectSpec) => {
    const [x, y, z] = objectSpec.position;
    addLabel(world.scene, objectSpec.label || objectSpec.shape, [x, y + 0.9, z], "name");
  });
}

function suggestionTitle(plan, suggestionId) {
  return plan?.objectSuggestions?.find((suggestion) => suggestion.id === suggestionId)?.title || suggestionId;
}

function missingSuggestionIds(step, assessment) {
  if (!step || !assessment) return [];
  const byId = new Map(assessment.objectAssessments.map((item) => [item.suggestionId, item]));
  return (step.requiredObjectIds || []).filter((id) => !byId.get(id)?.present);
}

function resetLiveChallengeState(plan = activePlan()) {
  const challenge = plan?.liveChallenge || null;
  liveChallengeState = challenge
    ? {
      planId: plan.problem?.id || null,
      challengeId: challenge.id,
      unlocked: false,
      complete: false,
      primaryObjectId: null,
      baselineValue: null,
      targetValue: null,
      currentValue: null,
      deltaValue: null,
      progress: 0,
      toleranceValue: null,
    }
    : null;
}

function findPrimaryLiveSuggestion(plan) {
  if (!plan?.liveChallenge) return null;
  const requiredIds = new Set(plan.buildSteps.flatMap((step) => step.requiredObjectIds || []));
  return plan.objectSuggestions.find((suggestion) => requiredIds.has(suggestion.id) && suggestion.object.shape !== "line")
    || plan.objectSuggestions.find((suggestion) => suggestion.object.shape !== "line")
    || null;
}

function findObjectForSuggestion(snapshot, suggestion, assessment = null) {
  if (!snapshot || !suggestion) return null;
  const matchedObjectId = assessment?.objectAssessments?.find((item) => item.suggestionId === suggestion.id)?.matchedObjectId || null;
  if (matchedObjectId) {
    return snapshot.objects.find((objectSpec) => objectSpec.id === matchedObjectId) || null;
  }

  return snapshot.objects.find((objectSpec) => {
    const metadata = objectSpec.metadata || {};
    return (
      objectSpec.id === suggestion.object.id
      || metadata.sourceSuggestionId === suggestion.id
      || metadata.suggestionId === suggestion.id
      || metadata.guidedObjectId === suggestion.object.id
    );
  }) || null;
}

function computeLiveChallenge(plan, assessment) {
  const challenge = plan?.liveChallenge;
  if (!challenge) return null;

  if (!liveChallengeState || liveChallengeState.planId !== plan.problem?.id || liveChallengeState.challengeId !== challenge.id) {
    resetLiveChallengeState(plan);
  }

  const snapshot = currentSnapshot();
  const primarySuggestion = findPrimaryLiveSuggestion(plan);
  const currentObject = liveChallengeState?.primaryObjectId
    ? sceneApi.getObject(liveChallengeState.primaryObjectId)
    : findObjectForSuggestion(snapshot, primarySuggestion, assessment);
  const currentMetrics = currentObject ? computeGeometry(currentObject.shape, currentObject.params) : null;
  const currentValue = currentMetrics ? currentMetrics[challenge.metric] : null;

  if (!liveChallengeState.unlocked && assessment?.answerGate?.allowed && currentObject && Number.isFinite(currentValue)) {
    liveChallengeState.unlocked = true;
    liveChallengeState.primaryObjectId = currentObject.id;
    liveChallengeState.baselineValue = currentValue;
    liveChallengeState.targetValue = currentValue * challenge.multiplier;
  }

  if (liveChallengeState.unlocked) {
    const trackedObject = sceneApi.getObject(liveChallengeState.primaryObjectId)
      || findObjectForSuggestion(snapshot, primarySuggestion, assessment);
    const trackedMetrics = trackedObject ? computeGeometry(trackedObject.shape, trackedObject.params) : null;
    const trackedValue = trackedMetrics ? trackedMetrics[challenge.metric] : null;
    liveChallengeState.primaryObjectId = trackedObject?.id || liveChallengeState.primaryObjectId;
    liveChallengeState.currentValue = trackedValue;
    liveChallengeState.deltaValue = Number.isFinite(trackedValue) && Number.isFinite(liveChallengeState.targetValue)
      ? trackedValue - liveChallengeState.targetValue
      : null;
    liveChallengeState.toleranceValue = Number.isFinite(liveChallengeState.targetValue)
      ? Math.max(0.0001, liveChallengeState.targetValue * challenge.tolerance)
      : null;
    liveChallengeState.progress = Number.isFinite(trackedValue) && Number.isFinite(liveChallengeState.targetValue) && liveChallengeState.targetValue > 0
      ? Math.max(0, Math.min(trackedValue / liveChallengeState.targetValue, 1.25))
      : 0;
    liveChallengeState.complete = Number.isFinite(liveChallengeState.deltaValue) && Number.isFinite(liveChallengeState.toleranceValue)
      ? Math.abs(liveChallengeState.deltaValue) <= liveChallengeState.toleranceValue
      : false;
  }

  return {
    ...challenge,
    ...liveChallengeState,
    primarySuggestion,
  };
}

function renderAssessment(assessment) {
  if (!sceneValidation) return;
  if (!assessment) {
    sceneValidation.innerHTML = `<p class="muted-text">Nova will evaluate the scene and guide the next step as you build.</p>`;
    showAnswerSection(false);
    return;
  }

  const guidance = assessment.guidance || {};
  sceneValidation.innerHTML = `
    <div class="validation-stat"><strong>${assessment.summary.matchedRequiredObjects}/${assessment.summary.totalRequiredObjects}</strong> required objects matched</div>
    <div class="validation-stat"><strong>${Math.round(assessment.summary.completionRatio * 100)}%</strong> build completion</div>
    <div class="validation-stat"><strong>${guidance.readyForPrediction ? "Ready" : "Building"}</strong><br />${guidance.coachFeedback}</div>
  `;

  showAnswerSection(Boolean(activeChallenge && assessment.answerGate.allowed));
}

function renderPlanSummary(plan) {
  if (!planSummary || !planObjects || !scenePlanSection) return;
  const givens = plan.sourceSummary.givens?.length
    ? plan.sourceSummary.givens.map((given) => `<span class="pill subtle">${given}</span>`).join(" ")
    : "";
  planSummary.innerHTML = `
    <p style="margin:0 0 6px"><strong>${plan.sourceSummary.cleanedQuestion || plan.problem.question}</strong></p>
    <p class="muted-text">${plan.sceneFocus.primaryInsight || plan.sceneFocus.focusPrompt}</p>
    ${givens ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${givens}</div>` : ""}
  `;

  if (buildSummary) {
    buildSummary.classList.remove("hidden");
    buildSummary.textContent = plan.sceneFocus.judgeSummary || plan.overview || "Build the scene, make a prediction, then check the idea in 3D.";
  }

  planObjects.innerHTML = plan.objectSuggestions.map((suggestion) => `
    <li>
      <strong>${suggestion.title}</strong><br />
      <span class="muted-text">${suggestion.purpose}</span>
    </li>
  `).join("");
  scenePlanSection.classList.remove("hidden");
}

function syncStepFromAssessment(plan, assessment) {
  if (!plan?.buildSteps?.length || !assessment) return;
  const targetId = assessment.guidance?.currentStepId || assessment.activeStep?.stepId || null;
  const stepIndex = plan.buildSteps.findIndex((step) => step.id === targetId);
  if (stepIndex >= 0) {
    tutorState.goToStep(stepIndex);
  }
}

function updateStepIndicator() {
  if (!stepIndicator || !stepLabel || !stepPrev || !stepNext) return;
  const plan = activePlan();
  const total = tutorState.totalSteps;
  if (!plan || !total) {
    stepIndicator.classList.add("hidden");
    return;
  }

  const stage = tutorState.learningStage;
  const step = tutorState.getCurrentStep();
  const focus = step?.title || plan.sceneFocus.concept || "Lesson";
  stepIndicator.classList.remove("hidden");
  stepLabel.textContent = `${stage[0].toUpperCase()}${stage.slice(1)} · ${focus}`;
  stepPrev.disabled = tutorState.currentStep <= 0;
  stepNext.disabled = tutorState.currentStep >= total - 1;
}

function stageConfig(plan, assessment) {
  const stage = tutorState.learningStage;
  const learningMoment = plan?.learningMoments?.[stage] || {};
  const step = tutorState.getCurrentStep();
  const selected = selectedObjectContext();
  const challenge = computeLiveChallenge(plan, assessment);
  const guidance = assessment?.guidance || {};
  const missingTitles = guidance.missingTitles || [];

  const config = {
    stage,
    headline: learningMoment.title || "Lesson",
    message: learningMoment.coachMessage || plan?.sceneFocus?.primaryInsight || "Use the scene to reason step by step.",
    goal: learningMoment.goal || plan?.sceneFocus?.focusPrompt || "Use the scene to focus on the main idea.",
    feedback: lastSceneFeedback || guidance.coachFeedback || "Nova is waiting for your next action.",
    why: learningMoment.whyItMatters || plan?.sceneFocus?.primaryInsight || "",
    advanceLabel: "Continue",
    showPrediction: false,
    challengeText: "",
    showChallenge: false,
  };

  if (stage === "orient") {
    config.headline = plan?.sceneFocus?.concept
      ? `Focus on ${plan.sceneFocus.concept}`
      : "Orient";
    config.message = learningMoment.coachMessage || `Start by naming the main object or relationship in this problem.`;
    config.goal = plan?.sceneFocus?.focusPrompt || learningMoment.goal;
    config.feedback = `Question -> spatial setup -> student action -> AI feedback -> insight.`;
    config.advanceLabel = "Start Build";
    return config;
  }

  if (stage === "build") {
    config.headline = step?.title || learningMoment.title || "Build / Inspect";
    config.message = missingTitles.length
      ? `Build the scene a piece at a time. ${missingTitles.join(", ")} still need attention.`
      : guidance.coachFeedback || learningMoment.coachMessage;
    config.goal = step?.instruction || learningMoment.goal;
    config.feedback = guidance.coachFeedback || lastSceneFeedback;
    config.advanceLabel = guidance.readyForPrediction ? "Move to Prediction" : "Keep Building";
    return config;
  }

  if (stage === "predict") {
    config.headline = learningMoment.title || "Predict";
    config.message = learningMoment.coachMessage || "Pause before solving and make a short prediction.";
    config.goal = learningMoment.prompt || tutorState.predictionState.prompt || "Make one short prediction from the scene.";
    config.feedback = selected
      ? `Use ${selected.label} to ground your prediction.`
      : "Pick the object or helper that best shows the idea.";
    config.showPrediction = true;
    config.advanceLabel = tutorState.predictionState.submitted ? "Check in Scene" : "Save Prediction";
    return config;
  }

  if (stage === "check") {
    config.headline = learningMoment.title || "Check";
    config.message = selected
      ? `Check your prediction by inspecting ${selected.label}.`
      : learningMoment.coachMessage || "Use the scene to test your prediction.";
    config.goal = learningMoment.goal || "Rotate, select, or adjust the object that controls the idea.";
    config.feedback = lastSceneFeedback || guidance.coachFeedback;
    config.advanceLabel = "Reflect";
    return config;
  }

  if (stage === "reflect") {
    config.headline = learningMoment.title || "Reflect";
    config.message = learningMoment.insight || plan?.sceneFocus?.primaryInsight || "State the key idea in one short sentence.";
    config.goal = learningMoment.goal || "Summarize what the scene made clearer.";
    config.feedback = selected
      ? `${selected.label} now anchors the explanation with visible dimensions.`
      : guidance.coachFeedback || "The scene is ready to explain.";
    config.advanceLabel = "Start Challenge";
    return config;
  }

  config.headline = challenge?.title || learningMoment.title || "Challenge";
  config.message = challenge?.prompt || learningMoment.coachMessage || "Try one short follow-up.";
  config.goal = challenge?.unlocked
    ? `Target ${formatMetricName(challenge.metric)}: ${formatNumber(challenge.targetValue)}`
    : learningMoment.goal || "Use one more scene action to reinforce the idea.";
  config.feedback = challenge?.unlocked
    ? challenge.complete
      ? "Challenge complete. Your scene is within the target tolerance."
      : `Current ${formatMetricName(challenge.metric)}: ${formatNumber(challenge.currentValue)}`
    : guidance.coachFeedback || "Finish the build to unlock the challenge.";
  config.showChallenge = true;
  config.challengeText = challenge?.prompt || learningMoment.prompt || "";
  config.advanceLabel = activeChallenge ? "Check Answer" : "Keep Exploring";
  return config;
}

function renderLessonCard() {
  const plan = activePlan();
  if (!lessonSection || !lessonStagePill || !lessonHeadline || !lessonMessage || !lessonGoal || !lessonFeedback) return;

  if (!plan) {
    lessonSection.classList.add("hidden");
    return;
  }

  lessonSection.classList.remove("hidden");
  const assessment = tutorState.latestAssessment;
  const config = stageConfig(plan, assessment);
  lessonStagePill.textContent = config.stage[0].toUpperCase() + config.stage.slice(1);
  lessonHeadline.textContent = config.headline;
  lessonMessage.textContent = config.message;
  lessonGoal.textContent = config.goal;
  lessonFeedback.textContent = config.feedback;
  whyText.textContent = config.why;
  advanceStageBtn.textContent = config.advanceLabel;

  const predictionPromptText = tutorState.predictionState.prompt || plan.learningMoments.predict.prompt || config.goal;
  predictionPrompt.textContent = predictionPromptText;
  predictionInput.value = tutorState.predictionState.response || "";
  predictionPanel.classList.toggle("hidden", !config.showPrediction);

  challengePromptText.textContent = config.challengeText;
  challengePromptCard.classList.toggle("hidden", !config.showChallenge || !config.challengeText);
  transcriptDetails.open = !tutorState.transcriptCollapsed;
  followUpDetails.open = !tutorState.followUpCollapsed;
}

function sceneContextPayload(plan, assessment) {
  const selected = selectedObjectContext();
  return {
    selection: selected
      ? {
        id: selected.id,
        label: selected.label,
        shape: selected.shape,
        params: selected.params,
        metrics: {
          volume: Number(selected.metrics.volume.toFixed(3)),
          surfaceArea: Number(selected.metrics.surfaceArea.toFixed(3)),
        },
      }
      : null,
    liveChallenge: plan?.liveChallenge ? computeLiveChallenge(plan, assessment) : null,
    sceneFocus: plan?.sceneFocus || null,
    sourceSummary: plan?.sourceSummary || null,
    guidance: assessment?.guidance || null,
  };
}

function setQuestionStatus(text = "", type = "hidden") {
  if (!questionStatus) return;
  questionStatus.textContent = text;
  questionStatus.className = "question-status";
  if (!text || type === "hidden") {
    questionStatus.classList.add("hidden");
    return;
  }
  if (type === "loading") questionStatus.classList.add("is-loading");
  if (type === "error") questionStatus.classList.add("is-error");
}

function revokeQuestionPreview() {
  if (questionImagePreviewUrl) {
    URL.revokeObjectURL(questionImagePreviewUrl);
    questionImagePreviewUrl = null;
  }
}

function renderQuestionImageState() {
  const hasImage = Boolean(questionImageFile);
  questionImageMeta?.classList.toggle("hidden", !hasImage);
  questionImagePreview?.classList.toggle("hidden", !hasImage);
  questionImageClear?.classList.toggle("hidden", !hasImage);
  if (!hasImage) {
    questionImageMeta.textContent = "";
    questionImageThumb.removeAttribute("src");
    revokeQuestionPreview();
    return;
  }

  questionImageMeta.textContent = `${questionImageFile.name} · ${formatNumber(questionImageFile.size / 1024, 0)} KB`;
  revokeQuestionPreview();
  questionImagePreviewUrl = URL.createObjectURL(questionImageFile);
  questionImageThumb.src = questionImagePreviewUrl;
}

async function syncAssessment() {
  const plan = activePlan();
  if (!plan) {
    renderAssessment(null);
    renderSceneInfo();
    renderLessonCard();
    updateStepIndicator();
    return;
  }

  try {
    const { assessment } = await evaluateBuild({
      plan,
      sceneSnapshot: currentSnapshot(),
      currentStepId: tutorState.getCurrentStep()?.id || null,
    });
    tutorState.setAssessment(assessment);
    syncStepFromAssessment(plan, assessment);

    if (tutorState.learningStage === "build" && assessment.guidance?.readyForPrediction) {
      tutorState.setLearningStage("predict");
      tutorState.resetPrediction(plan.learningMoments.predict.prompt);
      lastSceneFeedback = "The scene is ready. Make a short prediction before asking for the explanation.";
    }

    renderAssessment(assessment);
    renderSceneInfo();
    renderLessonCard();
    updateStepIndicator();
  } catch (error) {
    console.error("Assessment sync failed:", error);
  }
}

function scheduleAssessment() {
  window.clearTimeout(assessmentTimer);
  assessmentTimer = window.setTimeout(() => {
    syncAssessment();
    renderAnnotations();
  }, 160);
}

function setPlan(plan, options = {}) {
  const normalizedPlan = normalizeScenePlan(plan);
  activeChallenge = options.challenge || null;
  tutorState.setPlan(normalizedPlan, { mode: options.mode || normalizedPlan.problem.mode || "guided" });
  tutorState.setPhase("plan_ready");
  tutorState.setLearningStage("orient");
  resetLiveChallengeState(normalizedPlan);
  lastSceneFeedback = normalizedPlan.sceneFocus.judgeSummary || "Nova will react to what you do in the scene.";

  if (answerFeedback) {
    answerFeedback.textContent = "";
    answerFeedback.classList.add("hidden");
  }
  if (answerInput) answerInput.value = "";

  renderPlanSummary(normalizedPlan);
  renderCameraBookmarks(normalizedPlan);
  renderSceneInfo();
  renderAssessment(null);
  renderLessonCard();
  updateStepIndicator();
  clearTranscript();

  if (options.clearScene !== false) {
    sceneApi.clearScene();
  }
}

async function handleQuestionSubmit() {
  const questionText = questionInput?.value?.trim() || "";
  if (!questionText && !questionImageFile) return;

  tutorState.reset();
  activeChallenge = null;
  resetLiveChallengeState(null);
  tutorState.setPhase("parsing");
  questionSubmit.disabled = true;
  setQuestionStatus("Planning a scene-aware lesson with Nova...", "loading");

  try {
    const { scenePlan } = await requestScenePlan({
      questionText,
      imageFile: questionImageFile,
      mode: "guided",
      sceneSnapshot: currentSnapshot(),
    });
    setPlan(scenePlan);
    addTranscriptMessage("system", `Lesson created: "${scenePlan.sourceSummary?.cleanedQuestion || questionText || "Uploaded diagram"}"`);
    setQuestionStatus("", "hidden");
  } catch (error) {
    console.error("Plan request failed:", error);
    tutorState.setError(error.message);
    setQuestionStatus(`Error: ${error.message}`, "error");
  } finally {
    questionSubmit.disabled = false;
  }
}

function beginGuidedBuild() {
  const plan = activePlan();
  if (!plan) return;
  tutorState.setMode("guided");
  tutorState.setPhase(activeChallenge ? "challenge" : "guided_build");
  tutorState.setLearningStage("build");
  sceneApi.clearScene();
  switchToTab("tutor");
  lastSceneFeedback = "Build the scene one meaningful piece at a time. Nova will watch for the next required object.";
  renderLessonCard();
  scheduleAssessment();
}

function loadDraftScene() {
  const plan = activePlan();
  if (!plan) return;
  tutorState.setMode("guided");
  tutorState.setPhase("explore");
  tutorState.setLearningStage("predict");
  tutorState.resetPrediction(plan.learningMoments.predict.prompt);
  sceneApi.loadSnapshot(buildSceneSnapshotFromSuggestions(plan), "draft-scene");
  renderAnnotations();
  lastSceneFeedback = "Treat this as a draft scene. Inspect it, then make a prediction before asking for the explanation.";
  renderLessonCard();
  scheduleAssessment();
}

function beginManualBuild() {
  const plan = activePlan();
  if (!plan) return;
  tutorState.setMode("manual");
  tutorState.setPhase(activeChallenge ? "challenge" : "manual_build");
  tutorState.setLearningStage("build");
  sceneApi.clearScene();
  switchToTab("scene");
  lastSceneFeedback = "Manual build mode is active. Use the mouse to place the scene yourself.";
  renderLessonCard();
  scheduleAssessment();
}

async function sendTutorMessage(messageText, options = {}) {
  const plan = activePlan();
  if (!plan) return;
  const text = messageText?.trim();
  if (!text) return;

  if (options.showUserMessage !== false) {
    addTranscriptMessage("user", options.userLabel || text);
  }
  tutorState.addMessage("user", text);

  transcriptDetails.open = true;
  tutorState.setTranscriptCollapsed(false);
  const typing = addTranscriptMessage("tutor", "...");
  typing?.classList.add("loading-dots");

  try {
    const response = await askTutor({
      plan,
      sceneSnapshot: currentSnapshot(),
      sceneContext: sceneContextPayload(plan, tutorState.latestAssessment),
      learningState: tutorState.snapshot(),
      userMessage: text,
      contextStepId: tutorState.getCurrentStep()?.id || null,
      onChunk: (chunk) => {
        typing?.classList.remove("loading-dots");
        if (typing) {
          typing.textContent = (typing.textContent === "..." ? "" : typing.textContent) + chunk;
        }
      },
      onAssessment: (assessment) => {
        tutorState.setAssessment(assessment);
        renderAssessment(assessment);
        renderLessonCard();
      },
    });

    if (typing) {
      typing.classList.remove("loading-dots");
      typing.textContent = response.text || "I could not generate a tutor reply.";
      tutorState.addMessage("assistant", typing.textContent);
      lastSceneFeedback = response.text || lastSceneFeedback;
    }

    if (response.assessment) {
      tutorState.setAssessment(response.assessment);
    }

    renderAssessment(tutorState.latestAssessment);
    renderLessonCard();

    if (voiceEnabled && typing?.textContent) {
      speakText(typing.textContent);
    }
  } catch (error) {
    if (typing) {
      typing.classList.remove("loading-dots");
      typing.textContent = `Error: ${error.message}`;
    }
  }
}

async function handleHint() {
  if (!tutorState.useHint()) {
    addTranscriptMessage("system", "No more hints available.");
    return;
  }
  updateHintCount();
  await sendTutorMessage(`Give me one short hint for the ${tutorState.learningStage} stage using the current scene.`, {
    userLabel: "Need a hint",
  });
}

async function handleExplain() {
  await sendTutorMessage(`Explain the current scene for the ${tutorState.learningStage} stage in two short sentences.`, {
    userLabel: "Explain the scene",
  });
}

async function speakText(text) {
  if (!text) return;
  try {
    const response = await requestVoiceResponse(text, "auto");
    if (response.audioBase64) {
      const binary = atob(response.audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: response.contentType || "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
      return;
    }
  } catch (error) {
    console.warn("Voice response failed:", error);
  }

  if ("speechSynthesis" in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    speechSynthesis.speak(utterance);
  }
}

function advanceLessonStage() {
  const plan = activePlan();
  const assessment = tutorState.latestAssessment;
  if (!plan) return;

  switch (tutorState.learningStage) {
    case "orient":
      beginGuidedBuild();
      break;
    case "build":
      if (assessment?.guidance?.readyForPrediction) {
        tutorState.setLearningStage("predict");
        tutorState.resetPrediction(plan.learningMoments.predict.prompt);
      } else {
        switchToTab("scene");
      }
      break;
    case "predict":
      if (!tutorState.predictionState.submitted) {
        predictionSubmit.click();
        return;
      }
      tutorState.setLearningStage("check");
      lastSceneFeedback = "Use the scene to test your prediction.";
      break;
    case "check":
      tutorState.setLearningStage("reflect");
      break;
    case "reflect":
      tutorState.setLearningStage("challenge");
      break;
    case "challenge":
      if (activeChallenge && assessment?.answerGate?.allowed) {
        answerInput?.focus();
      } else {
        sendTutorMessage("Give me one short follow-up challenge based on the current scene.", {
          userLabel: "Give me a short challenge",
        });
      }
      break;
    default:
      break;
  }

  renderLessonCard();
  updateStepIndicator();
}

async function loadChallengesList() {
  try {
    const { challenges } = await fetchChallenges();
    challengeList.innerHTML = challenges.map((challenge) => `
      <div class="challenge-item" data-id="${challenge.id}">
        <p class="challenge-title">${challenge.title}</p>
        <div class="challenge-meta">
          <span class="challenge-diff ${challenge.difficulty}">${challenge.difficulty}</span>
          <span>${challenge.category}</span>
        </div>
      </div>
    `).join("");

    challengeList.querySelectorAll(".challenge-item").forEach((node) => {
      node.addEventListener("click", () => {
        const challenge = challenges.find((candidate) => candidate.id === node.dataset.id);
        if (!challenge) return;
        activeChallenge = challenge;
        questionInput.value = challenge.question;
        questionImageFile = null;
        questionImageInput.value = "";
        renderQuestionImageState();
        tutorState.startChallenge(challenge.id, challenge.scenePlan);
        setPlan(challenge.scenePlan, { challenge, clearScene: true });
        tutorState.setLearningStage("build");
        addTranscriptMessage("system", `Practice challenge loaded: ${challenge.title}`);
        beginManualBuild();
      });
    });
  } catch (error) {
    challengeList.innerHTML = `<p class="muted-text">Challenges need the server to be running.</p>`;
    console.error("Challenge load failed:", error);
  }
}

async function handleAnswerSubmit() {
  if (!activeChallenge) return;
  const answer = Number(answerInput?.value);
  if (!Number.isFinite(answer)) {
    showAnswerFeedback("Enter a valid number first.", false);
    return;
  }
  if (!tutorState.latestAssessment?.answerGate?.allowed) {
    showAnswerFeedback("Finish the build check before answering.", false);
    return;
  }

  try {
    const result = await checkChallenge(activeChallenge.id, answer);
    showAnswerFeedback(result.feedback, result.correct);
    if (result.correct) {
      tutorState.recordCorrect();
      scoreDisplay.textContent = `Score: ${tutorState.score}`;
      tutorState.setPhase("complete");
    } else {
      tutorState.recordIncorrect();
    }
  } catch (error) {
    showAnswerFeedback(`Error: ${error.message}`, false);
  }
}

function handleSceneMutation(detail) {
  const plan = activePlan();
  if (!plan || !detail || detail.type !== "objects") return;

  if (detail.reason === "place" && detail.object?.label) {
    lastSceneFeedback = `Placed ${detail.object.label}. Nova is checking how it fits the current goal.`;
  } else if (detail.reason === "drag-end" && detail.object?.label) {
    lastSceneFeedback = `Updated ${detail.object.label}. Check whether that changes the focus relationship.`;
  } else if (detail.object?.label) {
    lastSceneFeedback = `${detail.object.label} changed. Inspect the scene and compare it with your prediction.`;
  }

  if (tutorState.learningStage === "predict" && tutorState.predictionState.submitted) {
    tutorState.setLearningStage("check");
  }

  renderSceneInfo();
  renderLessonCard();
  syncUnfoldDrawer();
  scheduleAssessment();
}

function bindEvents() {
  document.querySelectorAll(".panel-tab").forEach((button) => {
    button.addEventListener("click", () => switchToTab(button.dataset.tab));
  });

  questionSubmit?.addEventListener("click", handleQuestionSubmit);
  questionInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleQuestionSubmit();
    }
  });

  questionImageInput?.addEventListener("change", () => {
    const file = questionImageInput.files?.[0] || null;
    if (file && !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      questionImageFile = null;
      setQuestionStatus("Only PNG, JPEG, and WEBP diagrams are supported.", "error");
      questionImageInput.value = "";
      renderQuestionImageState();
      return;
    }
    if (file && file.size > 3.75 * 1024 * 1024) {
      questionImageFile = null;
      setQuestionStatus("Uploaded diagram must be 3.75 MB or smaller.", "error");
      questionImageInput.value = "";
      renderQuestionImageState();
      return;
    }
    questionImageFile = file;
    renderQuestionImageState();
    setQuestionStatus("", "hidden");
  });

  questionImageClear?.addEventListener("click", () => {
    questionImageFile = null;
    questionImageInput.value = "";
    renderQuestionImageState();
  });

  addAllBtn?.addEventListener("click", loadDraftScene);
  stepByStepBtn?.addEventListener("click", beginGuidedBuild);
  buildManuallyBtn?.addEventListener("click", beginManualBuild);
  hintBtn?.addEventListener("click", handleHint);
  explainBtn?.addEventListener("click", handleExplain);
  advanceStageBtn?.addEventListener("click", advanceLessonStage);
  predictionSubmit?.addEventListener("click", () => {
    const response = predictionInput?.value?.trim() || "";
    tutorState.submitPrediction(response);
    tutorState.setLearningStage("check");
    lastSceneFeedback = response
      ? `Prediction saved: "${response}". Now use the scene to test it.`
      : "Prediction saved. Now use the scene to test it.";
    renderLessonCard();
    updateStepIndicator();
  });

  voiceToggle?.addEventListener("click", () => {
    voiceEnabled = !voiceEnabled;
    voiceToggle.classList.toggle("is-active", voiceEnabled);
    voiceToggle.setAttribute("aria-pressed", String(voiceEnabled));
    voiceToggle.textContent = voiceEnabled ? "Voice On" : "Voice";
  });

  chatSend?.addEventListener("click", () => {
    const text = chatInput?.value?.trim();
    if (!text) return;
    chatInput.value = "";
    sendTutorMessage(text);
  });
  chatInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      chatSend.click();
    }
  });

  answerSubmit?.addEventListener("click", handleAnswerSubmit);
  answerInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAnswerSubmit();
    }
  });

  transcriptDetails?.addEventListener("toggle", () => {
    tutorState.setTranscriptCollapsed(!transcriptDetails.open);
  });
  followUpDetails?.addEventListener("toggle", () => {
    tutorState.setFollowUpCollapsed(!followUpDetails.open);
  });

  stepPrev?.addEventListener("click", () => {
    tutorState.prevStep();
    updateStepIndicator();
    renderLessonCard();
    scheduleAssessment();
  });
  stepNext?.addEventListener("click", () => {
    tutorState.nextStep();
    updateStepIndicator();
    renderLessonCard();
    scheduleAssessment();
  });
}

function bindDom() {
  questionInput = document.getElementById("questionInput");
  questionSubmit = document.getElementById("questionSubmit");
  questionStatus = document.getElementById("questionStatus");
  questionImageInput = document.getElementById("questionImageInput");
  questionImageMeta = document.getElementById("questionImageMeta");
  questionImagePreview = document.getElementById("questionImagePreview");
  questionImageThumb = document.getElementById("questionImageThumb");
  questionImageClear = document.getElementById("questionImageClear");
  scenePlanSection = document.getElementById("scenePlanSection");
  planSummary = document.getElementById("planSummary");
  buildSummary = document.getElementById("buildSummary");
  planObjects = document.getElementById("planObjects");
  addAllBtn = document.getElementById("addAllBtn");
  stepByStepBtn = document.getElementById("stepByStepBtn");
  buildManuallyBtn = document.getElementById("buildManuallyBtn");
  lessonSection = document.getElementById("lessonSection");
  lessonStagePill = document.getElementById("lessonStagePill");
  lessonHeadline = document.getElementById("lessonHeadline");
  lessonMessage = document.getElementById("lessonMessage");
  lessonGoal = document.getElementById("lessonGoal");
  lessonFeedback = document.getElementById("lessonFeedback");
  predictionPanel = document.getElementById("predictionPanel");
  predictionPrompt = document.getElementById("predictionPrompt");
  predictionInput = document.getElementById("predictionInput");
  predictionSubmit = document.getElementById("predictionSubmit");
  challengePromptCard = document.getElementById("challengePromptCard");
  challengePromptText = document.getElementById("challengePromptText");
  hintBtn = document.getElementById("hintBtn");
  hintCount = document.getElementById("hintCount");
  explainBtn = document.getElementById("explainBtn");
  advanceStageBtn = document.getElementById("advanceStageBtn");
  voiceToggle = document.getElementById("voiceToggle");
  whyDetails = document.getElementById("whyDetails");
  whyText = document.getElementById("whyText");
  transcriptDetails = document.getElementById("transcriptDetails");
  chatMessages = document.getElementById("chatMessages");
  followUpDetails = document.getElementById("followUpDetails");
  chatInput = document.getElementById("chatInput");
  chatSend = document.getElementById("chatSend");
  answerSection = document.getElementById("answerSection");
  answerInput = document.getElementById("answerInput");
  answerSubmit = document.getElementById("answerSubmit");
  answerFeedback = document.getElementById("answerFeedback");
  challengeList = document.getElementById("challengeList");
  scoreDisplay = document.getElementById("scoreDisplay");
  sceneInfo = document.getElementById("sceneInfo");
  sceneValidation = document.getElementById("sceneValidation");
  cameraBookmarkList = document.getElementById("cameraBookmarkList");
  objectCount = document.getElementById("objectCount");
  stepIndicator = document.getElementById("stepIndicator");
  stepLabel = document.getElementById("stepLabel");
  stepPrev = document.getElementById("stepPrev");
  stepNext = document.getElementById("stepNext");
}

export function initTutorController(context) {
  appContext = context;
  world = context.world;
  sceneApi = context.sceneApi;
  cameraDirector = new CameraDirector(world.camera, world.controls);

  const stageWrap = document.querySelector(".stage-wrap");
  if (stageWrap) {
    initLabelRenderer(stageWrap);
  }

  bindDom();
  bindEvents();
  initUnfoldDrawer(context);
  updateHintCount();
  renderQuestionImageState();
  renderAssessment(null);
  renderSceneInfo();
  renderLessonCard();
  updateStepIndicator();
  loadChallengesList();

  sceneApi.onSceneEvent((detail) => {
    if (detail.type === "objects") {
      handleSceneMutation(detail);
    }
  });

  sceneApi.onSelectionChange(() => {
    const selected = selectedObjectContext();
    if (selected) {
      lastSceneFeedback = `Selected ${selected.label}. Use it to inspect the current idea.`;
      if (tutorState.learningStage === "predict" && tutorState.predictionState.submitted) {
        tutorState.setLearningStage("check");
      }
    }
    renderSceneInfo();
    renderLessonCard();
    syncUnfoldDrawer();
  });

}

export function updateTutorLabels() {
  if (world) {
    renderLabels(world.scene, world.camera);
  }
  syncUnfoldDrawer();
}
