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
let observationState = null;

let questionInput;
let questionSubmit;
let questionStatus;
let scenePlanSection;
let planSummary;
let buildSummary;
let planObjects;
let addAllBtn;
let stepByStepBtn;
let buildManuallyBtn;
let buildStatusSection;
let buildCompletionChip;
let buildProgress;
let stepStatusNote;
let buildStepsSection;
let buildStepsList;
let buildGoalChip;
let liveChallengeSection;
let liveChallengeChip;
let liveChallengeCard;
let challengeList;
let scoreDisplay;
let chatMessages;
let chatInput;
let chatSend;
let hintBtn;
let hintCount;
let explainBtn;
let voiceToggle;
let answerSection;
let answerInput;
let answerSubmit;
let answerFeedback;
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

function suggestionTitle(plan, suggestionId) {
  return plan?.objectSuggestions?.find((suggestion) => suggestion.id === suggestionId)?.title || suggestionId;
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
    metrics: {
      volume: Number(metrics.volume.toFixed(3)),
      surfaceArea: Number(metrics.surfaceArea.toFixed(3)),
    },
  };
}

function resetLiveChallengeState(plan = activePlan()) {
  const challenge = plan?.liveChallenge || null;
  liveChallengeState = challenge
    ? {
      planId: plan.problem?.id || null,
      challengeId: challenge.id,
      unlocked: false,
      complete: false,
      primarySuggestionId: null,
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

function resetObservationState() {
  observationState = {
    announcedStepIds: new Set(),
    lastPlacedObjectId: null,
    liveUnlocked: false,
    liveComplete: false,
    lastProgressBucket: -1,
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

function addChatMessage(role, content) {
  if (!chatMessages) return null;
  chatMessages.querySelector(".chat-welcome")?.remove();
  const message = document.createElement("div");
  message.className = `chat-msg is-${role}`;
  message.textContent = content;
  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return message;
}

function appendTutorObservation(content) {
  addChatMessage("tutor", content);
  tutorState.addMessage("assistant", content);
}

function clearChat() {
  if (chatMessages) chatMessages.innerHTML = "";
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
    sceneInfo.innerHTML = `<p class="muted-text">Ask a question or choose a practice challenge to generate a guided build.</p>`;
    return;
  }

  const selectionMarkup = selected
    ? `
      <p class="muted-text" style="margin:8px 0 0">
        Selected: <strong>${selected.label}</strong>
        <span class="formula">V = ${formatNumber(selected.metrics.volume)}, SA = ${formatNumber(selected.metrics.surfaceArea)}</span>
      </p>
    `
    : `<p class="muted-text" style="margin:8px 0 0">Select or right click a solid to inspect its dimensions and unfold view.</p>`;

  sceneInfo.innerHTML = `
    <p style="margin:0 0 6px"><strong>${plan.problem.question}</strong></p>
    <p class="muted-text">${count} object${count === 1 ? "" : "s"} currently in the world</p>
    <p class="muted-text">Formula scaffold: <span class="formula">${plan.answerScaffold.formula || "Ask the tutor to derive it from the current scene."}</span></p>
    ${selectionMarkup}
  `;
}

function renderPlanSummary(plan) {
  if (!planSummary || !planObjects || !scenePlanSection) return;
  planSummary.textContent = plan.problem.summary || plan.problem.question;
  if (buildSummary) {
    buildSummary.classList.remove("hidden");
    buildSummary.textContent = plan.overview || "Nova turned the question into a spatial build. Start placing objects or let Nova add the scene.";
  }
  planObjects.innerHTML = plan.objectSuggestions.map((suggestion) => `
    <li>
      <strong>${suggestion.title}</strong><br />
      <span class="muted-text">${suggestion.purpose}</span>
    </li>
  `).join("");
  scenePlanSection.classList.remove("hidden");
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

function missingSuggestionIds(step, assessment) {
  if (!step || !assessment) return [];
  const byId = new Map(assessment.objectAssessments.map((item) => [item.suggestionId, item]));
  return (step.requiredObjectIds || []).filter((id) => !byId.get(id)?.present);
}

function addSuggestionsById(suggestionIds) {
  const plan = activePlan();
  if (!plan) return;
  const snapshot = currentSnapshot();
  const existingShapes = new Set(snapshot.objects.map((objectSpec) => `${objectSpec.shape}:${JSON.stringify(objectSpec.params)}`));
  const toAdd = plan.objectSuggestions
    .filter((suggestion) => suggestionIds.includes(suggestion.id))
    .filter((suggestion) => !existingShapes.has(`${suggestion.object.shape}:${JSON.stringify(suggestion.object.params)}`))
    .map((suggestion) => suggestion.object);
  if (!toAdd.length) return;
  sceneApi.addObjects(toAdd, { reason: "guided-add" });
  renderAnnotations();
}

function renderSteps(plan, assessment) {
  if (!buildStepsList || !buildStepsSection || !plan) return;
  buildStepsSection.classList.remove("hidden");
  const currentStep = tutorState.getCurrentStep();
  buildGoalChip.textContent = currentStep ? currentStep.title : "Ready";

  buildStepsList.innerHTML = plan.buildSteps.map((step, index) => {
    const stepAssessment = assessment?.stepAssessments?.find((item) => item.stepId === step.id);
    const active = tutorState.currentStep === index;
    const complete = Boolean(stepAssessment?.complete);
    const missing = missingSuggestionIds(step, assessment);
    const buttonLabel = missing.length
      ? `Add ${missing.length} suggestion${missing.length === 1 ? "" : "s"}`
      : step.cameraBookmarkId ? "Focus view" : "Review step";
    return `
      <article class="build-step-card${active ? " is-active" : ""}${complete ? " is-complete" : ""}" data-step-id="${step.id}">
        <div class="build-step-top">
          <p class="build-step-title">${step.title}</p>
          <span class="build-step-state">${complete ? "complete" : active ? "active" : "open"}</span>
        </div>
        <p class="build-step-instruction">${step.instruction}</p>
        <p class="build-step-hint">${step.hint || "Ask Nova for a short hint if you need one."}</p>
        <p class="build-step-feedback ${complete ? "is-good" : "is-warn"}">${stepAssessment?.feedback || "Build this part of the scene to continue."}</p>
        <div class="build-step-actions">
          <button type="button" class="step-card-btn" data-step-action="focus" data-step-id="${step.id}">${buttonLabel}</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderAssessment(assessment) {
  if (!sceneValidation) return;
  if (!assessment) {
    sceneValidation.innerHTML = `<p class="muted-text">The tutor will evaluate your scene as you build.</p>`;
    showAnswerSection(false);
    return;
  }

  sceneValidation.innerHTML = `
    <div class="validation-stat"><strong>${assessment.summary.matchedRequiredObjects}/${assessment.summary.totalRequiredObjects}</strong> required objects matched</div>
    <div class="validation-stat"><strong>${Math.round(assessment.summary.completionRatio * 100)}%</strong> build completion</div>
    <div class="validation-stat"><strong>${assessment.answerGate.allowed ? "Ready" : "Not ready"}</strong> to answer<br />${assessment.answerGate.reason}</div>
  `;

  showAnswerSection(Boolean(activeChallenge && assessment.answerGate.allowed));
}

function renderBuildStatus(plan, assessment) {
  if (!buildStatusSection || !buildCompletionChip || !buildProgress || !stepStatusNote) return;
  if (!plan) {
    buildStatusSection.classList.add("hidden");
    return;
  }

  buildStatusSection.classList.remove("hidden");

  if (!assessment) {
    buildCompletionChip.textContent = `0 / ${plan.objectSuggestions.filter((suggestion) => !suggestion.optional).length}`;
    buildProgress.innerHTML = `<p class="muted-text">Nova will track exact object matches as soon as the scene starts changing.</p>`;
    stepStatusNote.textContent = "Place the first required object or let Nova add the suggestions.";
    return;
  }

  const percent = Math.round((assessment.summary.completionRatio || 0) * 100);
  const currentStep = tutorState.getCurrentStep();
  const stepAssessment = currentStepAssessment(assessment);
  const missingTitles = missingSuggestionIds(currentStep, assessment).map((id) => suggestionTitle(plan, id));

  buildCompletionChip.textContent = `${assessment.summary.matchedRequiredObjects} / ${assessment.summary.totalRequiredObjects}`;
  buildProgress.innerHTML = `
    <div class="validation-stat"><strong>${percent}%</strong> completion</div>
    <div class="validation-stat"><strong>${assessment.summary.matchedRequiredObjects}</strong> required object${assessment.summary.matchedRequiredObjects === 1 ? "" : "s"} placed</div>
    <div class="validation-stat"><strong>${stepAssessment?.complete ? "Step clear" : "Step active"}</strong><br />${currentStep?.title || "No active step selected"}</div>
  `;

  if (!currentStep) {
    stepStatusNote.textContent = assessment.answerGate.allowed
      ? "The core build is complete. Manipulate the scene or ask Nova to explain the math."
      : "Select a build step to continue.";
    return;
  }

  stepStatusNote.textContent = stepAssessment?.complete
    ? `${currentStep.title} is complete. Move to the next step or start exploring the scene.`
    : missingTitles.length
      ? `Still needed for ${currentStep.title}: ${missingTitles.join(", ")}.`
      : `Keep shaping ${currentStep.title}. Nova is watching the scene for the right dimensions.`;
}

function showStepIndicator() {
  if (!stepIndicator) return;
  const total = tutorState.totalSteps;
  if (!total) {
    stepIndicator.classList.add("hidden");
    return;
  }
  stepIndicator.classList.remove("hidden");
  stepLabel.textContent = `Build ${tutorState.currentStep + 1} / ${total}`;
  stepPrev.disabled = tutorState.currentStep <= 0;
  stepNext.disabled = tutorState.currentStep >= total - 1;
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
      objectSpec.id === suggestion.object.id ||
      metadata.sourceSuggestionId === suggestion.id ||
      metadata.suggestionId === suggestion.id ||
      metadata.guidedObjectId === suggestion.object.id
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
  const activeObject = liveChallengeState?.primaryObjectId
    ? sceneApi.getObject(liveChallengeState.primaryObjectId)
    : findObjectForSuggestion(snapshot, primarySuggestion, assessment);
  const currentObject = activeObject || findObjectForSuggestion(snapshot, primarySuggestion, assessment);
  const currentMetrics = currentObject ? computeGeometry(currentObject.shape, currentObject.params) : null;
  const currentValue = currentMetrics ? currentMetrics[challenge.metric] : null;

  if (!liveChallengeState.unlocked && assessment?.answerGate?.allowed && primarySuggestion && currentObject && Number.isFinite(currentValue)) {
    liveChallengeState.unlocked = true;
    liveChallengeState.primarySuggestionId = primarySuggestion.id;
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

function renderLiveChallenge(plan, assessment) {
  if (!liveChallengeSection || !liveChallengeChip || !liveChallengeCard) return;
  if (!plan?.liveChallenge) {
    liveChallengeSection.classList.add("hidden");
    return;
  }

  liveChallengeSection.classList.remove("hidden");
  const state = computeLiveChallenge(plan, assessment);
  const metricName = formatMetricName(plan.liveChallenge.metric);

  if (!state?.unlocked) {
    liveChallengeChip.textContent = "Locked";
    liveChallengeCard.innerHTML = `
      <p class="live-challenge-title">${plan.liveChallenge.title || `Double the ${metricName}`}</p>
      <p class="live-challenge-prompt">${plan.liveChallenge.prompt || `Complete the build to unlock a live ${metricName} target.`}</p>
      <div class="live-challenge-progress"><span style="width: 0%"></span></div>
    `;
    return;
  }

  liveChallengeChip.textContent = state.complete ? "Complete" : "Active";
  const progressPercent = Math.max(0, Math.min(state.progress * 100, 100));
  const remaining = Number.isFinite(state.deltaValue) ? state.targetValue - state.currentValue : null;
  liveChallengeCard.innerHTML = `
    <p class="live-challenge-title">${state.title || `Double the ${metricName}`}</p>
    <p class="live-challenge-prompt">${state.prompt || `Adjust the scene until the ${metricName} reaches the target.`}</p>
    <div class="live-challenge-metric">
      <div class="live-challenge-stat">
        <span class="live-challenge-stat-label">Current</span>
        <span class="live-challenge-stat-value">${formatNumber(state.currentValue)}</span>
      </div>
      <div class="live-challenge-stat">
        <span class="live-challenge-stat-label">Target</span>
        <span class="live-challenge-stat-value">${formatNumber(state.targetValue)}</span>
      </div>
      <div class="live-challenge-stat">
        <span class="live-challenge-stat-label">${state.complete ? "Status" : "Delta"}</span>
        <span class="live-challenge-stat-value">${state.complete ? "Within tolerance" : formatNumber(remaining)}</span>
      </div>
    </div>
    <div class="live-challenge-progress"><span style="width: ${progressPercent}%"></span></div>
    <p class="muted-text">${state.complete
      ? `Target reached. Nova accepts a tolerance of +/-${formatNumber(state.toleranceValue)} ${metricName}.`
      : `Tolerance: +/-${formatNumber(state.toleranceValue)} ${metricName}. Keep shaping the object until the target is close enough.`}</p>
  `;
}

function sceneContextPayload(plan, assessment) {
  const snapshot = currentSnapshot();
  const selection = selectedObjectContext(snapshot);
  const challenge = plan?.liveChallenge ? computeLiveChallenge(plan, assessment) : null;
  return {
    selection,
    liveChallenge: challenge
      ? {
        id: challenge.challengeId,
        title: challenge.title,
        metric: challenge.metric,
        unlocked: challenge.unlocked,
        complete: challenge.complete,
        currentValue: challenge.currentValue,
        targetValue: challenge.targetValue,
        toleranceValue: challenge.toleranceValue,
      }
      : null,
  };
}

function handleAssessmentObservations(plan, previousAssessment, nextAssessment) {
  if (!plan || !nextAssessment || !observationState) return;

  const previousMatched = previousAssessment?.summary?.matchedRequiredObjects || 0;
  const nextMatched = nextAssessment.summary?.matchedRequiredObjects || 0;
  if (nextMatched > previousMatched) {
    appendTutorObservation(`Build progress: ${nextMatched}/${nextAssessment.summary.totalRequiredObjects} required objects are now matched.`);
  }

  nextAssessment.stepAssessments.forEach((stepAssessment) => {
    if (!stepAssessment.complete || observationState.announcedStepIds.has(stepAssessment.stepId)) return;
    observationState.announcedStepIds.add(stepAssessment.stepId);
    const nextStep = plan.buildSteps.find((step) => step.id === stepAssessment.stepId);
    appendTutorObservation(nextStep
      ? `${nextStep.title} is complete. ${nextStep.hint || "Move on to the next spatial relationship."}`
      : `${stepAssessment.title} is complete.`);
  });
}

function handleLiveChallengeObservations(plan, assessment) {
  const state = computeLiveChallenge(plan, assessment);
  if (!state || !observationState) return;

  if (state.unlocked && !observationState.liveUnlocked) {
    observationState.liveUnlocked = true;
    appendTutorObservation(`Live challenge unlocked: reach ${formatNumber(state.targetValue)} ${formatMetricName(state.metric)} by reshaping the main object.`);
  }

  const bucket = Math.floor(Math.max(0, Math.min(state.progress, 1)) * 4);
  if (state.unlocked && !state.complete && bucket > observationState.lastProgressBucket && bucket > 0) {
    observationState.lastProgressBucket = bucket;
    appendTutorObservation(`Challenge progress: you're about ${bucket * 25}% of the way to the ${formatMetricName(state.metric)} target.`);
  }

  if (state.complete && !observationState.liveComplete) {
    observationState.liveComplete = true;
    appendTutorObservation(`Challenge complete. The current ${formatMetricName(state.metric)} is within Nova's tolerance band.`);
  }
}

async function syncAssessment() {
  const plan = activePlan();
  if (!plan) {
    renderAssessment(null);
    renderBuildStatus(null, null);
    renderLiveChallenge(null, null);
    return;
  }

  try {
    const previousAssessment = tutorState.latestAssessment;
    const { assessment } = await evaluateBuild({
      plan,
      sceneSnapshot: currentSnapshot(),
      currentStepId: tutorState.getCurrentStep()?.id || null,
    });
    tutorState.setAssessment(assessment);
    renderSteps(plan, assessment);
    renderAssessment(assessment);
    renderBuildStatus(plan, assessment);
    renderLiveChallenge(plan, assessment);
    renderSceneInfo();
    showStepIndicator();
    handleAssessmentObservations(plan, previousAssessment, assessment);
    handleLiveChallengeObservations(plan, assessment);
  } catch (error) {
    console.error("Assessment sync failed:", error);
  }
}

function scheduleAssessment() {
  window.clearTimeout(assessmentTimer);
  assessmentTimer = window.setTimeout(() => {
    syncAssessment();
    renderAnnotations();
  }, 180);
}

function setPlan(plan, options = {}) {
  const normalizedPlan = normalizeScenePlan(plan);
  activeChallenge = options.challenge || null;
  tutorState.setPlan(normalizedPlan, { mode: options.mode || normalizedPlan.problem.mode || "guided" });
  tutorState.setPhase("plan_ready");
  resetLiveChallengeState(normalizedPlan);
  resetObservationState();

  if (answerFeedback) {
    answerFeedback.textContent = "";
    answerFeedback.classList.add("hidden");
  }
  if (answerInput) answerInput.value = "";

  renderPlanSummary(normalizedPlan);
  renderCameraBookmarks(normalizedPlan);
  renderSceneInfo();
  renderAssessment(null);
  renderBuildStatus(normalizedPlan, null);
  renderLiveChallenge(normalizedPlan, null);
  renderSteps(normalizedPlan, null);
  showStepIndicator();

  if (options.clearScene !== false) {
    sceneApi.clearScene();
  }
}

async function handleQuestionSubmit() {
  const question = questionInput?.value?.trim();
  if (!question) return;

  tutorState.reset();
  activeChallenge = null;
  resetObservationState();
  resetLiveChallengeState(null);
  tutorState.setPhase("parsing");
  questionSubmit.disabled = true;
  setQuestionStatus("Asking Nova Pro for a scene plan...", "loading");

  try {
    const { scenePlan } = await requestScenePlan({ question, mode: "guided", sceneSnapshot: currentSnapshot() });
    setPlan(scenePlan);
    clearChat();
    addChatMessage("system", `Question loaded: "${question}"`);
    beginGuidedBuild({ announce: false });
    appendTutorObservation("Nova translated the text into a spatial build. Start with the active step, or open the Scene tab to place the objects manually.");
    setQuestionStatus("", "hidden");
  } catch (error) {
    console.error("Plan request failed:", error);
    tutorState.setError(error.message);
    setQuestionStatus(`Error: ${error.message}`, "error");
  } finally {
    questionSubmit.disabled = false;
  }
}

function beginGuidedBuild(options = {}) {
  const plan = activePlan();
  if (!plan) return;
  tutorState.setMode("guided");
  tutorState.setPhase(activeChallenge ? "challenge" : "guided_build");
  sceneApi.clearScene();
  switchToTab(options.tab || "tutor");
  if (options.announce !== false) {
    appendTutorObservation("Guided build is ready. Use the active step, or place the required shapes directly in the scene.");
  }
  scheduleAssessment();
}

function addAllSuggestedObjects() {
  const plan = activePlan();
  if (!plan) return;
  tutorState.setMode("guided");
  tutorState.setPhase("explore");
  sceneApi.loadSnapshot(buildSceneSnapshotFromSuggestions(plan), "add-all");
  renderAnnotations();
  appendTutorObservation("The full suggested scene is now in the world. Rotate it, resize it, or ask Nova why the measurements matter.");
  scheduleAssessment();
}

function beginManualBuild() {
  const plan = activePlan();
  if (!plan) return;
  tutorState.setMode("manual");
  tutorState.setPhase(activeChallenge ? "challenge" : "manual_build");
  sceneApi.clearScene();
  switchToTab("scene");
  appendTutorObservation("Manual build mode is active. Place the objects yourself, and Nova will count exact guided matches.");
  scheduleAssessment();
}

async function sendTutorMessage(messageText) {
  const plan = activePlan();
  if (!plan) return;
  const text = messageText?.trim();
  if (!text) return;
  addChatMessage("user", text);
  tutorState.addMessage("user", text);

  const typing = addChatMessage("tutor", "...");
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
        chatMessages.scrollTop = chatMessages.scrollHeight;
      },
      onAssessment: (assessment) => {
        tutorState.setAssessment(assessment);
        renderAssessment(assessment);
        renderBuildStatus(plan, assessment);
        renderSteps(plan, assessment);
        renderLiveChallenge(plan, assessment);
      },
    });

    if (typing) {
      typing.classList.remove("loading-dots");
      typing.textContent = response.text || "I could not generate a tutor reply.";
      tutorState.addMessage("assistant", typing.textContent);
    }

    if (response.assessment) {
      tutorState.setAssessment(response.assessment);
      renderBuildStatus(plan, response.assessment);
      renderLiveChallenge(plan, response.assessment);
    }

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
    addChatMessage("system", "No more hints available.");
    return;
  }
  updateHintCount();
  await sendTutorMessage("Give me one short hint about the next spatial step.");
}

async function handleExplain() {
  const step = tutorState.getCurrentStep();
  if (!step) {
    await sendTutorMessage("Explain how to reason about this scene.");
    return;
  }
  await sendTutorMessage(`Explain this build step: ${step.title}.`);
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

function bindStepList() {
  buildStepsList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-step-action]");
    const card = event.target.closest("[data-step-id]");
    const stepId = button?.dataset.stepId || card?.dataset.stepId;
    if (!stepId) return;

    const plan = activePlan();
    const stepIndex = plan?.buildSteps?.findIndex((step) => step.id === stepId) ?? -1;
    if (stepIndex >= 0) {
      tutorState.goToStep(stepIndex);
      showStepIndicator();
      renderSteps(plan, tutorState.latestAssessment);
      renderBuildStatus(plan, tutorState.latestAssessment);
    }

    if (button?.dataset.stepAction === "focus") {
      const step = plan?.buildSteps?.[stepIndex];
      if (!step) return;
      const assessment = tutorState.latestAssessment;
      const idsToAdd = missingSuggestionIds(step, assessment);
      if (idsToAdd.length) {
        addSuggestionsById(idsToAdd);
        addChatMessage("system", `Added suggestions for ${step.title}.`);
      } else if (step.cameraBookmarkId) {
        const bookmark = plan.cameraBookmarks.find((candidate) => candidate.id === step.cameraBookmarkId);
        if (bookmark) {
          cameraDirector.animateTo(bookmark.position, bookmark.target, 900);
        }
      }
      scheduleAssessment();
    }
  });
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
        tutorState.startChallenge(challenge.id, challenge.scenePlan);
        setPlan(challenge.scenePlan, { challenge, clearScene: true });
        clearChat();
        addChatMessage("system", `Challenge: ${challenge.title}`);
        appendTutorObservation("Build the scene correctly first. When the required objects are in place, the answer box unlocks.");
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
  if (!plan || !detail || detail.type !== "objects" || !observationState) return;

  renderSceneInfo();
  renderLiveChallenge(plan, tutorState.latestAssessment);
  syncUnfoldDrawer();

  if (detail.reason === "place" && detail.object?.id && observationState.lastPlacedObjectId !== detail.object.id) {
    observationState.lastPlacedObjectId = detail.object.id;
    appendTutorObservation(`Placed ${detail.object.label || detail.object.shape}. Nova will count it against the current build step.`);
  }

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

  addAllBtn?.addEventListener("click", addAllSuggestedObjects);
  stepByStepBtn?.addEventListener("click", () => beginGuidedBuild());
  buildManuallyBtn?.addEventListener("click", beginManualBuild);
  hintBtn?.addEventListener("click", handleHint);
  explainBtn?.addEventListener("click", handleExplain);
  voiceToggle?.addEventListener("click", () => {
    voiceEnabled = !voiceEnabled;
    voiceToggle.classList.toggle("is-active", voiceEnabled);
    voiceToggle.setAttribute("aria-pressed", String(voiceEnabled));
    voiceToggle.textContent = voiceEnabled ? "Voice On" : "Voice";
  });

  document.getElementById("demoBtn")?.addEventListener("click", () => {
    questionInput.value = "A cylinder has radius 3 and height 10. What is its volume?";
    handleQuestionSubmit();
  });

  answerSubmit?.addEventListener("click", handleAnswerSubmit);
  answerInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAnswerSubmit();
    }
  });

  stepPrev?.addEventListener("click", () => {
    tutorState.prevStep();
    showStepIndicator();
    renderSteps(activePlan(), tutorState.latestAssessment);
    renderBuildStatus(activePlan(), tutorState.latestAssessment);
  });
  stepNext?.addEventListener("click", () => {
    tutorState.nextStep();
    showStepIndicator();
    renderSteps(activePlan(), tutorState.latestAssessment);
    renderBuildStatus(activePlan(), tutorState.latestAssessment);
  });

  bindStepList();
}

