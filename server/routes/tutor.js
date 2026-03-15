import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { buildSolutionRevealText, isExplicitSolutionRequest } from "../../src/core/tutorSolution.js";
import { evaluateBuild } from "../services/buildEvaluator.js";
import { generateFreeformTutorTurn, buildFallbackFreeformTurn } from "../services/freeformTutor.js";
import { evaluateTutorCompletion } from "../services/tutorCompletion.js";
import { buildTutorSystemPrompt, buildFallbackTutorReply } from "../services/tutorPrompt.js";
import { converseStreamWithModelFailover } from "../services/modelInvoker.js";
import { buildTutorResponseMeta } from "../services/tutorMetadata.js";
import { generateSimilarTutorQuestions } from "../services/tutorSimilar.js";
import { evaluateConcept, isTrivialInteraction } from "../services/conceptEvaluator.js";

export function createTutorRoute({
  streamModel = converseStreamWithModelFailover,
  freeformTurnGenerator = generateFreeformTutorTurn,
  completionEvaluator = evaluateTutorCompletion,
  conceptEvaluator = evaluateConcept,
  trivialityCheck = isTrivialInteraction,
  similarQuestionGenerator = generateSimilarTutorQuestions,
} = {}) {
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

      if (!sceneSnapshot || !userMessage || typeof userMessage !== "string") {
        return c.json({ error: "sceneSnapshot and userMessage are required" }, 400);
      }

      if (!plan) {
        let freeformTurn;
        try {
          freeformTurn = await freeformTurnGenerator({
            sceneSnapshot,
            sceneContext,
            learningState,
            userMessage,
          });
        } catch (error) {
          console.error("Tutor freeform error:", error);
          freeformTurn = buildFallbackFreeformTurn({
            sceneSnapshot,
            sceneContext,
            userMessage,
          });
        }

        return streamSSE(c, async (stream) => {
          await stream.writeSSE({ data: JSON.stringify({ type: "meta", content: freeformTurn.meta || null }) });
          await stream.writeSSE({ data: JSON.stringify({ type: "text", content: freeformTurn.text || "I am here. Ask me about the scene or tell me what to build." }) });
          await stream.writeSSE({ data: JSON.stringify({ type: "done" }) });
        });
      }

      const assessment = evaluateBuild(plan, sceneSnapshot, contextStepId);
      const revealSolution = isExplicitSolutionRequest(userMessage);
      const numericCompletion = revealSolution
        ? { complete: true, reason: "revealed-solution" }
        : completionEvaluator({ plan, userMessage });

      let conceptVerdict = null;
      if (numericCompletion.complete) {
        conceptVerdict = {
          verdict: "CORRECT",
          confidence: 1.0,
          what_was_right: "Correct answer",
          gap: null,
          misconception_type: null,
          scene_cue: null,
          tutor_tone: "encouraging",
        };
      } else if (!revealSolution && !trivialityCheck(learningState?.learningStage, userMessage)) {
        const currentStep = plan.buildSteps?.find((s) => s.id === contextStepId)
          || plan.buildSteps?.[learningState?.currentStep || 0];
        const stageGoal = currentStep?.focusConcept
          || plan.sceneFocus?.primaryInsight
          || plan.learningMoments?.[learningState?.learningStage]?.goal
          || "";
        try {
          conceptVerdict = await conceptEvaluator({
            stageGoal,
            learnerInput: userMessage,
            lessonContext: { plan, assessment },
            prediction: learningState?.predictionState?.response || "",
            learnerHistory: learningState?.learnerHistory || [],
          });
        } catch (err) {
          console.error("Concept evaluation failed:", err);
          conceptVerdict = null;
        }
      }

      const completionState = numericCompletion.complete
        ? numericCompletion
        : conceptVerdict?.verdict === "CORRECT"
          ? { complete: true, reason: "correct-answer" }
          : { complete: false, reason: null };

      const responseMeta = buildTutorResponseMeta({
        plan,
        learningState,
        contextStepId,
        assessment,
        completionState,
        userMessage,
        conceptVerdict,
      });
      const deterministicRevealText = revealSolution ? buildSolutionRevealText(plan) : "";
      const systemPrompt = buildTutorSystemPrompt({
        plan,
        sceneSnapshot,
        sceneContext,
        learningState,
        contextStepId,
        assessment,
        conceptVerdict,
      });

      const history = Array.isArray(learningState.history) ? learningState.history : [];
      const messages = [];
      for (const message of history.slice(-8)) {
        const role = message.role === "tutor" ? "assistant" : message.role;
        if (!["user", "assistant"].includes(role)) continue;
        if (messages.length && messages[messages.length - 1].role === role) continue;
        messages.push({ role, content: [{ text: String(message.content || "") }] });
      }
      // Ensure the conversation starts with a user message (Bedrock requirement)
      while (messages.length && messages[0].role !== "user") {
        messages.shift();
      }
      if (!messages.length || messages[messages.length - 1].role !== "user") {
        messages.push({ role: "user", content: [{ text: userMessage }] });
      } else {
        messages[messages.length - 1] = { role: "user", content: [{ text: userMessage }] };
      }

      return streamSSE(c, async (stream) => {
        try {
          await stream.writeSSE({ data: JSON.stringify({ type: "meta", content: { ...responseMeta, conceptVerdict } }) });
          if (revealSolution) {
            await stream.writeSSE({ data: JSON.stringify({ type: "text", content: deterministicRevealText || "Here is the worked solution." }) });
            await stream.writeSSE({ data: JSON.stringify({ type: "assessment", content: assessment }) });
            await stream.writeSSE({ data: JSON.stringify({ type: "done" }) });
            return;
          }
          for await (const chunk of streamModel("text", systemPrompt, messages, {
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

  tutorRoute.post("/similar", async (c) => {
    try {
      const { plan, limit = 3 } = await c.req.json();
      if (!plan) {
        return c.json({ error: "plan is required" }, 400);
      }

      const suggestions = await similarQuestionGenerator({
        plan,
        limit,
      });
      return c.json({ suggestions: suggestions.slice(0, 3) });
    } catch (error) {
      console.error("Tutor similar route error:", error);
      return c.json({ error: error.message || "Internal server error" }, 500);
    }
  });

  return tutorRoute;
}

const tutorRoute = createTutorRoute();

export default tutorRoute;
