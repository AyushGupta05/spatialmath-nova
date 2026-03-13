import { converseNova, MODEL_IDS } from "../../middleware/bedrock.js";
import { SOURCE_SUMMARY_PROMPT } from "./prompts.js";
import { heuristicSourceSummary } from "./heuristics.js";
import { cleanupJson } from "./shared.js";

function contentBlocksForSource({ questionText = "", imageAsset = null }) {
  const blocks = [];
  const promptText = questionText.trim()
    ? `Question text:\n${questionText.trim()}`
    : "Question text: none provided. Infer the problem from the uploaded diagram.";
  blocks.push({ text: promptText });
  if (imageAsset) {
    blocks.push({
      image: {
        format: imageAsset.format,
        source: { bytes: imageAsset.bytes },
      },
    });
  }
  return blocks;
}

export async function interpretQuestionSource({ questionText = "", imageAsset = null }) {
  const fallback = heuristicSourceSummary({ questionText, imageAsset });
  if (!questionText.trim() && !imageAsset) {
    return fallback;
  }

  try {
    const text = await converseNova(MODEL_IDS.NOVA_PRO, SOURCE_SUMMARY_PROMPT, [
      {
        role: "user",
        content: contentBlocksForSource({ questionText, imageAsset }),
      },
    ], {
      maxTokens: 1200,
      temperature: 0.1,
    });

    return {
      ...fallback,
      ...JSON.parse(cleanupJson(text)),
    };
  } catch (error) {
    console.warn("Falling back to heuristic source summary:", error?.message || error);
    return fallback;
  }
}
