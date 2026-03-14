import {
  requestScenePlan,
  evaluateBuild,
  askTutor,
  requestVoiceResponse,
} from "../ai/client.js";
import { buildSceneSnapshotFromSuggestions, normalizeScenePlan } from "../ai/planSchema.js";
import { computeGeometry } from "../core/geometry.js";
import { initLabelRenderer, renderLabels, addLabel, clearLabels } from "../render/labels.js";
import { AnalyticOverlayManager } from "../render/analyticOverlayManager.js";
import { CameraDirector } from "../render/cameraDirector.js";
import { tutorState } from "../state/tutorState.js";
import { initUnfoldDrawer, syncUnfoldDrawer } from "./unfoldDrawer.js";
import { MicrophoneCapture } from "./microphoneCapture.js";
import { extractPastedQuestionImageFile } from "./questionImage.js";

let world = null;
let sceneApi = null;
let cameraDirector = null;
let assessmentTimer = null;
let questionImageFile = null;
let questionImagePreviewUrl = null;
let lastSceneFeedback = "Nova Prism will react to what you do in the scene.";
let voiceConversationId = null;
let voiceRecording = false;
let activeMicCapture = null;
let lastAnnouncedStageKey = null;
let lastCheckpointKey = null;
let analyticOverlayManager = null;
let analyticFormulaVisible = false;
let analyticFullSolutionVisible = false;
let analyticFormulaDismissed = false;

let questionSection;
let questionInput;
let questionSubmit;
let questionStatus;
let questionImageInput;
let questionImageMeta;
let questionImagePreview;
let questionImageThumb;
let questionImageClear;
let buildFromDiagramBtn;
let lessonPanelToggle;
let lessonPanelSummary;
let chatMessages;
let chatInput;
let chatSend;
let voiceRecordBtn;
let voiceStatus;
let stageRail;
let stageRailTitle;
let stageRailProgress;
let stageRailGoal;
let chatCheckpoint;
let chatCheckpointPrompt;
let checkpointYesBtn;
let checkpointUnsureBtn;
let sceneInfo;
let sceneValidation;
let cameraBookmarkList;
let objectCount;
let stepIndicator;
let formulaCard;
let formulaCardTitle;
let formulaCardEquation;
let formulaCardExplanation;
let formulaCardRevealBtn;
let formulaCardCloseBtn;
let solutionDrawer;
let solutionDrawerTitle;
let solutionDrawerSteps;
let solutionDrawerClose;

function formatNumber(value, digits = 2) {
  const next = Number(value);
  if (!Number.isFinite(next)) return "0";
  return next.toFixed(digits).replace(/\.00$/, "");
}

function formatKilobytes(bytes) {
  return `${formatNumber(Number(bytes) / 1024, 0)} KB`;
}

