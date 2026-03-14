import { randomUUID } from "node:crypto";
import { invokeBidirectionalStream } from "../middleware/bedrock.js";
import { evaluateBuild } from "./buildEvaluator.js";
import { buildTutorSystemPrompt, buildFallbackTutorReply } from "./tutorPrompt.js";
import { getCapabilitySnapshot, hasAwsCredentials, resolveModelId } from "./modelRouter.js";

const OUTPUT_SAMPLE_RATE = 24000;
const sessions = new Map();

function getSession(conversationId = null) {
  const id = conversationId || randomUUID();
  if (!sessions.has(id)) {
    sessions.set(id, { id, history: [] });
  }
  return sessions.get(id);
}

function recentHistory(session) {
  return (session?.history || []).slice(-6);
}

function chunkBuffer(buffer, size = 16384) {
  const chunks = [];
  for (let offset = 0; offset < buffer.length; offset += size) {
    chunks.push(buffer.subarray(offset, Math.min(offset + size, buffer.length)));
  }
  return chunks;
}

function decodeBase64Audio(audioBase64 = "") {
  return Buffer.from(String(audioBase64 || ""), "base64");
}

function pcmToWavBuffer(pcmBuffer, sampleRate = OUTPUT_SAMPLE_RATE, channelCount = 1, bitsPerSample = 16) {
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

function buildNarrationPrompt() {
  return `You are Nova Prism, narrating in the style of 3Blue1Brown.

Read the provided text aloud with these qualities:
- Warm, curious, and unhurried. Like thinking alongside a friend.
- Pause slightly before key insights to let them land.
- Read formulas naturally: "pi r squared" not "pi times r to the power of two."
- Keep a sense of wonder. Even simple ideas deserve a moment of appreciation.
- Do not add filler. Be concise but never rushed.`;
}

function buildVoiceCoachPrompt(context = {}, session) {
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
  const historyText = recentHistory(session)
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

function buildVoiceFallback({ text, context, userMessage }) {
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

function buildOutputModalities(playbackMode, voiceId) {
  if (playbackMode === "caption_only") {
    return { text: {} };
  }
  return {
    text: {},
    audio: {
      mediaType: "audio/lpcm",
      sampleRateHertz: OUTPUT_SAMPLE_RATE,
      sampleSizeBits: 16,
      channelCount: 1,
      ...(voiceId ? { voiceId } : {}),
    },
  };
}

function buildSonicEvents({ systemPrompt, text, audioBuffer, playbackMode, voiceId }) {
  const promptName = "user_turn";
  const contentName = audioBuffer?.length ? "voice_input" : "text_input";
  const events = [
    {
      event: {
        sessionStart: {
          inferenceConfiguration: {
            maxTokens: 700,
            temperature: text && !audioBuffer ? 0.15 : 0.3,
            topP: 0.9,
          },
          outputModalities: buildOutputModalities(playbackMode, voiceId),
        },
      },
    },
    {
      event: {
        promptStart: {
          promptName,
          textOutputConfiguration: { mediaType: "text/plain" },
        },
      },
    },
    {
      event: {
        contentStart: {
          promptName,
          contentName,
          type: audioBuffer?.length ? "AUDIO" : "TEXT",
          interactive: true,
          role: "USER",
          ...(audioBuffer?.length
            ? {
              audioInputConfiguration: {
                mediaType: "audio/lpcm",
                sampleRateHertz: 16000,
                sampleSizeBits: 16,
                channelCount: 1,
              },
            }
            : {}),
        },
      },
    },
  ];

  if (audioBuffer?.length) {
    for (const chunk of chunkBuffer(audioBuffer)) {
      events.push({
        event: {
          audioInput: {
            promptName,
            contentName,
            content: chunk.toString("base64"),
          },
        },
      });
    }
  } else {
    events.push({
      event: {
        textInput: {
          promptName,
          contentName,
          content: String(text || ""),
        },
      },
    });
  }

  events.push(
    {
      event: {
        contentEnd: {
          promptName,
          contentName,
        },
      },
    },
    {
      event: {
        promptEnd: {
          promptName,
        },
      },
    },
    {
      event: {
        sessionEnd: {},
      },
    }
  );

  if (systemPrompt) {
    events.splice(1, 0, {
      event: {
        promptStart: {
          promptName: "system_context",
          textOutputConfiguration: { mediaType: "text/plain" },
        },
      },
    }, {
      event: {
        contentStart: {
          promptName: "system_context",
          contentName: "system_text",
          type: "TEXT",
          interactive: false,
          role: "SYSTEM",
        },
      },
    }, {
      event: {
        textInput: {
          promptName: "system_context",
          contentName: "system_text",
          content: systemPrompt,
        },
      },
    }, {
      event: {
        contentEnd: {
          promptName: "system_context",
          contentName: "system_text",
        },
      },
    }, {
      event: {
        promptEnd: {
          promptName: "system_context",
        },
      },
    });
  }

  return events;
}

function parseVoiceEvents(events = []) {
  let assistantText = "";
  let inputTranscript = "";
  const audioChunks = [];

  for (const rawEvent of events) {
    const event = rawEvent?.event || rawEvent || {};
    if (typeof event.textOutput?.content === "string") {
      assistantText += event.textOutput.content;
    } else if (typeof event.textOutput?.text === "string") {
      assistantText += event.textOutput.text;
    }

    if (typeof event.transcriptEvent?.content === "string") {
      inputTranscript += event.transcriptEvent.content;
    } else if (typeof event.inputTranscriptEvent?.content === "string") {
      inputTranscript += event.inputTranscriptEvent.content;
    }

    const audioValue = event.audioOutput?.content
      || event.audioOutput?.audio
      || event.audioOutput?.bytes
      || null;
    if (typeof audioValue === "string") {
      audioChunks.push(Buffer.from(audioValue, "base64"));
    } else if (Array.isArray(audioValue)) {
      audioChunks.push(Buffer.from(audioValue));
    }
  }

  return {
    assistantText: assistantText.trim(),
    inputTranscript: inputTranscript.trim(),
    audioBuffer: audioChunks.length ? Buffer.concat(audioChunks) : null,
  };
}

export async function respondWithVoice({
  text = "",
  audioBase64 = null,
  conversationId = null,
  playbackMode = "auto",
  voiceId = null,
  mode = "narrate",
  context = null,
}) {
  const session = getSession(conversationId);
  const audioBuffer = audioBase64 ? decodeBase64Audio(audioBase64) : null;
  const voiceModel = resolveModelId("voice");
  const userMessage = String(text || "").trim();
  const fallbackText = buildVoiceFallback({
    text,
    context,
    userMessage,
  });

  if (!voiceModel || !hasAwsCredentials()) {
    if (userMessage) {
      session.history.push({ role: "user", content: userMessage });
    }
    session.history.push({ role: "assistant", content: fallbackText });
    return {
      conversationId: session.id,
      transcript: fallbackText,
      assistantText: fallbackText,
      inputTranscript: userMessage || null,
      audioBase64: null,
      contentType: null,
      source: "browser-fallback",
      fallbackUsed: true,
      capabilities: getCapabilitySnapshot(),
    };
  }

  try {
    const systemPrompt = mode === "coach"
      ? buildVoiceCoachPrompt(context, session)
      : buildNarrationPrompt();
    const events = buildSonicEvents({
      systemPrompt,
      text: userMessage,
      audioBuffer,
      playbackMode,
      voiceId,
    });
    const outputEvents = await invokeBidirectionalStream(voiceModel, events);
    const parsed = parseVoiceEvents(outputEvents);
    const assistantText = parsed.assistantText || fallbackText;
    const inputTranscript = parsed.inputTranscript || userMessage || null;
    const wavBuffer = parsed.audioBuffer ? pcmToWavBuffer(parsed.audioBuffer) : null;

    if (inputTranscript) {
      session.history.push({ role: "user", content: inputTranscript });
    }
    session.history.push({ role: "assistant", content: assistantText });

    return {
      conversationId: session.id,
      transcript: assistantText,
      assistantText,
      inputTranscript,
      audioBase64: wavBuffer ? wavBuffer.toString("base64") : null,
      contentType: wavBuffer ? "audio/wav" : null,
      source: "nova-sonic",
      fallbackUsed: false,
    };
  } catch (error) {
    console.warn("Voice synthesis fallback:", error?.message || error);
    if (userMessage) {
      session.history.push({ role: "user", content: userMessage });
    }
    session.history.push({ role: "assistant", content: fallbackText });
    return {
      conversationId: session.id,
      transcript: fallbackText,
      assistantText: fallbackText,
      inputTranscript: userMessage || null,
      audioBase64: null,
      contentType: null,
      source: "browser-fallback",
      fallbackUsed: true,
    };
  }
}
