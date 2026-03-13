import { Hono } from "hono";
import { respondWithVoice } from "../services/voiceController.js";

export function createVoiceRoute({ voiceResponder = respondWithVoice } = {}) {
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

  return voiceRoute;
}

export default createVoiceRoute();
