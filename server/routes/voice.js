import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { respondWithVoice } from "../services/voiceController.js";
import { voiceSessionManager } from "../services/voiceSessionManager.js";

export function createVoiceRoute({
  voiceResponder = respondWithVoice,
  sessionManager = voiceSessionManager,
} = {}) {
  const voiceRoute = new Hono();

  voiceRoute.post("/respond", async (c) => {
    try {
      const {
        text = "",
        audioBase64 = null,
        mimeType = "audio/lpcm",
        conversationId = null,
        playbackMode = "auto",
        voiceId = null,
        mode = "narrate",
        context = null,
      } = await c.req.json();
      if ((!text || typeof text !== "string") && !audioBase64) {
        return c.json({ error: "text or audioBase64 is required" }, 400);
      }

      const response = await voiceResponder({
        text,
        audioBase64,
        mimeType,
        conversationId,
        playbackMode,
        voiceId,
        mode,
        context,
      });
      return c.json(response);
    } catch (error) {
      console.error("Voice route error:", error);
      return c.json({ error: error.message || "Internal server error" }, 500);
    }
  });

  voiceRoute.post("/session", async (c) => {
    try {
      return c.json(sessionManager.createSession());
    } catch (error) {
      console.error("Voice session create error:", error);
      return c.json({ error: error.message || "Internal server error" }, 500);
    }
  });

  voiceRoute.get("/session/:sessionId/events", (c) => {
    const sessionId = c.req.param("sessionId");
    const subscription = sessionManager.subscribe(sessionId);
    c.req.raw.signal?.addEventListener("abort", () => subscription.close(), { once: true });

    return streamSSE(c, async (stream) => {
      try {
        while (true) {
          const event = await subscription.next();
          if (!event) {
            return;
          }
          await stream.writeSSE({
            data: JSON.stringify(event),
          });
        }
      } finally {
        subscription.close();
      }
    });
  });

  voiceRoute.post("/session/:sessionId/start", async (c) => {
    try {
      const sessionId = c.req.param("sessionId");
      const {
        playbackMode = "auto",
        voiceId = null,
        mode = "coach",
        context = null,
        text = "",
      } = await c.req.json().catch(() => ({}));

      const response = await sessionManager.startTurn({
        sessionId,
        playbackMode,
        voiceId,
        mode,
        context,
        text,
      });
      return c.json(response);
    } catch (error) {
      console.error("Voice session start error:", error);
      return c.json({ error: error.message || "Internal server error" }, 500);
    }
  });

  voiceRoute.post("/session/:sessionId/audio", async (c) => {
    try {
      const sessionId = c.req.param("sessionId");
      const {
        audioBase64 = "",
        mimeType = "audio/lpcm;rate=16000;channels=1;sampleSizeBits=16",
      } = await c.req.json();

      if (!audioBase64 || typeof audioBase64 !== "string") {
        return c.json({ error: "audioBase64 is required" }, 400);
      }

      const response = await sessionManager.appendAudio({
        sessionId,
        audioBase64,
        mimeType,
      });
      return c.json(response);
    } catch (error) {
      console.error("Voice session audio error:", error);
      return c.json({ error: error.message || "Internal server error" }, 500);
    }
  });

  voiceRoute.post("/session/:sessionId/stop", async (c) => {
    try {
      const sessionId = c.req.param("sessionId");
      const response = await sessionManager.stopTurn(sessionId);
      return c.json(response);
    } catch (error) {
      console.error("Voice session stop error:", error);
      return c.json({ error: error.message || "Internal server error" }, 500);
    }
  });

  return voiceRoute;
}

export default createVoiceRoute();
