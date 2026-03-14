import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanupJson } from "./plan/shared.js";
import { converseWithModelFailover } from "./modelInvoker.js";
import { hasAwsCredentials } from "./modelRouter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHALLENGE_DATA_PATH = join(__dirname, "..", "data", "challenges.json");

const ANALYTIC_TEMPLATES = {
  line_plane_angle: [
    {
      label: "New Line-Plane Angle",
      prompt: "In three-dimensional space, a line passes through the point B(2, -1, 4) and has direction vector (1, 2, -2). A plane has equation x - 2y + 2z = 5. Find the acute angle between the line and the plane.",
    },
    {
      label: "Angle Through the Normal",
      prompt: "A line passes through the point C(-1, 3, 2) with direction vector (2, 1, 1). A plane has equation 2x + y - z = 4. Find the acute angle between the line and the plane.",
    },
    {
      label: "Another Acute Angle",
      prompt: "A line passes through the point D(0, -2, 1) and has direction vector (3, -1, 2). A plane has equation x + 2y + 2z = 6. Find the acute angle between the line and the plane.",
    },
  ],
  line_plane_intersection: [
    {
      label: "Fresh Intersection",
      prompt: "A line passes through the point Q(2, -1, 0) with direction vector (1, 3, 2). A plane has equation x + y + z = 5. Find the coordinates of the point where the line intersects the plane.",
    },
    {
      label: "Parametric Contact Point",
      prompt: "A line passes through the point R(-1, 2, 4) with direction vector (2, -1, 1). A plane has equation 2x - y + z = 3. Find the coordinates of the point where the line intersects the plane.",
    },
    {
      label: "Line Meets Plane",
      prompt: "A line passes through the point S(3, 0, -2) with direction vector (-1, 2, 3). A plane has equation x + 2y - z = 7. Find the coordinates of the intersection point.",
    },
  ],
  skew_lines_distance: [
    {
      label: "Shortest Connector",
      prompt: "Two lines in space are given by r1 = (1,0,2) + t(2,1,-1), r2 = (4,-2,1) + s(1,-1,2). Find the shortest distance between the two skew lines.",
    },
    {
      label: "Common Perpendicular",
      prompt: "Two lines in space are given by r1 = (-1,2,0) + t(1,2,1), r2 = (3,-1,4) + s(2,-1,0). Find the shortest distance between the two skew lines.",
    },
    {
      label: "Skew Distance Practice",
      prompt: "Two lines in space are given by r1 = (2,1,-1) + t(3,-2,1), r2 = (0,4,2) + s(1,1,-2). Find the shortest distance between the two skew lines.",
    },
  ],
};

const QUESTION_TYPE_TEMPLATES = {
  volume: [
    {
      label: "Cylinder Volume",
      prompt: "Find the volume of a cylinder with radius 4 and height 6. Round to two decimal places.",
    },
    {
      label: "Cone Volume",
      prompt: "Find the volume of a cone with radius 3 and height 10. Round to two decimal places.",
    },
    {
      label: "Sphere Volume",
      prompt: "Find the volume of a sphere with radius 5. Round to two decimal places.",
    },
  ],
  surface_area: [
    {
      label: "Cylinder Surface Area",
      prompt: "Find the total surface area of a cylinder with radius 3 and height 8. Round to two decimal places.",
    },
    {
      label: "Cuboid Surface Area",
      prompt: "Find the surface area of a cuboid with width 6, height 2, and depth 5.",
    },
    {
      label: "Cone Surface Area",
      prompt: "Find the total surface area of a cone with radius 4 and slant height 9. Round to two decimal places.",
    },
  ],
  comparison: [
    {
      label: "Compare Two Volumes",
      prompt: "Which has a greater volume: a cylinder with radius 3 and height 8, or a cone with radius 4 and height 12? By how much? Round to two decimal places.",
    },
    {
      label: "Cube vs Sphere",
      prompt: "Which has a greater volume: a cube with side 6, or a sphere with radius 3? By how much? Round to two decimal places.",
    },
    {
      label: "Two Solids, One Winner",
      prompt: "Which has a greater volume: a cuboid with dimensions 4, 5, and 7, or a cylinder with radius 3 and height 10? By how much? Round to two decimal places.",
    },
  ],
  spatial: [
    {
      label: "3D Coordinate Practice",
      prompt: "In three-dimensional space, points A(1, 2, 3) and B(4, -1, 5) are given. Find the midpoint of AB and the distance between the two points.",
    },
    {
      label: "Vector Geometry",
      prompt: "A line passes through P(2, -1, 4) with direction vector (1, 2, -2). Find a second point on the line and explain how the direction vector controls its path.",
    },
    {
      label: "Plane and Point",
      prompt: "A plane has equation x + 2y - z = 6 and a point A(2, 1, 0). Determine whether the point lies on the plane and justify your answer.",
    },
  ],
  composite: [
    {
      label: "Composite Volume",
      prompt: "A hemisphere of radius 3 sits on top of a cylinder of radius 3 and height 5. Find the total volume. Round to two decimal places.",
    },
    {
      label: "Layered Solid",
      prompt: "A cone of radius 4 and height 6 sits on top of a cylinder of radius 4 and height 8. Find the total volume. Round to two decimal places.",
    },
    {
      label: "Two-Part Solid",
      prompt: "A sphere of radius 2 is attached to the top of a cube of side 4. Find the combined volume. Round to two decimal places.",
    },
  ],
};