function withFollowUp(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return "Feel free to ask any questions.";
  }
  if (/feel free to ask any questions\.?$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed} Feel free to ask any questions.`;
}

function activePlan() {
  return tutorState.plan;
}

function isAnalyticPlan(plan = activePlan()) {
  return plan?.experienceMode === "analytic_auto";
}

function currentSceneMoment(plan = activePlan()) {
  if (!plan?.sceneMoments?.length) return null;
  const currentStepId = tutorState.getCurrentStep()?.id || null;
  return plan.sceneMoments.find((moment) => moment.id === currentStepId)
    || plan.sceneMoments[Math.min(tutorState.currentStep, plan.sceneMoments.length - 1)]
    || plan.sceneMoments[0]
    || null;
}

function currentSnapshot() {
  return sceneApi?.snapshot?.() || { objects: [], selectedObjectId: null };
}

function selectedSceneObject(snapshot = currentSnapshot()) {
  const selectedObjectId = snapshot?.selectedObjectId || sceneApi?.getSelection?.() || null;
  return selectedObjectId ? sceneApi?.getObject?.(selectedObjectId) || null : null;
}

function selectedObjectContext(snapshot = currentSnapshot()) {
  const objectSpec = selectedSceneObject(snapshot);
  if (!objectSpec) return null;

  return {
    id: objectSpec.id,
    label: objectSpec.label || objectSpec.shape,
    shape: objectSpec.shape,
    params: objectSpec.params,
    metrics: computeGeometry(objectSpec.shape, objectSpec.params),
  };
}

function switchToTab(tabName) {
  document.querySelectorAll(".panel-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-content").forEach((content) => {
    content.classList.toggle("active", content.dataset.content === tabName);
  });
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function transcriptMessageTextNode(message) {
  return message?.querySelector(".chat-msg-text") || null;
}

function setTranscriptMessageText(message, content) {
  const node = transcriptMessageTextNode(message);
  if (node) {
    node.textContent = content;
  }
}

function renderMessageActions(message, actions = []) {
  if (!message) return;
  message.querySelector(".chat-msg-actions")?.remove();
  if (!actions.length) return;

  const row = document.createElement("div");
  row.className = "chat-msg-actions";
  actions.forEach((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-action-chip";
    button.textContent = action.label;
    button.addEventListener("click", () => handleTutorAction(action));
    row.appendChild(button);
  });
  message.querySelector(".chat-msg-bubble")?.appendChild(row);
}

function addTranscriptMessage(role, content, options = {}) {
  if (!chatMessages) return null;
  chatMessages.querySelector(".chat-welcome")?.remove();

  const message = document.createElement("div");
  message.className = `chat-msg is-${role}`;

  const bubble = document.createElement("div");
  bubble.className = "chat-msg-bubble";

  const text = document.createElement("p");
  text.className = "chat-msg-text";
  text.textContent = content;

  bubble.appendChild(text);
  message.appendChild(bubble);
  chatMessages.appendChild(message);

  if (options.actions?.length) {
    renderMessageActions(message, options.actions);
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;
  return message;
}

function clearTranscript() {
  if (!chatMessages) return;
  chatMessages.innerHTML = `
    <div class="chat-welcome">
      <p class="chat-welcome-title">Scene-aware tutor</p>
      <p class="chat-welcome-text">Upload a diagram or paste a prompt, then let the tutor guide the build one stage at a time.</p>
    </div>
  `;
}

function setQuestionStatus(text = "", tone = "hidden") {
  if (!questionStatus) return;
  questionStatus.textContent = text;
  questionStatus.className = "question-status";
  if (!text || tone === "hidden") {
    questionStatus.classList.add("hidden");
    return;
  }
  if (tone === "loading") questionStatus.classList.add("is-loading");
  if (tone === "error") questionStatus.classList.add("is-error");
}

function updateVoiceStatus(text = "", tone = "muted") {
  if (!voiceStatus) return;
  voiceStatus.textContent = text;
  voiceStatus.className = "muted-text";
  voiceStatus.style.color = "";
  if (tone === "ready") voiceStatus.style.color = "var(--accent)";
  if (tone === "error") voiceStatus.style.color = "var(--danger)";
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
    if (questionImageMeta) questionImageMeta.textContent = "";
    questionImageThumb?.removeAttribute("src");
    revokeQuestionPreview();
    return;
  }

  if (questionImageMeta) {
    questionImageMeta.textContent = `${questionImageFile.name} - ${formatKilobytes(questionImageFile.size)}`;
  }
  revokeQuestionPreview();
  questionImagePreviewUrl = URL.createObjectURL(questionImageFile);
  if (questionImageThumb) {
    questionImageThumb.src = questionImagePreviewUrl;
  }
}

function validateQuestionImage(file) {
  if (!file) return null;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    return "Only PNG, JPEG, and WEBP diagrams are supported.";
  }
  if (file.size > 3.75 * 1024 * 1024) {
    return "Uploaded diagram must be 3.75 MB or smaller.";
  }
  return null;
}

function setQuestionImageFile(file, { announcePaste = false } = {}) {
  const errorMessage = validateQuestionImage(file);
  if (errorMessage) {
    questionImageFile = null;
    if (questionImageInput) questionImageInput.value = "";
    renderQuestionImageState();
    setQuestionStatus(errorMessage, "error");
    return false;
  }

  questionImageFile = file || null;
  if (questionImageInput && !file) {
    questionImageInput.value = "";
  }
  renderQuestionImageState();
  setQuestionPanelCollapsed(questionSection?.classList.contains("is-collapsed"), { force: true });
  setQuestionStatus(
    announcePaste && file ? `Pasted image ready: ${file.name}` : "",
    announcePaste && file ? "loading" : "hidden"
  );
  return true;
}

function lessonPanelSummaryText() {
  const plan = activePlan();
  const planQuestion = plan?.sourceSummary?.cleanedQuestion || plan?.problem?.question || "";
  const promptText = questionInput?.value?.trim() || "";
  const imageSummary = questionImageFile?.name ? `Diagram: ${questionImageFile.name}` : "";
  return planQuestion || promptText || imageSummary || "Edit the prompt or upload a different diagram.";
}

function setQuestionPanelCollapsed(collapsed, { force = false } = {}) {
  const canCollapse = Boolean(activePlan());
  const nextCollapsed = Boolean(collapsed && canCollapse);

  if (!force && !canCollapse) {
    questionSection?.classList.remove("is-collapsed");
    questionSection?.setAttribute("data-collapsible", "false");
    lessonPanelToggle?.setAttribute("aria-expanded", "true");
    lessonPanelSummary?.classList.add("hidden");
    return;
  }

  questionSection?.classList.toggle("is-collapsed", nextCollapsed);
  questionSection?.setAttribute("data-collapsible", String(canCollapse));
  lessonPanelToggle?.setAttribute("aria-expanded", String(!nextCollapsed));
  if (lessonPanelSummary) {
    lessonPanelSummary.textContent = lessonPanelSummaryText();
    lessonPanelSummary.classList.toggle("hidden", !nextCollapsed);
  }
}

function currentLessonStage(plan = activePlan()) {
  if (!plan?.lessonStages?.length) return null;
  const currentStepId = tutorState.getCurrentStep()?.id || null;
  return plan.lessonStages.find((stage) => stage.id === currentStepId)
    || plan.lessonStages[Math.min(tutorState.currentStep, plan.lessonStages.length - 1)]
    || plan.lessonStages[0]
    || null;
}

function currentStageIndex(plan = activePlan()) {
  const stage = currentLessonStage(plan);
  if (!stage || !plan?.lessonStages?.length) return -1;
  return Math.max(0, plan.lessonStages.findIndex((candidate) => candidate.id === stage.id));
}

function currentStageKey(plan = activePlan()) {
  const stage = currentLessonStage(plan);
  return `${tutorState.learningStage}:${stage?.id || "none"}`;
}

function nextRequiredSuggestion(plan = activePlan(), assessment = tutorState.latestAssessment) {
  const suggestionId = assessment?.guidance?.nextRequiredSuggestionIds?.[0] || null;
  return suggestionId
    ? plan?.objectSuggestions?.find((suggestion) => suggestion.id === suggestionId) || null
    : null;
}

function stageFocusTargets(plan = activePlan(), assessment = tutorState.latestAssessment) {
  const stage = currentLessonStage(plan);
  if (stage?.highlightTargets?.length) {
    return stage.highlightTargets;
  }
  const suggestion = nextRequiredSuggestion(plan, assessment);
  return suggestion?.object?.id ? [suggestion.object.id] : [];
}

function fillPreviewActionObjectSpec(action, plan = activePlan(), assessment = tutorState.latestAssessment) {
  if (!action || action.kind !== "preview-required-object") return action;
  if (action.payload?.objectSpec) return action;

  const suggestionId = action.payload?.suggestionId || nextRequiredSuggestion(plan, assessment)?.id || null;
  if (!suggestionId) return action;

  const suggestion = plan?.objectSuggestions?.find((candidate) => candidate.id === suggestionId) || null;
  if (!suggestion) return action;

  return {
    ...action,
    payload: {
      ...(action.payload || {}),
      suggestionId,
      objectSpec: suggestion.object,
      highlightTargets: action.payload?.highlightTargets?.length
        ? action.payload.highlightTargets
        : [suggestion.object.id],
    },
  };
}

function stageActionsForClient(plan = activePlan(), assessment = tutorState.latestAssessment) {
  if (!plan) return [];

  const stage = currentLessonStage(plan);
  if (isAnalyticPlan(plan)) {
    return stage?.suggestedActions?.length ? stage.suggestedActions : [];
  }
  const learningStage = tutorState.learningStage;
  const defaultExplain = {
    id: `${stage?.id || learningStage}-explain`,
    label: learningStage === "orient" ? "Explain the Scene" : "Explain This Step",
    kind: "explain-stage",
    payload: { stageId: stage?.id || null },
  };
  const continueAction = {
    id: `${stage?.id || learningStage}-continue`,
    label: learningStage === "reflect" ? "Open Questions" : "Continue",
    kind: "continue-stage",
    payload: { stageId: stage?.id || null },
  };
  const previewAction = fillPreviewActionObjectSpec(
    stage?.suggestedActions?.find((action) => action.kind === "preview-required-object")
      || {
        id: `${stage?.id || "lesson"}-preview`,
        label: nextRequiredSuggestion(plan, assessment)?.title
          ? `Preview ${nextRequiredSuggestion(plan, assessment).title}`
          : "Preview Scene",
        kind: "preview-required-object",
        payload: {
          stageId: stage?.id || null,
          suggestionId: nextRequiredSuggestion(plan, assessment)?.id || null,
        },
      },
    plan,
    assessment
  );

  const actions = [];
  if (previewAction?.payload?.objectSpec) {
    actions.push(previewAction);
  }
  actions.push(defaultExplain, continueAction);
  return actions.slice(0, 3);
}

function buildSystemContextMessage(plan = activePlan()) {
  if (!plan) return "";
  const evidence = plan.sourceEvidence || {};
  const source = evidence.diagramSummary || "Using the typed prompt as the source.";
  const givens = evidence.givens?.length ? ` Givens: ${evidence.givens.join(", ")}.` : "";
  const conflicts = evidence.conflicts?.length ? ` Check this mismatch: ${evidence.conflicts.join(" ")}` : "";
  const analytic = isAnalyticPlan(plan)
    ? ` Nova auto-drew the scene for ${plan.analyticContext?.subtype?.replaceAll("_", " ") || "analytic geometry"}.`
    : "";
  return `${source}${givens}${conflicts}${analytic}`.trim();
}

function buildStageIntroMessage(plan = activePlan(), assessment = tutorState.latestAssessment) {
  if (!plan) return "";

  const learningStage = tutorState.learningStage;
  const stage = currentLessonStage(plan);
  const index = currentStageIndex(plan);

  if (isAnalyticPlan(plan) && stage) {
    return withFollowUp(stage.tutorIntro || stage.goal || currentSceneMoment(plan)?.prompt || "");
  }

  if ((learningStage === "orient" || learningStage === "build") && stage) {
    const stageNumber = index >= 0 ? index + 1 : 1;
    const feedbackSource = assessment?.guidance?.coachFeedback || lastSceneFeedback;
    const feedback = feedbackSource ? ` ${feedbackSource}` : "";
    return `Stage ${stageNumber}: ${stage.title}. ${stage.tutorIntro} Goal: ${stage.goal}.${feedback}`.trim();
  }

  if (learningStage === "predict") {
    const moment = plan.learningMoments?.predict || {};
    return `${moment.title || "Prediction"}. ${moment.coachMessage || "Pause before solving and make one short prediction."} ${moment.prompt || "What do you expect to happen?"}`.trim();
  }

  if (learningStage === "check") {
    const moment = plan.learningMoments?.check || {};
    return `${moment.title || "Tutor feedback"}. ${moment.coachMessage || "Use the scene to test your prediction."} ${lastSceneFeedback || moment.goal || "Inspect the object or helper that controls the idea."}`.trim();
  }

  if (learningStage === "reflect") {
    const moment = plan.learningMoments?.reflect || {};
    return `${moment.title || "Reflect"}. ${moment.coachMessage || "Say what became clearer once you saw it in 3D."} ${lastSceneFeedback || moment.goal || "Summarize the key insight in one sentence."}`.trim();
  }

  const moment = plan.learningMoments?.challenge || {};
  return `${moment.title || "Free questions"}. ${moment.coachMessage || "Ask anything about the scene and I will keep the answer grounded in what you built."}`.trim();
}

function updateComposerState() {
  const hasPlan = Boolean(activePlan());
  if (chatInput) {
    chatInput.disabled = !hasPlan;
    if (!hasPlan) {
      chatInput.placeholder = "Start a lesson above to chat with the tutor...";
    } else if (isAnalyticPlan()) {
      chatInput.placeholder = "Ask about the scene, formula, or the current visual step...";
    } else if (tutorState.learningStage === "predict" && !tutorState.predictionState.submitted) {
      chatInput.placeholder = "Type your one-sentence prediction...";
    } else {
      chatInput.placeholder = "Ask a question about the current scene...";
    }
  }
  if (chatSend) chatSend.disabled = !hasPlan;
  if (voiceRecordBtn) voiceRecordBtn.disabled = !hasPlan;
  if (!hasPlan) {
    updateVoiceStatus("Mic ready when a lesson is loaded.", "muted");
  }
}

function setCheckpointState(checkpoint = null) {
  if (!chatCheckpoint || !chatCheckpointPrompt) return;
  if (!checkpoint) {
    chatCheckpoint.classList.add("hidden");
    chatCheckpointPrompt.textContent = "";
    return;
  }
  chatCheckpoint.classList.remove("hidden");
  chatCheckpointPrompt.textContent = checkpoint.prompt || "Does this look correct?";
}

function renderAnalyticPanels(plan = activePlan()) {
  const analytic = plan?.analyticContext || null;
  const showFormulaCard = Boolean(
    isAnalyticPlan(plan)
    && analytic
    && !analyticFormulaDismissed
    && (analyticFormulaVisible || currentSceneMoment(plan)?.revealFormula || analyticFullSolutionVisible)
  );
  const showSolutionDrawer = Boolean(isAnalyticPlan(plan) && analytic && !analyticFormulaDismissed && analyticFullSolutionVisible);

  formulaCard?.classList.toggle("hidden", !showFormulaCard);
  solutionDrawer?.classList.toggle("hidden", !showSolutionDrawer);

  if (!showFormulaCard || !analytic) return;

  if (formulaCardTitle) formulaCardTitle.textContent = analytic.formulaCard?.title || "Relevant Formula";
  if (formulaCardEquation) formulaCardEquation.textContent = analytic.formulaCard?.formula || plan.answerScaffold?.formula || "";
  if (formulaCardExplanation) formulaCardExplanation.textContent = analytic.formulaCard?.explanation || plan.answerScaffold?.explanation || "";
  if (formulaCardRevealBtn) {
    formulaCardRevealBtn.textContent = showSolutionDrawer ? "Hide Full Solution" : "Reveal Full Solution";
  }

  if (showSolutionDrawer && solutionDrawerTitle && solutionDrawerSteps) {
    solutionDrawerTitle.textContent = analytic.formulaCard?.title || "Worked Solution";
    solutionDrawerSteps.innerHTML = "";
    (analytic.solutionSteps || []).forEach((step, index) => {
      const item = document.createElement("div");
      item.className = "solution-step";
      item.innerHTML = `
        <p class="solution-step-index">Step ${index + 1}</p>
        <h4>${escapeHtml(step.title)}</h4>
        <p class="solution-step-formula">${escapeHtml(step.formula || "")}</p>
        <p class="solution-step-copy">${escapeHtml(step.explanation || "")}</p>
      `;
      solutionDrawerSteps.appendChild(item);
    });
  }
}

function updateStageRail() {
  const plan = activePlan();
  if (!stageRail || !stageRailTitle || !stageRailProgress || !stageRailGoal) return;
  if (!plan) {
    stageRail.classList.add("hidden");
    updateComposerState();
    return;
  }

  const stage = currentLessonStage(plan);
  const stageIndex = currentStageIndex(plan);
  const learningStage = tutorState.learningStage;
  const assessment = tutorState.latestAssessment;

  stageRail.classList.remove("hidden");

  if ((learningStage === "orient" || learningStage === "build") && stage) {
    stageRailTitle.textContent = stage.title;
    stageRailProgress.textContent = `Stage ${Math.max(stageIndex + 1, 1)} / ${plan.lessonStages.length}`;
    stageRailGoal.textContent = assessment?.guidance?.coachFeedback || stage.goal || plan.sceneFocus?.focusPrompt || "Build the next important relationship.";
  } else if (learningStage === "predict") {
    stageRailTitle.textContent = plan.learningMoments?.predict?.title || "Prediction";
    stageRailProgress.textContent = "Next";
    stageRailGoal.textContent = tutorState.predictionState.submitted
      ? "Use the scene to test the prediction you just made."
      : plan.learningMoments?.predict?.prompt || "Make one short prediction before moving on.";
  } else if (learningStage === "check") {
    stageRailTitle.textContent = plan.learningMoments?.check?.title || "Tutor Feedback";
    stageRailProgress.textContent = "Check";
    stageRailGoal.textContent = assessment?.guidance?.coachFeedback || plan.learningMoments?.check?.goal || "Inspect the scene and see whether the prediction holds.";
  } else if (learningStage === "reflect") {
    stageRailTitle.textContent = plan.learningMoments?.reflect?.title || "Reflect";
    stageRailProgress.textContent = "Reflect";
    stageRailGoal.textContent = plan.learningMoments?.reflect?.goal || "Say what became clearer once the scene was built.";
  } else {
    stageRailTitle.textContent = plan.learningMoments?.challenge?.title || "Free Questions";
    stageRailProgress.textContent = "Ask Anything";
    stageRailGoal.textContent = plan.learningMoments?.challenge?.goal || "Ask anything about the model and the tutor will keep bringing the answer back to the scene.";
  }

  renderAnalyticPanels(plan);
  updateComposerState();
}

function focusStageTargets(targetIds = [], options = {}) {
  if (!sceneApi?.focusObjects) return;
  if (!targetIds?.length) {
    sceneApi.clearFocus?.();
    return;
  }
  sceneApi.focusObjects(targetIds, options);
}

function syncStepFromAssessment(plan, assessment) {
  if (!plan?.buildSteps?.length || !assessment) return;
  const stepId = assessment.guidance?.currentStepId || assessment.activeStep?.stepId || null;
  if (!stepId) return;
  const stepIndex = plan.buildSteps.findIndex((step) => step.id === stepId);
  if (stepIndex >= 0) {
    tutorState.goToStep(stepIndex);
  }
}

function renderSceneInfo() {
  if (!sceneInfo || !objectCount) return;

  const snapshot = currentSnapshot();
  const plan = activePlan();
  const selected = selectedObjectContext(snapshot);
  const count = snapshot.objects.length;

  objectCount.textContent = String(count);

  if (!plan) {
    sceneInfo.innerHTML = `<p class="muted-text">Add a prompt or diagram to generate a 3D lesson scene.</p>`;
    return;
  }

  const selectionMarkup = selected
    ? `
      <p class="muted-text" style="margin:8px 0 0">
        Selected: <strong>${escapeHtml(selected.label)}</strong>
        <span class="formula">V = ${formatNumber(selected.metrics.volume)}, SA = ${formatNumber(selected.metrics.surfaceArea)}</span>
      </p>
    `
    : `<p class="muted-text" style="margin:8px 0 0">Select an object in the scene to inspect its measurements and role.</p>`;

  if (isAnalyticPlan(plan)) {
    const analyticSelectionMarkup = selected
      ? `<p class="muted-text" style="margin:8px 0 0">Selected: <strong>${escapeHtml(selected.label)}</strong> ${escapeHtml(JSON.stringify(selected.params || {}))}</p>`
      : `<p class="muted-text" style="margin:8px 0 0">Select a line, plane, point, or helper to inspect it.</p>`;
    const currentMoment = currentSceneMoment(plan);
    sceneInfo.innerHTML = `
      <p style="margin:0 0 6px"><strong>${escapeHtml(plan.sourceSummary?.cleanedQuestion || plan.problem?.question || "Current lesson")}</strong></p>
      <p class="muted-text">${count} object${count === 1 ? "" : "s"} currently visible in the world</p>
      <p class="muted-text">Current visual step: <span class="formula">${escapeHtml(currentMoment?.title || "Observe")}</span></p>
      <p class="muted-text">Focus: <span class="formula">${escapeHtml(plan.sceneFocus?.primaryInsight || currentMoment?.goal || "")}</span></p>
      ${analyticSelectionMarkup}
    `;
    return;
  }

  sceneInfo.innerHTML = `
    <p style="margin:0 0 6px"><strong>${escapeHtml(plan.sourceSummary?.cleanedQuestion || plan.problem?.question || "Current lesson")}</strong></p>
    <p class="muted-text">${count} object${count === 1 ? "" : "s"} currently in the world</p>
    <p class="muted-text">Focus: <span class="formula">${escapeHtml(plan.sceneFocus?.primaryInsight || plan.sceneFocus?.focusPrompt || "Build the scene and inspect the key relationship.")}</span></p>
    ${selectionMarkup}
  `;
}

function renderAssessment(assessment) {
  if (!sceneValidation) return;
  if (!assessment) {
    sceneValidation.innerHTML = `<p class="muted-text">The tutor will inspect the scene and highlight the next useful idea.</p>`;
    return;
  }

  if (isAnalyticPlan()) {
    const currentMoment = currentSceneMoment();
    sceneValidation.innerHTML = `
      <div class="validation-stat"><strong>Auto scene ready</strong></div>
      <div class="validation-stat"><strong>${escapeHtml(currentMoment?.title || "Observe")}</strong><br />${escapeHtml(currentMoment?.goal || assessment.guidance?.coachFeedback || "Use the visible scene to reason.")}</div>
      <div class="validation-stat"><strong>Formula</strong><br />${escapeHtml(activePlan()?.analyticContext?.formulaCard?.formula || activePlan()?.answerScaffold?.formula || "Reveal when ready")}</div>
    `;
    return;
  }

  const guidance = assessment.guidance || {};
  const readyLabel = guidance.readyForPrediction ? "Scene ready" : "Scene preview";
  sceneValidation.innerHTML = `
    <div class="validation-stat"><strong>${readyLabel}</strong></div>
    <div class="validation-stat"><strong>${assessment.summary.objectCount}</strong> object${assessment.summary.objectCount === 1 ? "" : "s"} visible</div>
    <div class="validation-stat"><strong>Next focus</strong><br />${escapeHtml(guidance.coachFeedback || "The tutor is highlighting the next relationship.")}</div>
  `;
}

function renderCameraBookmarks(plan = activePlan()) {
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

function sceneDirectiveForCurrentMoment(plan = activePlan()) {
  if (!isAnalyticPlan(plan)) return null;
  const moment = currentSceneMoment(plan);
  if (!moment) return null;
  return {
    stageId: moment.id,
    cameraBookmarkId: moment.cameraBookmarkId || null,
    focusTargets: moment.focusTargets || [],
    visibleObjectIds: moment.visibleObjectIds || [],
    visibleOverlayIds: moment.visibleOverlayIds || [],
    revealFormula: Boolean(moment.revealFormula),
    revealFullSolution: Boolean(moment.revealFullSolution),
  };
}

function applySceneDirective(sceneDirective = null, { forceCamera = false } = {}) {
  const plan = activePlan();
  if (!isAnalyticPlan(plan) || !sceneDirective) return;

  const visibleIds = sceneDirective.visibleObjectIds?.length
    ? sceneDirective.visibleObjectIds
    : currentSceneMoment(plan)?.visibleObjectIds || [];
  const snapshot = buildSceneSnapshotFromSuggestions(plan, visibleIds);
  sceneApi?.loadSnapshot?.(snapshot, "analytic-auto");
  analyticOverlayManager?.render(plan, sceneDirective.visibleOverlayIds || []);

  const bookmark = (plan.cameraBookmarks || []).find((item) => item.id === sceneDirective.cameraBookmarkId);
  if (bookmark && forceCamera) {
    cameraDirector.animateTo(bookmark.position, bookmark.target, 900);
  }

  if (sceneDirective.focusTargets?.length) {
    focusStageTargets(sceneDirective.focusTargets, { selectFirst: true });
  }

  if (sceneDirective.revealFormula) {
    analyticFormulaVisible = true;
    analyticFormulaDismissed = false;
  }
  if (sceneDirective.revealFullSolution) {
    analyticFormulaDismissed = false;
  }
  renderAnalyticPanels(plan);
  renderAnnotations();
}

function applyAnalyticSceneState({ forceCamera = false } = {}) {
  if (!isAnalyticPlan()) return;
  applySceneDirective(sceneDirectiveForCurrentMoment(), { forceCamera });
}

function renderAnnotations() {
  if (!world?.scene) return;
  if (isAnalyticPlan()) {
    return;
  }
  clearLabels(world.scene);
  currentSnapshot().objects.forEach((objectSpec) => {
    const [x, y, z] = objectSpec.position;
    addLabel(world.scene, objectSpec.label || objectSpec.shape, [x, y + 0.9, z], "name");
  });
}

function announceCurrentStage(force = false) {
  const plan = activePlan();
  if (!plan) return;

  const stageKey = currentStageKey(plan);
  if (!force && lastAnnouncedStageKey === stageKey) return;

  lastAnnouncedStageKey = stageKey;
  if (isAnalyticPlan(plan)) {
    applyAnalyticSceneState({ forceCamera: force });
  } else {
    focusStageTargets(stageFocusTargets(plan), { selectFirst: tutorState.learningStage === "build" });
  }
  addTranscriptMessage("tutor", buildStageIntroMessage(plan), {
    actions: stageActionsForClient(plan),
  });
}

async function syncAssessment() {
  const plan = activePlan();
  if (!plan) {
    renderAssessment(null);
    renderSceneInfo();
    setCheckpointState(null);
    updateStageRail();
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

    if (isAnalyticPlan(plan)) {
      renderAssessment(assessment);
      renderSceneInfo();
      setCheckpointState(null);
      updateStageRail();
      announceCurrentStage();
      return;
    }

    if (
      tutorState.learningStage === "build"
      && assessment.guidance?.readyForPrediction
      && tutorState.currentStep >= Math.max(plan.lessonStages.length - 1, 0)
    ) {
      tutorState.setLearningStage("predict");
      tutorState.resetPrediction(plan.learningMoments?.predict?.prompt || "");
      lastSceneFeedback = "The scene is ready. Make one short prediction before the tutor explains it.";
    }

    renderAssessment(assessment);
    renderSceneInfo();
    updateStageRail();

    const checkpointKey = tutorState.learningStage === "build" && assessment?.activeStep?.complete
      ? `${assessment.activeStep.stepId}:complete`
      : null;

    if (checkpointKey && checkpointKey !== lastCheckpointKey) {
      lastCheckpointKey = checkpointKey;
      setCheckpointState({ prompt: currentLessonStage(plan)?.checkpointPrompt || "Does this look correct?" });
      addTranscriptMessage("system", assessment.guidance?.coachFeedback || "This stage looks complete. Check it before moving on.");
    } else if (!checkpointKey) {
      setCheckpointState(null);
    }

    announceCurrentStage();
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
  voiceConversationId = null;
  lastAnnouncedStageKey = null;
  lastCheckpointKey = null;
  analyticFormulaVisible = false;
  analyticFullSolutionVisible = false;
  analyticFormulaDismissed = false;
  tutorState.setPlan(normalizedPlan, { mode: options.mode || normalizedPlan.problem?.mode || "guided" });
  tutorState.setPhase(isAnalyticPlan(normalizedPlan) ? "guided_build" : "plan_ready");
  tutorState.setLearningStage(isAnalyticPlan(normalizedPlan) ? "build" : "orient");
  lastSceneFeedback = normalizedPlan.sceneFocus?.primaryInsight || "Nova Prism will react to what you do in the scene.";

  clearTranscript();
  setCheckpointState(null);
  renderCameraBookmarks(normalizedPlan);
  renderSceneInfo();
  renderAssessment(null);
  updateStageRail();

  if (options.clearScene !== false) {
    sceneApi?.clearScene?.();
  }
  sceneApi?.clearFocus?.();
  analyticOverlayManager?.clear();
  if (!isAnalyticPlan(normalizedPlan)) {
    const autoSnapshot = buildSceneSnapshotFromSuggestions(normalizedPlan);
    if (autoSnapshot.objects.length) {
      sceneApi?.loadSnapshot?.(autoSnapshot, "lesson-auto");
    }
  }
  questionSection?.classList.add("is-compact");
  setQuestionPanelCollapsed(true, { force: true });
  switchToTab("tutor");
  const systemContext = isAnalyticPlan(normalizedPlan) ? "" : buildSystemContextMessage(normalizedPlan);
  if (systemContext) {
    addTranscriptMessage("system", systemContext);
  }
  announceCurrentStage(true);
  updateVoiceStatus("Mic ready. Hold to talk when you want to ask out loud.", "muted");
}

async function handleQuestionSubmit(overrides = {}) {
  const questionText = (overrides.questionText ?? questionInput?.value?.trim()) || "";
  const imageFile = overrides.imageFile ?? questionImageFile;
  if (!questionText && !imageFile) return;

  tutorState.reset();
  tutorState.setPhase("parsing");
  analyticFormulaVisible = false;
  analyticFullSolutionVisible = false;
  analyticFormulaDismissed = false;
  analyticOverlayManager?.clear();
  renderAnalyticPanels(null);
  if (questionSubmit) questionSubmit.disabled = true;
  setQuestionStatus("Building a staged lesson from your prompt and scene...", "loading");

  try {
    const { scenePlan } = await requestScenePlan({
      questionText,
      imageFile,
      mode: "guided",
      sceneSnapshot: currentSnapshot(),
    });
    setPlan(scenePlan);
    setQuestionStatus("", "hidden");
  } catch (error) {
    console.error("Plan request failed:", error);
    tutorState.setError(error.message);
    setQuestionStatus(`Error: ${error.message}`, "error");
  } finally {
    if (questionSubmit) questionSubmit.disabled = false;
  }
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
    sceneFocus: plan?.sceneFocus || null,
    sourceSummary: plan?.sourceSummary || null,
    guidance: assessment?.guidance || null,
    analyticContext: plan?.analyticContext || null,
    sceneMoment: currentSceneMoment(plan) || null,
    formulaVisible: analyticFormulaVisible,
    fullSolutionVisible: analyticFullSolutionVisible,
  };
}

function beginGuidedBuild() {
  const plan = activePlan();
  if (!plan) return;
  if (isAnalyticPlan(plan)) {
    tutorState.setMode("guided");
    tutorState.setPhase("guided_build");
    tutorState.setLearningStage("build");
    applyAnalyticSceneState({ forceCamera: true });
    updateStageRail();
    announceCurrentStage(true);
    return;
  }
  tutorState.setMode("guided");
  tutorState.setPhase("guided_build");
  tutorState.setLearningStage("build");
  sceneApi?.cancelPreviewAction?.();
  sceneApi?.clearScene?.();
  lastSceneFeedback = "Build the scene one meaningful piece at a time. The tutor will watch for the next required object.";
  setCheckpointState(null);
  updateStageRail();
  announceCurrentStage(true);
  scheduleAssessment();
}

function beginManualBuild() {
  const plan = activePlan();
  if (!plan) return;
  if (isAnalyticPlan(plan)) {
    applyAnalyticSceneState({ forceCamera: true });
    return;
  }
  tutorState.setMode("manual");
  tutorState.setPhase("manual_build");
  tutorState.setLearningStage("build");
  sceneApi?.cancelPreviewAction?.();
  sceneApi?.clearScene?.();
  lastSceneFeedback = "Manual placement is active. The tutor will still react to each object you add.";
  setCheckpointState(null);
  updateStageRail();
  announceCurrentStage(true);
  scheduleAssessment();
}

function syncStepFromTutorResponse(response = {}, plan = activePlan()) {
  const stageId = response.stageStatus?.currentStageId || null;
  if (!plan?.lessonStages?.length || !stageId) return;
  const stageIndex = plan.lessonStages.findIndex((stage) => stage.id === stageId);
  if (stageIndex >= 0) {
    tutorState.goToStep(stageIndex);
  }
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

  const typing = addTranscriptMessage("tutor", "...");
  typing?.classList.add("loading-dots");
  let streamedText = "";

  try {
    const response = await askTutor({
      plan,
      sceneSnapshot: currentSnapshot(),
      sceneContext: sceneContextPayload(plan, tutorState.latestAssessment),
      learningState: tutorState.snapshot(),
      userMessage: text,
      contextStepId: tutorState.getCurrentStep()?.id || null,
      onChunk: (chunk) => {
        streamedText += chunk;
        typing?.classList.remove("loading-dots");
        setTranscriptMessageText(typing, streamedText);
      },
      onAssessment: (assessment) => {
        tutorState.setAssessment(assessment);
        renderAssessment(assessment);
        renderSceneInfo();
        updateStageRail();
      },
    });

    typing?.classList.remove("loading-dots");
    setTranscriptMessageText(typing, response.text || streamedText || "I could not generate a tutor reply.");
    syncStepFromTutorResponse(response, plan);

    const actions = response.actions?.length ? response.actions : stageActionsForClient(plan, tutorState.latestAssessment);
    renderMessageActions(typing, actions);
    tutorState.addMessage("assistant", response.text || streamedText || "I could not generate a tutor reply.");

    if (response.assessment) {
      tutorState.setAssessment(response.assessment);
    }
    if (response.focusTargets?.length) {
      focusStageTargets(response.focusTargets, { selectFirst: true });
    }
    if (response.checkpoint) {
      setCheckpointState(response.checkpoint);
    }
    if (response.sceneDirective) {
      applySceneDirective(response.sceneDirective, { forceCamera: true });
    }

    lastSceneFeedback = response.text || lastSceneFeedback;
    renderAssessment(tutorState.latestAssessment);
    renderSceneInfo();
    updateStageRail();
    announceCurrentStage();
  } catch (error) {
    typing?.classList.remove("loading-dots");
    setTranscriptMessageText(typing, `Error: ${error.message}`);
  }
}

async function handleExplain() {
  await sendTutorMessage(`Explain the current ${tutorState.learningStage} stage using the scene in two short sentences.`, {
    userLabel: "Explain this stage",
  });
}

async function handleComposerSubmit() {
  const plan = activePlan();
  const text = chatInput?.value?.trim();
  if (!plan || !text) return;

  chatInput.value = "";

  if (tutorState.learningStage === "predict" && !tutorState.predictionState.submitted) {
    tutorState.submitPrediction(text);
    tutorState.setLearningStage("check");
    lastSceneFeedback = `Prediction saved: "${text}". Now inspect the scene and test it.`;
    addTranscriptMessage("user", `Prediction: ${text}`);
    addTranscriptMessage("tutor", "Good. Now use the scene to test that prediction and ask if anything looks off.", {
      actions: stageActionsForClient(plan),
    });
    setCheckpointState(null);
    updateStageRail();
    announceCurrentStage(true);
    return;
  }

  await sendTutorMessage(text);
}

async function playReturnedAudio(response) {
  if (!response?.audioBase64) return false;
  const binary = atob(response.audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const blob = new Blob([bytes], { type: response.contentType || "audio/wav" });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => URL.revokeObjectURL(url);
  await audio.play();
  return true;
}

function buildVoiceContext(plan = activePlan()) {
  return {
    plan,
    sceneSnapshot: currentSnapshot(),
    sceneContext: sceneContextPayload(plan, tutorState.latestAssessment),
    learningState: tutorState.snapshot(),
    contextStepId: tutorState.getCurrentStep()?.id || null,
  };
}

async function finishVoiceCapture() {
  if (!activeMicCapture) return;
  const capture = activeMicCapture;
  activeMicCapture = null;
  voiceRecording = false;
  voiceRecordBtn?.classList.remove("is-recording");
  if (voiceRecordBtn) voiceRecordBtn.textContent = "Hold to Talk";
  updateVoiceStatus("Sending audio to Nova Prism...", "ready");

  try {
    const clip = await capture.finish();
    const response = await requestVoiceResponse({
      audioBase64: clip.audioBase64,
      mimeType: clip.mimeType,
      conversationId: voiceConversationId,
      mode: "coach",
      context: buildVoiceContext(),
      playbackMode: "auto",
    });
    voiceConversationId = response.conversationId || voiceConversationId;

    addTranscriptMessage("user", response.inputTranscript || "Voice question");
    addTranscriptMessage("tutor", response.assistantText || response.transcript || "Nova Prism did not return a voice reply.");
    if (!(await playReturnedAudio(response)) && (response.assistantText || response.transcript) && "speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(response.assistantText || response.transcript);
      speechSynthesis.speak(utterance);
    }

    updateVoiceStatus(
      response.fallbackUsed ? "Voice fallback used. Captions are still available." : "Voice reply ready.",
      response.fallbackUsed ? "muted" : "ready"
    );
    syncAssessment();
  } catch (error) {
    console.error("Voice capture failed:", error);
    updateVoiceStatus(`Voice error: ${error.message}`, "error");
  }
}

async function toggleVoiceCapture() {
  if (!activePlan()) return;
  if (voiceRecording) {
    await finishVoiceCapture();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    updateVoiceStatus("This browser cannot capture microphone audio.", "error");
    return;
  }

  try {
    activeMicCapture = new MicrophoneCapture();
    await activeMicCapture.start();
    voiceRecording = true;
    if (voiceRecordBtn) {
      voiceRecordBtn.classList.add("is-recording");
      voiceRecordBtn.textContent = "Send Voice";
    }
    updateVoiceStatus("Recording... click again to send your question.", "ready");
  } catch (error) {
    console.error("Microphone start failed:", error);
    updateVoiceStatus(`Mic error: ${error.message}`, "error");
  }
}

function advanceLessonStage() {
  const plan = activePlan();
  if (!plan) return;

  if (isAnalyticPlan(plan)) {
    if (tutorState.currentStep < plan.lessonStages.length - 1) {
      tutorState.nextStep();
      lastSceneFeedback = currentLessonStage(plan)?.goal || "Move to the next visual step.";
      setCheckpointState(null);
      updateStageRail();
      applyAnalyticSceneState({ forceCamera: true });
      announceCurrentStage(true);
      return;
    }
    analyticFormulaVisible = true;
    analyticFullSolutionVisible = true;
    renderAnalyticPanels(plan);
    updateStageRail();
    return;
  }

  if (tutorState.learningStage === "orient") {
    beginGuidedBuild();
    return;
  }

  if (tutorState.learningStage === "build") {
    if (tutorState.currentStep < plan.lessonStages.length - 1) {
      tutorState.nextStep();
      lastSceneFeedback = currentLessonStage(plan)?.goal || "Move to the next stage of the build.";
      setCheckpointState(null);
      updateStageRail();
      announceCurrentStage(true);
      scheduleAssessment();
      return;
    }

    tutorState.setLearningStage("predict");
    tutorState.resetPrediction(plan.learningMoments?.predict?.prompt || "");
    lastSceneFeedback = "Pause here and make one short prediction before asking for the explanation.";
    setCheckpointState(null);
    updateStageRail();
    announceCurrentStage(true);
    return;
  }

  if (tutorState.learningStage === "predict") {
    if (!tutorState.predictionState.submitted) {
      addTranscriptMessage("system", "Type your prediction into the composer first.");
      return;
    }
    tutorState.setLearningStage("check");
    lastSceneFeedback = "Use the scene to test the prediction you just made.";
    updateStageRail();
    announceCurrentStage(true);
    return;
  }

  if (tutorState.learningStage === "check") {
    tutorState.setLearningStage("reflect");
    lastSceneFeedback = "Say what became clearer once you manipulated the model.";
    updateStageRail();
    announceCurrentStage(true);
    return;
  }

  if (tutorState.learningStage === "reflect") {
    tutorState.setLearningStage("challenge");
    lastSceneFeedback = "Free questions are open. The tutor will keep grounding answers in the scene.";
    updateStageRail();
    announceCurrentStage(true);
  }
}

async function handleTutorAction(action = {}) {
  const plan = activePlan();
  if (!plan) return;

  switch (action.kind) {
    case "highlight-key-idea":
      applyAnalyticSceneState({ forceCamera: true });
      addTranscriptMessage("system", withFollowUp(currentSceneMoment(plan)?.goal || "Highlighted the current idea in the scene."));
      break;
    case "show-formula":
      analyticFormulaVisible = true;
      analyticFormulaDismissed = false;
      renderAnalyticPanels(plan);
      addTranscriptMessage(
        "system",
        withFollowUp(
          [
            plan.analyticContext?.formulaCard?.formula || plan.answerScaffold?.formula || "Relevant formula revealed.",
            plan.analyticContext?.formulaCard?.explanation || plan.answerScaffold?.explanation || "",
          ].filter(Boolean).join(" ")
        )
      );
      break;
    case "reveal-next-step":
      advanceLessonStage();
      break;
    case "reveal-full-solution":
      analyticFormulaVisible = true;
      analyticFullSolutionVisible = true;
      analyticFormulaDismissed = false;
      if (isAnalyticPlan(plan) && tutorState.currentStep < plan.lessonStages.length - 1) {
        tutorState.goToStep(plan.lessonStages.length - 1);
      }
      applyAnalyticSceneState({ forceCamera: true });
      renderAnalyticPanels(plan);
      addTranscriptMessage("system", withFollowUp("Full worked solution revealed."));
      break;
    case "reset-view":
      applyAnalyticSceneState({ forceCamera: true });
      break;
    case "start-guided-build":
      beginGuidedBuild();
      break;
    case "build-manually":
      beginManualBuild();
      break;
    case "preview-required-object": {
      const preparedAction = fillPreviewActionObjectSpec(action, plan, tutorState.latestAssessment);
      if (!preparedAction?.payload?.objectSpec) {
        addTranscriptMessage("system", "There is nothing to preview yet. Ask the tutor to explain the stage first.");
        return;
      }

      const preview = sceneApi?.previewAction?.(preparedAction.payload || preparedAction);
      if (preview) {
        focusStageTargets(preparedAction.payload.highlightTargets || [], { selectFirst: false });
        addTranscriptMessage("system", `Previewing ${preview.label || preview.shape}. Confirm the ghost placement if it matches the stage goal.`, {
          actions: [
            {
              id: `${preparedAction.id}-confirm`,
              label: "Confirm Placement",
              kind: "confirm-preview",
              payload: { stageId: preparedAction.payload?.stageId || null },
            },
            {
              id: `${preparedAction.id}-cancel`,
              label: "Cancel Preview",
              kind: "cancel-preview",
              payload: { stageId: preparedAction.payload?.stageId || null },
            },
          ],
        });
      }
      break;
    }
    case "confirm-preview": {
      const placedObject = sceneApi?.confirmPreviewAction?.();
      if (placedObject) {
        addTranscriptMessage("system", `Placed ${placedObject.label || placedObject.shape}.`);
        scheduleAssessment();
      }
      break;
    }
    case "cancel-preview":
      sceneApi?.cancelPreviewAction?.();
      focusStageTargets(stageFocusTargets(plan));
      addTranscriptMessage("system", "Preview cancelled. Choose another tutor action or place the object manually.");
      break;
    case "explain-stage":
      await handleExplain();
      break;
    case "skip-stage":
      if (tutorState.currentStep < plan.lessonStages.length - 1) {
        tutorState.nextStep();
        setCheckpointState(null);
        updateStageRail();
        announceCurrentStage(true);
      } else {
        advanceLessonStage();
      }
      break;
    case "continue-stage":
      setCheckpointState(null);
      advanceLessonStage();
      break;
    case "show-mistake":
      await sendTutorMessage(action.payload?.prompt || "Show me the mistake in this stage and explain what should be different.", {
        userLabel: "Show me the mistake",
      });
      break;
    default:
      break;
  }
}

function handleSceneMutation(detail) {
  const plan = activePlan();
  if (!plan || !detail || detail.type !== "objects") return;
  if (isAnalyticPlan(plan) && detail.reason === "analytic-auto") {
    renderSceneInfo();
    updateStageRail();
    return;
  }
  if (!isAnalyticPlan(plan) && detail.reason === "lesson-auto") {
    renderSceneInfo();
    updateStageRail();
    syncUnfoldDrawer();
    scheduleAssessment();
    return;
  }

  if (detail.reason === "place" && detail.object?.label) {
    lastSceneFeedback = `Placed ${detail.object.label}. The tutor is checking how it fits the current goal.`;
    addTranscriptMessage("system", lastSceneFeedback);
  } else if (detail.reason === "drag-end" && detail.object?.label) {
    lastSceneFeedback = `Updated ${detail.object.label}. Check whether that changes the focus relationship.`;
    addTranscriptMessage("system", lastSceneFeedback);
  } else if (detail.reason === "remove" && detail.object?.label) {
    lastSceneFeedback = `Removed ${detail.object.label}. The tutor will adjust the stage guidance.`;
    addTranscriptMessage("system", lastSceneFeedback);
  }

  if (tutorState.learningStage === "predict" && tutorState.predictionState.submitted) {
    tutorState.setLearningStage("check");
  }

  renderSceneInfo();
  updateStageRail();
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
    setQuestionImageFile(file);
  });

  questionImageClear?.addEventListener("click", () => {
    setQuestionImageFile(null);
  });

  questionInput?.addEventListener("paste", (event) => {
    const file = extractPastedQuestionImageFile(event.clipboardData?.items);
    if (!file) return;
    event.preventDefault();
    setQuestionImageFile(file, { announcePaste: true });
  });

  buildFromDiagramBtn?.addEventListener("click", () => questionImageInput?.click());
  lessonPanelToggle?.addEventListener("click", () => {
    if (!activePlan()) return;
    const isCollapsed = questionSection?.classList.contains("is-collapsed");
    setQuestionPanelCollapsed(!isCollapsed, { force: true });
  });
  voiceRecordBtn?.addEventListener("click", toggleVoiceCapture);
  chatSend?.addEventListener("click", handleComposerSubmit);
  chatInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleComposerSubmit();
    }
  });
  checkpointYesBtn?.addEventListener("click", () => handleTutorAction({
    id: "checkpoint-yes",
    label: "Yes",
    kind: "continue-stage",
    payload: { stageId: currentLessonStage()?.id || null },
  }));
  checkpointUnsureBtn?.addEventListener("click", () => handleTutorAction({
    id: "checkpoint-not-sure",
    label: "Not sure",
    kind: "show-mistake",
    payload: { prompt: currentLessonStage()?.mistakeProbe || "Show me the mistake in this stage." },
  }));
  formulaCardRevealBtn?.addEventListener("click", () => {
    if (analyticFullSolutionVisible) {
      analyticFullSolutionVisible = false;
      renderAnalyticPanels(activePlan());
      return;
    }
    handleTutorAction({
      id: "formula-reveal-solution",
      label: "Reveal Full Solution",
      kind: "reveal-full-solution",
    });
  });
  formulaCardCloseBtn?.addEventListener("click", () => {
    analyticFormulaVisible = false;
    analyticFullSolutionVisible = false;
    analyticFormulaDismissed = true;
    renderAnalyticPanels(activePlan());
  });
  solutionDrawerClose?.addEventListener("click", () => {
    analyticFullSolutionVisible = false;
    renderAnalyticPanels(activePlan());
  });
}

function bindDom() {
  questionSection = document.querySelector(".question-section");
  questionInput = document.getElementById("questionInput");
  questionSubmit = document.getElementById("questionSubmit");
  questionStatus = document.getElementById("questionStatus");
  questionImageInput = document.getElementById("questionImageInput");
  questionImageMeta = document.getElementById("questionImageMeta");
  questionImagePreview = document.getElementById("questionImagePreview");
  questionImageThumb = document.getElementById("questionImageThumb");
  questionImageClear = document.getElementById("questionImageClear");
  buildFromDiagramBtn = document.getElementById("questionImageTrigger");
  lessonPanelToggle = document.getElementById("lessonPanelToggle");
  lessonPanelSummary = document.getElementById("lessonPanelSummary");
  chatMessages = document.getElementById("chatMessages");
  chatInput = document.getElementById("chatInput");
  chatSend = document.getElementById("chatSend");
  voiceRecordBtn = document.getElementById("voiceRecordBtn");
  voiceStatus = document.getElementById("voiceStatus");
  stageRail = document.getElementById("stageRail");
  stageRailTitle = document.getElementById("stageRailTitle");
  stageRailProgress = document.getElementById("stageRailProgress");
  stageRailGoal = document.getElementById("stageRailGoal");
  chatCheckpoint = document.getElementById("chatCheckpoint");
  chatCheckpointPrompt = document.getElementById("chatCheckpointPrompt");
  checkpointYesBtn = document.getElementById("checkpointYesBtn");
  checkpointUnsureBtn = document.getElementById("checkpointUnsureBtn");
  sceneInfo = document.getElementById("sceneInfo");
  sceneValidation = document.getElementById("sceneValidation");
  cameraBookmarkList = document.getElementById("cameraBookmarkList");
  objectCount = document.getElementById("objectCount");
  stepIndicator = document.getElementById("stepIndicator");
  formulaCard = document.getElementById("formulaCard");
  formulaCardTitle = document.getElementById("formulaCardTitle");
  formulaCardEquation = document.getElementById("formulaCardEquation");
  formulaCardExplanation = document.getElementById("formulaCardExplanation");
  formulaCardRevealBtn = document.getElementById("formulaCardRevealBtn");
  formulaCardCloseBtn = document.getElementById("formulaCardCloseBtn");
  solutionDrawer = document.getElementById("solutionDrawer");
  solutionDrawerTitle = document.getElementById("solutionDrawerTitle");
  solutionDrawerSteps = document.getElementById("solutionDrawerSteps");
  solutionDrawerClose = document.getElementById("solutionDrawerClose");
}

export function initTutorController(context) {
  world = context.world;
  sceneApi = context.sceneApi;
  cameraDirector = new CameraDirector(world.camera, world.controls);
  analyticOverlayManager = new AnalyticOverlayManager(world, sceneApi);

  const stageWrap = document.querySelector(".stage-wrap");
  if (stageWrap) {
    initLabelRenderer(stageWrap);
  }

  bindDom();
  bindEvents();
  initUnfoldDrawer(context);
  clearTranscript();
  renderQuestionImageState();
  setQuestionPanelCollapsed(false, { force: true });
  renderAssessment(null);
  renderSceneInfo();
  updateStageRail();
  renderAnalyticPanels(null);
  updateComposerState();
  updateVoiceStatus("Mic ready when the lesson is loaded.", "muted");
  stepIndicator?.classList.add("hidden");

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
    updateStageRail();
    syncUnfoldDrawer();
  });

  questionInput?.addEventListener("input", () => {
    if (questionSection?.classList.contains("is-collapsed")) {
      setQuestionPanelCollapsed(true, { force: true });
    }
  });
}

export function updateTutorLabels() {
  if (world) {
    renderLabels(world.scene, world.camera);
  }
  syncUnfoldDrawer();
}
