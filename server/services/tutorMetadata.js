import { normalizeScenePlan } from "../../src/ai/planSchema.js";

function suggestionById(plan, suggestionId) {
  return plan.objectSuggestions.find((suggestion) => suggestion.id === suggestionId) || null;
}

function currentLessonStage(plan, learningState = {}, contextStepId = null, assessment = null) {
  const explicitId = contextStepId
    || assessment?.guidance?.currentStepId
    || plan.buildSteps[learningState?.currentStep || 0]?.id
    || null;
  return plan.lessonStages.find((stage) => stage.id === explicitId)
    || plan.lessonStages[0]
    || null;
}

function stageActionsForReply(plan, stage, learningState = {}, assessment = null) {
  if (!stage) return [];

  const nextRequiredId = assessment?.guidance?.nextRequiredSuggestionIds?.[0] || null;
  const nextRequiredSuggestion = nextRequiredId ? suggestionById(plan, nextRequiredId) : null;
  const actions = [];

  if ((learningState?.learningStage || "orient") === "orient") {
    actions.push({
      id: `${stage.id}-start`,
      label: "Start Guided Build",
      kind: "start-guided-build",
      payload: { stageId: stage.id },
    });
  }

  if (nextRequiredSuggestion) {
    actions.push({
      id: `${stage.id}-preview`,
      label: `Preview ${nextRequiredSuggestion.title}`,
      kind: "preview-required-object",
      payload: {
        stageId: stage.id,
        suggestionId: nextRequiredSuggestion.id,
        objectSpec: nextRequiredSuggestion.object,
        highlightTargets: [nextRequiredSuggestion.object.id],
      },
    });
  }

  actions.push(
    {
      id: `${stage.id}-manual`,
      label: "Place Manually",
      kind: "build-manually",
      payload: { stageId: stage.id },
    },
    {
      id: `${stage.id}-explain`,
      label: "Explain First",
      kind: "explain-stage",
      payload: { stageId: stage.id },
    }
  );

  if (assessment?.activeStep?.complete || assessment?.guidance?.readyForPrediction) {
    actions.push({
      id: `${stage.id}-continue`,
      label: "Continue",
      kind: "continue-stage",
      payload: { stageId: stage.id },
    });
  } else {
    actions.push({
      id: `${stage.id}-mistake`,
      label: "Show Me the Mistake",
      kind: "show-mistake",
      payload: { stageId: stage.id, prompt: stage.mistakeProbe },
    });
  }

  return actions.slice(0, 4);
}

function systemContextMessage(plan) {
  const evidence = plan.sourceEvidence;
  const givens = evidence?.givens?.length ? `Givens: ${evidence.givens.join(", ")}.` : "";
  const diagram = evidence?.diagramSummary ? `Source: ${evidence.diagramSummary}` : "Source: text prompt only.";
  const conflicts = evidence?.conflicts?.length ? ` Check the mismatch: ${evidence.conflicts.join(" ")}` : "";
  return `${diagram} ${givens}${conflicts}`.trim();
}

export function buildTutorResponseMeta({
  plan: planInput,
  learningState = {},
  contextStepId = null,
  assessment = null,
}) {
  const plan = normalizeScenePlan(planInput);
  const stage = currentLessonStage(plan, learningState, contextStepId, assessment);
  const nextRequiredSuggestionIds = assessment?.guidance?.nextRequiredSuggestionIds || [];
  const focusTargets = stage?.highlightTargets?.length
    ? stage.highlightTargets
    : nextRequiredSuggestionIds
      .map((id) => suggestionById(plan, id)?.object?.id)
      .filter(Boolean);

  return {
    actions: stageActionsForReply(plan, stage, learningState, assessment),
    focusTargets,
    checkpoint: assessment?.activeStep?.complete || assessment?.guidance?.readyForPrediction
      ? {
        prompt: stage?.checkpointPrompt || "Does this look correct?",
        options: ["yes", "not_sure"],
      }
      : null,
    stageStatus: {
      currentStageId: stage?.id || null,
      canAdvance: Boolean(assessment?.activeStep?.complete || assessment?.guidance?.readyForPrediction),
    },
    systemContextMessage: systemContextMessage(plan),
  };
}
