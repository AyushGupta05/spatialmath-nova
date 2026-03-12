/**
 * TutorController: Wires the question input, tutor chat, challenge panel,
 * scene builder, labels, and camera director into a coherent tutor experience.
 *
 * This is the main integration layer between the AI backend and the 3D frontend.
 */

import { parseQuestion, askTutor, fetchChallenges, checkChallenge } from "../ai/client.js";
import { buildSceneFromSpec, clearSceneSpecMeshes, highlightObjects, resetHighlights } from "../ai/sceneBuilder.js";
import { initLabelRenderer, renderLabels, addLabelsFromSpec, clearLabels } from "../render/labels.js";
import { CameraDirector } from "../render/cameraDirector.js";
import { tutorState } from "../state/tutorState.js";

let world = null;
let cameraDirector = null;
let currentMeshes = null; // Map<string, Mesh>
let currentSpec = null;

// DOM refs (set in init)
let questionInput, questionSubmit, questionStatus;
let chatMessages, chatInput, chatSend;
let hintBtn, hintCount, explainBtn;
let stepIndicator, stepLabel, stepPrev, stepNext;
let challengeList, scoreDisplay;
let answerSection, answerInput, answerSubmit, answerFeedback;
let sceneInfo, objectCount;
let voiceToggle;
let voiceEnabled = false;

export function initTutorController(worldRef) {
  world = worldRef;
  cameraDirector = new CameraDirector(world.camera, world.controls);

  // Initialize label renderer
  const stageWrap = document.querySelector(".stage-wrap");
  if (stageWrap) {
    initLabelRenderer(stageWrap);
  }

  // Grab DOM refs
  questionInput = document.getElementById("questionInput");
  questionSubmit = document.getElementById("questionSubmit");
  questionStatus = document.getElementById("questionStatus");
  chatMessages = document.getElementById("chatMessages");
  chatInput = document.getElementById("chatInput");
  chatSend = document.getElementById("chatSend");
  hintBtn = document.getElementById("hintBtn");
  hintCount = document.getElementById("hintCount");
  explainBtn = document.getElementById("explainBtn");
  stepIndicator = document.getElementById("stepIndicator");
  stepLabel = document.getElementById("stepLabel");
  stepPrev = document.getElementById("stepPrev");
  stepNext = document.getElementById("stepNext");
  challengeList = document.getElementById("challengeList");
  scoreDisplay = document.getElementById("scoreDisplay");
  answerSection = document.getElementById("answerSection");
  answerInput = document.getElementById("answerInput");
  answerSubmit = document.getElementById("answerSubmit");
  answerFeedback = document.getElementById("answerFeedback");
  sceneInfo = document.getElementById("sceneInfo");
  objectCount = document.getElementById("objectCount");
  voiceToggle = document.getElementById("voiceToggle");

  bindEvents();
  loadChallenges();
  setupModeToggle();
  initToastContainer();

  // Subscribe to tutor state changes
  tutorState.on("step", handleStepChange);
  tutorState.on("phase", handlePhaseChange);

  // Check for demo mode via URL param
  if (new URLSearchParams(window.location.search).has("demo")) {
    setTimeout(() => runDemoMode(), 800);
  }
}

function bindEvents() {
  // Question submission
  questionSubmit?.addEventListener("click", handleQuestionSubmit);
  questionInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleQuestionSubmit();
    }
  });

  // Chat
  chatSend?.addEventListener("click", handleChatSend);
  chatInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleChatSend();
  });

  // Tutor actions
  hintBtn?.addEventListener("click", handleHint);
  explainBtn?.addEventListener("click", handleExplain);

  // Step navigation
  stepPrev?.addEventListener("click", () => tutorState.prevStep());
  stepNext?.addEventListener("click", () => {
    if (!tutorState.nextStep()) {
      // Reached end of steps
      tutorState.setPhase("practice");
    }
  });

  // Answer submission
  answerSubmit?.addEventListener("click", handleAnswerSubmit);
  answerInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleAnswerSubmit();
  });

  // Voice toggle
  voiceToggle?.addEventListener("click", () => {
    voiceEnabled = !voiceEnabled;
    voiceToggle.classList.toggle("is-active", voiceEnabled);
  });

  // Demo button
  document.getElementById("demoBtn")?.addEventListener("click", () => runDemoMode());
}

