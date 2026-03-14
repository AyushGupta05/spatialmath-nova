import { normalizeScenePlan } from "../../src/ai/planSchema.js";

function suggestionById(plan, suggestionId) {
  return plan.objectSuggestions.find((suggestion) => suggestion.id === suggestionId) || null;
}

function sceneMomentForStage(plan, stageId = null, learningState = {}) {
  if (!plan?.sceneMoments?.length) return null;
  return plan.sceneMoments.find((moment) => moment.id === stageId)
    || plan.sceneMoments[learningState?.currentStep || 0]
    || plan.sceneMoments[0]
    || null;
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
  if (plan.experienceMode === "analytic_auto") {
    const sceneMoment = sceneMomentForStage(plan, stage.id, learningState);
    const sceneIndex = Math.max(0, plan.sceneMoments.findIndex((moment) => moment.id === sceneMoment?.id));
    const includeNext = sceneIndex < Math.max(plan.sceneMoments.length - 1, 0);
    const actions = [
      !sceneMoment?.revealFormula
        ? {
          id: `${stage.id}-formula`,
          label: "Show Formula",
          kind: "show-formula",
          payload: { stageId: stage.id },
        }
        : null,
      includeNext
        ? {
          id: `${stage.id}-next`,
          label: "What's next?",
          kind: "reveal-next-step",
          payload: { stageId: stage.id },
        }
        : null,
      {
        id: `${stage.id}-solution`,
        label: "View Solution",
        kind: "reveal-full-solution",
        payload: { stageId: stage.id },
      },
    ].filter(Boolean);
    return actions;
  }

  const nextRequiredId = assessment?.guidance?.nextRequiredSuggestionIds?.[0] || null;
  const nextRequiredSuggestion = nextRequiredId ? suggestionById(plan, nextRequiredId) : null;
  const actions = [];

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
      id: `${stage.id}-explain`,
      label: (learningState?.learningStage || "orient") === "orient" ? "Give me a hint" : "I'm stuck",
      kind: "explain-stage",
      payload: { stageId: stage.id },
    },
    {
      id: `${stage.id}-continue`,
      label: "I think I see it",
      kind: "continue-stage",
      payload: { stageId: stage.id },
    },
  );

  return actions.slice(0, 3);
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
  completionState = null,
}) {
  const plan = normalizeScenePlan(planInput);
  const stage = currentLessonStage(plan, learningState, contextStepId, assessment);
  const sceneMoment = sceneMomentForStage(plan, stage?.id || null, learningState);
  const nextRequiredSuggestionIds = assessment?.guidance?.nextRequiredSuggestionIds || [];
  const focusTargets = plan.experienceMode === "analytic_auto"
    ? (sceneMoment?.focusTargets?.length ? sceneMoment.focusTargets : (stage?.highlightTargets || []))
    : stage?.highlightTargets?.length
      ? stage.highlightTargets
      : nextRequiredSuggestionIds
        .map((id) => suggestionById(plan, id)?.object?.id)
        .filter(Boolean);

  return {
    actions: completionState?.complete ? [] : stageActionsForReply(plan, stage, learningState, assessment),
    focusTargets,
    checkpoint: completionState?.complete
      ? null
      : assessment?.activeStep?.complete || assessment?.guidance?.readyForPrediction
      ? {
        prompt: stage?.checkpointPrompt || "Does this look correct?",
        options: ["yes", "not_sure"],
      }
      : null,
    stageStatus: {
      currentStageId: stage?.id || null,
      canAdvance: completionState?.complete
        ? false
        : plan.experienceMode === "analytic_auto"
        ? true
        : Boolean(assessment?.activeStep?.complete || assessment?.guidance?.readyForPrediction),
    },
    systemContextMessage: systemContextMessage(plan),
    completionState: completionState?.complete
      ? { complete: true, reason: completionState.reason || "correct-answer" }
      : { complete: false, reason: null },
    sceneDirective: plan.experienceMode === "analytic_auto"
      ? {
        stageId: sceneMoment?.id || stage?.id || null,
        cameraBookmarkId: sceneMoment?.cameraBookmarkId || stage?.cameraBookmarkId || null,
        focusTargets,
        visibleObjectIds: sceneMoment?.visibleObjectIds || [],
        visibleOverlayIds: sceneMoment?.visibleOverlayIds || [],
        revealFormula: Boolean(sceneMoment?.revealFormula),
        revealFullSolution: Boolean(sceneMoment?.revealFullSolution),
      }
      : null,
  };
}
