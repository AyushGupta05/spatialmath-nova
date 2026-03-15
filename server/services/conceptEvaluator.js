import { converseWithModelFailover } from "./modelInvoker.js";
import { cleanupJson } from "./plan/shared.js";

const MATH_TOKEN_HINT = /[$\\]|[_^]|\d/;

const EVALUATION_SYSTEM_PROMPT = `You are an evaluation engine for a spatial math tutor.
Given a learner's response to a stage goal, classify it
into exactly one of: CORRECT, PARTIAL, or STUCK.

Rules:
- CORRECT: captures the core idea, even if imprecise language
- PARTIAL: right direction but missing a key component
- STUCK: confused, off-topic, or asks for the answer directly
- Never penalise creative phrasing of correct ideas
- Never mark CORRECT if a core misconception is present

You must respond ONLY with valid JSON. No preamble.`;

const FALLBACK_VERDICT = {
  verdict: "PARTIAL",
  confidence: 0.5,
  what_was_right: "",
  gap: "",
  misconception_type: null,
  scene_cue: null,
  tutor_tone: "encouraging",
};

export function isTrivialInteraction(learningStage, userMessage) {
  if (learningStage === "orient") return true;

  const text = String(userMessage || "").trim();
  if (learningStage === "build") {
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount < 10 && !MATH_TOKEN_HINT.test(text)) {
      return true;
    }
  }

  return false;
}

function summarizeLearnerHistory(history = []) {
  if (!history.length) return "None";
  return history
    .slice(-4)
    .map((entry) => `Stage ${entry.stage}: verdict=${entry.verdict}${entry.gap ? `, gap="${entry.gap}"` : ""}`)
    .join("; ");
}

function buildEvaluationMessage({ stageGoal, learnerInput, prediction, learnerHistory }) {
  return [
    `Stage goal: "${stageGoal}"`,
    `Learner's prediction: "${prediction || "none"}"`,
    `Learner's response: "${learnerInput}"`,
    `Previous interactions: ${summarizeLearnerHistory(learnerHistory)}`,
    "",
    "Return JSON:",
    `{`,
    `  "verdict": "CORRECT" | "PARTIAL" | "STUCK",`,
    `  "confidence": <number 0-1>,`,
    `  "what_was_right": "<string>",`,
    `  "gap": "<string or null>",`,
    `  "misconception_type": "<string or null>",`,
    `  "scene_cue": "<string or null>",`,
    `  "tutor_tone": "encouraging" | "redirecting" | "supportive"`,
    `}`,
  ].join("\n");
}

function normalizeVerdict(parsed = {}) {
  const verdict = ["CORRECT", "PARTIAL", "STUCK"].includes(parsed.verdict)
    ? parsed.verdict
    : "PARTIAL";
  const confidence = typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0.5;

  const effective = verdict === "CORRECT" && confidence < 0.65
    ? "PARTIAL"
    : verdict;

  return {
    verdict: effective,
    confidence,
    what_was_right: String(parsed.what_was_right || ""),
    gap: parsed.gap || null,
    misconception_type: parsed.misconception_type || null,
    scene_cue: parsed.scene_cue || null,
    tutor_tone: parsed.tutor_tone || "encouraging",
  };
}

export async function evaluateConcept(
  { stageGoal, learnerInput, lessonContext: _lessonContext, prediction, learnerHistory },
  deps = {},
) {
  const converse = deps.converseWithModelFailover || converseWithModelFailover;

  const userText = buildEvaluationMessage({
    stageGoal,
    learnerInput,
    prediction,
    learnerHistory,
  });

  const messages = [{ role: "user", content: [{ text: userText }] }];

  try {
    const raw = await converse("text", EVALUATION_SYSTEM_PROMPT, messages, {
      maxTokens: 512,
      temperature: 0.1,
    });
    const parsed = JSON.parse(cleanupJson(raw));
    return normalizeVerdict(parsed);
  } catch (error) {
    console.error("Concept evaluation parse/call error:", error?.message || error);
    return { ...FALLBACK_VERDICT };
  }
}
