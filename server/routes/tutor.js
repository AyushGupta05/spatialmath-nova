import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { converseNovaStream, MODEL_IDS } from "../middleware/bedrock.js";

const tutor = new Hono();

function buildSystemPrompt(sceneSpec, phase, currentStep, hintsUsed) {
  const objectSummary = (sceneSpec?.objects || [])
    .map((o) => `${o.id}: ${o.shape} (${JSON.stringify(o.params)}) at [${o.position}]`)
    .join("\n  ");

  const stepInfo = sceneSpec?.answer?.steps?.[currentStep];
  const stepText = stepInfo ? `Current step: "${stepInfo.text}" (formula: ${stepInfo.formula || "N/A"})` : "";

  return `You are a friendly, encouraging geometry tutor helping a student understand spatial reasoning through an interactive 3D scene.

Current scene:
  ${objectSummary || "No objects yet"}

Question: ${sceneSpec?.question || "Not set"}
Phase: ${phase}
Step ${currentStep + 1} of ${sceneSpec?.answer?.steps?.length || 1}
${stepText}
Hints used: ${hintsUsed}/3

Guidelines:
- Be concise (2-3 sentences max unless explaining a formula)
- Be encouraging and pedagogically sound
- If the student asks for a hint, give a gentle nudge without revealing the full answer
- Reference the 3D objects by their labels (A, B, etc.)
- When explaining formulas, break them into clear steps
- If you detect a misconception, gently correct it
- Never give away the final answer directly unless the student has worked through the steps`;
}

tutor.post("/", async (c) => {
  try {
    const { sceneSpec, history, userMessage, phase, currentStep, hintsUsed } = await c.req.json();

    if (!userMessage || typeof userMessage !== "string") {
      return c.json({ error: "userMessage is required" }, 400);
    }

    const systemPrompt = buildSystemPrompt(sceneSpec, phase || "scene_ready", currentStep || 0, hintsUsed || 0);

    // Build conversation messages for Converse API
    // Filter to only user/assistant roles (skip "system" messages from the chat UI)
    const messages = [];
    if (history && Array.isArray(history)) {
      for (const msg of history.slice(-10)) {
        if (msg.role === "system") continue;
        const role = msg.role === "tutor" ? "assistant" : "user";
        // Avoid consecutive same-role messages (Bedrock requires alternating)
        if (messages.length > 0 && messages[messages.length - 1].role === role) continue;
        messages.push({ role, content: [{ text: msg.content }] });
      }
    }
    messages.push({ role: "user", content: [{ text: userMessage }] });

    // Ensure first message is from user (Bedrock requirement)
    while (messages.length > 0 && messages[0].role !== "user") {
      messages.shift();
    }

    // Stream the response as SSE
    return streamSSE(c, async (stream) => {
      try {
        for await (const chunk of converseNovaStream(MODEL_IDS.NOVA_LITE, systemPrompt, messages, {
          maxTokens: 1024,
          temperature: 0.4,
        })) {
          await stream.writeSSE({ data: JSON.stringify({ type: "text", content: chunk }) });
        }
        await stream.writeSSE({ data: JSON.stringify({ type: "done" }) });
      } catch (streamErr) {
        console.error("Tutor stream error:", streamErr);
        await stream.writeSSE({ data: JSON.stringify({ type: "error", content: streamErr.message }) });
      }
    });
  } catch (err) {
    console.error("Tutor route error:", err);
    return c.json({ error: err.message || "Internal server error" }, 500);
  }
});

export default tutor;