let cachedChallenges = null;

function normalizeText(value = "") {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function uniqueByPrompt(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const key = normalizeText(item.prompt);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function tokenize(value = "") {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 3);
}

function conceptKeywords(plan) {
  const subtype = plan?.analyticContext?.subtype || "";
  const base = new Set(tokenize(plan?.problem?.question || ""));
  const extras = {
    line_plane_angle: ["line", "plane", "angle", "normal", "vector", "acute"],
    line_plane_intersection: ["line", "plane", "intersection", "coordinates", "direction", "point"],
    skew_lines_distance: ["skew", "lines", "distance", "shortest", "perpendicular", "space"],
    volume: ["volume", "solid", "radius", "height"],
    surface_area: ["surface", "area", "faces", "lateral"],
    comparison: ["compare", "greater", "difference", "volume"],
  };
  for (const token of extras[subtype] || extras[plan?.problem?.questionType] || []) {
    base.add(token);
  }
  return [...base];
}

function overlapScore(keywords = [], text = "") {
  const tokens = new Set(tokenize(text));
  return keywords.reduce((score, keyword) => score + (tokens.has(keyword) ? 1 : 0), 0);
}

async function loadChallenges() {
  if (!cachedChallenges) {
    const raw = await readFile(CHALLENGE_DATA_PATH, "utf-8");
    cachedChallenges = JSON.parse(raw);
  }
  return cachedChallenges;
}

function deterministicSuggestions(plan, limit = 3) {
  const subtype = plan?.analyticContext?.subtype || "";
  const questionType = plan?.problem?.questionType || "";
  const source = ANALYTIC_TEMPLATES[subtype] || QUESTION_TYPE_TEMPLATES[questionType] || QUESTION_TYPE_TEMPLATES.spatial || [];
  return source.slice(0, limit).map((item) => ({ ...item, source: "template" }));
}

async function generateAiSuggestions(plan, limit = 3) {
  if (!hasAwsCredentials()) return [];

  const systemPrompt = `You generate similar math practice prompts.

Return only valid JSON with this shape:
{
  "suggestions": [
    { "label": "short title", "prompt": "full problem statement" }
  ]
}

Rules:
- Return exactly ${limit} suggestions.
- Keep them mathematically similar to the input concept.
- Change the numbers and points, but keep the same theme and difficulty.
- Do not include solutions.
- Do not repeat the original problem.`;

  const text = await converseWithModelFailover(
    "text",
    systemPrompt,
    [{
      role: "user",
      content: [{
        text: `Original prompt: ${plan?.problem?.question || ""}\nSubtype: ${plan?.analyticContext?.subtype || "none"}\nQuestion type: ${plan?.problem?.questionType || "spatial"}`,
      }],
    }],
    {
      maxTokens: 900,
      temperature: 0.35,
    }
  );

  const parsed = JSON.parse(cleanupJson(text));
  return Array.isArray(parsed?.suggestions)
    ? parsed.suggestions
      .map((item) => ({
        label: String(item?.label || "Similar Question").trim(),
        prompt: String(item?.prompt || "").trim(),
        source: "generated",
      }))
      .filter((item) => item.prompt)
      .slice(0, limit)
    : [];
}

export function rankChallengeMatches(plan, challenges = []) {
  const keywords = conceptKeywords(plan);
  const targetCategory = plan?.problem?.questionType || "";
  return challenges
    .map((challenge) => {
      const combinedText = `${challenge.title || ""} ${challenge.question || ""}`;
      const score = overlapScore(keywords, combinedText);
      return {
        challenge,
        score,
        categoryMatch: challenge.category === targetCategory,
      };
    })
    .filter((entry) => entry.categoryMatch && entry.score >= 2)
    .sort((left, right) => right.score - left.score);
}

export async function generateSimilarTutorQuestions({
  plan,
  limit = 3,
  challengeBank = null,
  aiSuggestionGenerator = generateAiSuggestions,
} = {}) {
  const finalLimit = Math.min(3, Math.max(3, Number(limit) || 3));
  const keywords = conceptKeywords(plan);
  const challenges = challengeBank || await loadChallenges();
  const closeChallenges = rankChallengeMatches(plan, challenges)
    .slice(0, finalLimit)
    .map(({ challenge }) => ({
      label: challenge.title,
      prompt: challenge.question,
      source: "challenge-bank",
    }));

  const suggestions = [...closeChallenges];
  if (suggestions.length < finalLimit) {
    try {
      const generated = await aiSuggestionGenerator(plan, finalLimit);
      suggestions.push(...generated.filter((item) => overlapScore(keywords, item.prompt || item.label || "") >= 2));
    } catch (error) {
      console.warn("Similar tutor question generation fallback:", error?.message || error);
    }
  }

  if (suggestions.length < finalLimit) {
    suggestions.push(...deterministicSuggestions(plan, finalLimit));
  }

  return uniqueByPrompt(suggestions).slice(0, finalLimit).map((item, index) => ({
    label: item.label || `Similar Question ${index + 1}`,
    prompt: item.prompt,
    source: item.source || "template",
  }));
}
