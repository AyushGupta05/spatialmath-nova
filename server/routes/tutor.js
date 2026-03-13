import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { converseNovaStream, MODEL_IDS } from "../middleware/bedrock.js";
import { evaluateBuild } from "../services/buildEvaluator.js";
import { normalizeScenePlan } from "../../src/ai/planSchema.js";

const tutorRoute = new Hono();

function summarizeScene(snapshot) {
  return (snapshot?.objects || [])
    .map((objectSpec) => `${objectSpec.label || objectSpec.id || "object"}: ${objectSpec.shape} ${JSON.stringify(objectSpec.params)}`)
    .join("\n");
}

function summarizeSceneContext(sceneContext = {}) {
  const selection = sceneContext?.selection
    ? `Selected object: ${sceneContext.selection.label} (${sceneContext.selection.shape}) params=${JSON.stringify(sceneContext.selection.params)} metrics=${JSON.stringify(sceneContext.selection.metrics)}`
    : "Selected object: none";
  const liveChallenge = sceneContext?.liveChallenge
    ? `Live challenge: ${sceneContext.liveChallenge.title || sceneContext.liveChallenge.metric} unlocked=${Boolean(sceneContext.liveChallenge.unlocked)} complete=${Boolean(sceneContext.liveChallenge.complete)} current=${sceneContext.liveChallenge.currentValue ?? "n/a"} target=${sceneContext.liveChallenge.targetValue ?? "n/a"} tolerance=${sceneContext.liveChallenge.toleranceValue ?? "n/a"}`
    : "Live challenge: none";
  return `${selection}\n${liveChallenge}`;
}

function buildSystemPrompt({ plan, sceneSnapshot, sceneContext, learningState, contextStepId, assessment }) {
  const normalizedPlan = normalizeScenePlan(plan);
  const currentStep = normalizedPlan.buildSteps.find((step) => step.id === contextStepId)
    || normalizedPlan.buildSteps[learningState?.currentStep || 0]
    || null;

  return `You are Nova Lite acting as a concise, warm spatial reasoning tutor.

Problem: ${normalizedPlan.problem.question}
Question type: ${normalizedPlan.problem.questionType}
Overview: ${normalizedPlan.overview}

Current build step:
${currentStep ? `${currentStep.title}: ${currentStep.instruction}` : "No active step"}

Scene snapshot:
${summarizeScene(sceneSnapshot) || "The learner has not built anything yet."}

Focused scene context:
${summarizeSceneContext(sceneContext)}

Build assessment:
${JSON.stringify(assessment.summary)}
Step feedback:
${assessment.stepAssessments.map((step) => `${step.title}: ${step.feedback}`).join("\n")}

Answer gate:
${assessment.answerGate.reason}

Conversation guidance:
- Be concise by default.
- Keep the learner involved in building and reasoning.
- If the build is incomplete, direct attention to the missing object or measurement.
- Do not dump the full solution unless the learner explicitly asks.
- Reference objects and helpers already in the scene when possible.
- When a selected object is available, anchor explanations to its actual dimensions and current metrics.
- When a live challenge is active, relate the reply to the current value, target, and tolerance.
- If the learner asks for a hint, give the next useful action, not the full answer.`;
}

function titlesForSuggestionIds(plan, ids = []) {
  const byId = new Map((plan?.objectSuggestions || []).map((suggestion) => [suggestion.id, suggestion.title]));
  return ids.map((id) => byId.get(id) || id);
}

function buildFallbackTutorReply({ plan, assessment, sceneContext, userMessage, contextStepId }) {
  const normalizedPlan = normalizeScenePlan(plan);
  const assessmentStepId = assessment?.summary?.currentStepId || null;
  const currentStep = normalizedPlan.buildSteps.find((step) => step.id === contextStepId)
    || normalizedPlan.buildSteps.find((step) => step.id === assessmentStepId)
    || normalizedPlan.buildSteps[0]
    || null;
  const currentStepAssessment = currentStep
    ? assessment?.stepAssessments?.find((step) => step.stepId === currentStep.id) || null
    : null;
  const missingTitles = currentStepAssessment
    ? titlesForSuggestionIds(normalizedPlan, currentStepAssessment.missingObjectIds || [])
    : [];
  const lowerMessage = String(userMessage || "").toLowerCase();
  const liveChallenge = sceneContext?.liveChallenge || null;
  const selected = sceneContext?.selection || null;

  if (liveChallenge?.unlocked && /(target|challenge|goal)/.test(lowerMessage)) {
    return `The live ${liveChallenge.metric === "surfaceArea" ? "surface area" : "volume"} target is ${liveChallenge.targetValue ?? "not set yet"}. The current value is ${liveChallenge.currentValue ?? "unknown"} and Nova accepts about +/-${liveChallenge.toleranceValue ?? "0"} tolerance.`;
  }

  if (/(hint|next)/.test(lowerMessage)) {
    if (missingTitles.length) {
      return `Next, add ${missingTitles.join(" and ")} for ${currentStep?.title || "the active step"}. That will move the build closer to the formula.`;
    }
    if (!assessment?.answerGate?.allowed) {
      return "Your next move is to finish the required scene objects so the build check turns ready.";
    }
    if (liveChallenge?.unlocked && !liveChallenge.complete) {
      return `Try reshaping the main object so its ${liveChallenge.metric === "surfaceArea" ? "surface area" : "volume"} moves from ${liveChallenge.currentValue} toward ${liveChallenge.targetValue}.`;
    }
  }

  if (/(why|explain|formula)/.test(lowerMessage)) {
    if (selected) {
      return `You're currently focused on ${selected.label}. Its dimensions are ${JSON.stringify(selected.params)}, which is why Nova tracks volume ${selected.metrics?.volume ?? "unknown"} and surface area ${selected.metrics?.surfaceArea ?? "unknown"} directly from the scene. ${normalizedPlan.answerScaffold.formula ? `The target formula here is ${normalizedPlan.answerScaffold.formula}.` : ""}`.trim();
    }
    return `Nova is using the built scene to map the measurements into ${normalizedPlan.answerScaffold.formula || "the problem formula"}. ${missingTitles.length ? `Right now the missing pieces are ${missingTitles.join(", ")}.` : "The required objects are already in place."}`;
  }

  if (!assessment?.answerGate?.allowed) {
    return missingTitles.length
      ? `The build is not complete yet. For ${currentStep?.title || "the current step"}, add ${missingTitles.join(" and ")}.`
      : `The build is still incomplete. Keep matching the required objects from the scene plan before solving.`;
  }

  if (liveChallenge?.unlocked && !liveChallenge.complete) {
    return `The required build is complete. The live challenge is active: current ${liveChallenge.metric === "surfaceArea" ? "surface area" : "volume"} ${liveChallenge.currentValue}, target ${liveChallenge.targetValue}.`;
  }

  return `The scene is in a good state to reason from. ${normalizedPlan.answerScaffold.formula ? `Use ${normalizedPlan.answerScaffold.formula} with the measurements already visible in the scene.` : "Ask about any measurement or relationship you want to inspect next."}`;
}

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
    const systemPrompt = buildSystemPrompt({
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
        for await (const chunk of converseNovaStream(MODEL_IDS.NOVA_LITE, systemPrompt, messages, {
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

export default tutorRoute;
