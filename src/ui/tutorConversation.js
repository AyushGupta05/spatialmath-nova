function normalizeText(value = "") {
  return String(value || "").trim();
}

function sentenceChunks(text = "") {
  return normalizeText(text)
    .replace(/\s+/g, " ")
    .match(/[^.!?]+[.!?]?/g)
    ?.map((part) => part.trim())
    .filter(Boolean) || [];
}

const SHORT_FOLLOW_UP_PATTERNS = [
  /^(why|how so|what changed)\??$/i,
  /^(show|give)\s+(me\s+)?(the\s+)?formula\??$/i,
  /^(explain|explain that|explain this)\??$/i,
  /^(another way|different method)\??$/i,
  /^(can you|could you)\s+(explain|show|clarify)/i,
];

const MATH_NOUN_PATTERN = /\b(angle|area|cone|coordinate|coordinates|cube|cuboid|cylinder|direction|distance|equation|find|height|intersect|intersection|line|normal|plane|point|radius|shortest|skew|sphere|surface area|vector|volume|width)\b/i;
const MATH_STRUCTURE_PATTERN = /[=+\-*/^]|\([^()]*,[^()]*\)|\b\d+(?:\.\d+)?\b/;

export function looksLikeShortFollowUp(text = "") {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (normalized.split(/\s+/).length <= 5 && SHORT_FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  return false;
}

export function isStandaloneMathProblem(text = "") {
  const normalized = normalizeText(text);
  if (!normalized || looksLikeShortFollowUp(normalized)) return false;

  const questionLike = /\?$/.test(normalized) || /\b(find|determine|calculate|compute|solve|what is|which)\b/i.test(normalized);
  const mathLike = MATH_NOUN_PATTERN.test(normalized) && MATH_STRUCTURE_PATTERN.test(normalized);
  return mathLike || (questionLike && normalized.split(/\s+/).length >= 6 && MATH_NOUN_PATTERN.test(normalized));
}

export function shouldStartLessonFromComposer({ text = "", hasPlan = false, lessonComplete = false } = {}) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (!hasPlan) return isStandaloneMathProblem(normalized);
  return Boolean(lessonComplete && isStandaloneMathProblem(normalized));
}

export function buildSuggestedQuestionActions(suggestions = []) {
  return (Array.isArray(suggestions) ? suggestions : [])
    .filter((suggestion) => suggestion?.prompt)
    .map((suggestion, index) => ({
    id: `suggested-question-${index + 1}`,
    label: suggestion.label || `Similar Question ${index + 1}`,
    kind: "start-suggested-question",
    payload: {
      prompt: suggestion.prompt,
      source: suggestion.source || "template",
    },
    }));
}

export function normalizeTutorReplyText(text = "", options = {}) {
  const normalized = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";
  if (!options.completion) return normalized;
  if (/\n\s*[-*]\s+/.test(normalized)) return normalized;

  const headingMatch = normalized.match(/^(\*\*[^*]+\*\*|Correct!?\.?)(?:\s+|$)([\s\S]*)$/i);
  if (!headingMatch) {
    const sentences = sentenceChunks(normalized);
    if (sentences.length <= 1) return normalized;
    return sentences.map((sentence, index) => (index === 0 ? sentence : `- ${sentence}`)).join("\n");
  }

  const heading = headingMatch[1].trim();
  const body = headingMatch[2].trim();
  const sentences = sentenceChunks(body);
  const filtered = sentences.filter((sentence, index) => {
    if (index !== sentences.length - 1) return true;
    return !/\?\s*$/.test(sentence);
  });
  if (!filtered.length) return heading;

  return [
    heading,
    ...filtered.map((sentence) => `- ${sentence}`),
  ].join("\n");
}
