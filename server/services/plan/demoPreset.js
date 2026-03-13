function firstValue(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function buildDemoPreset({ plan, sourceSummary, exemplar = null }) {
  const category = exemplar?.recommendedCategory || "Best of Multimodal Understanding";
  const concept = plan?.sceneFocus?.concept || sourceSummary?.cleanedQuestion || "spatial reasoning";
  const insight = plan?.sceneFocus?.judgeSummary || plan?.overview || "Nova turns a worksheet into an interactive 3D lesson.";

  return {
    title: firstValue(exemplar?.title, `Nova Prism: ${concept}`),
    scriptBeat: firstValue(
      exemplar?.scriptBeat,
      `We start from a flat worksheet, turn it into a live 3D lesson, and let Nova coach the learner through build, prediction, and feedback. ${insight}`
    ),
    recommendedCategory: category,
  };
}
