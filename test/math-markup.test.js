import test from "node:test";
import assert from "node:assert/strict";

import { hasMathMarkup, renderMathBlockHtml, renderRichTextHtml } from "../src/ui/mathMarkup.js";

test("renderRichTextHtml typesets inline LaTeX inside chat content", () => {
  const source = "Use $\\theta = 90^\\circ$ before you compare the vectors.";
  const html = renderRichTextHtml(source);

  assert.equal(hasMathMarkup(source), true);
  assert.match(html, /katex/);
});

test("renderMathBlockHtml typesets plain-text formulas for lesson cards", () => {
  const html = renderMathBlockHtml("cos(theta) = (AB · AC) / (|AB||AC|)");

  assert.match(html, /katex/);
  assert.doesNotMatch(html, /<code>/);
});
