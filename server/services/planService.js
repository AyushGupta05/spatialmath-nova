import { heuristicPlan } from "./plan/heuristics.js";
import { interpretQuestionSource } from "./plan/sourceInterpreter.js";
import { planFromNova } from "./plan/novaPlan.js";
import { mergeGeneratedPlan } from "./plan/mergePlan.js";
import { buildSourceEvidence } from "./plan/sourceEvidence.js";
import { buildDemoPreset } from "./plan/demoPreset.js";
import { retrieveLessonExemplar } from "./plan/retrieval.js";

function buildAgentTrace({ sourceSummary, retrieval, usedNovaPlan }) {
  return [
    {
      id: "source-interpreter",
      label: "Source Interpreter",
      status: sourceSummary?.inputMode === "image" || sourceSummary?.inputMode === "multimodal" ? "multimodal" : "ready",
      summary: sourceSummary?.diagramSummary
        ? `Parsed worksheet evidence: ${sourceSummary.diagramSummary}`
        : "Parsed the question text into givens and relationships.",
    },
    {
      id: "lesson-planner",
      label: "Lesson Planner",
      status: usedNovaPlan ? "nova" : "fallback",
      summary: usedNovaPlan
        ? "Used Nova planning with retrieval-informed lesson scaffolding."
        : "Used heuristic planning fallback to keep the lesson reliable.",
    },
    {
      id: "build-evaluator",
      label: "Build Evaluator",
      status: "ready",
      summary: "Will compare placed scene objects against required suggestions and guide the next step.",
    },
    {
      id: "tutor-coach",
      label: "Tutor Coach",
      status: "ready",
      summary: retrieval?.exemplar
        ? `Primed with the ${retrieval.exemplar.title.toLowerCase()} pattern for tutoring tone and demo framing.`
        : "Ready to coach the learner from the live scene state.",
    },
  ];
}

export async function generateScenePlan({ questionText = "", imageAsset = null, mode = "guided", sceneSnapshot = null }) {
  const sourceSummary = await interpretQuestionSource({ questionText, imageAsset });
  const workingQuestion = (sourceSummary.cleanedQuestion || questionText || "").trim();
  const retrieval = await retrieveLessonExemplar({ questionText: workingQuestion, sourceSummary });
  const baselinePlan = heuristicPlan(workingQuestion, mode, sourceSummary);
  let usedNovaPlan = false;
  let mergedPlan = baselinePlan;

  try {
    const novaPlan = await planFromNova({
      questionText: workingQuestion,
      mode,
      sceneSnapshot,
      sourceSummary,
      exemplar: retrieval.exemplar,
    });
    usedNovaPlan = true;

    mergedPlan = mergeGeneratedPlan({
      baselinePlan,
      novaPlan,
      workingQuestion,
      mode,
    });
  } catch (error) {
    console.warn("Falling back to heuristic scene plan:", error?.message || error);
  }

  const sourceEvidence = buildSourceEvidence(sourceSummary);
  const demoPreset = buildDemoPreset({
    plan: mergedPlan,
    sourceSummary,
    exemplar: retrieval.exemplar,
  });
  const agentTrace = buildAgentTrace({
    sourceSummary,
    retrieval,
    usedNovaPlan,
  });

  const scenePlan = {
    ...mergedPlan,
    sourceEvidence,
    agentTrace,
    demoPreset,
  };

  return {
    scenePlan,
    sourceEvidence,
    agentTrace,
    demoPreset,
    retrieval: {
      strategy: retrieval.strategy,
      score: retrieval.score,
      exemplarId: retrieval.exemplar?.id || null,
    },
  };
}
