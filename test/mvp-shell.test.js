import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("index.html keeps the chat-first tutor shell and removes judge demo panels", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

  assert.doesNotMatch(html, /Try Judge Demo/i);
  assert.doesNotMatch(html, /Source Evidence/i);
  assert.doesNotMatch(html, /Agent Trace/i);
  assert.doesNotMatch(html, /Lesson Draft/i);
  assert.match(html, /id="lessonPanelToggle"/);
  assert.match(html, /id="lessonPanelSummary"/);
  assert.match(html, /id="stageRail"/);
  assert.match(html, /id="formulaCard"/);
  assert.match(html, /id="solutionDrawer"/);
  assert.match(html, /id="solutionDrawerAnswer"/);
  assert.match(html, /id="questionMathPreview"/);
  assert.match(html, /id="chatMessages"/);
  assert.match(html, /id="chatMathPreview"/);
  assert.match(html, /id="chatCheckpoint"/);
  assert.match(html, /id="voiceRecordBtn"/);
});
