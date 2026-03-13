function uniqueStrings(values = []) {
  return [...new Set(
    values
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean)
  )];
}

export function buildSourceEvidence(sourceSummary = {}) {
  return {
    inputMode: sourceSummary.inputMode || "text",
    givens: uniqueStrings(sourceSummary.givens || []),
    diagramSummary: typeof sourceSummary.diagramSummary === "string" ? sourceSummary.diagramSummary : "",
    conflicts: uniqueStrings(sourceSummary.conflicts || []),
  };
}
