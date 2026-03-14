function normalizeWhitespace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractTuple(text = "") {
  const tupleMatch = String(text || "").match(/\(([^()]+)\)/);
  if (!tupleMatch) return null;
  const values = tupleMatch[1]
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value));
  return values.length >= 2 ? values : null;
}

function extractNumbers(text = "") {
  return String(text || "")
    .replaceAll(",", "")
    .match(/[-+]?\d*\.?\d+/g)
    ?.map((value) => Number(value))
    .filter((value) => Number.isFinite(value)) || [];
}

function numericTolerance(expectedText = "", expectedValue = 0) {
  const fraction = String(expectedText || "").match(/\.(\d+)/);
  if (fraction?.[1]?.length) {
    return Math.max(0.01, 2 * (10 ** (-fraction[1].length)));
  }
  return Math.max(0.5, Math.abs(expectedValue) * 0.005);
}

function compareNumeric(expectedValue, actualValue, tolerance) {
  return Math.abs(actualValue - expectedValue) <= tolerance;
}

function compareTuple(expectedTuple = [], actualTuple = [], tolerance = 0.02) {
  if (expectedTuple.length !== actualTuple.length) return false;
  return expectedTuple.every((value, index) => compareNumeric(value, actualTuple[index], tolerance));
}

export function evaluateTutorCompletion({ plan, userMessage }) {
  const finalAnswer = plan?.answerScaffold?.finalAnswer;
  const normalizedMessage = normalizeWhitespace(userMessage);
  if (!finalAnswer || !normalizedMessage) {
    return { complete: false, reason: null };
  }

  if (Array.isArray(finalAnswer)) {
    const actualTuple = extractTuple(normalizedMessage) || extractNumbers(normalizedMessage);
    return {
      complete: compareTuple(finalAnswer.map(Number), actualTuple, 0.02),
      reason: compareTuple(finalAnswer.map(Number), actualTuple, 0.02) ? "correct-answer" : null,
    };
  }

  const expectedText = normalizeWhitespace(finalAnswer);
  const expectedTuple = extractTuple(expectedText);
  if (expectedTuple) {
    const actualTuple = extractTuple(normalizedMessage) || extractNumbers(normalizedMessage);
    const complete = compareTuple(expectedTuple, actualTuple, 0.02);
    return { complete, reason: complete ? "correct-answer" : null };
  }

  const expectedNumbers = extractNumbers(expectedText);
  const actualNumbers = extractNumbers(normalizedMessage);
  if (expectedNumbers.length && actualNumbers.length) {
    const expectedValue = expectedNumbers[0];
    const actualValue = actualNumbers[0];
    const complete = compareNumeric(expectedValue, actualValue, numericTolerance(expectedText, expectedValue));
    return { complete, reason: complete ? "correct-answer" : null };
  }

  const normalizedExpected = expectedText.toLowerCase();
  const normalizedActual = normalizedMessage.toLowerCase();
  const complete = normalizedExpected.length > 0 && normalizedActual.includes(normalizedExpected);
  return { complete, reason: complete ? "correct-answer" : null };
}
