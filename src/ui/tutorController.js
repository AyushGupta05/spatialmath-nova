import {
  requestScenePlan,
  evaluateBuild,
  askTutor,
  requestSimilarTutorQuestions,
  appendVoiceSessionAudio,
  createVoiceSession,
  startVoiceSessionTurn,
  stopVoiceSessionTurn,
  subscribeToVoiceSession,
} from "../ai/client.js";
import { buildSceneSnapshotFromSuggestions, normalizeScenePlan } from "../ai/planSchema.js";
import { computeGeometry } from "../core/geometry.js";
import { initLabelRenderer, renderLabels, addLabel, clearLabels } from "../render/labels.js";
import { AnalyticOverlayManager } from "../render/analyticOverlayManager.js";
import { CameraDirector } from "../render/cameraDirector.js";
import { tutorState } from "../state/tutorState.js";
import { initUnfoldDrawer, syncUnfoldDrawer } from "./unfoldDrawer.js";
import { MicrophoneCapture } from "./microphoneCapture.js";
import { PcmAudioPlayer } from "./pcmAudioPlayer.js";
import { extractPastedQuestionImageFile } from "./questionImage.js";
import {
  buildSuggestedQuestionActions,
  normalizeTutorReplyText,
  shouldStartLessonFromComposer,
} from "./tutorConversation.js";

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
let voiceSessionUnsubscribe = null;
let voiceAudioUploadChain = Promise.resolve();
let voiceStreamDraft = null;
let voiceAudioPlayer = null;
let voiceHoldRequested = false;
let lastAnnouncedStageKey = null;
let lastCheckpointKey = null;
let analyticOverlayManager = null;
let analyticFormulaVisible = false;
let analyticFullSolutionVisible = false;
let analyticFormulaDismissed = false;
let similarQuestionRequest = null;
let lastCompletionPromptKey = null;

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
let newQuestionBtn;

function formatNumber(value, digits = 2) {
  const next = Number(value);
  if (!Number.isFinite(next)) return "0";
  return next.toFixed(digits).replace(/\.00$/, "");
}

