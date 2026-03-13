import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { converseNovaStream, MODEL_IDS } from "../middleware/bedrock.js";
import { evaluateBuild } from "../services/buildEvaluator.js";
import { buildTutorSystemPrompt, buildFallbackTutorReply } from "../services/tutorPrompt.js";
import { resolveModelId } from "../services/modelRouter.js";
import { buildTutorResponseMeta } from "../services/tutorMetadata.js";

export function createTutorRoute({ streamModel = converseNovaStream } = {}) {
  const tutorRoute = new Hono();

  tutorRoute.post("/", async (c) => {
    try {
      const {
        plan,
        sceneSnapshot,
        sceneContext = null,
        learningState = {},
        userMessage,
        contextStepId = null,
      } = await c.req.json();

      if (!plan || !sceneSnapshot || !userMessage || typeof userMessage !== "string") {
        return c.json({ error: "plan, sceneSnapshot, and userMessage are required" }, 400);
      }

      const assessment = evaluateBuild(plan, sceneSnapshot, contextStepId);
      const responseMeta = buildTutorResponseMeta({
        plan,
        learningState,
        contextStepId,
        assessment,
      });
      const systemPrompt = buildTutorSystemPrompt({
        plan,
        sceneSnapshot,
        sceneContext,
        learningState,
        contextStepId,
        assessment,
      });

      const history = Array.isArray(learningState.history) ? learningState.history : [];
      const messages = [];
      for (const message of history.slice(-8)) {
        const role = message.role === "tutor" ? "assistant" : message.role;
        if (!["user", "assistant"].includes(role)) continue;
        if (messages.length && messages[messages.length - 1].role === role) continue;
        messages.push({ role, content: [{ text: String(message.content || "") }] });
      }
      if (!messages.length || messages[messages.length - 1].role !== "user") {
        messages.push({ role: "user", content: [{ text: userMessage }] });
      } else {
        messages[messages.length - 1] = { role: "user", content: [{ text: userMessage }] };
      }

      return streamSSE(c, async (stream) => {
        try {
          await stream.writeSSE({ data: JSON.stringify({ type: "meta", content: responseMeta }) });
          for await (const chunk of streamModel(resolveModelId("text") || MODEL_IDS.NOVA_LITE, systemPrompt, messages, {
            maxTokens: 1024,
            temperature: 0.35,
          })) {
            await stream.writeSSE({ data: JSON.stringify({ type: "text", content: chunk }) });
          }
          await stream.writeSSE({ data: JSON.stringify({ type: "assessment", content: assessment }) });
          await stream.writeSSE({ data: JSON.stringify({ type: "done" }) });
        } catch (error) {
          console.error("Tutor stream error:", error);
          const fallbackText = buildFallbackTutorReply({
            plan,
            assessment,
            sceneContext,
            userMessage,
            contextStepId,
          });
          await stream.writeSSE({ data: JSON.stringify({ type: "meta", content: responseMeta }) });
          await stream.writeSSE({ data: JSON.stringify({ type: "text", content: fallbackText }) });
          await stream.writeSSE({ data: JSON.stringify({ type: "assessment", content: assessment }) });
          await stream.writeSSE({ data: JSON.stringify({ type: "done", fallback: true }) });
        }
      });
    } catch (error) {
      console.error("Tutor route error:", error);
      return c.json({ error: error.message || "Internal server error" }, 500);
    }
  });

  return tutorRoute;
}

const tutorRoute = createTutorRoute();

export default tutorRoute;
