import { randomUUID } from "node:crypto";
import { startBidirectionalStream } from "../middleware/bedrock.js";
import {
  getCapabilitySnapshot,
  getModelCandidateOrder,
  hasAwsCredentials,
  rememberWorkingModel,
} from "./modelRouter.js";
import {
  buildAudioChunkEvent,
  buildAudioContentStartEvent,
  buildConversationPreambleEvents,
  buildNarrationPrompt,
  buildPromptEndEvents,
  buildTextContentEvents,
  buildVoiceCoachPrompt,
  buildVoiceFallback,
  extractVoiceStreamDelta,
  getVoiceConversationSession,
  createVoiceEventState,
} from "./voiceCommon.js";
import { generateRecoveredVoiceReply } from "./voiceReplyFallback.js";

function createAsyncQueue() {
  const values = [];
  const waiters = [];
  let closed = false;

  return {
    push(value) {
      if (closed) return false;
      if (waiters.length) {
        waiters.shift()(value);
      } else {
        values.push(value);
      }
      return true;
    },
    async nextValue() {
      if (values.length) {
        return values.shift();
      }
      if (closed) {
        return null;
      }
      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },
    close() {
      if (closed) return;
      closed = true;
      while (waiters.length) {
        waiters.shift()(null);
      }
    },
    get closed() {
      return closed;
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        const value = await this.nextValue();
        if (value == null) {
          return;
        }
        yield value;
      }
    },
  };
}

function buildAggregateError(kind, attempts = []) {
  const summary = attempts
    .map(({ modelId, error }) => `${modelId}: ${error?.message || error}`)
    .join(" | ");
  return new Error(summary
    ? `All ${kind} model candidates failed. ${summary}`
    : `All ${kind} model candidates failed.`);
}

function safeContent(text = "") {
  return String(text || "").trim();
}

function fallbackCaptionForTurn(turn) {
  if (turn.userText) {
    return turn.fallbackText;
  }
  return "Voice mode is unavailable right now. Type your question and I'll keep helping in the chat.";
}

function emptyVoiceTurnReply() {
  return "I didn't catch anything. Try that again.";
}

