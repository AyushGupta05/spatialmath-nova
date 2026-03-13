import { heuristicPlan } from "./plan/heuristics.js";
import { interpretQuestionSource } from "./plan/sourceInterpreter.js";
import { planFromNova } from "./plan/novaPlan.js";
import { mergeGeneratedPlan } from "./plan/mergePlan.js";

export async function generateScenePlan({ questionText = "", imageAsset = null, mode = "guided", sceneSnapshot = null }) {
  const sourceSummary = await interpretQuestionSource({ questionText, imageAsset });
  const workingQuestion = (sourceSummary.cleanedQuestion || questionText || "").trim();
  const baselinePlan = heuristicPlan(workingQuestion, mode, sourceSummary);

  try {
    const novaPlan = await planFromNova({
      questionText: workingQuestion,
      mode,
      sceneSnapshot,
      sourceSummary,
    });

    return mergeGeneratedPlan({
      baselinePlan,
      novaPlan,
      workingQuestion,
      mode,
    });
  } catch (error) {
    console.warn("Falling back to heuristic scene plan:", error?.message || error);
    return baselinePlan;
  }
}
