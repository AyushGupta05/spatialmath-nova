import { converseNova, MODEL_IDS } from "../../middleware/bedrock.js";
import { normalizeScenePlan } from "../../../src/ai/planSchema.js";
import { PLAN_SYSTEM_PROMPT } from "./prompts.js";
import { cleanupJson } from "./shared.js";
import { resolveModelId } from "../modelRouter.js";

export async function planFromNova({ questionText, mode, sceneSnapshot, sourceSummary, exemplar = null }) {
  const text = await converseNova(resolveModelId("text") || MODEL_IDS.NOVA_PRO, PLAN_SYSTEM_PROMPT, [
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

  return normalizeScenePlan(JSON.parse(cleanupJson(text)));
}