function formatKilobytes(bytes) {
  return `${formatNumber(Number(bytes) / 1024, 0)} KB`;
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

function isLessonComplete() {
  return Boolean(tutorState.completionState?.complete);
}

function suggestionActions() {
  return buildSuggestedQuestionActions(tutorState.similarQuestions || []);
}

function completionPromptKey(plan = activePlan(), suggestions = tutorState.similarQuestions || []) {
  if (!plan) return "";
  return `${plan.problem?.id || "plan"}:${plan.problem?.question || ""}:${suggestions.map((item) => item.prompt).join("|")}`;
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

function formatChatInlineHtml(content = "") {
  return escapeHtml(content).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function renderChatMessageHtml(content = "", options = {}) {
  const role = options.role || "tutor";
  const normalized = role === "tutor"
    ? normalizeTutorReplyText(content, { completion: options.completion })
    : String(content || "").replace(/\r\n?/g, "\n").trim();

  if (!normalized) {
    return `<p class="chat-msg-paragraph"></p>`;
  }

  const lines = normalized.split("\n");
  const blocks = [];
  let listItems = [];

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(`<ul class="chat-msg-list">${listItems.join("")}</ul>`);
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      listItems.push(`<li>${formatChatInlineHtml(bulletMatch[1])}</li>`);
      continue;
    }

    flushList();
    blocks.push(`<p class="chat-msg-paragraph">${formatChatInlineHtml(line)}</p>`);
  }

  flushList();
  return blocks.join("");
}

function setTranscriptMessageText(message, content, options = {}) {
  const node = transcriptMessageTextNode(message);
  if (node) {
    const role = options.role || message?.dataset?.role || "tutor";
    const completion = options.completion ?? message?.dataset?.completion === "true";
    node.innerHTML = renderChatMessageHtml(content, { role, completion });
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
  message.dataset.role = role;
  message.dataset.completion = options.completion ? "true" : "false";

  const bubble = document.createElement("div");
  bubble.className = "chat-msg-bubble";

  const text = document.createElement("div");
  text.className = "chat-msg-text";
  text.innerHTML = renderChatMessageHtml(content, {
    role,
    completion: Boolean(options.completion),
  });

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
      <p class="chat-welcome-title">Let's explore together</p>
      <p class="chat-welcome-text">Ask a question, talk about the current scene, or say "show me something cool" and I'll build a math visual.</p>
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
  voiceStatus.className = "voice-status-text";
  voiceStatus.style.color = "";
  if (!text || tone === "hidden") {
    voiceStatus.classList.add("hidden");
    return;
  }
  voiceStatus.classList.remove("hidden");
  if (tone === "ready") voiceStatus.style.color = "var(--accent)";
  if (tone === "error") voiceStatus.style.color = "var(--danger)";
}

function ensureVoiceAudioPlayer() {
  if (!voiceAudioPlayer) {
    voiceAudioPlayer = new PcmAudioPlayer({ sampleRate: 24000 });
  }
  return voiceAudioPlayer;
}

function resetVoiceDraft() {
  voiceStreamDraft = {
    userMessage: null,
    assistantMessage: null,
    inputTranscript: "",
    assistantPreviewText: "",
    assistantFinalText: "",
  };
  return voiceStreamDraft;
}

function currentVoiceDraft() {
  return voiceStreamDraft || resetVoiceDraft();
}

function setVoiceTranscript(content = "") {
  const draft = currentVoiceDraft();
  const transcript = String(content || "").trim();
  draft.inputTranscript = transcript;
  if (!transcript) return;
  if (!draft.userMessage) {
    draft.userMessage = addTranscriptMessage("user", transcript);
    return;
  }
  setTranscriptMessageText(draft.userMessage, transcript, { role: "user" });
}

function setVoiceAssistantMessage(content = "", { final = false } = {}) {
  const draft = currentVoiceDraft();
  const nextContent = String(content || "").trim();
  if (!nextContent) return;
  if (final) {
    draft.assistantFinalText = nextContent;
  } else {
    draft.assistantPreviewText = nextContent;
  }
  const messageText = draft.assistantFinalText || draft.assistantPreviewText;
  if (!draft.assistantMessage) {
    draft.assistantMessage = addTranscriptMessage("tutor", messageText);
    return;
  }
  setTranscriptMessageText(draft.assistantMessage, messageText, {
    role: "tutor",
    completion: false,
  });
}

function closeVoiceSessionStream() {
  voiceSessionUnsubscribe?.();
  voiceSessionUnsubscribe = null;
}

async function resetVoiceSessionState() {
  closeVoiceSessionStream();
  voiceConversationId = null;
  voiceStreamDraft = null;
  voiceAudioUploadChain = Promise.resolve();
  voiceHoldRequested = false;
  if (activeMicCapture) {
    await activeMicCapture.stop();
    activeMicCapture = null;
  }
  voiceRecording = false;
  voiceRecordBtn?.classList.remove("is-recording");
  if (voiceRecordBtn) voiceRecordBtn.textContent = "\u{1F3A4}";
  if (voiceAudioPlayer) {
    voiceAudioPlayer.stop();
  }
  updateVoiceStatus("", "hidden");
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
  newQuestionBtn?.classList.toggle("hidden", !nextCollapsed);
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
  if (isLessonComplete()) {
    return suggestionActions();
  }

  const stage = currentLessonStage(plan);
  if (isAnalyticPlan(plan)) {
    const analyticActions = [];
    const moment = currentSceneMoment(plan);
    const sceneIndex = Math.max(0, (plan.sceneMoments || []).findIndex((m) => m.id === moment?.id));
    const hasNext = sceneIndex < Math.max((plan.sceneMoments || []).length - 1, 0);
    if (!moment?.revealFormula) {
      analyticActions.push({
        id: `${stage?.id || "analytic"}-formula`,
        label: "Show Formula",
        kind: "show-formula",
        payload: { stageId: stage?.id || null },
      });
    }
    if (hasNext) {
      analyticActions.push({
        id: `${stage?.id || "analytic"}-next`,
        label: "What's next?",
        kind: "reveal-next-step",
        payload: { stageId: stage?.id || null },
      });
    }
    analyticActions.push({
      id: `${stage?.id || "analytic"}-solution`,
      label: "View Solution",
      kind: "reveal-full-solution",
      payload: { stageId: stage?.id || null },
    });
    return analyticActions;
  }
  const learningStage = tutorState.learningStage;
  const hintAction = {
    id: `${stage?.id || learningStage}-explain`,
    label: learningStage === "orient" ? "Give me a hint" : "I'm stuck",
    kind: "explain-stage",
    payload: { stageId: stage?.id || null },
  };
  const continueAction = {
    id: `${stage?.id || learningStage}-continue`,
    label: learningStage === "reflect" ? "Keep exploring" : "I think I see it",
    kind: "continue-stage",
    payload: { stageId: stage?.id || null },
  };
  const previewAction = fillPreviewActionObjectSpec(
    stage?.suggestedActions?.find((action) => action.kind === "preview-required-object")
      || {
        id: `${stage?.id || "lesson"}-preview`,
        label: nextRequiredSuggestion(plan, assessment)?.title
          ? `Show me ${nextRequiredSuggestion(plan, assessment).title}`
          : "Show me in the scene",
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
  actions.push(hintAction, continueAction);
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

  if (isAnalyticPlan(plan) && stage) {
    const moment = currentSceneMoment(plan);
    return moment?.prompt || stage.tutorIntro || stage.goal || "Take a look at the scene. What stands out to you?";
  }

  if ((learningStage === "orient" || learningStage === "build") && stage) {
    const intro = stage.tutorIntro || stage.goal || "";
    const question = assessment?.guidance?.coachFeedback || lastSceneFeedback || "";
    return intro
      ? `${intro} ${question}`.trim()
      : `Look at the scene. ${question || "What do you notice?"}`;
  }

  if (learningStage === "predict") {
    const moment = plan.learningMoments?.predict || {};
    return moment.prompt || "Before we go further, what's your gut feeling about what happens here?";
  }

  if (learningStage === "check") {
    return "Now look at the scene. Does it match what you expected?";
  }

  if (learningStage === "reflect") {
    return "In your own words, what's the key idea you just saw?";
  }

  return "The scene is yours to explore. What are you curious about?";
}

function updateComposerState() {
  const hasPlan = Boolean(activePlan());
  if (chatInput) {
    chatInput.disabled = false;
    if (!hasPlan) {
      chatInput.placeholder = "Chat, ask about the scene, or say 'show me something cool'";
    } else if (isLessonComplete()) {
      chatInput.placeholder = "Ask a follow-up, or type a new math question";
    } else if (tutorState.learningStage === "predict" && !tutorState.predictionState.submitted) {
      chatInput.placeholder = "What's your prediction?";
    } else {
      chatInput.placeholder = "What do you think happens next?";
    }
  }
  if (chatSend) chatSend.disabled = false;
  if (voiceRecordBtn) voiceRecordBtn.disabled = false;
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

function announceCompletionOptions() {
  const plan = activePlan();
  const actions = suggestionActions();
  const key = completionPromptKey(plan, tutorState.similarQuestions || []);
  if (!plan || !isLessonComplete() || !actions.length || !key || key === lastCompletionPromptKey) return;
  lastCompletionPromptKey = key;
  addTranscriptMessage("tutor", "This question is wrapped. Ask a follow-up, or try one of these similar prompts.", {
    actions,
  });
}

async function fetchSimilarQuestionsOnce() {
  const plan = activePlan();
  const requestedPlanKey = completionPromptKey(plan, []);
  if (!plan || !isLessonComplete()) return;
  if (tutorState.similarQuestions?.length) {
    announceCompletionOptions();
    return;
  }
  if (similarQuestionRequest) {
    await similarQuestionRequest;
    return;
  }

  similarQuestionRequest = requestSimilarTutorQuestions({ plan, limit: 3 })
    .then((payload) => {
      if (completionPromptKey(activePlan(), []) !== requestedPlanKey) return;
      tutorState.setSimilarQuestions(payload?.suggestions || []);
      announceCompletionOptions();
    })
    .catch((error) => {
      console.error("Similar tutor questions failed:", error);
      tutorState.setSimilarQuestions([]);
    })
    .finally(() => {
      similarQuestionRequest = null;
    });

  await similarQuestionRequest;
}

function completeLesson({ reason = "correct-answer", revealSolution = false } = {}) {
  tutorState.setCompletionState({ complete: true, reason });
  tutorState.setPhase("complete");
  tutorState.setSimilarQuestions(tutorState.similarQuestions || []);
  setCheckpointState(null);
  if (revealSolution) {
    analyticFormulaVisible = true;
    analyticFullSolutionVisible = true;
    analyticFormulaDismissed = false;
  }
  updateStageRail();
  renderAssessment(tutorState.latestAssessment);
  renderSceneInfo();
  void fetchSimilarQuestionsOnce();
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
  if (!stageRail || !stageRailProgress || !stageRailGoal) return;
  if (!plan) {
    stageRail.classList.add("hidden");
    updateComposerState();
    return;
  }

  const stage = currentLessonStage(plan);
  const stageIndex = currentStageIndex(plan);
  const learningStage = tutorState.learningStage;

  stageRail.classList.remove("hidden");

  if (isLessonComplete()) {
    stageRailProgress.textContent = "Complete";
    stageRailGoal.textContent = "Solved. Ask a follow-up or start a similar question.";
  } else if ((learningStage === "orient" || learningStage === "build") && stage) {
    stageRailProgress.textContent = `${Math.max(stageIndex + 1, 1)} / ${plan.lessonStages.length}`;
    stageRailGoal.textContent = stage.goal || plan.sceneFocus?.focusPrompt || "";
  } else if (learningStage === "predict") {
    stageRailProgress.textContent = "Predict";
    stageRailGoal.textContent = tutorState.predictionState.submitted
      ? "Check your prediction against the scene."
      : "What's your gut feeling?";
  } else if (learningStage === "check") {
    stageRailProgress.textContent = "Check";
    stageRailGoal.textContent = "Compare your prediction with the scene.";
  } else if (learningStage === "reflect") {
    stageRailProgress.textContent = "Reflect";
    stageRailGoal.textContent = "What's the key idea?";
  } else {
    stageRailProgress.textContent = "Explore";
    stageRailGoal.textContent = "";
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
    if (!count) {
      sceneInfo.innerHTML = `<p class="muted-text">No active lesson. Build a scene manually, ask a question, or say "show me something cool."</p>`;
      return;
    }

    const freeformSelectionMarkup = selected
      ? `
        <p class="muted-text" style="margin:8px 0 0">
          Selected: <strong>${escapeHtml(selected.label)}</strong>
          <span class="formula">V = ${formatNumber(selected.metrics.volume)}, SA = ${formatNumber(selected.metrics.surfaceArea)}</span>
        </p>
      `
      : `<p class="muted-text" style="margin:8px 0 0">Select an object, or ask Nova to explain or remix the scene.</p>`;

    sceneInfo.innerHTML = `
      <p style="margin:0 0 6px"><strong>Freeform scene</strong></p>
      <p class="muted-text">${count} object${count === 1 ? "" : "s"} currently in the world</p>
      <p class="muted-text">Nova can read this scene, talk about it, and edit it if you ask.</p>
      ${freeformSelectionMarkup}
    `;
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

  if (isLessonComplete()) {
    sceneValidation.innerHTML = `
      <div class="validation-stat"><strong>Solved</strong></div>
      <div class="validation-stat"><strong>Next move</strong><br />Ask a follow-up or try a similar question.</div>
      <div class="validation-stat"><strong>Answer</strong><br />${escapeHtml(activePlan()?.answerScaffold?.finalAnswer || "Shown in the lesson")}</div>
    `;
    return;
  }

  if (!assessment) {
    if (!activePlan()) {
      sceneValidation.innerHTML = `<p class="muted-text">Nova can chat about anything, inspect the current scene, and build a fresh math visual when you ask.</p>`;
      return;
    }
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

function mergeSceneObjects(baseObjects = [], nextObjects = []) {
  const byId = new Map((baseObjects || []).map((objectSpec) => [objectSpec.id, objectSpec]));
  (nextObjects || []).forEach((objectSpec) => {
    if (!objectSpec?.id) return;
    byId.set(objectSpec.id, objectSpec);
  });
  return [...byId.values()];
}

function applyAssistantSceneCommand(sceneCommand = null) {
  if (!sceneCommand?.operations?.length || !sceneApi) return false;

  sceneApi.cancelPreviewAction?.();
  let snapshot = currentSnapshot();
  let changedScene = false;

  sceneCommand.operations.forEach((operation) => {
    switch (operation.kind) {
      case "replace_scene":
        snapshot = sceneApi.loadSnapshot?.({
          objects: operation.objects || [],
          selectedObjectId: operation.selectedObjectId || null,
        }, "assistant-replace") || currentSnapshot();
        changedScene = true;
        break;
      case "merge_objects":
        snapshot = sceneApi.loadSnapshot?.({
          objects: mergeSceneObjects(snapshot.objects || [], operation.objects || []),
          selectedObjectId: snapshot.selectedObjectId || null,
        }, "assistant-merge") || currentSnapshot();
        changedScene = true;
        break;
      case "remove_objects":
        snapshot = sceneApi.loadSnapshot?.({
          objects: (snapshot.objects || []).filter((objectSpec) => !(operation.objectIds || []).includes(objectSpec.id)),
          selectedObjectId: (operation.objectIds || []).includes(snapshot.selectedObjectId) ? null : snapshot.selectedObjectId,
        }, "assistant-remove") || currentSnapshot();
        changedScene = true;
        break;
      case "select_object":
        sceneApi.selectObject?.(operation.objectId || null);
        snapshot = currentSnapshot();
        break;
      case "focus_objects":
        sceneApi.focusObjects?.(operation.targetIds || [], { selectFirst: true });
        break;
      case "clear_scene":
        sceneApi.clearScene?.();
        snapshot = currentSnapshot();
        changedScene = true;
        break;
      case "clear_focus":
        sceneApi.clearFocus?.();
        break;
      case "reset_view":
        sceneApi.resetView?.();
        break;
      default:
        break;
    }
  });

  renderAnnotations();
  renderSceneInfo();
  renderAssessment(activePlan() ? tutorState.latestAssessment : null);
  updateStageRail();
  return changedScene;
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
  if (isLessonComplete() && !force) return;

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
      setCheckpointState({ prompt: currentLessonStage(plan)?.checkpointPrompt || "Does this match what you expected?" });
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
  void resetVoiceSessionState();
  lastAnnouncedStageKey = null;
  lastCheckpointKey = null;
  analyticFormulaVisible = false;
  analyticFullSolutionVisible = false;
  analyticFormulaDismissed = false;
  similarQuestionRequest = null;
  lastCompletionPromptKey = null;
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
}

async function handleQuestionSubmit(overrides = {}) {
  const questionText = (overrides.questionText ?? questionInput?.value?.trim()) || "";
  const imageFile = overrides.imageFile ?? questionImageFile;
  if (!questionText && !imageFile) return;
  if (questionText && questionInput) {
    questionInput.value = questionText;
  }

  tutorState.reset();
  tutorState.setPhase("parsing");
  analyticFormulaVisible = false;
  analyticFullSolutionVisible = false;
  analyticFormulaDismissed = false;
  similarQuestionRequest = null;
  lastCompletionPromptKey = null;
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
    objectCount: currentSnapshot().objects.length,
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
    completionState: tutorState.completionState || { complete: false, reason: null },
    formulaVisible: analyticFormulaVisible,
    fullSolutionVisible: analyticFullSolutionVisible,
    lastSceneFeedback,
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
  lastSceneFeedback = "";
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
  lastSceneFeedback = "";
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
        setTranscriptMessageText(typing, streamedText, { role: "tutor", completion: false });
      },
      onAssessment: (assessment) => {
        tutorState.setAssessment(assessment);
        renderAssessment(assessment);
        renderSceneInfo();
        updateStageRail();
      },
    });

    typing?.classList.remove("loading-dots");
    if (typing) {
      typing.dataset.completion = response.completionState?.complete ? "true" : "false";
    }
    setTranscriptMessageText(typing, response.text || streamedText || "I could not generate a tutor reply.", {
      role: "tutor",
      completion: Boolean(response.completionState?.complete),
    });
    syncStepFromTutorResponse(response, plan);

    if (response.completionState?.complete) {
      completeLesson({ reason: response.completionState.reason || "correct-answer" });
    }

    const actions = response.actions?.length ? response.actions : stageActionsForClient(plan, tutorState.latestAssessment);
    renderMessageActions(typing, actions);
    tutorState.addMessage("assistant", response.text || streamedText || "I could not generate a tutor reply.");

    if (response.assessment) {
      tutorState.setAssessment(response.assessment);
    } else if (!plan) {
      tutorState.setAssessment(null);
    }
    if (response.focusTargets?.length) {
      focusStageTargets(response.focusTargets, { selectFirst: true });
    }
    if (response.checkpoint && !isLessonComplete()) {
      setCheckpointState(response.checkpoint);
    } else if (!plan) {
      setCheckpointState(null);
    } else if (isLessonComplete()) {
      setCheckpointState(null);
    }
    if (response.sceneDirective) {
      applySceneDirective(response.sceneDirective, { forceCamera: true });
    }
    if (response.sceneCommand) {
      applyAssistantSceneCommand(response.sceneCommand);
    }

    lastSceneFeedback = response.text || lastSceneFeedback;
    renderAssessment(plan ? tutorState.latestAssessment : null);
    renderSceneInfo();
    updateStageRail();
    if (plan && !isLessonComplete()) {
      announceCurrentStage();
    }
  } catch (error) {
    typing?.classList.remove("loading-dots");
    setTranscriptMessageText(typing, `Error: ${error.message}`, { role: "tutor", completion: false });
  }
}

async function handleExplain() {
  await sendTutorMessage(`I'm stuck. Give me a small hint about what to focus on in the scene, without giving me the answer.`, {
    userLabel: "I need a hint",
  });
}

async function handleComposerSubmit() {
  const plan = activePlan();
  const text = chatInput?.value?.trim();
  if (!text) return;

  chatInput.value = "";

  if (tutorState.learningStage === "predict" && !tutorState.predictionState.submitted) {
    tutorState.submitPrediction(text);
    tutorState.setLearningStage("check");
    lastSceneFeedback = "";
    addTranscriptMessage("user", text);
    addTranscriptMessage("tutor", "Interesting. Now look at the scene - does it match what you predicted?", {
      actions: stageActionsForClient(plan),
    });
    setCheckpointState(null);
    updateStageRail();
    announceCurrentStage(true);
    return;
  }

  if (shouldStartLessonFromComposer({
    text,
    hasPlan: Boolean(plan),
    lessonComplete: isLessonComplete(),
  })) {
    await handleQuestionSubmit({ questionText: text, imageFile: null });
    return;
  }

  await sendTutorMessage(text);
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

function handleVoiceSessionEvent(event = {}) {
  switch (event.type) {
    case "state":
      if (event.state === "connecting") {
        updateVoiceStatus("Connecting voice session...", "ready");
      } else if (event.state === "listening") {
        updateVoiceStatus("Listening... release when you're done.", "ready");
      } else if (event.state === "processing") {
        updateVoiceStatus("Thinking...", "ready");
      } else if (event.state === "responding") {
        updateVoiceStatus("Replying...", "ready");
      } else if (event.state === "idle") {
        updateVoiceStatus("", "hidden");
      }
      return;
    case "input_transcript":
      setVoiceTranscript(event.content || "");
      return;
    case "assistant_text":
      setVoiceAssistantMessage(event.content || "", {
        final: event.generationStage === "FINAL",
      });
      return;
    case "assistant_audio":
      ensureVoiceAudioPlayer()
        .appendBase64Chunk(event.audioBase64, event.sampleRateHertz || 24000)
        .catch((error) => {
          console.error("Voice audio playback failed:", error);
        });
      return;
    case "done":
      if (event.inputTranscript) {
        setVoiceTranscript(event.inputTranscript);
      }
      setVoiceAssistantMessage(event.assistantText || "Nova Prism did not return a voice reply.", {
        final: true,
      });
      voiceConversationId = event.conversationId || voiceConversationId;
      syncAssessment();
      voiceStreamDraft = null;
      if (event.fallbackUsed) {
        updateVoiceStatus("Voice replied in captions.", "ready");
        window.setTimeout(() => updateVoiceStatus("", "hidden"), 1400);
      } else {
        updateVoiceStatus("", "hidden");
      }
      return;
    default:
      return;
  }
}

async function ensureVoiceSessionConnected() {
  if (voiceConversationId && voiceSessionUnsubscribe) {
    return voiceConversationId;
  }

  if (!voiceConversationId) {
    const session = await createVoiceSession();
    voiceConversationId = session.conversationId || session.sessionId || voiceConversationId;
  }
  closeVoiceSessionStream();
  voiceSessionUnsubscribe = subscribeToVoiceSession(voiceConversationId, {
    onEvent: handleVoiceSessionEvent,
    onError: (error) => {
      console.error("Voice session stream error:", error);
      updateVoiceStatus("Voice session disconnected. Hold the mic to reconnect.", "error");
      closeVoiceSessionStream();
    },
  });
  return voiceConversationId;
}

function queueVoiceAudioChunk(chunk) {
  if (!voiceConversationId || !chunk?.audioBase64) {
    return;
  }
  voiceAudioUploadChain = voiceAudioUploadChain
    .then(() => appendVoiceSessionAudio({
      sessionId: voiceConversationId,
      audioBase64: chunk.audioBase64,
      mimeType: chunk.mimeType,
    }))
    .catch((error) => {
      console.error("Voice audio upload failed:", error);
      updateVoiceStatus(`Voice error: ${error.message}`, "error");
    });
}

async function finishVoiceCapture() {
  if (!activeMicCapture) return;
  const capture = activeMicCapture;
  activeMicCapture = null;
  voiceRecording = false;
  voiceRecordBtn?.classList.remove("is-recording");
  if (voiceRecordBtn) voiceRecordBtn.textContent = "\u{1F3A4}";
  updateVoiceStatus("Thinking...", "ready");

  try {
    await capture.finish();
    await voiceAudioUploadChain;
    if (voiceConversationId) {
      await stopVoiceSessionTurn(voiceConversationId);
    }
  } catch (error) {
    console.error("Voice capture failed:", error);
    updateVoiceStatus(`Voice error: ${error.message}`, "error");
  }
}

async function startVoiceCapture() {
  if (voiceRecording) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    updateVoiceStatus("This browser cannot capture microphone audio.", "error");
    return;
  }

  try {
    const sessionId = await ensureVoiceSessionConnected();
    resetVoiceDraft();
    ensureVoiceAudioPlayer().stop();
    const sessionStart = await startVoiceSessionTurn({
      sessionId,
      mode: "coach",
      context: buildVoiceContext(),
      playbackMode: "auto",
    });

    if (sessionStart.fallbackUsed) {
      updateVoiceStatus("Voice replied in captions.", "ready");
      return;
    }

    voiceAudioUploadChain = Promise.resolve();
    activeMicCapture = new MicrophoneCapture({ onChunk: queueVoiceAudioChunk });
    await activeMicCapture.start({ onChunk: queueVoiceAudioChunk });
    voiceRecording = true;
    if (voiceRecordBtn) {
      voiceRecordBtn.classList.add("is-recording");
      voiceRecordBtn.textContent = "\u25A0";
    }
    updateVoiceStatus("Listening... release when you're done.", "ready");
    if (!voiceHoldRequested) {
      await stopVoiceCapture();
    }
  } catch (error) {
    console.error("Microphone start failed:", error);
    updateVoiceStatus(`Voice error: ${error.message}`, "error");
  }
}

async function stopVoiceCapture() {
  voiceHoldRequested = false;
  if (!voiceRecording) return;
  await finishVoiceCapture();
}

function advanceLessonStage() {
  const plan = activePlan();
  if (!plan) return;

  if (isAnalyticPlan(plan)) {
    if (tutorState.currentStep < plan.lessonStages.length - 1) {
      tutorState.nextStep();
      lastSceneFeedback = "";
      setCheckpointState(null);
      updateStageRail();
      applyAnalyticSceneState({ forceCamera: true });
      announceCurrentStage(true);
      return;
    }
    analyticFormulaVisible = true;
    analyticFullSolutionVisible = true;
    renderAnalyticPanels(plan);
    completeLesson({ reason: "correct-answer", revealSolution: true });
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
      lastSceneFeedback = "";
      setCheckpointState(null);
      updateStageRail();
      announceCurrentStage(true);
      scheduleAssessment();
      return;
    }

    tutorState.setLearningStage("predict");
    tutorState.resetPrediction(plan.learningMoments?.predict?.prompt || "");
    lastSceneFeedback = "";
    setCheckpointState(null);
    updateStageRail();
    announceCurrentStage(true);
    return;
  }

  if (tutorState.learningStage === "predict") {
    if (!tutorState.predictionState.submitted) {
      addTranscriptMessage("tutor", "Before we move on, type what you think will happen.");
      return;
    }
    tutorState.setLearningStage("check");
    lastSceneFeedback = "";
    updateStageRail();
    announceCurrentStage(true);
    return;
  }

  if (tutorState.learningStage === "check") {
    tutorState.setLearningStage("reflect");
    lastSceneFeedback = "";
    updateStageRail();
    announceCurrentStage(true);
    return;
  }

  if (tutorState.learningStage === "reflect") {
    tutorState.setLearningStage("challenge");
    lastSceneFeedback = "";
    updateStageRail();
    announceCurrentStage(true);
  }
}

async function handleTutorAction(action = {}) {
  switch (action.kind) {
    case "freeform-prompt":
      await sendTutorMessage(action.payload?.prompt || action.label || "Show me something interesting.", {
        userLabel: action.label || action.payload?.prompt || "Try that",
      });
      return;
    case "clear-scene":
      sceneApi?.clearScene?.();
      setCheckpointState(null);
      renderAssessment(activePlan() ? tutorState.latestAssessment : null);
      renderSceneInfo();
      updateStageRail();
      renderAnnotations();
      return;
    case "start-suggested-question":
      if (action.payload?.prompt) {
        await handleQuestionSubmit({ questionText: action.payload.prompt, imageFile: null });
      }
      return;
    default:
      break;
  }

  const plan = activePlan();
  if (!plan) return;

  switch (action.kind) {
    case "highlight-key-idea":
      applyAnalyticSceneState({ forceCamera: true });
      break;
    case "show-formula":
      analyticFormulaVisible = true;
      analyticFormulaDismissed = false;
      renderAnalyticPanels(plan);
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
      completeLesson({ reason: "correct-answer", revealSolution: true });
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
        addTranscriptMessage("tutor", `Here's ${preview.label || preview.shape}. Does this look right to you?`, {
          actions: [
            {
              id: `${preparedAction.id}-confirm`,
              label: "Place it",
              kind: "confirm-preview",
              payload: { stageId: preparedAction.payload?.stageId || null },
            },
            {
              id: `${preparedAction.id}-cancel`,
              label: "Not quite",
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
        scheduleAssessment();
      }
      break;
    }
    case "cancel-preview":
      sceneApi?.cancelPreviewAction?.();
      focusStageTargets(stageFocusTargets(plan));
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
      await sendTutorMessage(action.payload?.prompt || "Something doesn't look right. Give me a nudge about what to check in the scene.", {
        userLabel: "Something's off - help me see it",
      });
      break;
    default:
      break;
  }
}

function handleSceneMutation(detail) {
  const plan = activePlan();
  if (!detail || detail.type !== "objects") return;

  if (!plan) {
    if (detail.reason === "place" && detail.object?.label) {
      lastSceneFeedback = `Placed ${detail.object.label}.`;
    } else if (detail.reason === "drag-end" && detail.object?.label) {
      lastSceneFeedback = `Updated ${detail.object.label}.`;
    } else if (detail.reason === "remove" && detail.object?.label) {
      lastSceneFeedback = `Removed ${detail.object.label}.`;
    } else if (detail.reason === "assistant-replace") {
      lastSceneFeedback = "Loaded a fresh scene.";
    } else if (detail.reason === "assistant-merge") {
      lastSceneFeedback = "Updated the scene.";
    } else if (detail.reason === "assistant-remove") {
      lastSceneFeedback = "Removed objects from the scene.";
    } else if (detail.reason === "clear") {
      lastSceneFeedback = "Cleared the scene.";
    }

    renderSceneInfo();
    renderAssessment(null);
    updateStageRail();
    syncUnfoldDrawer();
    renderAnnotations();
    return;
  }

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
    lastSceneFeedback = `Placed ${detail.object.label}.`;
  } else if (detail.reason === "drag-end" && detail.object?.label) {
    lastSceneFeedback = `Updated ${detail.object.label}.`;
  } else if (detail.reason === "remove" && detail.object?.label) {
    lastSceneFeedback = `Removed ${detail.object.label}.`;
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
  newQuestionBtn?.addEventListener("click", () => {
    tutorState.reset();
    void resetVoiceSessionState();
    analyticFormulaVisible = false;
    analyticFullSolutionVisible = false;
    analyticFormulaDismissed = false;
    similarQuestionRequest = null;
    lastCompletionPromptKey = null;
    analyticOverlayManager?.clear();
    sceneApi?.clearScene?.();
    sceneApi?.clearFocus?.();
    clearTranscript();
    renderAnalyticPanels(null);
    renderAssessment(null);
    renderSceneInfo();
    updateStageRail();
    setQuestionPanelCollapsed(false, { force: true });
    questionSection?.classList.remove("is-compact");
    if (questionInput) {
      questionInput.value = "";
      questionInput.focus();
    }
  });
  lessonPanelToggle?.addEventListener("click", () => {
    if (!activePlan()) return;
    const isCollapsed = questionSection?.classList.contains("is-collapsed");
    setQuestionPanelCollapsed(!isCollapsed, { force: true });
  });
  voiceRecordBtn?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    voiceHoldRequested = true;
    voiceRecordBtn?.setPointerCapture?.(event.pointerId);
    startVoiceCapture();
  });
  voiceRecordBtn?.addEventListener("pointerup", (event) => {
    event.preventDefault();
    stopVoiceCapture();
  });
  voiceRecordBtn?.addEventListener("pointercancel", () => {
    stopVoiceCapture();
  });
  voiceRecordBtn?.addEventListener("pointerleave", () => {
    if (voiceRecording) {
      stopVoiceCapture();
    }
  });
  voiceRecordBtn?.addEventListener("keydown", (event) => {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      voiceHoldRequested = true;
      startVoiceCapture();
    }
  });
  voiceRecordBtn?.addEventListener("keyup", (event) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      stopVoiceCapture();
    }
  });
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
  newQuestionBtn = document.getElementById("newQuestionBtn");
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
