import { randomUUID } from "node:crypto";
import { evaluateBuild } from "./buildEvaluator.js";
import { buildTutorSystemPrompt, buildFallbackTutorReply } from "./tutorPrompt.js";

export const OUTPUT_SAMPLE_RATE = 24000;
export const INPUT_SAMPLE_RATE = 16000;
export const DEFAULT_VOICE_ID = "matthew";
const conversationSessions = new Map();

export function getVoiceConversationSession(conversationId = null) {
  const id = conversationId || randomUUID();
  if (!conversationSessions.has(id)) {
    conversationSessions.set(id, { id, history: [] });
  }
  return conversationSessions.get(id);
}

export function recentVoiceHistory(session) {
  return (session?.history || []).slice(-6);
}

export function normalizeVoiceHistoryForRealtime(history = []) {
  const normalized = recentVoiceHistory({ history })
    .map((entry) => ({
      role: String(entry?.role || "").trim().toLowerCase(),
      content: String(entry?.content || "").trim(),
    }))
    .filter((entry) => entry.content && (entry.role === "user" || entry.role === "assistant"));

  while (normalized.length && normalized[0].role !== "user") {
    normalized.shift();
  }

  return normalized;
}

export function decodeBase64Audio(audioBase64 = "") {
  return Buffer.from(String(audioBase64 || ""), "base64");
}

export function chunkBuffer(buffer, size = 16384) {
  const chunks = [];
  for (let offset = 0; offset < buffer.length; offset += size) {
    chunks.push(buffer.subarray(offset, Math.min(offset + size, buffer.length)));
  }
  return chunks;
}

export function pcmToWavBuffer(pcmBuffer, sampleRate = OUTPUT_SAMPLE_RATE, channelCount = 1, bitsPerSample = 16) {
  const blockAlign = (channelCount * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channelCount, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([header, pcmBuffer]);
}

export function buildNarrationPrompt() {
  return `You are Nova Prism, narrating in the style of 3Blue1Brown.

Read the provided text aloud with these qualities:
- Warm, curious, and unhurried. Like thinking alongside a friend.
- Pause slightly before key insights to let them land.
- Read formulas naturally: "pi r squared" not "pi times r to the power of two."
- Keep a sense of wonder. Even simple ideas deserve a moment of appreciation.
- Do not add filler. Be concise but never rushed.`;
}

export function buildVoiceCoachPrompt(context = {}, session) {
  if (!context?.plan || !context?.sceneSnapshot) {
    return `You are Nova Prism, a spoken spatial-maths tutor in the style of 3Blue1Brown.
- Speak warmly and curiously, like you're exploring an idea together.
- Keep replies to 1-2 short sentences. Ask one guiding question.
- Never give the answer directly. Point to what's in the scene and ask what they notice.
- Reference specific shapes and measurements by name.`;
  }

  const assessment = evaluateBuild(context.plan, context.sceneSnapshot, context.contextStepId || null);
  const basePrompt = buildTutorSystemPrompt({
    plan: context.plan,
    sceneSnapshot: context.sceneSnapshot,
    sceneContext: context.sceneContext || null,
    learningState: context.learningState || {},
    contextStepId: context.contextStepId || null,
    assessment,
  });
  const historyText = recentVoiceHistory(session)
    .map((entry) => `${entry.role}: ${entry.content}`)
    .join("\n");

  return `${basePrompt}

Voice style (3Blue1Brown-inspired):
- You are speaking out loud. Be natural, warm, and conversational.
- Guide with questions, not answers. "What do you think happens when..." or "Notice how..."
- Never dump a full solution. Give the smallest nudge that moves understanding forward.
- If the learner asks for the answer directly, say: "Let's work through it. Look at the scene..."
- One idea per reply. Let the scene do the heavy lifting.
- Recent voice conversation:
${historyText || "No prior voice turns."}`;
}

export function buildVoiceFallback({ text, context, userMessage }) {
  if (context?.plan && context?.sceneSnapshot) {
    const assessment = evaluateBuild(context.plan, context.sceneSnapshot, context.contextStepId || null);
    return buildFallbackTutorReply({
      plan: context.plan,
      assessment,
      sceneContext: context.sceneContext || null,
      userMessage: userMessage || text || "Voice request",
      contextStepId: context.contextStepId || null,
    });
  }
  return String(text || "Nova Prism voice is unavailable right now. Try a typed follow-up.");
}

function outputConfiguration(playbackMode, voiceId) {
  const normalizedVoiceId = String(voiceId || "").trim();
  const resolvedVoiceId = normalizedVoiceId || DEFAULT_VOICE_ID;
  const configuration = {
    textOutputConfiguration: {
      mediaType: "text/plain",
    },
    // Nova Sonic requires audio output to be configured for bidirectional chat,
    // even when the client plans to ignore speculative audio and captions-only UI.
    audioOutputConfiguration: {
      mediaType: "audio/lpcm",
      sampleRateHertz: OUTPUT_SAMPLE_RATE,
      sampleSizeBits: 16,
      channelCount: 1,
      encoding: "base64",
      audioType: "SPEECH",
      voiceId: resolvedVoiceId,
    },
  };
  return configuration;
}

function asConversationRole(role = "") {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "assistant") return "ASSISTANT";
  if (normalized === "system") return "SYSTEM";
  return "USER";
}

