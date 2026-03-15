import test from "node:test";
import assert from "node:assert/strict";

import { createVoiceRoute } from "../server/routes/voice.js";

test("POST /api/voice/respond supports the richer voice contract", async () => {
  let capturedPayload = null;
  const voiceRoute = createVoiceRoute({
    voiceResponder: async (payload) => {
      capturedPayload = payload;
      return {
        conversationId: "voice-123",
        transcript: "Tutor reply",
        assistantText: "Tutor reply",
        inputTranscript: "What should I do next?",
        audioBase64: null,
        contentType: null,
        source: "browser-fallback",
        fallbackUsed: true,
      };
    },
  });

  const response = await voiceRoute.request("/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audioBase64: "AAAA",
      mimeType: "audio/lpcm;rate=16000",
      conversationId: "voice-123",
      playbackMode: "auto",
      mode: "coach",
      context: { plan: { problem: { question: "Demo" } } },
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.conversationId, "voice-123");
  assert.equal(payload.fallbackUsed, true);
  assert.equal(capturedPayload.mode, "coach");
  assert.equal(capturedPayload.mimeType, "audio/lpcm;rate=16000");
});

test("voice session routes proxy the realtime lifecycle", async () => {
  const calls = [];
  let eventReads = 0;
  const voiceRoute = createVoiceRoute({
    sessionManager: {
      createSession() {
        calls.push(["createSession"]);
        return {
          sessionId: "voice-session-1",
          conversationId: "voice-session-1",
          state: "idle",
        };
      },
      subscribe(sessionId) {
        calls.push(["subscribe", sessionId]);
        return {
          async next() {
            eventReads += 1;
            if (eventReads === 1) {
              return {
                sessionId,
                type: "done",
                conversationId: sessionId,
                assistantText: "Caption reply",
                inputTranscript: "Test prompt",
                fallbackUsed: true,
                source: "caption-only",
              };
            }
            return null;
          },
          close() {
            calls.push(["close", sessionId]);
          },
        };
      },
      async startTurn(payload) {
        calls.push(["startTurn", payload]);
        return {
          sessionId: payload.sessionId,
          conversationId: payload.sessionId,
          fallbackUsed: false,
        };
      },
      async appendAudio(payload) {
        calls.push(["appendAudio", payload]);
        return {
          accepted: true,
          audioChunkCount: 1,
        };
      },
      async stopTurn(sessionId) {
        calls.push(["stopTurn", sessionId]);
        return {
          sessionId,
          conversationId: sessionId,
          stopped: true,
        };
      },
      async interruptTurn(sessionId) {
        calls.push(["interruptTurn", sessionId]);
        return {
          sessionId,
          conversationId: sessionId,
          interrupted: true,
        };
      },
    },
  });

  const createResponse = await voiceRoute.request("/session", { method: "POST" });
  assert.equal(createResponse.status, 200);
  assert.equal((await createResponse.json()).sessionId, "voice-session-1");

  const startResponse = await voiceRoute.request("/session/voice-session-1/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playbackMode: "auto",
      mode: "coach",
      context: { plan: { problem: { question: "Demo" } } },
    }),
  });
  assert.equal(startResponse.status, 200);
  assert.equal((await startResponse.json()).fallbackUsed, false);

  const audioResponse = await voiceRoute.request("/session/voice-session-1/audio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audioBase64: "AAAA",
    }),
  });
  assert.equal(audioResponse.status, 200);
  assert.equal((await audioResponse.json()).accepted, true);

  const stopResponse = await voiceRoute.request("/session/voice-session-1/stop", {
    method: "POST",
  });
  assert.equal(stopResponse.status, 200);
  assert.equal((await stopResponse.json()).stopped, true);

  const interruptResponse = await voiceRoute.request("/session/voice-session-1/interrupt", {
    method: "POST",
  });
  assert.equal(interruptResponse.status, 200);
  assert.equal((await interruptResponse.json()).interrupted, true);

  const eventsResponse = await voiceRoute.request("/session/voice-session-1/events");
  assert.equal(eventsResponse.status, 200);
  const sseText = await eventsResponse.text();
  assert.match(sseText, /"assistantText":"Caption reply"/);
  assert.deepEqual(calls.slice(0, 6).map(([name]) => name), [
    "createSession",
    "startTurn",
    "appendAudio",
    "stopTurn",
    "interruptTurn",
    "subscribe",
  ]);
});
