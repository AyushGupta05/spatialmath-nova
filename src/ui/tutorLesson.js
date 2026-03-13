import { computeGeometry } from "../core/geometry.js";

export function formatNumber(value, digits = 2) {
  const next = Number(value);
  if (!Number.isFinite(next)) return "0";
  return next.toFixed(digits).replace(/\.00$/, "");
}

export function formatMetricName(metric) {
  return metric === "surfaceArea" ? "surface area" : metric || "metric";
}

export function createLiveChallengeState(plan = null) {
  const challenge = plan?.liveChallenge || null;
  return challenge
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

export function findPrimaryLiveSuggestion(plan) {
  if (!plan?.liveChallenge) return null;
  const requiredIds = new Set(plan.buildSteps.flatMap((step) => step.requiredObjectIds || []));
  return plan.objectSuggestions.find((suggestion) => requiredIds.has(suggestion.id) && suggestion.object.shape !== "line")
    || plan.objectSuggestions.find((suggestion) => suggestion.object.shape !== "line")
    || null;
}

export function findObjectForSuggestion(snapshot, suggestion, assessment = null) {
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

export function computeLiveChallengeState({
  plan,
  assessment,
  liveChallengeState,
  snapshot,
  getObject,
}) {
  const challenge = plan?.liveChallenge || null;
  if (!challenge) {
    return { liveChallengeState: null, liveChallenge: null };
  }

  let nextState = liveChallengeState;
  if (!nextState || nextState.planId !== plan.problem?.id || nextState.challengeId !== challenge.id) {
    nextState = createLiveChallengeState(plan);
  }

  const primarySuggestion = findPrimaryLiveSuggestion(plan);
  const currentObject = nextState?.primaryObjectId
    ? getObject(nextState.primaryObjectId)
    : findObjectForSuggestion(snapshot, primarySuggestion, assessment);
  const currentMetrics = currentObject ? computeGeometry(currentObject.shape, currentObject.params) : null;
  const currentValue = currentMetrics ? currentMetrics[challenge.metric] : null;

  if (!nextState.unlocked && assessment?.answerGate?.allowed && currentObject && Number.isFinite(currentValue)) {
    nextState = {
      ...nextState,
      unlocked: true,
      primaryObjectId: currentObject.id,
      baselineValue: currentValue,
      targetValue: currentValue * challenge.multiplier,
    };
  }

  if (nextState.unlocked) {
    const trackedObject = getObject(nextState.primaryObjectId)
      || findObjectForSuggestion(snapshot, primarySuggestion, assessment);
    const trackedMetrics = trackedObject ? computeGeometry(trackedObject.shape, trackedObject.params) : null;
    const trackedValue = trackedMetrics ? trackedMetrics[challenge.metric] : null;
    const targetValue = nextState.targetValue;
    const deltaValue = Number.isFinite(trackedValue) && Number.isFinite(targetValue)
      ? trackedValue - targetValue
      : null;
    const toleranceValue = Number.isFinite(targetValue)
      ? Math.max(0.0001, targetValue * challenge.tolerance)
      : null;
    const progress = Number.isFinite(trackedValue) && Number.isFinite(targetValue) && targetValue > 0
      ? Math.max(0, Math.min(trackedValue / targetValue, 1.25))
      : 0;
    const complete = Number.isFinite(deltaValue) && Number.isFinite(toleranceValue)
      ? Math.abs(deltaValue) <= toleranceValue
      : false;

    nextState = {
      ...nextState,
      primaryObjectId: trackedObject?.id || nextState.primaryObjectId,
      currentValue: trackedValue,
      deltaValue,
      toleranceValue,
      progress,
      complete,
    };
  }

  return {
    liveChallengeState: nextState,
    liveChallenge: {
      ...challenge,
      ...nextState,
      primarySuggestion,
    },
  };
}

export function buildStageConfig({
  plan,
  assessment,
  learningStage,
  currentStep,
  predictionState,
  selectedObject,
  liveChallenge,
  lastSceneFeedback,
  activeChallenge,
}) {
  const stage = learningStage;
  const learningMoment = plan?.learningMoments?.[stage] || {};
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
    config.message = learningMoment.coachMessage || "Start by naming the main object or relationship in this problem.";
    config.goal = plan?.sceneFocus?.focusPrompt || learningMoment.goal;
    config.feedback = "Question -> spatial setup -> student action -> AI feedback -> insight.";
    config.advanceLabel = "Start Build";
    return config;
  }

  if (stage === "build") {
    config.headline = currentStep?.title || learningMoment.title || "Build / Inspect";
    config.message = missingTitles.length
      ? `Build the scene a piece at a time. ${missingTitles.join(", ")} still need attention.`
      : guidance.coachFeedback || learningMoment.coachMessage;
    config.goal = currentStep?.instruction || learningMoment.goal;
    config.feedback = guidance.coachFeedback || lastSceneFeedback;
    config.advanceLabel = guidance.readyForPrediction ? "Move to Prediction" : "Keep Building";
    return config;
  }

  if (stage === "predict") {
    config.headline = learningMoment.title || "Predict";
    config.message = learningMoment.coachMessage || "Pause before solving and make a short prediction.";
    config.goal = learningMoment.prompt || predictionState?.prompt || "Make one short prediction from the scene.";
    config.feedback = selectedObject
      ? `Use ${selectedObject.label} to ground your prediction.`
      : "Pick the object or helper that best shows the idea.";
    config.showPrediction = true;
    config.advanceLabel = predictionState?.submitted ? "Check in Scene" : "Save Prediction";
    return config;
  }

  if (stage === "check") {
    config.headline = learningMoment.title || "Check";
    config.message = selectedObject
      ? `Check your prediction by inspecting ${selectedObject.label}.`
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
    config.feedback = selectedObject
      ? `${selectedObject.label} now anchors the explanation with visible dimensions. This is the moment to connect the visual change to the math.`
      : guidance.coachFeedback || "The scene is ready to explain. Name what became clearer once the flat prompt became a 3D build.";
    config.advanceLabel = "Start Challenge";
    return config;
  }

  config.headline = liveChallenge?.title || learningMoment.title || "Challenge";
  config.message = liveChallenge?.prompt || learningMoment.coachMessage || "Try one short follow-up.";
  config.goal = liveChallenge?.unlocked
    ? `Target ${formatMetricName(liveChallenge.metric)}: ${formatNumber(liveChallenge.targetValue)}`
    : learningMoment.goal || "Use one more scene action to reinforce the idea.";
  config.feedback = liveChallenge?.unlocked
    ? liveChallenge.complete
      ? `Challenge complete. Your scene is within the target tolerance, which means the learner can now explain what changed and why.`
      : `Current ${formatMetricName(liveChallenge.metric)}: ${formatNumber(liveChallenge.currentValue)}`
    : guidance.coachFeedback || "Finish the build to unlock the challenge.";
  config.showChallenge = true;
  config.challengeText = liveChallenge?.prompt || learningMoment.prompt || "";
  config.advanceLabel = activeChallenge ? "Check Answer" : "Keep Exploring";
  return config;
}
