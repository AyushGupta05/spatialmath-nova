function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hasUnitInValue(valueText = "", unitText = "") {
  if (!valueText || !unitText) return false;
  const normalizedValue = normalizeText(valueText).toLowerCase();
  const normalizedUnit = normalizeText(unitText).toLowerCase();
  if (!normalizedValue || !normalizedUnit) return false;
  if (normalizedValue.includes(normalizedUnit)) return true;
  if (normalizedUnit === "degrees" && /°|degrees?/.test(normalizedValue)) return true;
  return false;
}

function stringifyFinalAnswer(finalAnswer = null) {
  if (Array.isArray(finalAnswer)) {
    const values = finalAnswer.map((value) => String(value).trim()).filter(Boolean);
    return values.length ? `(${values.join(", ")})` : "";
  }
  return String(finalAnswer ?? "").trim();
}

export function formatPlanFinalAnswer(plan = {}) {
  const valueText = stringifyFinalAnswer(plan?.answerScaffold?.finalAnswer);
  const unitText = normalizeText(plan?.answerScaffold?.unit || "");
  if (!valueText) {
    return {
      valueText: "",
      unitText: "",
      text: "",
    };
  }

  return {
    valueText,
    unitText,
    text: hasUnitInValue(valueText, unitText) || !unitText
      ? valueText
      : `${valueText} ${unitText}`.trim(),
  };
}

export function isExplicitSolutionRequest(text = "") {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) return false;

  return [
    /\bview (the )?solution\b/,
    /\bshow (me )?(the )?(solution|answer)\b/,
    /\breveal (the )?(solution|answer)\b/,
    /\bfinal answer\b/,
    /\bworked solution\b/,
    /\bwhat('?s| is) the answer\b/,
    /\bjust tell me\b/,
    /\bgive me the answer\b/,
    /\bi want the answer\b/,
    /\bsolve it for me\b/,
  ].some((pattern) => pattern.test(normalized));
}

export function buildSolutionRevealText(plan = {}) {
  const finalAnswer = formatPlanFinalAnswer(plan);
  const formula = normalizeText(plan?.analyticContext?.formulaCard?.formula || plan?.answerScaffold?.formula || "");
  const explanation = normalizeText(plan?.analyticContext?.formulaCard?.explanation || plan?.answerScaffold?.explanation || "");
  const solutionSteps = Array.isArray(plan?.analyticContext?.solutionSteps)
    ? plan.analyticContext.solutionSteps
        .map((step) => {
          const title = normalizeText(step?.title || "");
          const stepFormula = normalizeText(step?.formula || "");
          const stepExplanation = normalizeText(step?.explanation || "");
          if (!title && !stepFormula && !stepExplanation) return "";
          const summary = [
            stepFormula ? `$${stepFormula}$` : "",
            stepExplanation,
          ].filter(Boolean).join(" - ");
          return `- **${title || "Step"}:** ${summary || "Use the visible scene to finish the calculation."}`;
        })
        .filter(Boolean)
    : [];

  const blocks = ["Here is the full worked solution."];
  if (formula) {
    blocks.push(`**Formula:** $$${formula}$$`);
  }
  if (explanation) {
    blocks.push(explanation);
  }
  if (solutionSteps.length) {
    blocks.push(solutionSteps.join("\n"));
  }
  if (finalAnswer.text) {
    blocks.push(`**Final answer:** $$${finalAnswer.text}$$`);
  } else {
    blocks.push("**Final answer:** Use the final highlighted scene and the last calculation step together.");
  }

  return blocks.join("\n\n");
}
