import { normalizeScenePlan } from "../../src/ai/planSchema.js";

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
  const sceneFocus = sceneContext?.sceneFocus
    ? `Scene focus: concept=${sceneContext.sceneFocus.concept || "n/a"} insight=${sceneContext.sceneFocus.primaryInsight || "n/a"}`
    : "Scene focus: none";
  const sourceSummary = sceneContext?.sourceSummary
    ? `Source summary: cleanedQuestion=${sceneContext.sourceSummary.cleanedQuestion || "n/a"} givens=${JSON.stringify(sceneContext.sourceSummary.givens || [])} relationships=${JSON.stringify(sceneContext.sourceSummary.relationships || [])}`
    : "Source summary: none";
  const guidance = sceneContext?.guidance
    ? `Guidance: ${sceneContext.guidance.coachFeedback || "n/a"}`
    : "Guidance: none";
  const representation = sceneContext?.representationMode
    ? `Representation mode: ${sceneContext.representationMode}`
    : "Representation mode: 3d";
  return `${selection}\n${liveChallenge}\n${sceneFocus}\n${sourceSummary}\n${guidance}\n${representation}`;
}

function summarizeDerivedValues(analytic = {}) {
  const derived = analytic.derivedValues || {};
  if (!Object.keys(derived).length) return "";
  const entries = Object.entries(derived)
    .map(([key, value]) => `${key} = ${Array.isArray(value) ? `(${value.join(", ")})` : value}`)
    .join(", ");
  return `\nIntermediate computed values: ${entries}`;
}

function summarizeEntities(analytic = {}) {
  const entities = analytic.entities || {};
  const parts = [];
  (entities.lines || []).forEach((line) => {
    parts.push(`${line.label}: point=${JSON.stringify(line.point)} direction=${JSON.stringify(line.direction)}`);
  });
  (entities.points || []).forEach((point) => {
    parts.push(`${point.label}: coordinates=${JSON.stringify(point.coordinates)}`);
  });
  (entities.planes || []).forEach((plane) => {
    parts.push(`${plane.label}: normal=${JSON.stringify(plane.normal)} d=${plane.d}`);
  });
  return parts.length ? `\nEntities: ${parts.join("; ")}` : "";
}

function summarizeAnalyticContext(plan = {}, _sceneContext = {}, contextStepId = null, learningState = {}) {
  if (plan?.experienceMode !== "analytic_auto") return "Analytic context: none";
  const currentMoment = (plan.sceneMoments || []).find((moment) => moment.id === contextStepId)
    || plan.sceneMoments?.[learningState?.currentStep || 0]
    || plan.sceneMoments?.[0]
    || null;
  const analytic = plan.analyticContext || {};
  const steps = (analytic.solutionSteps || [])
    .map((step) => `${step.title}: ${step.formula || step.explanation}`)
    .join("\n");
  return [
    `Analytic subtype: ${analytic.subtype || "unknown"}`,
    `Formula card: ${analytic.formulaCard?.formula || "n/a"}`,
    `Formula explanation: ${analytic.formulaCard?.explanation || "n/a"}`,
    currentMoment ? `Current scene moment: ${currentMoment.title} -> ${currentMoment.prompt}` : "Current scene moment: none",
    steps ? `Deterministic solution steps:\n${steps}` : "Deterministic solution steps: none",
    summarizeEntities(analytic),
    summarizeDerivedValues(analytic),
  ].join("\n");
}

function titlesForSuggestionIds(plan, ids = []) {
  const byId = new Map((plan?.objectSuggestions || []).map((suggestion) => [suggestion.id, suggestion.title]));
  return ids.map((id) => byId.get(id) || id);
}

function stuckStrategy(stuckCount = 0) {
  if (stuckCount <= 1) return "ANALOGY";
  if (stuckCount === 2) return "SIMPLER_QUESTION";
  return "SCENE_FOCUS";
}

