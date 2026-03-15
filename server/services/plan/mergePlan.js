import { normalizeScenePlan } from "../../../src/ai/planSchema.js";

export function mergeGeneratedPlan({ baselinePlan, novaPlan, workingQuestion, mode }) {
  const preserveAnalytic = baselinePlan?.experienceMode === "analytic_auto";
  const preferNovaScaffold = !preserveAnalytic && novaPlan?.experienceMode === "analytic_auto";
  return normalizeScenePlan({
    ...baselinePlan,
    ...novaPlan,
    problem: {
      ...baselinePlan.problem,
      ...novaPlan.problem,
      question: workingQuestion,
      mode,
    },
    sourceSummary: {
      ...baselinePlan.sourceSummary,
      ...novaPlan.sourceSummary,
    },
    sceneFocus: {
      ...baselinePlan.sceneFocus,
      ...novaPlan.sceneFocus,
    },
    learningMoments: {
      ...baselinePlan.learningMoments,
      ...novaPlan.learningMoments,
    },
    overview: novaPlan.overview || baselinePlan.overview,
    objectSuggestions: preferNovaScaffold
      ? (novaPlan.objectSuggestions?.length ? novaPlan.objectSuggestions : baselinePlan.objectSuggestions)
      : (novaPlan.objectSuggestions?.length || 0) >= baselinePlan.objectSuggestions.length
      ? novaPlan.objectSuggestions
      : baselinePlan.objectSuggestions,
    buildSteps: preferNovaScaffold
      ? (novaPlan.buildSteps?.length ? novaPlan.buildSteps : baselinePlan.buildSteps)
      : (novaPlan.buildSteps?.length || 0) >= baselinePlan.buildSteps.length
      ? novaPlan.buildSteps
      : baselinePlan.buildSteps,
    cameraBookmarks: preferNovaScaffold
      ? (novaPlan.cameraBookmarks?.length ? novaPlan.cameraBookmarks : baselinePlan.cameraBookmarks)
      : (novaPlan.cameraBookmarks?.length || 0)
      ? novaPlan.cameraBookmarks
      : baselinePlan.cameraBookmarks,
    answerScaffold: {
      ...baselinePlan.answerScaffold,
      ...novaPlan.answerScaffold,
    },
    challengePrompts: preferNovaScaffold
      ? (novaPlan.challengePrompts?.length ? novaPlan.challengePrompts : baselinePlan.challengePrompts)
      : (novaPlan.challengePrompts?.length || 0)
      ? novaPlan.challengePrompts
      : baselinePlan.challengePrompts,
    liveChallenge: novaPlan.liveChallenge || baselinePlan.liveChallenge || null,
    sourceEvidence: novaPlan.sourceEvidence || baselinePlan.sourceEvidence || null,
    experienceMode: preserveAnalytic ? baselinePlan.experienceMode : (novaPlan.experienceMode || baselinePlan.experienceMode || "builder"),
    analyticContext: preserveAnalytic ? baselinePlan.analyticContext : (novaPlan.analyticContext || baselinePlan.analyticContext || null),
    sceneMoments: preserveAnalytic ? baselinePlan.sceneMoments : (novaPlan.sceneMoments || baselinePlan.sceneMoments || []),
    sceneOverlays: preserveAnalytic ? baselinePlan.sceneOverlays : (novaPlan.sceneOverlays || baselinePlan.sceneOverlays || []),
    agentTrace: (novaPlan.agentTrace?.length || 0)
      ? novaPlan.agentTrace
      : baselinePlan.agentTrace,
    demoPreset: novaPlan.demoPreset || baselinePlan.demoPreset || null,
  });
}
