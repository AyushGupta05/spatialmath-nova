import katex from "../../node_modules/katex/dist/katex.mjs";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

const MATH_TOKEN_PATTERN = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\]|(?<!\\)\$[^$\n]+?(?<!\\)\$)/g;
const LATEX_INPUT_PATTERN = /(^|[^\\])(\${1,2}|\\\(|\\\[)|\\(?:frac|sqrt|theta|pi|cdot|times|vec|left|right|angle|approx|epsilon|lambda|sigma|phi|alpha|beta|gamma|Delta)|[_^]/;
const STANDALONE_MATH_PATTERN = /[=^_]|[θπ·√≈≤≥∞]|(?:\b(?:sin|cos|tan|theta|pi|epsilon|lambda|sigma|phi|angle|distance|vector|plane|line)\b)/i;
const PROSE_PATTERN = /\b(?:the|and|or|use|if|when|what|which|before|after|look|compare|between|helpful|because|then|find|show|tell|explain)\b/i;

function stripMathDelimiters(value = "") {
  const text = String(value || "").trim();
  if (text.startsWith("$$") && text.endsWith("$$")) return text.slice(2, -2).trim();
  if (text.startsWith("\\[") && text.endsWith("\\]")) return text.slice(2, -2).trim();
  if (text.startsWith("\\(") && text.endsWith("\\)")) return text.slice(2, -2).trim();
  if (text.startsWith("$") && text.endsWith("$")) return text.slice(1, -1).trim();
  return text;
}

function normalizePlainMath(text = "") {
  return stripMathDelimiters(text)
    .replaceAll("·", " \\cdot ")
    .replaceAll("⋅", " \\cdot ")
    .replaceAll("×", " \\times ")
    .replaceAll("÷", " \\div ")
    .replaceAll("≈", " \\approx ")
    .replaceAll("≤", " \\le ")
    .replaceAll("≥", " \\ge ")
    .replaceAll("°", "^\\circ")
    .replace(/(?<!\\)\btheta\b/gi, "\\theta")
    .replace(/(?<!\\)\bpi\b/gi, "\\pi")
    .replace(/(?<!\\)\bepsilon\b/gi, "\\epsilon")
    .replace(/(?<!\\)\blambda\b/gi, "\\lambda")
    .replace(/(?<!\\)\bsigma\b/gi, "\\sigma")
    .replace(/(?<!\\)\bphi\b/gi, "\\phi")
    .replace(/(?<!\\)\balpha\b/gi, "\\alpha")
    .replace(/(?<!\\)\bbeta\b/gi, "\\beta")
    .replace(/(?<!\\)\bgamma\b/gi, "\\gamma")
    .replace(/(?<!\\)\bdelta\b/gi, "\\delta")
    .replace(/\s+x\s+/g, " \\times ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderMathHtml(expression = "", { displayMode = false } = {}) {
  const source = normalizePlainMath(expression);
  if (!source) return "";
  try {
    return katex.renderToString(source, {
      displayMode,
      throwOnError: false,
      strict: "ignore",
      output: "htmlAndMathml",
    });
  } catch {
    return `<code>${escapeHtml(String(expression || "").trim())}</code>`;
  }
}

function formatInlineText(text = "") {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function tokenToMath(token = "") {
  if (token.startsWith("$$") && token.endsWith("$$")) {
    return { displayMode: true, body: token.slice(2, -2) };
  }
  if (token.startsWith("\\[") && token.endsWith("\\]")) {
    return { displayMode: true, body: token.slice(2, -2) };
  }
  if (token.startsWith("\\(") && token.endsWith("\\)")) {
    return { displayMode: false, body: token.slice(2, -2) };
  }
  if (token.startsWith("$") && token.endsWith("$")) {
    return { displayMode: false, body: token.slice(1, -1) };
  }
  return { displayMode: false, body: token };
}

function renderInlineMixedHtml(text = "") {
  const source = String(text || "");
  let lastIndex = 0;
  let output = "";

  for (const match of source.matchAll(MATH_TOKEN_PATTERN)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      output += formatInlineText(source.slice(lastIndex, index));
    }
    const math = tokenToMath(token);
    output += renderMathHtml(math.body, { displayMode: math.displayMode });
    lastIndex = index + token.length;
  }

  if (lastIndex < source.length) {
    output += formatInlineText(source.slice(lastIndex));
  }

  return output || formatInlineText(source);
}

function isStandaloneMathLine(line = "") {
  const normalized = String(line || "").trim();
  if (!normalized) return false;
  if (/^(?:\$\$[\s\S]+\$\$|\\\[[\s\S]+\\\]|\\\([\s\S]+\\\)|(?<!\\)\$[^$\n]+(?<!\\)\$)$/.test(normalized)) {
    return true;
  }
  if (PROSE_PATTERN.test(normalized)) return false;
  if (!STANDALONE_MATH_PATTERN.test(normalized)) return false;
  if (/[.?!]$/.test(normalized)) return false;
  return normalized.split(/\s+/).length <= 10;
}

export function hasMathMarkup(text = "") {
  const normalized = String(text || "").trim();
  if (!normalized) return false;
  return LATEX_INPUT_PATTERN.test(normalized) || isStandaloneMathLine(normalized);
}

export function renderRichTextHtml(content = "") {
  const normalized = String(content || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return `<p class="chat-msg-paragraph"></p>`;
  }

  const lines = normalized.split("\n");
  const blocks = [];
  let listItems = [];

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(`<ul class="chat-msg-list">${listItems.join("")}</ul>`);
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      listItems.push(`<li>${renderInlineMixedHtml(bulletMatch[1])}</li>`);
      continue;
    }

    flushList();
    if (isStandaloneMathLine(line)) {
      blocks.push(`<div class="chat-msg-display-math">${renderMathHtml(line, { displayMode: true })}</div>`);
      continue;
    }

    blocks.push(`<p class="chat-msg-paragraph">${renderInlineMixedHtml(line)}</p>`);
  }

  flushList();
  return blocks.join("");
}

export function renderMathBlockHtml(content = "", { displayMode = true } = {}) {
  const normalized = String(content || "").trim();
  if (!normalized) return "";
  return renderMathHtml(normalized, { displayMode });
}
