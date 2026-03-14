import { getCapabilitySnapshot, hasAwsCredentials } from "./modelRouter.js";
import { invokeBidirectionalStreamWithModelFailover } from "./modelInvoker.js";
import {
  buildNarrationPrompt,
  buildSonicTurnEvents,
  buildVoiceCoachPrompt,
  buildVoiceFallback,
  collectVoiceOutputs,
  decodeBase64Audio,
  getVoiceConversationSession,
  pcmToWavBuffer,
} from "./voiceCommon.js";

export async function respondWithVoice({
  text = "",
  audioBase64 = null,
  conversationId = null,
  playbackMode = "auto",
  voiceId = null,
  mode = "narrate",
  context = null,
}) {
  const session = getVoiceConversationSession(conversationId);
  const audioBuffer = audioBase64 ? decodeBase64Audio(audioBase64) : null;
  const userMessage = String(text || "").trim();
  const fallbackText = buildVoiceFallback({
    text,
    context,
    userMessage,
  });

  if (!hasAwsCredentials()) {
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
      source: "caption-only",
      fallbackUsed: true,
      capabilities: getCapabilitySnapshot(),
    };
  }

  try {
    const systemPrompt = mode === "coach"
      ? buildVoiceCoachPrompt(context, session)
      : buildNarrationPrompt();
    const events = buildSonicTurnEvents({
      systemPrompt,
      text: userMessage,
      audioBuffer,
      playbackMode,
      voiceId,
      history: session.history,
    });
    const outputEvents = await invokeBidirectionalStreamWithModelFailover("voice", events);
    const parsed = collectVoiceOutputs(outputEvents);
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
      source: "caption-only",
      fallbackUsed: true,
      capabilities: getCapabilitySnapshot(),
    };
  }
}
