import { normalizeScenePlan } from "../../src/ai/planSchema.js";

function summarizeScene(snapshot) {
  return (snapshot?.objects || [])
    .map((objectSpec) => `${objectSpec.label || objectSpec.id || "object"}: ${objectSpec.shape} ${JSON.stringify(objectSpec.params)}`)
    .join("\n");
}

function summarizeSceneContext(sceneContext = {}) {
  const selection = sceneContext?.selection
    ? `Selected object: ${sceneContext.selection.label} (${sceneContext.selection.shape}) params=${JSON.stringify(sceneContext.selection.params)} metrics=${JSON.stringify(sceneContext.selection.metrics)}`
    : "Selected object: none";
  const liveChallenge = sceneContext?.liveChallenge
    ? `Live challenge: ${sceneContext.liveChallenge.title || sceneContext.liveChallenge.metric} unlocked=${Boolean(sceneContext.liveChallenge.unlocked)} complete=${Boolean(sceneContext.liveChallenge.complete)} current=${sceneContext.liveChallenge.currentValue ?? "n/a"} target=${sceneContext.liveChallenge.targetValue ?? "n/a"} tolerance=${sceneContext.liveChallenge.toleranceValue ?? "n/a"}`
    : "Live challenge: none";
  const sceneFocus = sceneContext?.sceneFocus
    ? `Scene focus: concept=${sceneContext.sceneFocus.concept || "n/a"} insight=${sceneContext.sceneFocus.primaryInsight || "n/a"}`
    : "Scene focus: none";
  const sourceSummary = sceneContext?.sourceSummary
    ? `Source summary: cleanedQuestion=${sceneContext.sourceSummary.cleanedQuestion || "n/a"} givens=${JSON.stringify(sceneContext.sourceSummary.givens || [])} relationships=${JSON.stringify(sceneContext.sourceSummary.relationships || [])}`
    : "Source summary: none";
  const guidance = sceneContext?.guidance
    ? `Guidance: ${sceneContext.guidance.coachFeedback || "n/a"}`
    : "Guidance: none";
  return `${selection}\n${liveChallenge}\n${sceneFocus}\n${sourceSummary}\n${guidance}`;
}

function summarizeAnalyticContext(plan = {}, _sceneContext = {}, contextStepId = null, learningState = {}) {
  if (plan?.experienceMode !== "analytic_auto") return "Analytic context: none";
  const currentMoment = (plan.sceneMoments || []).find((moment) => moment.id === contextStepId)
    || plan.sceneMoments?.[learningState?.currentStep || 0]
    || plan.sceneMoments?.[0]
    || null;
  const analytic = plan.analyticContext || {};
  const steps = (analytic.solutionSteps || [])
    .map((step) => `${step.title}: ${step.formula || step.explanation}`)
    .join("\n");
  return [
    `Analytic subtype: ${analytic.subtype || "unknown"}`,
    `Formula card: ${analytic.formulaCard?.formula || "n/a"}`,
    `Formula explanation: ${analytic.formulaCard?.explanation || "n/a"}`,
    currentMoment ? `Current scene moment: ${currentMoment.title} -> ${currentMoment.prompt}` : "Current scene moment: none",
    steps ? `Deterministic solution steps:\n${steps}` : "Deterministic solution steps: none",
  ].join("\n");
}

function titlesForSuggestionIds(plan, ids = []) {
  const byId = new Map((plan?.objectSuggestions || []).map((suggestion) => [suggestion.id, suggestion.title]));
  return ids.map((id) => byId.get(id) || id);
}

