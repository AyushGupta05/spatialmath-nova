import { normalizeScenePlan } from "../../../src/ai/planSchema.js";
import { PLAN_SYSTEM_PROMPT } from "./prompts.js";
import { cleanupJson } from "./shared.js";
import { converseWithModelFailover } from "../modelInvoker.js";
import { promoteNovaPlanToAnalyticAuto } from "./novaAnalyticAuto.js";

const PLAN_MAX_TOKEN_ATTEMPTS = [4096, 7000, 11000];
const PLAN_TEMPERATURE = 0;

function isRecoverablePlanParseError(error) {
  return error instanceof SyntaxError
    || /Unexpected token|Unterminated string|Expected/i.test(error?.message || "");
}

export async function planFromNova({ questionText, mode, sceneSnapshot, sourceSummary, exemplar = null }) {
  const messages = [
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
  ];

  let lastError = null;
  for (const maxTokens of PLAN_MAX_TOKEN_ATTEMPTS) {
    try {
      const text = await converseWithModelFailover("text", PLAN_SYSTEM_PROMPT, messages, {
        maxTokens,
        temperature: PLAN_TEMPERATURE,
      });
      const normalizedPlan = normalizeScenePlan(JSON.parse(cleanupJson(text)));
      return promoteNovaPlanToAnalyticAuto(normalizedPlan, {
        questionText,
        sourceSummary,
      });
    } catch (error) {
      lastError = error;
      if (!isRecoverablePlanParseError(error) || maxTokens === PLAN_MAX_TOKEN_ATTEMPTS[PLAN_MAX_TOKEN_ATTEMPTS.length - 1]) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Nova planning failed.");
}
