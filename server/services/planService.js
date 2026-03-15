import { heuristicPlan } from "./plan/heuristics.js";
import { interpretQuestionSource } from "./plan/sourceInterpreter.js";
import { planFromNova } from "./plan/novaPlan.js";
import { mergeGeneratedPlan } from "./plan/mergePlan.js";
import { buildSourceEvidence } from "./plan/sourceEvidence.js";
import { buildDemoPreset } from "./plan/demoPreset.js";
import { retrieveLessonExemplar } from "./plan/retrieval.js";
import { buildAnalyticPlan } from "./plan/analytic.js";
import { buildElectricFieldPlan } from "./plan/electricField.js";

export function buildAnalyticPlannerInput({ questionText = "", sourceSummary = {} }) {
  const rawQuestion = String(questionText || sourceSummary.rawQuestion || "").trim();
  const cleanedQuestion = String(sourceSummary.cleanedQuestion || "").trim();
  const givens = Array.isArray(sourceSummary.givens)
    ? sourceSummary.givens.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const relationships = Array.isArray(sourceSummary.relationships)
    ? sourceSummary.relationships.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const diagramSummary = String(sourceSummary.diagramSummary || "").trim();
  const analyticQuestion = rawQuestion || [
    cleanedQuestion,
    ...givens,
    diagramSummary,
    ...relationships,
  ].filter(Boolean).join(". ");

  if (!analyticQuestion) {
    return {
      questionText: "",
      sourceSummary,
    };
  }

  if (!rawQuestion) {
    return {
      questionText: analyticQuestion,
      sourceSummary,
    };
  }

  return {
    questionText: rawQuestion,
    sourceSummary: {
      ...sourceSummary,
      rawQuestion,
      cleanedQuestion: rawQuestion,
    },
  };
}

function buildAgentTrace({ sourceSummary, retrieval, usedNovaPlan, usedAnalyticPlan, usedElectricFieldPlan }) {
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
      label: usedElectricFieldPlan ? "Physics Planner" : usedAnalyticPlan ? "Analytic Solver" : "Lesson Planner",
      status: usedElectricFieldPlan ? "physics" : usedAnalyticPlan ? "deterministic" : usedNovaPlan ? "nova" : "fallback",
      summary: usedElectricFieldPlan
        ? "Used the focused electromagnetism planner for charged objects, live field flow, and flux intuition."
        : usedAnalyticPlan
        ? "Used the deterministic analytic geometry planner for reliable formulas, helpers, and scene beats."
        : usedNovaPlan
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
  let usedNovaPlan = false;
  const analyticInput = buildAnalyticPlannerInput({ questionText, sourceSummary });
  const electricFieldPlan = buildElectricFieldPlan(workingQuestion, sourceSummary);
  const analyticPlan = buildAnalyticPlan(analyticInput.questionText, analyticInput.sourceSummary);
  const usedElectricFieldPlan = Boolean(electricFieldPlan);
  const usedAnalyticPlan = Boolean(analyticPlan);
  const baselinePlan = electricFieldPlan || analyticPlan || heuristicPlan(workingQuestion, mode, sourceSummary);
  let mergedPlan = baselinePlan;

  if (!usedAnalyticPlan && !usedElectricFieldPlan) {
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
  }

  const effectiveSourceSummary = mergedPlan.sourceSummary || sourceSummary;
  const sourceEvidence = buildSourceEvidence(effectiveSourceSummary);
  const demoPreset = buildDemoPreset({
    plan: mergedPlan,
    sourceSummary: effectiveSourceSummary,
    exemplar: retrieval.exemplar,
  });
  const agentTrace = buildAgentTrace({
    sourceSummary: effectiveSourceSummary,
    retrieval,
    usedNovaPlan,
    usedAnalyticPlan,
    usedElectricFieldPlan,
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