export function buildTutorSystemPrompt({ plan, sceneSnapshot, sceneContext, learningState, contextStepId, assessment }) {
  const normalizedPlan = normalizeScenePlan(plan);
  const currentStep = normalizedPlan.buildSteps.find((step) => step.id === contextStepId)
    || normalizedPlan.buildSteps[learningState?.currentStep || 0]
    || null;
  const learningStage = learningState?.learningStage || "orient";
  const learningMoment = normalizedPlan.learningMoments?.[learningStage] || {};

  return `You are Nova Prism, a spatial-maths tutor inspired by 3Blue1Brown's visual teaching and Khan Academy's Socratic tutoring.

Your core philosophy:
- NEVER give the answer directly. Guide the learner to discover it themselves through the 3D scene.
- Show, don't tell. Point to what's visible in the scene rather than explaining abstractly.
- Ask one focused question at a time. "What do you notice about..." or "What would happen if..."
- Build intuition before formulas. The scene IS the explanation.
- Be warm, curious, and brief. Sound like a thoughtful guide, not a textbook.

Problem: ${normalizedPlan.sourceSummary.cleanedQuestion || normalizedPlan.problem.question}
Question type: ${normalizedPlan.problem.questionType}
Overview: ${normalizedPlan.overview}
Learning stage: ${learningStage}
Current lesson focus: ${normalizedPlan.sceneFocus.primaryInsight}

Current build step:
${currentStep ? `${currentStep.title}: ${currentStep.instruction}` : "No active step"}

Current lesson card intent:
Title: ${learningMoment.title || learningStage}
Coach message: ${learningMoment.coachMessage || ""}
Goal: ${learningMoment.goal || ""}
Prediction prompt: ${learningMoment.prompt || ""}

Scene snapshot:
${summarizeScene(sceneSnapshot) || "The learner has not built anything yet."}

Focused scene context:
${summarizeSceneContext(sceneContext)}

Analytic lesson context:
${summarizeAnalyticContext(normalizedPlan, sceneContext, contextStepId, learningState)}

Build assessment:
${JSON.stringify(assessment.summary)}
Step feedback:
${assessment.stepAssessments.map((step) => `${step.title}: ${step.feedback}`).join("\n")}
Guidance feedback:
${assessment.guidance?.coachFeedback || "n/a"}

Answer gate:
${assessment.answerGate.reason}

Conversation rules:
- Keep responses to 1-2 short sentences. One focused thought per reply.
- ALWAYS end with a question that nudges the learner to think or look at the scene. Examples:
  "What do you notice about how these two shapes compare?"
  "Look at the highlighted edge. What happens to the volume if you stretch it?"
  "Before I show you the formula, what's your gut feeling?"
- When the learner asks "what's the answer?" or "just tell me", respond with:
  "Let's figure it out together. Look at [specific scene element] - what does it tell you?"
  If they insist, say: "I can show you the solution - tap 'View Solution' when you're ready. But first, what's your best guess?"
- If the build is incomplete, point to the specific missing piece in the scene.
- If the stage is predict, help them commit to a prediction. Don't explain yet.
- If the stage is check, ask them to compare their prediction with what the scene shows.
- If the stage is reflect, prompt them to state the insight in their own words.
- Reference specific objects by name. Say "look at cylinder A" not "consider the shape."
- When a selected object is available, anchor to its actual dimensions and metrics.
- When the learner is stuck, give the smallest useful nudge, not a full explanation.
- Never recite formulas unless the learner has already attempted reasoning and asks to see one.
- Never say "Great question!" or similar filler. Jump straight into the guiding thought.`;
}