function setupModeToggle() {
  const modeTutor = document.getElementById("modeTutor");
  const modeSandbox = document.getElementById("modeSandbox");
  const appShell = document.querySelector(".app-shell");

  modeTutor?.addEventListener("click", () => {
    appShell.dataset.mode = "tutor";
    modeTutor.classList.add("is-active");
    modeSandbox.classList.remove("is-active");
    modeTutor.setAttribute("aria-selected", "true");
    modeSandbox.setAttribute("aria-selected", "false");
  });

  modeSandbox?.addEventListener("click", () => {
    appShell.dataset.mode = "sandbox";
    modeSandbox.classList.add("is-active");
    modeTutor.classList.remove("is-active");
    modeSandbox.setAttribute("aria-selected", "true");
    modeTutor.setAttribute("aria-selected", "false");
  });
}

// ============ QUESTION HANDLING ============

async function handleQuestionSubmit() {
  const question = questionInput?.value?.trim();
  if (!question) return;

  tutorState.setPhase("parsing");
  setQuestionStatus("Asking Nova Pro to analyze your question...", "loading");
  questionSubmit.disabled = true;

  try {
    const { sceneSpec } = await parseQuestion(question);

    tutorState.setSceneSpec(sceneSpec);
    tutorState.setPhase("scene_ready");

    // Clear previous scene
    clearCurrentScene();

    // Build new scene
    const result = buildSceneFromSpec(sceneSpec, world);
    currentMeshes = result.meshes;
    currentSpec = result.spec;

    // Add labels
    addLabelsFromSpec(world.scene, result.spec, currentMeshes);

    // Animate camera
    if (result.spec.camera) {
      animateCamera(result.spec.camera.position, result.spec.camera.target);
    }

    // Update UI
    updateSceneInfo(result.spec);
    updateObjectCount(currentMeshes.size);
    setQuestionStatus("", "hidden");

    // Add welcome message to chat
    clearChat();
    addChatMessage("system", `Scene generated for: "${question}"`);
    addChatMessage("tutor", `I've created a 3D scene for your problem. ${result.spec.answer?.steps?.length ? `There are ${result.spec.answer.steps.length} steps to solve this. Click "Explain Step" or use the step navigator to walk through the solution.` : "Feel free to ask me anything about this problem!"}`);

    // Show step indicator if there are steps
    if (result.spec.answer?.steps?.length > 0) {
      showStepIndicator(result.spec.answer.steps.length);
      tutorState.setPhase("walkthrough");
    }

  } catch (err) {
    console.error("Question parse error:", err);
    setQuestionStatus(`Error: ${err.message}`, "error");
    showToast(`Failed to parse question: ${err.message}`, "error", 6000);
    tutorState.setError(err.message);
  } finally {
    questionSubmit.disabled = false;
  }
}

// ============ CHAT ============

async function handleChatSend() {
  const msg = chatInput?.value?.trim();
  if (!msg) return;

  chatInput.value = "";
  addChatMessage("user", msg);
  tutorState.addMessage("user", msg);

  // Show typing indicator
  const typingEl = addChatMessage("tutor", "...");
  typingEl.classList.add("loading-dots");

  try {
    let fullResponse = "";
    await askTutor({
      sceneSpec: currentSpec,
      history: tutorState.history,
      userMessage: msg,
      phase: tutorState.phase,
      currentStep: tutorState.currentStep,
      hintsUsed: tutorState.hintsUsed,
      onChunk: (chunk) => {
        fullResponse += chunk;
        typingEl.textContent = fullResponse;
        typingEl.classList.remove("loading-dots");
        scrollChatToBottom();
      },
    });

    if (!fullResponse) {
      typingEl.textContent = "I'm having trouble connecting. Please try again.";
    }
    typingEl.classList.remove("loading-dots");
    tutorState.addMessage("tutor", fullResponse);

    // Voice
    if (voiceEnabled && fullResponse) {
      speakText(fullResponse);
    }
  } catch (err) {
    typingEl.textContent = `Error: ${err.message}`;
    typingEl.classList.remove("loading-dots");
  }
}

