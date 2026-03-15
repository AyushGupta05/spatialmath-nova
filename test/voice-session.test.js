import test from "node:test";
import assert from "node:assert/strict";

import { createVoiceSessionManager } from "../server/services/voiceSessionManager.js";
import { getVoiceConversationSession } from "../server/services/voiceCommon.js";

async function collectUntil(subscription, predicate) {
  const events = [];
  while (true) {
    const event = await subscription.next();
    if (!event) break;
    events.push(event);
    if (predicate(event)) {
      return events;
    }
  }
  return events;
}

test("voice session manager streams transcript, audio, and done events with model failover", async () => {
  const attemptedModels = [];
  let rememberedModel = null;
  const manager = createVoiceSessionManager({
    hasAwsCredentials: () => true,
    getCapabilitySnapshot: () => ({ configured: true }),
    getModelCandidateOrder: () => ["bad-model", "good-model"],
    rememberWorkingModel: (_kind, modelId) => {
      rememberedModel = modelId;
    },
    generateRecoveredVoiceReply: async ({ inputTranscript }) => ({
      assistantText: "Notice how the flow bends toward the positive charge.",
      audioChunks: [Buffer.from([0, 0, 2, 0]).toString("base64")],
      sampleRateHertz: 24000,
      source: "voice-guided",
      fallbackUsed: false,
      actions: [{ id: "next", label: "What's next?", kind: "reveal-next-step", payload: {} }],
      sceneCommand: {
        summary: "Focus the charge",
        operations: [{ kind: "focus_objects", targetIds: ["charge-a"] }],
      },
      focusTargets: ["charge-a"],
      inputTranscript,
    }),
    startBidirectionalStream: async (modelId, inputQueue) => {
      attemptedModels.push(modelId);
      if (modelId === "bad-model") {
        throw new Error("The provided model identifier is invalid.");
      }

      return (async function* fakeOutput() {
        let heardAudio = false;
        for await (const input of inputQueue) {
          if (input?.event?.audioInput?.content) {
            heardAudio = true;
          }
          if (input?.event?.sessionEnd) {
            break;
          }
        }

        yield {
          event: {
            contentStart: {
              contentId: "user-final",
              role: "USER",
              type: "TEXT",
              additionalModelFields: JSON.stringify({ generationStage: "FINAL" }),
            },
          },
        };
        yield {
          event: {
            textOutput: {
              contentId: "user-final",
              content: heardAudio ? "What happens to the field lines?" : "Hello?",
            },
          },
        };
        yield {
          event: {
            contentStart: {
              contentId: "assistant-final",
              role: "ASSISTANT",
              type: "TEXT",
              additionalModelFields: JSON.stringify({ generationStage: "FINAL" }),
            },
          },
        };
        yield {
          event: {
            textOutput: {
              contentId: "assistant-final",
              content: "Notice how the flow bends toward the positive charge.",
            },
          },
        };
        yield {
          event: {
            contentStart: {
              contentId: "assistant-audio",
              role: "ASSISTANT",
              type: "AUDIO",
              additionalModelFields: JSON.stringify({ generationStage: "FINAL" }),
            },
          },
        };
        yield {
          event: {
            audioOutput: {
              contentId: "assistant-audio",
              content: Buffer.from([0, 0, 2, 0]).toString("base64"),
              sampleRateHertz: 24000,
            },
          },
        };
      }());
    },
  });

  const session = manager.createSession();
  const subscription = manager.subscribe(session.sessionId);
  await subscription.next();

  const start = await manager.startTurn({
    sessionId: session.sessionId,
    mode: "coach",
    context: {},
    playbackMode: "auto",
  });
  assert.equal(start.fallbackUsed, false);
  assert.equal(start.modelId, "good-model");

  const append = await manager.appendAudio({
    sessionId: session.sessionId,
    audioBase64: "AAAA",
  });
  assert.equal(append.accepted, true);

  const stop = await manager.stopTurn(session.sessionId);
  assert.equal(stop.stopped, true);

  const events = await collectUntil(subscription, (event) => event.type === "done");
  const eventTypes = events.map((event) => event.type);

  assert.deepEqual(attemptedModels, ["bad-model", "good-model"]);
  assert.equal(rememberedModel, "good-model");
  assert.ok(eventTypes.includes("state"));
  assert.ok(eventTypes.includes("input_transcript"));
  assert.ok(eventTypes.includes("assistant_text"));
  assert.ok(eventTypes.includes("assistant_audio"));
  assert.equal(events.at(-1).assistantText, "Notice how the flow bends toward the positive charge.");
  assert.equal(events.at(-1).inputTranscript, "What happens to the field lines?");
  assert.equal(events.at(-1).actions[0].label, "What's next?");
  assert.equal(events.at(-1).sceneCommand.summary, "Focus the charge");

  subscription.close();
});