function bindDom() {
  questionInput = document.getElementById("questionInput");
  questionSubmit = document.getElementById("questionSubmit");
  questionStatus = document.getElementById("questionStatus");
  scenePlanSection = document.getElementById("scenePlanSection");
  planSummary = document.getElementById("planSummary");
  buildSummary = document.getElementById("buildSummary");
  planObjects = document.getElementById("planObjects");
  addAllBtn = document.getElementById("addAllBtn");
  stepByStepBtn = document.getElementById("stepByStepBtn");
  buildManuallyBtn = document.getElementById("buildManuallyBtn");
  buildStatusSection = document.getElementById("buildStatusSection");
  buildCompletionChip = document.getElementById("buildCompletionChip");
  buildProgress = document.getElementById("buildProgress");
  stepStatusNote = document.getElementById("stepStatusNote");
  buildStepsSection = document.getElementById("buildStepsSection");
  buildStepsList = document.getElementById("buildStepsList");
  buildGoalChip = document.getElementById("buildGoalChip");
  liveChallengeSection = document.getElementById("liveChallengeSection");
  liveChallengeChip = document.getElementById("liveChallengeChip");
  liveChallengeCard = document.getElementById("liveChallengeCard");
  challengeList = document.getElementById("challengeList");
  scoreDisplay = document.getElementById("scoreDisplay");
  chatMessages = document.getElementById("chatMessages");
  chatInput = document.getElementById("chatInput");
  chatSend = document.getElementById("chatSend");
  hintBtn = document.getElementById("hintBtn");
  hintCount = document.getElementById("hintCount");
  explainBtn = document.getElementById("explainBtn");
  voiceToggle = document.getElementById("voiceToggle");
  answerSection = document.getElementById("answerSection");
  answerInput = document.getElementById("answerInput");
  answerSubmit = document.getElementById("answerSubmit");
  answerFeedback = document.getElementById("answerFeedback");
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
  resetObservationState();
  resetLiveChallengeState(null);
  updateHintCount();
  renderAssessment(null);
  renderBuildStatus(null, null);
  renderLiveChallenge(null, null);
  renderSceneInfo();
  loadChallengesList();

  sceneApi.onSceneEvent((detail) => {
    if (detail.type === "objects") {
      handleSceneMutation(detail);
    }
  });

  sceneApi.onSelectionChange(() => {
    renderSceneInfo();
    renderLiveChallenge(activePlan(), tutorState.latestAssessment);
    syncUnfoldDrawer();
  });

  if (new URLSearchParams(window.location.search).has("demo")) {
    questionInput.value = "A cylinder has radius 3 and height 10. What is its volume?";
    handleQuestionSubmit();
  }
}

export function updateTutorLabels() {
  if (world) {
    renderLabels(world.scene, world.camera);
  }
  syncUnfoldDrawer();
}