async function handleHint() {
  if (!tutorState.useHint()) {
    addChatMessage("system", "No more hints available!");
    return;
  }
  updateHintCount();

  chatInput.value = "Can you give me a hint?";
  handleChatSend();
}

async function handleExplain() {
  const step = tutorState.getCurrentStepData();
  if (!step) {
    chatInput.value = "Can you explain the current problem?";
  } else {
    chatInput.value = `Can you explain step ${tutorState.currentStep + 1}: "${step.text}"?`;
  }
  handleChatSend();
}

// ============ STEP NAVIGATION ============

function handleStepChange({ step }) {
  updateStepIndicator(step);
  const stepData = tutorState.getCurrentStepData();
  if (!stepData) return;

  // Highlight relevant objects
  if (currentMeshes && stepData.highlightObjects) {
    highlightObjects(currentMeshes, stepData.highlightObjects);
  }

  // Show step explanation in chat
  addChatMessage("system", `Step ${step + 1}: ${stepData.text}${stepData.formula ? ` (${stepData.formula})` : ""}`);
}

function handlePhaseChange({ phase }) {
  // Show/hide answer section for practice mode
  if (answerSection) {
    answerSection.classList.toggle("hidden", phase !== "practice");
  }

  if (phase === "practice") {
    addChatMessage("system", "Now it's your turn! Enter your answer below.");
    if (currentMeshes) resetHighlights(currentMeshes);
  }
}

// ============ CHALLENGES ============

async function loadChallenges() {
  try {
    const { challenges } = await fetchChallenges();
    renderChallengeList(challenges);
  } catch {
    if (challengeList) {
      challengeList.innerHTML = '<p class="muted-text">Challenges will be available when the server is running.</p>';
    }
  }
}

function renderChallengeList(challenges) {
  if (!challengeList) return;
  challengeList.innerHTML = challenges.map((ch) => `
    <div class="challenge-item" data-id="${ch.id}">
      <p class="challenge-title">${ch.title}</p>
      <div class="challenge-meta">
        <span class="challenge-diff ${ch.difficulty}">${ch.difficulty}</span>
        <span>${ch.category}</span>
      </div>
    </div>
  `).join("");

  // Bind click handlers
  challengeList.querySelectorAll(".challenge-item").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.id;
      const ch = challenges.find((c) => c.id === id);
      if (ch) startChallenge(ch);
    });
  });
}

function startChallenge(challenge) {
  // Mark active
  challengeList?.querySelectorAll(".challenge-item").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.id === challenge.id);
  });

  tutorState.startChallenge(challenge.id, challenge.sceneSpec);

  // Clear and build scene
  clearCurrentScene();
  const result = buildSceneFromSpec(challenge.sceneSpec, world);
  currentMeshes = result.meshes;
  currentSpec = result.spec;

  addLabelsFromSpec(world.scene, result.spec, currentMeshes);

  if (result.spec.camera) {
    animateCamera(result.spec.camera.position, result.spec.camera.target);
  }

  updateSceneInfo(result.spec);
  updateObjectCount(currentMeshes.size);

  // Chat
  clearChat();
  addChatMessage("system", `Challenge: ${challenge.title}`);
  addChatMessage("tutor", challenge.question);

  // Show steps
  if (result.spec.answer?.steps?.length > 0) {
    showStepIndicator(result.spec.answer.steps.length);
  }

  // Show answer section
  if (answerSection) answerSection.classList.remove("hidden");
  if (answerFeedback) { answerFeedback.classList.add("hidden"); answerFeedback.textContent = ""; }
  if (answerInput) answerInput.value = "";
}

async function handleAnswerSubmit() {
  const answer = parseFloat(answerInput?.value);
  if (isNaN(answer)) {
    showAnswerFeedback("Please enter a valid number.", false);
    return;
  }

  try {
    const result = await checkChallenge(tutorState.challengeId, answer);
    showAnswerFeedback(result.feedback, result.correct);

    if (result.correct) {
      tutorState.recordCorrect();
      updateScore();
    } else {
      tutorState.recordIncorrect();
    }
  } catch (err) {
    showAnswerFeedback(`Error checking answer: ${err.message}`, false);
  }
}

// ============ UI HELPERS ============

function clearCurrentScene() {
  if (currentMeshes) {
    clearSceneSpecMeshes(world, currentMeshes);
    currentMeshes = null;
  }
  clearLabels(world.scene);
  currentSpec = null;
}

