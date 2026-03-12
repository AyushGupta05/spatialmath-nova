import { Hono } from "hono";
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";

const voice = new Hono();

const REGION = process.env.AWS_REGION || "us-east-1";

let pollyClient = null;
function getPolly() {
  if (!pollyClient) {
    pollyClient = new PollyClient({
      region: REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN || undefined,
      },
    });
  }
  return pollyClient;
}

/**
 * POST /api/voice  { text: string, voiceId?: string }
 * Returns: { audio: "<base64 mp3>", contentType: "audio/mpeg", method: "polly" }
 *          or { text, method: "browser-tts" } on Polly failure (graceful fallback).
 */
voice.post("/", async (c) => {
  try {
    const { text, voiceId = "Joanna" } = await c.req.json();

    if (!text || typeof text !== "string") {
      return c.json({ error: "text is required" }, 400);
    }

    const trimmed = text.trim().slice(0, 3000);

    try {
      const cmd = new SynthesizeSpeechCommand({
        Text: trimmed,
        OutputFormat: "mp3",
        VoiceId: voiceId,
        Engine: "neural",
        LanguageCode: "en-US",
      });

      const response = await getPolly().send(cmd);

      if (!response.AudioStream) {
        throw new Error("No audio stream from Polly");
      }

      const chunks = [];
      for await (const chunk of response.AudioStream) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      const base64 = buffer.toString("base64");

      return c.json({
        audio: base64,
        contentType: "audio/mpeg",
        method: "polly",
      });
    } catch (pollyErr) {
      console.warn("Polly TTS failed, falling back to browser TTS:", pollyErr.message);
      return c.json({
        text: trimmed,
        method: "browser-tts",
      });
    }
  } catch (err) {
    console.error("Voice route error:", err);
    return c.json({ error: err.message || "Internal server error" }, 500);
  }
});

export default voice;