test("voice session manager falls back to captions when credentials are unavailable", async () => {
  const manager = createVoiceSessionManager({
    hasAwsCredentials: () => false,
    getCapabilitySnapshot: () => ({ configured: false, fallbacks: { voice: "caption-only" } }),
  });

  const session = manager.createSession();
  const subscription = manager.subscribe(session.sessionId);
  await subscription.next();

  const start = await manager.startTurn({
    sessionId: session.sessionId,
    mode: "coach",
    context: {},
  });

  assert.equal(start.fallbackUsed, true);
  const events = await collectUntil(subscription, (event) => event.type === "done");
  const done = events.at(-1);
  assert.equal(done.fallbackUsed, true);
  assert.match(done.assistantText, /Type your question/i);

  subscription.close();
});

test("voice session manager closes empty mic turns locally and allows the next turn to start", async () => {
  const manager = createVoiceSessionManager({
    hasAwsCredentials: () => true,
    getCapabilitySnapshot: () => ({ configured: true }),
    getModelCandidateOrder: () => ["good-model"],
    startBidirectionalStream: async (_modelId, inputQueue) => (async function* fakeOutput() {
      const noopEvents = [];
      yield* noopEvents;
      for await (const _input of inputQueue) {
        // Drain the queue; empty turns are finalized locally before Bedrock needs a content end.
      }
    }()),
  });

  const session = manager.createSession();
  const subscription = manager.subscribe(session.sessionId);
  await subscription.next();

  const firstStart = await manager.startTurn({
    sessionId: session.sessionId,
    mode: "coach",
    context: {},
  });
  assert.equal(firstStart.fallbackUsed, false);

  const duplicateStart = await manager.startTurn({
    sessionId: session.sessionId,
    mode: "coach",
    context: {},
  });
  assert.equal(duplicateStart.alreadyActive, true);

  const stop = await manager.stopTurn(session.sessionId);
  assert.equal(stop.stopped, true);
  assert.equal(stop.emptyInput, true);

  const events = await collectUntil(subscription, (event) => event.type === "done");
  assert.equal(events.at(-1).fallbackUsed, true);
  assert.match(events.at(-1).assistantText, /didn't catch anything/i);

  const conversation = getVoiceConversationSession(session.sessionId);
  assert.deepEqual(conversation.history, []);

  const nextStart = await manager.startTurn({
    sessionId: session.sessionId,
    mode: "coach",
    context: {},
    text: "Try again",
  });
  assert.equal(nextStart.fallbackUsed, false);

  subscription.close();
});

test("voice session manager interrupts an active reply so a new turn can start immediately", async () => {
  const manager = createVoiceSessionManager({
    hasAwsCredentials: () => true,
    getCapabilitySnapshot: () => ({ configured: true }),
    getModelCandidateOrder: () => ["good-model"],
    generateRecoveredVoiceReply: async ({ inputTranscript }) => ({
      assistantText: `Echo: ${inputTranscript}`,
      audioChunks: [],
      sampleRateHertz: 24000,
      source: "voice-guided",
      fallbackUsed: false,
    }),
    startBidirectionalStream: async (_modelId, inputQueue) => (async function* fakeOutput() {
      yield* [];
      for await (const _input of inputQueue) {
        // Keep the stream alive until interrupted or prompt end closes the input queue.
      }
    }()),
  });

  const session = manager.createSession();
  const subscription = manager.subscribe(session.sessionId);
  await subscription.next();

  const start = await manager.startTurn({
    sessionId: session.sessionId,
    mode: "coach",
    context: {},
  });
  assert.equal(start.fallbackUsed, false);

  const interrupt = await manager.interruptTurn(session.sessionId);
  assert.equal(interrupt.interrupted, true);

  const events = await collectUntil(subscription, (event) => event.type === "interrupted");
  assert.equal(events.at(-1).type, "interrupted");

  const nextStart = await manager.startTurn({
    sessionId: session.sessionId,
    mode: "coach",
    context: {},
    text: "Start over",
  });
  assert.equal(nextStart.fallbackUsed, false);

  subscription.close();
});
