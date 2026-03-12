import { Hono } from "hono";
import { converseNova, MODEL_IDS } from "../middleware/bedrock.js";

const voice = new Hono();

/**
 * Voice synthesis route.
 * For hackathon: uses browser speechSynthesis as primary fallback,
 * with Nova Sonic integration when available.
 *
 * Currently returns a text response that the frontend can feed to
 * the Web Speech API. When Nova 2 Sonic is available in Bedrock,
 * this will return streamed audio.
 */
voice.post("/", async (c) => {
  try {
    const { text } = await c.req.json();

    if (!text || typeof text !== "string") {
      return c.json({ error: "text is required" }, 400);
    }

    // For now, return the text for browser-side TTS
    // Nova 2 Sonic integration will replace this when available
    return c.json({
      text: text.trim(),
      method: "browser-tts",
      voice: "default",
    });
  } catch (err) {
    console.error("Voice route error:", err);
    return c.json({ error: err.message || "Internal server error" }, 500);
  }
});

export default voice;
