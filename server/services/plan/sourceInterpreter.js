import { converseNova, MODEL_IDS } from "../../middleware/bedrock.js";
import { SOURCE_SUMMARY_PROMPT } from "./prompts.js";
import { heuristicSourceSummary } from "./heuristics.js";
import { cleanupJson } from "./shared.js";
import { resolveModelId } from "../modelRouter.js";

export function contentBlocksForSource({ questionText = "", imageAsset = null }) {
  const blocks = [];
  if (imageAsset) {
    blocks.push({
      image: {
        format: imageAsset.format,
        source: { bytes: imageAsset.bytes },
      },
    });
  }
  const promptText = questionText.trim()
    ? `Question text:\n${questionText.trim()}`
    : "Question text: none provided. Infer the problem from the uploaded diagram.";
  blocks.push({ text: promptText });
  return blocks;
}

export async function interpretQuestionSource({ questionText = "", imageAsset = null }) {
  const fallback = heuristicSourceSummary({ questionText, imageAsset });
  if (!questionText.trim() && !imageAsset) {
    return fallback;
  }

  try {
    const text = await converseNova(resolveModelId("text") || MODEL_IDS.NOVA_PRO, SOURCE_SUMMARY_PROMPT, [
      {
        role: "user",
        content: contentBlocksForSource({ questionText, imageAsset }),
      },
    ], {
      maxTokens: 1200,
      temperature: 0.1,
    });

    const parsed = JSON.parse(cleanupJson(text));
    return {
      ...fallback,
      ...parsed,
      conflicts: Array.isArray(parsed.conflicts)
        ? parsed.conflicts
        : fallback.conflicts,
    };
  } catch (error) {
    console.warn("Falling back to heuristic source summary:", error?.message || error);
    return fallback;
  }
}