export function buildFallbackTutorReply({ plan, assessment, sceneContext, userMessage, contextStepId }) {
  const normalizedPlan = normalizeScenePlan(plan);
  const assessmentStepId = assessment?.summary?.currentStepId || null;
  const currentStep = normalizedPlan.buildSteps.find((step) => step.id === contextStepId)
    || normalizedPlan.buildSteps.find((step) => step.id === assessmentStepId)
    || normalizedPlan.buildSteps[0]
    || null;
  const currentStepAssessment = currentStep
    ? assessment?.stepAssessments?.find((step) => step.stepId === currentStep.id) || null
    : null;
  const missingTitles = currentStepAssessment
    ? titlesForSuggestionIds(normalizedPlan, currentStepAssessment.missingObjectIds || [])
    : [];
  const lowerMessage = String(userMessage || "").toLowerCase();
  const liveChallenge = sceneContext?.liveChallenge || null;
  const selected = sceneContext?.selection || null;
  const learningStage = sceneContext?.guidance?.readyForPrediction ? "predict-ready" : "building";

  if (normalizedPlan.experienceMode === "analytic_auto") {
    const currentMoment = normalizedPlan.sceneMoments.find((moment) => moment.id === contextStepId)
      || normalizedPlan.sceneMoments[0]
      || null;
    if (/(formula|equation)/.test(lowerMessage)) {
      return `${normalizedPlan.analyticContext?.formulaCard?.formula || normalizedPlan.answerScaffold.formula || "The formula card is ready."} ${normalizedPlan.analyticContext?.formulaCard?.explanation || ""}`.trim();
    }
    if (/(next|highlight|show)/.test(lowerMessage)) {
      return currentMoment?.goal
        ? `${currentMoment.goal} Use the highlighted objects, then reveal the next visual step when you're ready.`
        : "Use the highlighted objects, then reveal the next visual step when you're ready.";
    }
    return `${currentMoment?.prompt || normalizedPlan.sceneFocus?.primaryInsight || "Use the scene to explain the idea."} ${normalizedPlan.answerScaffold.formula ? `The key formula here is ${normalizedPlan.answerScaffold.formula}.` : ""}`.trim();
  }

  if (liveChallenge?.unlocked && /(target|challenge|goal)/.test(lowerMessage)) {
    return `The live ${liveChallenge.metric === "surfaceArea" ? "surface area" : "volume"} target is ${liveChallenge.targetValue ?? "not set yet"}. The current value is ${liveChallenge.currentValue ?? "unknown"} and Nova accepts about +/-${liveChallenge.toleranceValue ?? "0"} tolerance.`;
  }

  if (/(hint|next|stuck|help)/.test(lowerMessage)) {
    if (missingTitles.length) {
      return `Look at the scene. What's missing? Think about what ${missingTitles.join(" and ")} would add to the picture.`;
    }
    if (assessment?.guidance?.readyForPrediction) {
      return "The scene is set. Before I explain anything, what's your gut feeling about the answer?";
    }
    if (!assessment?.answerGate?.allowed) {
      return "There's still something to build. Look at the scene - what shape or relationship is missing?";
    }
    if (liveChallenge?.unlocked && !liveChallenge.complete) {
      return `What would you need to change so the ${liveChallenge.metric === "surfaceArea" ? "surface area" : "volume"} moves from ${liveChallenge.currentValue} toward ${liveChallenge.targetValue}?`;
    }
  }

  if (/(why|explain|formula)/.test(lowerMessage)) {
    if (selected) {
      return `Look at ${selected.label}. Its volume is ${selected.metrics?.volume ?? "unknown"} and surface area is ${selected.metrics?.surfaceArea ?? "unknown"}. What do those numbers tell you about the shape?`;
    }
    return `Look at the objects in the scene. ${missingTitles.length ? `What would change if you added ${missingTitles.join(", ")}?` : "What relationship do you notice between them?"}`;
  }

  if (learningStage === "predict-ready") {
    return "The scene is ready. Before we go further, what do you think the answer will be?";
  }

  if (!assessment?.answerGate?.allowed) {
    return missingTitles.length
      ? `Look at the scene. What would ${missingTitles.join(" and ")} add to the picture?`
      : "There's more to build. What do you think is missing from the scene?";
  }

  if (liveChallenge?.unlocked && !liveChallenge.complete) {
    return `The scene is built. The ${liveChallenge.metric === "surfaceArea" ? "surface area" : "volume"} is currently ${liveChallenge.currentValue}. How would you get it to ${liveChallenge.targetValue}?`;
  }

  return "What do you notice in the scene? What stands out to you?";
}