export function buildConversationPreambleEvents({
  promptName,
  systemPrompt,
  history = [],
  playbackMode = "auto",
  voiceId = null,
  temperature = 0.3,
}) {
  const events = [
    {
      event: {
        sessionStart: {
          inferenceConfiguration: {
            maxTokens: 700,
            temperature,
            topP: 0.9,
          },
        },
      },
    },
    {
      event: {
        promptStart: {
          promptName,
          ...outputConfiguration(playbackMode, voiceId),
        },
      },
    },
  ];

  if (systemPrompt) {
    events.push(...buildTextContentEvents({
      promptName,
      contentName: "system_context",
      role: "SYSTEM",
      text: systemPrompt,
      interactive: false,
    }));
  }

  normalizeVoiceHistoryForRealtime(history).forEach((entry, index) => {
    const text = String(entry?.content || "").trim();
    if (!text) return;
    events.push(...buildTextContentEvents({
      promptName,
      contentName: `history_${index}`,
      role: asConversationRole(entry.role),
      text,
      interactive: false,
    }));
  });

  return events;
}

export function buildTextContentEvents({
  promptName,
  contentName,
  role = "USER",
  text,
  interactive = true,
}) {
  return [
    {
      event: {
        contentStart: {
          promptName,
          contentName,
          type: "TEXT",
          interactive,
          role,
          textInputConfiguration: {
            mediaType: "text/plain",
          },
        },
      },
    },
    {
      event: {
        textInput: {
          promptName,
          contentName,
          content: String(text || ""),
        },
      },
    },
    {
      event: {
        contentEnd: {
          promptName,
          contentName,
        },
      },
    },
  ];
}

export function buildAudioContentStartEvent({
  promptName,
  contentName,
}) {
  return {
    event: {
      contentStart: {
        promptName,
        contentName,
        type: "AUDIO",
        interactive: true,
        role: "USER",
        audioInputConfiguration: {
          mediaType: "audio/lpcm",
          sampleRateHertz: INPUT_SAMPLE_RATE,
          sampleSizeBits: 16,
          channelCount: 1,
          audioType: "SPEECH",
          encoding: "base64",
        },
      },
    },
  };
}

export function buildAudioChunkEvent({
  promptName,
  contentName,
  audioBase64,
}) {
  return {
    event: {
      audioInput: {
        promptName,
        contentName,
        content: audioBase64,
      },
    },
  };
}

export function buildPromptEndEvents({
  promptName,
  contentName,
  includeContentEnd = false,
}) {
  const events = [];
  if (includeContentEnd && contentName) {
    events.push({
      event: {
        contentEnd: {
          promptName,
          contentName,
        },
      },
    });
  }
  events.push({
    event: {
      promptEnd: {
        promptName,
      },
    },
  });
  return events;
}

export function buildSonicTurnEvents({
  systemPrompt,
  text = "",
  audioBuffer = null,
  playbackMode = "auto",
  voiceId = null,
  history = [],
}) {
  const promptName = `voice_turn_${randomUUID()}`;
  const contentName = audioBuffer?.length ? "voice_input" : "text_input";
  const events = buildConversationPreambleEvents({
    promptName,
    systemPrompt,
    history,
    playbackMode,
    voiceId,
    temperature: text && !audioBuffer ? 0.15 : 0.3,
  });

  if (audioBuffer?.length) {
    events.push(buildAudioContentStartEvent({ promptName, contentName }));
    for (const chunk of chunkBuffer(audioBuffer)) {
      events.push(buildAudioChunkEvent({
        promptName,
        contentName,
        audioBase64: chunk.toString("base64"),
      }));
    }
  } else {
    events.push(...buildTextContentEvents({
      promptName,
      contentName,
      role: "USER",
      text,
      interactive: true,
    }));
  }

  events.push(...buildPromptEndEvents({
    promptName,
    contentName,
    includeContentEnd: Boolean(audioBuffer?.length),
  }));
  return events;
}

