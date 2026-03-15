import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import { buildSolutionRevealText, isExplicitSolutionRequest } from "../../src/core/tutorSolution.js";
import { evaluateBuild } from "./buildEvaluator.js";
import { evaluateConcept, isTrivialInteraction } from "./conceptEvaluator.js";
import { buildFallbackFreeformTurn, generateFreeformTutorTurn } from "./freeformTutor.js";
import { converseWithModelFailover } from "./modelInvoker.js";
import { evaluateTutorCompletion } from "./tutorCompletion.js";
import { buildTutorResponseMeta } from "./tutorMetadata.js";
import { buildTutorSystemPrompt, buildFallbackTutorReply } from "./tutorPrompt.js";
import {
  buildNarrationPrompt,
  buildVoiceCoachPrompt,
  buildVoiceFallback,
  chunkBuffer,
  DEFAULT_VOICE_ID,
  OUTPUT_SAMPLE_RATE,
} from "./voiceCommon.js";

const GENERIC_VOICE_REPLY_SYSTEM_PROMPT = `You are Nova Prism, a spoken spatial-maths tutor.
- Reply conversationally in 1-2 short sentences.
- Be warm, concrete, and easy to follow.
- Answer the user's question directly when you can.
- If helpful, end with one short follow-up question.`;

const SPOKEN_TUTOR_APPENDIX = `
Voice delivery rules:
- This reply will be spoken aloud.
- Use plain sentences only. No markdown, bullets, or numbered lists.
- Keep it brief: 1-2 short sentences, ideally under 35 words.
- Mention the most important visible clue or scene change in one clause.
- Ask at most one short question, and only if the learner still needs guidance.
- Never mention hidden system logic or internal evaluation.`;

let pollyClient = null;

function getPollyClient() {
  if (!pollyClient) {
    pollyClient = new PollyClient({
      region: process.env.AWS_REGION || "us-east-1",
      credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          sessionToken: process.env.AWS_SESSION_TOKEN || undefined,
        }
        : undefined,
    });
  }
  return pollyClient;
}

function normalizePollyVoiceId(voiceId = "") {
  const normalized = String(voiceId || "").trim();
  if (!normalized) return "Matthew";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
}

function buildVoiceReplySystemPrompt({ mode = "coach", context = null, session = null }) {
  if (mode === "narrate") {
    return buildNarrationPrompt();
  }
  if (context?.plan && context?.sceneSnapshot) {
    return `${buildTutorSystemPrompt({
      plan: context.plan,
      sceneSnapshot: context.sceneSnapshot,
      sceneContext: context.sceneContext || null,
      learningState: context.learningState || {},
      contextStepId: context.contextStepId || null,
      assessment: evaluateBuild(context.plan, context.sceneSnapshot, context.contextStepId || null),
      conceptVerdict: null,
    })}
${SPOKEN_TUTOR_APPENDIX}`;
  }
  if (context?.sceneSnapshot) {
    return `${buildVoiceCoachPrompt(context, session)}
${SPOKEN_TUTOR_APPENDIX}`;
  }
  return GENERIC_VOICE_REPLY_SYSTEM_PROMPT;
}

function normalizeHistoryMessages(history = [], userMessage = "") {
  const messages = [];
  for (const message of history.slice(-8)) {
    const role = message.role === "tutor" ? "assistant" : message.role;
    if (!["user", "assistant"].includes(role)) continue;
    const content = String(message.content || "").trim();
    if (!content) continue;
    if (messages.length && messages[messages.length - 1].role === role) continue;
    messages.push({ role, content: [{ text: content }] });
  }

  while (messages.length && messages[0].role !== "user") {
    messages.shift();
  }

  const normalizedUserMessage = String(userMessage || "").trim();
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    messages.push({ role: "user", content: [{ text: normalizedUserMessage }] });
  } else {
    messages[messages.length - 1] = { role: "user", content: [{ text: normalizedUserMessage }] };
  }
  return messages;
}