function buildVerdictInstructions(verdict, learningState = {}) {
  if (!verdict) return "";

  const stuckCount = learningState?.stuckCount || 0;

  switch (verdict.verdict) {
    case "CORRECT":
      return `

=== EVALUATION RESULT: CORRECT ===
The learner demonstrated correct understanding.
What they understood: ${verdict.what_was_right}

Response rules for this turn:
- Tone: warm but not over-the-top. Do NOT say "Great job!" or "Excellent!"
- Reference what they specifically said that was right.
- Bridge naturally to the next stage concept. Max 2 sentences before the bridge.
- End with a question that opens the next concept.`;

    case "PARTIAL":
      return `

=== EVALUATION RESULT: PARTIAL ===
What was right: ${verdict.what_was_right}
The gap: ${verdict.gap || "unspecified"}
Misconception type: ${verdict.misconception_type || "none identified"}

Response rules for this turn:
- Explicitly name what they got right FIRST.
- Then redirect to the gap using a scene reference ("look at the highlighted faces...").
- Do NOT reveal the answer yet.
- End with a targeted question that isolates the gap.
- Max 3 sentences total. This constraint is not optional.`;

    case "STUCK":
      return `

=== EVALUATION RESULT: STUCK ===
Misconception type: ${verdict.misconception_type || "none identified"}
Hint level: ${stuckCount + 1} (consecutive times stuck on this stage)
Strategy: ${stuckStrategy(stuckCount)}

Response rules for this turn:
- Use the ${stuckStrategy(stuckCount)} strategy. Pick ONE approach only:
  - ANALOGY: if they're confused about the concept itself, relate it to something concrete
  - SIMPLER_QUESTION: break the current question into a smaller, answerable piece
  - SCENE_FOCUS: point them to a specific object or relationship visible in the scene
- Keep it short. One question at the end. No answer.${stuckCount >= 2 ? "\n- Mention that they can tap 'View Solution' if they'd like to see the full worked solution." : ""}`;

    default:
      return "";
  }
}