function normalizeVoiceEvent(rawEvent) {
  return rawEvent?.event || rawEvent || {};
}

function parseAdditionalModelFields(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  if (typeof value !== "string") return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function eventContentMeta(state, contentId) {
  return state.contentMeta.get(contentId) || {
    role: "ASSISTANT",
    type: "TEXT",
    generationStage: "FINAL",
  };
}

function isInterruptedMarker(text = "") {
  return String(text || "").replace(/\s+/g, "").toLowerCase() === "{\"interrupted\":true}";
}

function audioBase64FromEvent(audioOutput = {}) {
  const audioValue = audioOutput.content || audioOutput.audio || audioOutput.bytes || null;
  if (typeof audioValue === "string") {
    return audioValue;
  }
  if (Array.isArray(audioValue)) {
    return Buffer.from(audioValue).toString("base64");
  }
  return null;
}

export function createVoiceEventState() {
  return {
    contentMeta: new Map(),
    inputTranscript: "",
    assistantSpeculativeText: "",
    assistantFinalText: "",
  };
}

export function extractVoiceStreamDelta(rawEvent, state = createVoiceEventState()) {
  const event = normalizeVoiceEvent(rawEvent);

  if (event.contentStart?.contentId) {
    const metadata = parseAdditionalModelFields(event.contentStart.additionalModelFields);
    const generationStage = String(metadata.generationStage || metadata.stage || "FINAL").toUpperCase();
    state.contentMeta.set(event.contentStart.contentId, {
      role: String(event.contentStart.role || "ASSISTANT").toUpperCase(),
      type: String(event.contentStart.type || "TEXT").toUpperCase(),
      generationStage,
    });
    return {
      type: "content_start",
      contentId: event.contentStart.contentId,
      role: String(event.contentStart.role || "ASSISTANT").toUpperCase(),
      contentType: String(event.contentStart.type || "TEXT").toUpperCase(),
      generationStage,
    };
  }

  if (event.contentEnd?.contentId) {
    return {
      type: "content_end",
      contentId: event.contentEnd.contentId,
    };
  }

  const textEvent = event.textOutput || event.transcriptEvent || event.inputTranscriptEvent || null;
  if (textEvent) {
    const contentId = textEvent.contentId || textEvent.contentName || "legacy_text";
    const content = textEvent.content || textEvent.text || "";
    if (content) {
      const meta = eventContentMeta(state, contentId);
      if (meta.role === "USER") {
        state.inputTranscript += content;
        return {
          type: "input_transcript",
          delta: content,
          content: state.inputTranscript,
          generationStage: meta.generationStage,
        };
      }

      if (meta.generationStage === "FINAL") {
        if (isInterruptedMarker(content)) {
          return null;
        }
        state.assistantFinalText += content;
        return {
          type: "assistant_text",
          delta: content,
          content: state.assistantFinalText,
          generationStage: "FINAL",
        };
      }

      state.assistantSpeculativeText += content;
      return {
        type: "assistant_text",
        delta: content,
        content: state.assistantSpeculativeText,
        generationStage: meta.generationStage,
      };
    }
  }

  if (event.audioOutput) {
    const audioBase64 = audioBase64FromEvent(event.audioOutput);
    if (audioBase64) {
      const meta = event.audioOutput.contentId
        ? eventContentMeta(state, event.audioOutput.contentId)
        : { generationStage: "FINAL" };
      return {
        type: "assistant_audio",
        audioBase64,
        generationStage: meta.generationStage || "FINAL",
        sampleRateHertz: Number(event.audioOutput.sampleRateHertz || OUTPUT_SAMPLE_RATE),
      };
    }
  }

  return null;
}

export function collectVoiceOutputs(events = []) {
  const state = createVoiceEventState();
  const audioChunks = [];

  for (const rawEvent of events) {
    const delta = extractVoiceStreamDelta(rawEvent, state);
    if (delta?.type === "assistant_audio" && delta.audioBase64) {
      audioChunks.push(Buffer.from(delta.audioBase64, "base64"));
    }
  }

  return {
    assistantText: state.assistantFinalText.trim() || state.assistantSpeculativeText.trim(),
    inputTranscript: state.inputTranscript.trim(),
    audioBuffer: audioChunks.length ? Buffer.concat(audioChunks) : null,
  };
}
