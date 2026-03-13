import { normalizeScenePlan } from "../../../src/ai/planSchema.js";

export function mergeGeneratedPlan({ baselinePlan, novaPlan, workingQuestion, mode }) {
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
    objectSuggestions: (novaPlan.objectSuggestions?.length || 0) >= baselinePlan.objectSuggestions.length
      ? novaPlan.objectSuggestions
      : baselinePlan.objectSuggestions,
    buildSteps: (novaPlan.buildSteps?.length || 0) >= baselinePlan.buildSteps.length
      ? novaPlan.buildSteps
      : baselinePlan.buildSteps,
    cameraBookmarks: (novaPlan.cameraBookmarks?.length || 0)
      ? novaPlan.cameraBookmarks
      : baselinePlan.cameraBookmarks,
    answerScaffold: {
      ...baselinePlan.answerScaffold,
      ...novaPlan.answerScaffold,
    },
    challengePrompts: (novaPlan.challengePrompts?.length || 0)
      ? novaPlan.challengePrompts
      : baselinePlan.challengePrompts,
    liveChallenge: novaPlan.liveChallenge || baselinePlan.liveChallenge || null,
    sourceEvidence: novaPlan.sourceEvidence || baselinePlan.sourceEvidence || null,
    agentTrace: (novaPlan.agentTrace?.length || 0)
      ? novaPlan.agentTrace
      : baselinePlan.agentTrace,
    demoPreset: novaPlan.demoPreset || baselinePlan.demoPreset || null,
  });
}
