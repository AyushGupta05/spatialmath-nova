import { normalizeScenePlan } from "../../../src/ai/planSchema.js";
import { PLAN_SYSTEM_PROMPT } from "./prompts.js";
import { cleanupJson } from "./shared.js";
import { converseWithModelFailover } from "../modelInvoker.js";
import { promoteNovaPlanToAnalyticAuto } from "./novaAnalyticAuto.js";

export async function planFromNova({ questionText, mode, sceneSnapshot, sourceSummary, exemplar = null }) {
  const text = await converseWithModelFailover("text", PLAN_SYSTEM_PROMPT, [
    {
      role: "user",
      content: [{
        text: JSON.stringify({
          question: questionText,
          mode,
          sourceSummary,
          sceneSnapshot: sceneSnapshot || null,
          retrievedExemplar: exemplar
            ? {
              title: exemplar.title,
              summary: exemplar.summary,
              recommendedCategory: exemplar.recommendedCategory,
              scriptBeat: exemplar.scriptBeat,
            }
            : null,
        }),
      }],
    },
  ], {
    maxTokens: 4096,
    temperature: 0.15,
  });

  const normalizedPlan = normalizeScenePlan(JSON.parse(cleanupJson(text)));
  return promoteNovaPlanToAnalyticAuto(normalizedPlan, {
    questionText,
    sourceSummary,
  });
}