export function buildTutorSystemPrompt({ plan, sceneSnapshot, sceneContext, learningState, contextStepId, assessment, conceptVerdict }) {
  const normalizedPlan = normalizeScenePlan(plan);
  const currentStep = normalizedPlan.buildSteps.find((step) => step.id === contextStepId)
    || normalizedPlan.buildSteps[learningState?.currentStep || 0]
    || null;
  const learningStage = learningState?.learningStage || "orient";
  const learningMoment = normalizedPlan.learningMoments?.[learningStage] || {};

  return `You are Nova Prism, a spatial-maths tutor inspired by 3Blue1Brown's visual teaching and Khan Academy's Socratic tutoring.

Your core philosophy:
- NEVER give the answer directly. Guide the learner to discover it themselves through the 3D scene.
- Show, don't tell. Point to what's visible in the scene rather than explaining abstractly.
- Ask one focused question at a time. "What do you notice about..." or "What would happen if..."
- Build intuition before formulas. The scene IS the explanation.
- Be warm, curious, and brief. Sound like a thoughtful guide, not a textbook.
- Keep your answers VERY CONCISE. Avoid long paragraphs. Use markdown bullet points generously to improve readability and break up ideas.
- ALWAYS end with exactly one question that nudges the learner to think or look at the scene.

Problem: ${normalizedPlan.sourceSummary.cleanedQuestion || normalizedPlan.problem.question}
Question type: ${normalizedPlan.problem.questionType}
Overview: ${normalizedPlan.overview}
Learning stage: ${learningStage}
Current lesson focus: ${normalizedPlan.sceneFocus.primaryInsight}

Current build step:
${currentStep ? `${currentStep.title}: ${currentStep.instruction}` : "No active step"}

Current lesson card intent:
Title: ${learningMoment.title || learningStage}
Coach message: ${learningMoment.coachMessage || ""}
Goal: ${learningMoment.goal || ""}
Prediction prompt: ${learningMoment.prompt || ""}

Scene snapshot:
${summarizeScene(sceneSnapshot) || "The learner has not built anything yet."}

Focused scene context:
${summarizeSceneContext(sceneContext)}

Analytic lesson context:
${summarizeAnalyticContext(normalizedPlan, sceneContext, contextStepId, learningState)}

Build assessment:
${JSON.stringify(assessment.summary)}
Step feedback:
${assessment.stepAssessments.map((step) => `${step.title}: ${step.feedback}`).join("\n")}
Guidance feedback:
${assessment.guidance?.coachFeedback || "n/a"}

Answer gate:
${assessment.answerGate.reason}

Exact answer: ${normalizedPlan.answerScaffold?.finalAnswer || "not available"}${normalizedPlan.answerScaffold?.unit ? ` ${normalizedPlan.answerScaffold.unit}` : ""}

Answer-checking rules (CRITICAL - follow precisely):
When the learner submits a numeric answer or asks "is X correct?", you MUST check it against the exact answer above. You have every intermediate value and entity listed in the analytic context. Use them.

CASE 1 — CLOSE ENOUGH (within ~5% or reasonable rounding, e.g. 2.3 vs 2.3094):
  Say: "Correct! [brief praise]. For exact precision, it's [exact answer]. [One sentence connecting the answer to the scene, e.g. 'That matches the length of the golden segment connecting the two lines.']"

CASE 2 — WRONG but you can diagnose the mistake:
  Before responding, silently run through these checks using the intermediate computed values and entities above:
  - Did they swap v1 and v2? (Compute what the answer would be with swapped vectors)
  - Did they forget the absolute value? (Would the answer be negative of theirs?)
  - Did they forget to divide by |v1 x v2|? (Is their answer the unnormalized dot product?)
  - Did they use the wrong formula entirely? (e.g. point-to-line instead of line-to-line)
  - Did they confuse a point coordinate with a direction vector?
  - Did they make an arithmetic error in the cross product or dot product?
  - Did they swap numerator and denominator?
  Once you identify the likely source, respond: "Not quite. Check [specific step] — look at [specific variable or value in the scene]. Did you [specific action that would produce their wrong answer]? Try recalculating just that part."
  NEVER reveal the correct answer when they're wrong. Guide them to fix their specific mistake.

CASE 3 — WRONG and you cannot figure out where it came from:
  Say: "That's not matching what the scene shows. Let's work through it together — what formula did you start with? Walk me through your steps and I'll help you spot where it went off track."
  Then guide them step-by-step through the solution, asking them to compute each intermediate value one at a time.

Conversation rules:
- Keep responses easy to scan:
  1. Start with one orienting sentence.
  2. Optionally add up to 2 bullets for the key visual clues.
  3. End with exactly one question that nudges the learner to think or look at the scene.
- ALWAYS end with a question that nudges the learner to think or look at the scene. Examples:
  "What do you notice about how these two shapes compare?"
  "Look at the highlighted edge. What happens to the volume if you stretch it?"
  "Before I show you the formula, what's your gut feeling?"
- When the learner asks "what's the answer?" or "just tell me", respond with:
  "Let's figure it out together. Look at [specific scene element] - what does it tell you?"
  If they insist, say: "I can show you the solution - tap 'View Solution' when you're ready. But first, what's your best guess?"
- If the build is incomplete, point to the specific missing piece in the scene.
- If the stage is predict, help them commit to a prediction. Don't explain yet.
- If the stage is check, ask them to compare their prediction with what the scene shows.
- If the stage is reflect, prompt them to state the insight in their own words.
- Reference specific objects by name. Say "look at cylinder A" not "consider the shape."
- When a selected object is available, anchor to its actual dimensions and metrics.
- When the learner is stuck, give the smallest useful nudge, not a full explanation.
- Never recite formulas unless the learner has already attempted reasoning and asks to see one.
- Never say "Great question!" or similar filler. Jump straight into the guiding thought.${buildVerdictInstructions(conceptVerdict, learningState)}`;
}