export function createVoiceSessionManager(deps = {}) {
  const sessions = new Map();
  const startStream = deps.startBidirectionalStream || startBidirectionalStream;
  const hasCredentials = deps.hasAwsCredentials || hasAwsCredentials;
  const getCapabilities = deps.getCapabilitySnapshot || getCapabilitySnapshot;
  const modelCandidates = deps.getModelCandidateOrder || getModelCandidateOrder;
  const rememberModel = deps.rememberWorkingModel || rememberWorkingModel;
  const recoverVoiceReply = deps.generateRecoveredVoiceReply || generateRecoveredVoiceReply;

  function ensureSession(sessionId = null) {
    const conversation = getVoiceConversationSession(sessionId);
    if (!sessions.has(conversation.id)) {
      sessions.set(conversation.id, {
        id: conversation.id,
        conversation,
        state: "idle",
        subscribers: new Set(),
        currentTurn: null,
      });
    }
    return sessions.get(conversation.id);
  }

  function publish(session, payload) {
    const event = {
      sessionId: session.id,
      ...payload,
    };
    for (const subscriber of session.subscribers) {
      subscriber.push(event);
    }
  }

  function setState(session, state, extra = {}) {
    if (session.state === state && !Object.keys(extra).length) {
      return;
    }
    session.state = state;
    publish(session, { type: "state", state, ...extra });
  }

  function subscribe(sessionId) {
    const session = ensureSession(sessionId);
    const subscriber = createAsyncQueue();
    session.subscribers.add(subscriber);
    subscriber.push({
      sessionId: session.id,
      type: "state",
      state: session.state,
    });
    return {
      async next() {
        return subscriber.nextValue();
      },
      close() {
        session.subscribers.delete(subscriber);
        subscriber.close();
      },
    };
  }

  async function openTurnStream(session, turn, systemPrompt) {
    const attempts = [];
    for (const modelId of modelCandidates("voice")) {
      const inputQueue = createAsyncQueue();
      for (const event of buildConversationPreambleEvents({
        promptName: turn.promptName,
        systemPrompt,
        history: session.conversation.history,
        playbackMode: turn.playbackMode,
        voiceId: turn.voiceId,
        temperature: turn.userText ? 0.15 : 0.3,
      })) {
        inputQueue.push(event);
      }

      try {
        const outputStream = await startStream(modelId, inputQueue);
        rememberModel("voice", modelId);
        return {
          modelId,
          inputQueue,
          outputStream,
        };
      } catch (error) {
        inputQueue.close();
        attempts.push({ modelId, error });
      }
    }

    throw buildAggregateError("voice", attempts);
  }

  function finalizeTurn(session, turn, result = {}) {
    if (session.currentTurn?.id !== turn.id || turn.closed) {
      return;
    }
    turn.closed = true;
    turn.inputQueue?.close();

    const inputTranscript = safeContent(result.inputTranscript ?? turn.inputTranscript ?? turn.userText);
    const assistantText = safeContent(
      result.assistantText
      ?? turn.assistantFinalText
      ?? turn.assistantPreviewText
      ?? turn.fallbackText
    ) || "I didn't catch that. Try again.";
    const shouldPersistTurn = Boolean(inputTranscript);

    if (shouldPersistTurn) {
      session.conversation.history.push({ role: "user", content: inputTranscript });
      session.conversation.history.push({ role: "assistant", content: assistantText });
    }
    session.currentTurn = null;

    publish(session, {
      type: "done",
      conversationId: session.id,
      inputTranscript: inputTranscript || null,
      assistantText,
      fallbackUsed: Boolean(result.fallbackUsed),
      source: result.source || "nova-sonic",
      actions: Array.isArray(result.actions) ? result.actions : [],
      focusTargets: Array.isArray(result.focusTargets) ? result.focusTargets : [],
      checkpoint: result.checkpoint || null,
      stageStatus: result.stageStatus || null,
      completionState: result.completionState || null,
      sceneDirective: result.sceneDirective || null,
      sceneCommand: result.sceneCommand || null,
      assessment: result.assessment || null,
      conceptVerdict: result.conceptVerdict || null,
      capabilities: result.fallbackUsed ? getCapabilities() : undefined,
    });
    setState(session, "idle");
  }

  function failTurn(session, turn, error, fallbackText = null) {
    console.warn("Voice session fallback:", error?.message || error);
    finalizeTurn(session, turn, {
      fallbackUsed: true,
      source: "caption-only",
      assistantText: fallbackText || fallbackCaptionForTurn(turn),
      inputTranscript: turn.inputTranscript || turn.userText || null,
    });
  }

  function handleTurnDelta(session, turn, delta) {
    if (session.currentTurn?.id !== turn.id || turn.closed || !delta) {
      return;
    }

    if (delta.type === "input_transcript") {
      turn.inputTranscript = delta.content;
      publish(session, {
        type: "input_transcript",
        content: turn.inputTranscript,
        delta: delta.delta,
      });
      return;
    }

    if (delta.type === "assistant_text") {
      if (delta.generationStage === "FINAL") {
        turn.assistantFinalText = delta.content;
      } else {
        turn.assistantPreviewText = delta.content;
      }
      if (turn.mode === "coach") {
        return;
      }
      setState(session, "responding");
      publish(session, {
        type: "assistant_text",
        content: delta.content,
        delta: delta.delta,
        generationStage: delta.generationStage,
      });
      return;
    }

    if (delta.type === "assistant_audio") {
      turn.assistantAudioReceived = true;
      if (turn.mode === "coach") {
        return;
      }
      setState(session, "responding");
      publish(session, {
        type: "assistant_audio",
        audioBase64: delta.audioBase64,
        sampleRateHertz: delta.sampleRateHertz,
        generationStage: delta.generationStage,
      });
    }
  }

  async function recoverTurnReply(session, turn, assistantTextOverride = "") {
    const inputTranscript = safeContent(turn.inputTranscript || turn.userText);
    if (!inputTranscript) {
      return null;
    }

    const recovered = await recoverVoiceReply({
      inputTranscript,
      assistantTextOverride,
      mode: turn.mode,
      context: turn.context,
      session: session.conversation,
      voiceId: turn.voiceId,
    }).catch((error) => {
      console.warn("Voice recovery fallback:", error?.message || error);
      return null;
    });

    if (!recovered?.assistantText) {
      return null;
    }

    setState(session, "responding");
    if (recovered.assistantText !== assistantTextOverride || turn.mode === "coach") {
      publish(session, {
        type: "assistant_text",
        content: recovered.assistantText,
        delta: recovered.assistantText,
        generationStage: "FINAL",
      });
    }

    for (const audioBase64 of recovered.audioChunks || []) {
      publish(session, {
        type: "assistant_audio",
        audioBase64,
        sampleRateHertz: recovered.sampleRateHertz,
        generationStage: "FINAL",
      });
    }

    return {
      assistantText: recovered.assistantText,
      inputTranscript,
      fallbackUsed: Boolean(recovered.fallbackUsed),
      source: recovered.source,
      actions: Array.isArray(recovered.actions) ? recovered.actions : [],
      focusTargets: Array.isArray(recovered.focusTargets) ? recovered.focusTargets : [],
      checkpoint: recovered.checkpoint || null,
      stageStatus: recovered.stageStatus || null,
      completionState: recovered.completionState || null,
      sceneDirective: recovered.sceneDirective || null,
      sceneCommand: recovered.sceneCommand || null,
      assessment: recovered.assessment || null,
      conceptVerdict: recovered.conceptVerdict || null,
    };
  }

  async function consumeTurn(session, turn, outputStream) {
    const eventState = createVoiceEventState();
    try {
      for await (const rawEvent of outputStream) {
        const delta = extractVoiceStreamDelta(rawEvent, eventState);
        handleTurnDelta(session, turn, delta);
      }
      if (turn.interrupted || turn.closed) {
        return;
      }
      const assistantText = safeContent(turn.assistantFinalText || turn.assistantPreviewText);
      if (safeContent(turn.inputTranscript || turn.userText)) {
        const recovered = await recoverTurnReply(session, turn, assistantText);
        finalizeTurn(session, turn, recovered || undefined);
        return;
      }
      finalizeTurn(session, turn, assistantText ? undefined : {
        assistantText: turn.fallbackText,
        inputTranscript: null,
        fallbackUsed: true,
        source: "caption-only",
      });
    } catch (error) {
      if (turn.interrupted || turn.closed) {
        return;
      }
      failTurn(session, turn, error);
    }
  }

  async function startTurn({
    sessionId,
    playbackMode = "auto",
    voiceId = null,
    mode = "coach",
    context = null,
    text = "",
  }) {
    const session = ensureSession(sessionId);
    if (session.currentTurn && !session.currentTurn.closed) {
      if (!session.currentTurn.inputEnded) {
        return {
          sessionId: session.id,
          conversationId: session.id,
          modelId: session.currentTurn.modelId || null,
          fallbackUsed: false,
          alreadyActive: true,
        };
      }
      throw new Error("A voice turn is already in progress.");
    }

    const userText = safeContent(text);
    const turn = {
      id: randomUUID(),
      promptName: `voice_turn_${randomUUID()}`,
      contentName: `input_${randomUUID()}`,
      playbackMode,
      voiceId,
      mode,
      context,
      userText,
      inputTranscript: "",
      assistantPreviewText: "",
      assistantFinalText: "",
      fallbackText: buildVoiceFallback({
        text: userText,
        context,
        userMessage: userText,
      }),
      inputQueue: null,
      inputEnded: false,
      audioChunkCount: 0,
      assistantAudioReceived: false,
      closed: false,
    };
    session.currentTurn = turn;
    setState(session, "connecting");

    if (!hasCredentials()) {
      publish(session, {
        type: "assistant_text",
        content: fallbackCaptionForTurn(turn),
        delta: fallbackCaptionForTurn(turn),
        generationStage: "FINAL",
      });
      finalizeTurn(session, turn, {
        fallbackUsed: true,
        source: "caption-only",
        assistantText: fallbackCaptionForTurn(turn),
        inputTranscript: userText || null,
      });
      return {
        sessionId: session.id,
        conversationId: session.id,
        fallbackUsed: true,
        source: "caption-only",
        capabilities: getCapabilities(),
      };
    }

    try {
      const systemPrompt = mode === "coach"
        ? buildVoiceCoachPrompt(context, session.conversation)
        : buildNarrationPrompt();
      const { modelId, inputQueue, outputStream } = await openTurnStream(session, turn, systemPrompt);
      turn.inputQueue = inputQueue;
      turn.modelId = modelId;
      turn.outputStream = outputStream;
      turn.outputTask = consumeTurn(session, turn, outputStream);

      if (userText) {
        for (const event of buildTextContentEvents({
          promptName: turn.promptName,
          contentName: turn.contentName,
          role: "USER",
          text: userText,
          interactive: true,
        })) {
          inputQueue.push(event);
        }
        for (const event of buildPromptEndEvents({
          promptName: turn.promptName,
          contentName: turn.contentName,
          includeContentEnd: false,
        })) {
          inputQueue.push(event);
        }
        turn.inputEnded = true;
        inputQueue.close();
        setState(session, "processing");
      } else {
        inputQueue.push(buildAudioContentStartEvent({
          promptName: turn.promptName,
          contentName: turn.contentName,
        }));
        setState(session, "listening");
      }

      return {
        sessionId: session.id,
        conversationId: session.id,
        modelId,
        fallbackUsed: false,
      };
    } catch (error) {
      failTurn(session, turn, error);
      return {
        sessionId: session.id,
        conversationId: session.id,
        fallbackUsed: true,
        source: "caption-only",
        capabilities: getCapabilities(),
      };
    }
  }

  async function appendAudio({
    sessionId,
    audioBase64,
  }) {
    const session = ensureSession(sessionId);
    const turn = session.currentTurn;
    if (!turn || turn.closed || turn.inputEnded || !turn.inputQueue) {
      throw new Error("No active voice turn to append audio to.");
    }

    const content = safeContent(audioBase64);
    if (!content) {
      return { accepted: false };
    }

    turn.audioChunkCount += 1;
    turn.inputQueue.push(buildAudioChunkEvent({
      promptName: turn.promptName,
      contentName: turn.contentName,
      audioBase64: content,
    }));
    return { accepted: true, audioChunkCount: turn.audioChunkCount };
  }

  async function stopTurn(sessionId) {
    const session = ensureSession(sessionId);
    const turn = session.currentTurn;
    if (!turn || turn.closed || turn.inputEnded || !turn.inputQueue) {
      return {
        sessionId: session.id,
        conversationId: session.id,
        stopped: false,
      };
    }

    if (!turn.userText && turn.audioChunkCount === 0) {
      turn.inputEnded = true;
      turn.inputQueue.close();
      finalizeTurn(session, turn, {
        fallbackUsed: true,
        source: "empty-input",
        assistantText: emptyVoiceTurnReply(),
        inputTranscript: null,
      });
      return {
        sessionId: session.id,
        conversationId: session.id,
        stopped: true,
        emptyInput: true,
      };
    }

    for (const event of buildPromptEndEvents({
      promptName: turn.promptName,
      contentName: turn.contentName,
      includeContentEnd: true,
    })) {
      turn.inputQueue.push(event);
    }
    turn.inputEnded = true;
    turn.inputQueue.close();
    setState(session, "processing");

    return {
      sessionId: session.id,
      conversationId: session.id,
      stopped: true,
    };
  }

  async function interruptTurn(sessionId) {
    const session = ensureSession(sessionId);
    const turn = session.currentTurn;
    if (!turn || turn.closed) {
      return {
        sessionId: session.id,
        conversationId: session.id,
        interrupted: false,
      };
    }

    turn.interrupted = true;
    turn.closed = true;
    turn.inputEnded = true;
    turn.inputQueue?.close();
    session.currentTurn = null;

    try {
      await turn.outputStream?.return?.();
    } catch {
      // Streams can already be closing as the next utterance starts.
    }

    publish(session, {
      type: "interrupted",
      conversationId: session.id,
      turnId: turn.id,
    });
    setState(session, "idle");

    return {
      sessionId: session.id,
      conversationId: session.id,
      interrupted: true,
    };
  }

  return {
    createSession() {
      const session = ensureSession();
      return {
        sessionId: session.id,
        conversationId: session.id,
        state: session.state,
      };
    },
    subscribe,
    startTurn,
    appendAudio,
    stopTurn,
    interruptTurn,
  };
}

export const voiceSessionManager = createVoiceSessionManager();
