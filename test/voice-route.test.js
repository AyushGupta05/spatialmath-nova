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