export function buildFallbackTutorReply({ plan, assessment, sceneContext, userMessage, contextStepId }) {
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
  const learningStage = sceneContext?.guidance?.readyForPrediction ? "predict-ready" : "building";
  const companionHint = normalizedPlan.representationMode !== "3d"
    ? "Use the 2D companion to compare each face once."
    : "";

  const finalAnswer = normalizedPlan.answerScaffold?.finalAnswer;
  const answerMatch = lowerMessage.match(/(?:is\s+(?:the\s+)?answer\s+|(?:^|\s))(\d+(?:\.\d+)?)/);
  if (finalAnswer && answerMatch) {
    const userAnswer = parseFloat(answerMatch[1]);
    const expected = parseFloat(finalAnswer);
    if (Number.isFinite(userAnswer) && Number.isFinite(expected)) {
      const tolerance = Math.max(Math.abs(expected) * 0.05, 0.05);
      if (Math.abs(userAnswer - expected) <= tolerance) {
        const isExact = String(userAnswer) === String(expected);
        return isExact
          ? `Correct! That's exactly right. Look at the highlighted segment in the scene — its length matches your answer perfectly.`
          : `Correct! For exact precision, the answer is ${finalAnswer}. Look at the highlighted segment in the scene — its length matches.`;
      }
      return `That's not matching what the scene shows. Let's work through it together — what formula did you start with? Walk me through your steps and I'll help you spot where it went off track.`;
    }
  }

  if (normalizedPlan.experienceMode === "analytic_auto") {
    const currentMoment = normalizedPlan.sceneMoments.find((moment) => moment.id === contextStepId)
      || normalizedPlan.sceneMoments[0]
      || null;
    if (/(formula|equation)/.test(lowerMessage)) {
      return `${normalizedPlan.analyticContext?.formulaCard?.formula || normalizedPlan.answerScaffold.formula || "The formula card is ready."} ${normalizedPlan.analyticContext?.formulaCard?.explanation || ""}`.trim();
    }
    if (/(next|highlight|show)/.test(lowerMessage)) {
      return currentMoment?.goal
        ? `${currentMoment.goal} Use the highlighted objects, then reveal the next visual step when you're ready.`
        : "Use the highlighted objects, then reveal the next visual step when you're ready.";
    }
    return `${currentMoment?.prompt || normalizedPlan.sceneFocus?.primaryInsight || "Use the scene to explain the idea."} ${normalizedPlan.answerScaffold.formula ? `The key formula here is ${normalizedPlan.answerScaffold.formula}.` : ""}`.trim();
  }

  if (liveChallenge?.unlocked && /(target|challenge|goal)/.test(lowerMessage)) {
    return `The live ${liveChallenge.metric === "surfaceArea" ? "surface area" : "volume"} target is ${liveChallenge.targetValue ?? "not set yet"}. The current value is ${liveChallenge.currentValue ?? "unknown"} and Nova accepts about +/-${liveChallenge.toleranceValue ?? "0"} tolerance.`;
  }

  if (/(hint|next|stuck|help)/.test(lowerMessage)) {
    if (missingTitles.length) {
      return `Look at the scene. What's missing? Think about what ${missingTitles.join(" and ")} would add to the picture. ${companionHint}`.trim();
    }
    if (assessment?.guidance?.readyForPrediction) {
      return `The scene is set. ${companionHint} Before I explain anything, what's your gut feeling about the answer?`.trim();
    }
    if (!assessment?.answerGate?.allowed) {
      return "There's still something to build. Look at the scene - what shape or relationship is missing?";
    }
    if (liveChallenge?.unlocked && !liveChallenge.complete) {
      return `What would you need to change so the ${liveChallenge.metric === "surfaceArea" ? "surface area" : "volume"} moves from ${liveChallenge.currentValue} toward ${liveChallenge.targetValue}?`;
    }
  }

  if (/(why|explain|formula)/.test(lowerMessage)) {
    if (selected) {
      return `Look at ${selected.label}. Its volume is ${selected.metrics?.volume ?? "unknown"} and surface area is ${selected.metrics?.surfaceArea ?? "unknown"}. ${companionHint} What do those numbers tell you about the shape?`.trim();
    }
    return `Look at the objects in the scene. ${companionHint} ${missingTitles.length ? `What would change if you added ${missingTitles.join(", ")}?` : "What relationship do you notice between them?"}`.trim();
  }

  if (learningStage === "predict-ready") {
    return "The scene is ready. Before we go further, what do you think the answer will be?";
  }

  if (!assessment?.answerGate?.allowed) {
    return missingTitles.length
      ? `Look at the scene. ${companionHint} What would ${missingTitles.join(" and ")} add to the picture?`.trim()
      : "There's more to build. What do you think is missing from the scene?";
  }

  if (liveChallenge?.unlocked && !liveChallenge.complete) {
    return `The scene is built. The ${liveChallenge.metric === "surfaceArea" ? "surface area" : "volume"} is currently ${liveChallenge.currentValue}. How would you get it to ${liveChallenge.targetValue}?`;
  }

  return "What do you notice in the scene? What stands out to you?";
}