function setQuestionStatus(text, type) {
  if (!questionStatus) return;
  questionStatus.textContent = text;
  questionStatus.className = "question-status";
  if (type === "hidden" || !text) {
    questionStatus.classList.add("hidden");
  } else if (type === "loading") {
    questionStatus.classList.add("is-loading");
    questionStatus.classList.remove("hidden");
  } else if (type === "error") {
    questionStatus.classList.add("is-error");
    questionStatus.classList.remove("hidden");
  }
}

function addChatMessage(role, content) {
  if (!chatMessages) return null;

  // Remove welcome message if present
  const welcome = chatMessages.querySelector(".chat-welcome");
  if (welcome) welcome.remove();

  const div = document.createElement("div");
  div.className = `chat-msg is-${role}`;
  div.textContent = content;
  chatMessages.appendChild(div);
  scrollChatToBottom();
  return div;
}

function clearChat() {
  if (!chatMessages) return;
  chatMessages.innerHTML = "";
}

function scrollChatToBottom() {
  if (chatMessages) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

function showStepIndicator(totalSteps) {
  if (!stepIndicator) return;
  stepIndicator.classList.remove("hidden");
  updateStepIndicator(0);
}

function updateStepIndicator(step) {
  const total = tutorState.totalSteps;
  if (stepLabel) stepLabel.textContent = `Step ${step + 1} / ${total}`;
  if (stepPrev) stepPrev.disabled = step <= 0;
  if (stepNext) stepNext.disabled = step >= total - 1;
}

function updateHintCount() {
  if (hintCount) {
    const remaining = tutorState.maxHints - tutorState.hintsUsed;
    hintCount.textContent = `(${remaining} left)`;
  }
  if (hintBtn) hintBtn.disabled = tutorState.hintsUsed >= tutorState.maxHints;
}

function updateSceneInfo(spec) {
  if (!sceneInfo) return;
  const objects = spec.objects || [];
  const answer = spec.answer;
  let html = `<p style="margin:0 0 6px"><strong>${spec.question || ""}</strong></p>`;
  html += `<p class="muted-text">${objects.length} object${objects.length !== 1 ? "s" : ""} in scene</p>`;
  if (answer?.formula) {
    html += `<p class="muted-text">Formula: <span class="formula">${answer.formula}</span></p>`;
  }
  sceneInfo.innerHTML = html;
}

function updateObjectCount(count) {
  if (objectCount) objectCount.textContent = count;
}

function updateScore() {
  if (scoreDisplay) scoreDisplay.textContent = `Score: ${tutorState.score}`;
}

function showAnswerFeedback(text, correct) {
  if (!answerFeedback) return;
  answerFeedback.textContent = text;
  answerFeedback.className = `answer-feedback ${correct ? "is-correct" : "is-incorrect"}`;
  answerFeedback.classList.remove("hidden");
}

function animateCamera(position, target) {
  if (!position || !target) return;
  cameraDirector.animateTo(position, target, 1200);
}

function speakText(text) {
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  speechSynthesis.speak(utterance);
}

// ============ DEMO MODE ============

const DEMO_SPEC = {
  question: "A sphere of radius 3 sits on top of a cube with side length 5. What is the total surface area?",
  questionType: "composite",
  objects: [
    {
      id: "A", shape: "cube",
      params: { size: 5 },
      position: [0, 2.5, 0], rotation: [0, 0, 0],
      color: "#48c9ff", highlight: false,
    },
    {
      id: "B", shape: "sphere",
      params: { radius: 3 },
      position: [0, 8, 0], rotation: [0, 0, 0],
      color: "#7cf7e4", highlight: false,
    },
  ],
  labels: [
    { text: "Cube (a = 5)", attachTo: "A", offset: [0, -1, 3.5], style: "name" },
    { text: "Sphere (r = 3)", attachTo: "B", offset: [0, 2, 2], style: "name" },
  ],
  dimensions: [
    { from: [-2.5, 0, 2.6], to: [2.5, 0, 2.6], label: "5 units", color: "#48c9ff" },
    { from: [2.6, 0, 0], to: [2.6, 5, 0], label: "5 units", color: "#48c9ff" },
    { from: [0, 8, 0], to: [3, 8, 0], label: "r = 3", color: "#7cf7e4" },
  ],
  camera: { position: [14, 10, 14], target: [0, 4, 0] },
  answer: {
    value: "150 + 4\u03c0(9) \u2248 263.1",
    unit: "square units",
    formula: "SA = 5a\u00b2 + 4\u03c0r\u00b2",
    steps: [
      { text: "Find the cube's exposed surface area. The top face is partially covered, but we assume the sphere sits on it. 5 faces are fully exposed plus the top face area minus the contact circle.", formula: "SA_cube \u2248 5 \u00d7 5\u00b2 = 125", highlightObjects: ["A"] },
      { text: "Find the sphere's full surface area.", formula: "SA_sphere = 4\u03c0r\u00b2 = 4\u03c0(3)\u00b2 = 36\u03c0 \u2248 113.1", highlightObjects: ["B"] },
      { text: "Add them together for the total surface area (assuming tangent contact).", formula: "SA_total = 125 + 36\u03c0 \u2248 238.1", highlightObjects: ["A", "B"] },
    ],
  },
};

async function runDemoMode() {
  showToast("Demo mode: Loading showcase scene...", "info");

  // Load the demo scene directly without API call
  clearCurrentScene();
  const result = buildSceneFromSpec(DEMO_SPEC, world);
  currentMeshes = result.meshes;
  currentSpec = result.spec;
  tutorState.setSceneSpec(result.spec);

  addLabelsFromSpec(world.scene, result.spec, currentMeshes);
  animateCamera(result.spec.camera.position, result.spec.camera.target);
  updateSceneInfo(result.spec);
  updateObjectCount(currentMeshes.size);

  if (questionInput) questionInput.value = DEMO_SPEC.question;

  clearChat();
  addChatMessage("system", "Demo Mode: Showcase scene loaded");
  addChatMessage("tutor", `I've created a 3D scene showing a sphere (radius 3) on top of a cube (side 5). There are ${result.spec.answer.steps.length} steps to find the total surface area. Use the step navigator above the viewport, or click "Explain Step" to walk through the solution.`);

  if (result.spec.answer?.steps?.length > 0) {
    showStepIndicator(result.spec.answer.steps.length);
    tutorState.setPhase("walkthrough");
  }

  // Auto-walkthrough: advance through steps with delays
  await delay(3000);
  for (let i = 0; i < result.spec.answer.steps.length; i++) {
    tutorState.goToStep(i);
    pulseHighlightedObjects(result.spec.answer.steps[i].highlightObjects);
    await delay(4000);
  }
  showToast("Demo complete! Try asking your own question.", "success");
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============ TOAST NOTIFICATIONS ============

let toastContainer = null;

function initToastContainer() {
  toastContainer = document.createElement("div");
  toastContainer.className = "toast-container";
  document.body.appendChild(toastContainer);
}

function showToast(message, type = "info", durationMs = 4000) {
  if (!toastContainer) initToastContainer();

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  // Trigger enter animation
  requestAnimationFrame(() => toast.classList.add("toast--visible"));

  setTimeout(() => {
    toast.classList.remove("toast--visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    // Fallback removal
    setTimeout(() => toast.remove(), 500);
  }, durationMs);
}

// ============ HIGHLIGHT PULSE ============

function pulseHighlightedObjects(objectIds) {
  if (!currentMeshes || !objectIds) return;
  for (const id of objectIds) {
    const mesh = currentMeshes.get(id);
    if (!mesh) continue;
    const startIntensity = mesh.material.emissiveIntensity;
    const startTime = performance.now();
    const duration = 800;

    function pulseTick(now) {
      const t = (now - startTime) / duration;
      if (t >= 1) {
        mesh.material.emissiveIntensity = 0.7;
        return;
      }
      // Smooth pulse: ramp up then back
      const pulse = Math.sin(t * Math.PI);
      mesh.material.emissiveIntensity = startIntensity + pulse * 0.8;
      requestAnimationFrame(pulseTick);
    }
    requestAnimationFrame(pulseTick);
  }
}

/**
 * Call this in the render loop to update labels.
 */
export function updateTutorLabels() {
  if (world) {
    renderLabels(world.scene, world.camera);
  }
}