function stripMarkdownForSpeech(text = "") {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^\s*[-*•]+\s*/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function condenseForSpeech(text = "", { maxSentences = 2, maxChars = 180 } = {}) {
  const normalized = stripMarkdownForSpeech(text);
  if (!normalized) return "";
  const sentences = normalized.match(/[^.!?]+[.!?]?/g) || [normalized];
  let spoken = sentences.slice(0, maxSentences).join(" ").trim() || normalized;
  if (spoken.length > maxChars) {
    spoken = `${spoken.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
  }
  return spoken;
}

function voiceMetaShape(meta = null) {
  return {
    actions: Array.isArray(meta?.actions) ? meta.actions : [],
    focusTargets: Array.isArray(meta?.focusTargets) ? meta.focusTargets : [],
    checkpoint: meta?.checkpoint || null,
    stageStatus: meta?.stageStatus || null,
    completionState: meta?.completionState || null,
    sceneDirective: meta?.sceneDirective || null,
    sceneCommand: meta?.sceneCommand || null,
  };
}

async function synthesizeAssistantAudio({ assistantText = "", voiceId = null }) {
  try {
    const pollyResponse = await getPollyClient().send(new SynthesizeSpeechCommand({
      Engine: "neural",
      OutputFormat: "pcm",
      SampleRate: String(OUTPUT_SAMPLE_RATE),
      Text: assistantText,
      TextType: "text",
      VoiceId: normalizePollyVoiceId(voiceId || DEFAULT_VOICE_ID),
    }));
    const audioBuffer = Buffer.from(await pollyResponse.AudioStream.transformToByteArray());
    return {
      audioChunks: chunkBuffer(audioBuffer).map((chunk) => chunk.toString("base64")),
      sampleRateHertz: OUTPUT_SAMPLE_RATE,
      audioFallbackUsed: false,
    };
  } catch (error) {
    console.warn("Voice audio fallback:", error?.message || error);
    return {
      audioChunks: [],
      sampleRateHertz: OUTPUT_SAMPLE_RATE,
      audioFallbackUsed: true,
    };
  }
}

async function generateFreeformVoiceReply({
  sceneSnapshot,
  sceneContext = null,
  learningState = {},
  userMessage = "",
}) {
  let turn;
  let fallbackUsed = false;
  try {
    turn = await generateFreeformTutorTurn({
      sceneSnapshot,
      sceneContext,
      learningState,
      userMessage,
    });
  } catch (error) {
    console.warn("Voice freeform fallback:", error?.message || error);
    turn = buildFallbackFreeformTurn({
      sceneSnapshot,
      sceneContext,
      userMessage,
    });
    fallbackUsed = true;
  }

  return {
    assistantText: condenseForSpeech(turn?.text || "Tell me what you'd like to build next."),
    source: fallbackUsed ? "voice-freeform-fallback" : "voice-freeform",
    fallbackUsed,
    assessment: null,
    conceptVerdict: null,
    ...voiceMetaShape(turn?.meta),
  };
}

async function generateGuidedVoiceReply({
  plan,
  sceneSnapshot,
  sceneContext = null,
  learningState = {},
  contextStepId = null,
  userMessage = "",
}) {
  const assessment = evaluateBuild(plan, sceneSnapshot, contextStepId);
  const revealSolution = isExplicitSolutionRequest(userMessage);
  const numericCompletion = revealSolution
    ? { complete: true, reason: "revealed-solution" }
    : evaluateTutorCompletion({ plan, userMessage });

  let conceptVerdict = null;
  if (numericCompletion.complete) {
    conceptVerdict = {
      verdict: "CORRECT",
      confidence: 1,
      what_was_right: "Correct answer",
      gap: null,
      misconception_type: null,
      scene_cue: null,
      tutor_tone: "encouraging",
    };
  } else if (!revealSolution && !isTrivialInteraction(learningState?.learningStage, userMessage)) {
    const currentStep = plan.buildSteps?.find((step) => step.id === contextStepId)
      || plan.buildSteps?.[learningState?.currentStep || 0];
    const stageGoal = currentStep?.focusConcept
      || plan.sceneFocus?.primaryInsight
      || plan.learningMoments?.[learningState?.learningStage]?.goal
      || "";
    try {
      conceptVerdict = await evaluateConcept({
        stageGoal,
        learnerInput: userMessage,
        lessonContext: { plan, assessment },
        prediction: learningState?.predictionState?.response || "",
        learnerHistory: learningState?.learnerHistory || [],
      });
    } catch (error) {
      console.error("Voice concept evaluation failed:", error);
      conceptVerdict = null;
    }
  }

  const completionState = numericCompletion.complete
    ? numericCompletion
    : conceptVerdict?.verdict === "CORRECT"
      ? { complete: true, reason: "correct-answer" }
      : { complete: false, reason: null };

  const meta = buildTutorResponseMeta({
    plan,
    learningState,
    contextStepId,
    assessment,
    completionState,
    userMessage,
    conceptVerdict,
  });

  let assistantText = "";
  let fallbackUsed = false;

  if (revealSolution) {
    assistantText = condenseForSpeech(
      buildSolutionRevealText(plan) || "I've opened the full solution. Follow the highlighted scene as you work through it."
    );
  } else {
    try {
      assistantText = await converseWithModelFailover(
        "text",
        `${buildTutorSystemPrompt({
          plan,
          sceneSnapshot,
          sceneContext,
          learningState,
          contextStepId,
          assessment,
          conceptVerdict,
        })}
${SPOKEN_TUTOR_APPENDIX}`,
        normalizeHistoryMessages(learningState?.history || [], userMessage),
        {
          maxTokens: 180,
          temperature: 0.25,
        }
      );
    } catch (error) {
      console.warn("Voice guided text fallback:", error?.message || error);
      fallbackUsed = true;
      assistantText = buildFallbackTutorReply({
        plan,
        assessment,
        sceneContext,
        userMessage,
        contextStepId,
      });
    }
  }

  return {
    assistantText: condenseForSpeech(assistantText),
    source: fallbackUsed ? "voice-guided-fallback" : "voice-guided",
    fallbackUsed,
    assessment,
    conceptVerdict,
    ...voiceMetaShape(meta),
  };
}

async function generateCoachVoiceReply({
  context = null,
  session = null,
  inputTranscript = "",
}) {
  const userMessage = String(inputTranscript || "").trim();
  if (!userMessage) {
    return null;
  }

  if (!context?.sceneSnapshot) {
    return {
      assistantText: condenseForSpeech(buildVoiceFallback({
        text: userMessage,
        context,
        userMessage,
      })),
      source: "voice-generic-fallback",
      fallbackUsed: true,
      assessment: null,
      conceptVerdict: null,
      ...voiceMetaShape(null),
    };
  }

  if (!context?.plan) {
    return generateFreeformVoiceReply({
      sceneSnapshot: context.sceneSnapshot,
      sceneContext: context.sceneContext || null,
      learningState: context.learningState || {},
      userMessage,
    });
  }

  return generateGuidedVoiceReply({
    plan: context.plan,
    sceneSnapshot: context.sceneSnapshot,
    sceneContext: context.sceneContext || null,
    learningState: context.learningState || {},
    contextStepId: context.contextStepId || null,
    userMessage,
    session,
  });
}

export async function generateRecoveredVoiceReply({
  inputTranscript = "",
  assistantTextOverride = "",
  mode = "coach",
  context = null,
  session = null,
  voiceId = null,
}) {
  const userMessage = String(inputTranscript || "").trim();
  const overriddenAssistantText = String(assistantTextOverride || "").trim();
  if (!userMessage && !overriddenAssistantText) return null;

  if (mode === "coach") {
    const structuredReply = await generateCoachVoiceReply({
      context,
      session,
      inputTranscript: userMessage,
    });
    if (!structuredReply?.assistantText) {
      return null;
    }

    const audio = await synthesizeAssistantAudio({
      assistantText: structuredReply.assistantText,
      voiceId,
    });

    return {
      assistantText: structuredReply.assistantText,
      audioChunks: audio.audioChunks,
      sampleRateHertz: audio.sampleRateHertz,
      source: structuredReply.source,
      fallbackUsed: Boolean(structuredReply.fallbackUsed || audio.audioFallbackUsed),
      actions: structuredReply.actions,
      focusTargets: structuredReply.focusTargets,
      checkpoint: structuredReply.checkpoint,
      stageStatus: structuredReply.stageStatus,
      completionState: structuredReply.completionState,
      sceneDirective: structuredReply.sceneDirective,
      sceneCommand: structuredReply.sceneCommand,
      assessment: structuredReply.assessment,
      conceptVerdict: structuredReply.conceptVerdict,
    };
  }

  const fallbackText = buildVoiceFallback({
    text: userMessage,
    context,
    userMessage,
  });

  let assistantText = overriddenAssistantText || fallbackText;
  let fallbackUsed = !overriddenAssistantText;
  if (!overriddenAssistantText) {
    try {
      assistantText = await converseWithModelFailover(
        "text",
        buildVoiceReplySystemPrompt({ mode, context, session }),
        [{ role: "user", content: [{ text: userMessage }] }],
        {
          maxTokens: 220,
          temperature: 0.35,
        }
      );
      fallbackUsed = false;
    } catch (error) {
      console.warn("Voice text fallback:", error?.message || error);
    }
  }

  const audio = await synthesizeAssistantAudio({
    assistantText,
    voiceId,
  });
  return {
    assistantText,
    audioChunks: audio.audioChunks,
    sampleRateHertz: audio.sampleRateHertz,
    source: audio.audioFallbackUsed ? "text-fallback" : "text-polly-fallback",
    fallbackUsed: Boolean(fallbackUsed || audio.audioFallbackUsed),
  };
}
