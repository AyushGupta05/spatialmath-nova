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

  return `You are Nova Prism acting as a concise, calm, scene-aware spatial tutor.

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

Build assessment:
${JSON.stringify(assessment.summary)}
Step feedback:
${assessment.stepAssessments.map((step) => `${step.title}: ${step.feedback}`).join("\n")}
Guidance feedback:
${assessment.guidance?.coachFeedback || "n/a"}

Answer gate:
${assessment.answerGate.reason}

Conversation guidance:
- Be concise by default.
- Keep the learner involved in building, predicting, and reasoning.
- Respond in at most two short paragraphs, usually one.
- Never sound like a general chatbot.
- If the build is incomplete, direct attention to the missing object or measurement.
- If the stage is predict, help the learner commit to a prediction instead of explaining everything.
- If the stage is check, refer to what the learner can inspect or change in the current scene.
- If the stage is reflect, help the learner state the spatial idea in one short sentence.
- Do not dump the full solution unless the learner explicitly asks.
- Reference objects and helpers already in the scene when possible.
- When a selected object is available, anchor explanations to its actual dimensions and current metrics.
- When a live challenge is active, relate the reply to the current value, target, and tolerance.
- If the learner asks for a hint, give the next useful action, not the full answer.`;
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

  if (liveChallenge?.unlocked && /(target|challenge|goal)/.test(lowerMessage)) {
    return `The live ${liveChallenge.metric === "surfaceArea" ? "surface area" : "volume"} target is ${liveChallenge.targetValue ?? "not set yet"}. The current value is ${liveChallenge.currentValue ?? "unknown"} and Nova accepts about +/-${liveChallenge.toleranceValue ?? "0"} tolerance.`;
  }

  if (/(hint|next)/.test(lowerMessage)) {
    if (missingTitles.length) {
      return `Next, add ${missingTitles.join(" and ")} for ${currentStep?.title || "the active step"}. That will move the build closer to the formula.`;
    }
    if (assessment?.guidance?.readyForPrediction) {
      return "The scene is ready. Make a short prediction about what matters most before asking for the explanation.";
    }
    if (!assessment?.answerGate?.allowed) {
      return "Your next move is to finish the required scene objects so the lesson can move into prediction.";
    }
    if (liveChallenge?.unlocked && !liveChallenge.complete) {
      return `Try reshaping the main object so its ${liveChallenge.metric === "surfaceArea" ? "surface area" : "volume"} moves from ${liveChallenge.currentValue} toward ${liveChallenge.targetValue}.`;
    }
  }

  if (/(why|explain|formula)/.test(lowerMessage)) {
    if (selected) {
      return `You're currently focused on ${selected.label}. Its dimensions are ${JSON.stringify(selected.params)}, which is why Nova tracks volume ${selected.metrics?.volume ?? "unknown"} and surface area ${selected.metrics?.surfaceArea ?? "unknown"} directly from the scene. ${normalizedPlan.answerScaffold.formula ? `The target formula here is ${normalizedPlan.answerScaffold.formula}.` : ""}`.trim();
    }
    return `Nova is using the built scene to map the measurements into ${normalizedPlan.answerScaffold.formula || "the problem formula"}. ${missingTitles.length ? `Right now the missing pieces are ${missingTitles.join(", ")}.` : "The required objects are already in place."}`;
  }

  if (learningStage === "predict-ready") {
    return "The scene is ready for a prediction. Name the measurement, direction, or change you expect to matter most.";
  }

  if (!assessment?.answerGate?.allowed) {
    return missingTitles.length
      ? `The build is not complete yet. For ${currentStep?.title || "the current step"}, add ${missingTitles.join(" and ")}.`
      : "The build is still incomplete. Keep matching the required objects from the scene plan before solving.";
  }

  if (liveChallenge?.unlocked && !liveChallenge.complete) {
    return `The required build is complete. The live challenge is active: current ${liveChallenge.metric === "surfaceArea" ? "surface area" : "volume"} ${liveChallenge.currentValue}, target ${liveChallenge.targetValue}.`;
  }

  return `The scene is in a good state to reason from. ${normalizedPlan.answerScaffold.formula ? `Use ${normalizedPlan.answerScaffold.formula} with the measurements already visible in the scene.` : "Ask about any measurement or relationship you want to inspect next."}`;
}
