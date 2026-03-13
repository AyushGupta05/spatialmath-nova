import { invokeModelJson } from "../../middleware/bedrock.js";
import { resolveModelId, hasAwsCredentials } from "../modelRouter.js";

const EXEMPLARS = [
  {
    id: "diagram-cylinder",
    title: "Diagram to 3D cylinder coach",
    question: "A student uploads a cylinder worksheet diagram and needs a live 3D explanation of radius, height, and volume change.",
    summary: "Best for showing how Nova turns a flat worksheet into a guided 3D lesson with prediction before explanation.",
    recommendedCategory: "Best of Multimodal Understanding",
    scriptBeat: "Show the paper diagram first, then let Nova rebuild it in 3D and coach the learner through the measurement change.",
    tags: ["diagram", "cylinder", "volume", "multimodal", "judge-demo"],
  },
  {
    id: "surface-area-net",
    title: "Surface area net walkthrough",
    question: "The learner unfolds a solid to understand how visible faces contribute to surface area.",
    summary: "Best for emphasizing the classroom impact of moving from static formulas to inspectable spatial surfaces.",
    recommendedCategory: "Enterprise or Community Impact",
    scriptBeat: "Move from a confusing surface area formula into a visual breakdown where every face can be inspected and explained.",
    tags: ["surface-area", "net", "classroom", "impact"],
  },
  {
    id: "voice-spatial-coach",
    title: "Voice-first tutor coaching",
    question: "A learner asks spoken follow-up questions while manipulating a 3D scene and receives spoken Nova guidance.",
    summary: "Best for demonstrating Sonic-powered tutoring with shared scene context and conversational support.",
    recommendedCategory: "Creativity and Innovation",
    scriptBeat: "Let the learner speak naturally, then answer with a grounded voice reply tied to the current object and build stage.",
    tags: ["voice", "sonic", "conversation", "tutor"],
  },
  {
    id: "comparison-scene",
    title: "Compare two solids in 3D",
    question: "Compare a cube and a sphere in the same scene, predict which parameter matters most, then verify it visually.",
    summary: "Best for showing active reasoning and fast visual feedback rather than static answer extraction.",
    recommendedCategory: "Technical Implementation",
    scriptBeat: "Use one shared scene to compare competing solids, make a prediction, and check the result through direct manipulation.",
    tags: ["comparison", "prediction", "scene-feedback"],
  },
];

const embeddingCache = new Map();

function tokenize(text = "") {
  return new Set(
    String(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length > 2)
  );
}

function lexicalScore(query, exemplar) {
  const queryTokens = tokenize(query);
  const exemplarTokens = tokenize(`${exemplar.title} ${exemplar.question} ${exemplar.summary} ${exemplar.tags.join(" ")}`);
  let overlap = 0;
  for (const token of queryTokens) {
    if (exemplarTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(1, queryTokens.size);
}

function dotProduct(a = [], b = []) {
  const length = Math.min(a.length, b.length);
  let score = 0;
  for (let index = 0; index < length; index += 1) {
    score += Number(a[index] || 0) * Number(b[index] || 0);
  }
  return score;
}

function vectorMagnitude(values = []) {
  return Math.sqrt(values.reduce((total, value) => total + (Number(value || 0) ** 2), 0));
}

function cosineSimilarity(a = [], b = []) {
  const denominator = vectorMagnitude(a) * vectorMagnitude(b);
  if (!denominator) return 0;
  return dotProduct(a, b) / denominator;
}

function parseEmbeddingResponse(payload = {}) {
  if (Array.isArray(payload.embedding)) return payload.embedding;
  if (Array.isArray(payload.embeddings?.[0]?.embedding)) return payload.embeddings[0].embedding;
  if (Array.isArray(payload.output?.embedding)) return payload.output.embedding;
  return null;
}

async function embedText(text) {
  const modelId = resolveModelId("embeddings");
  if (!modelId || !hasAwsCredentials()) return null;
  if (embeddingCache.has(text)) return embeddingCache.get(text);

  try {
    const payload = await invokeModelJson(modelId, {
      inputText: text,
    });
    const embedding = parseEmbeddingResponse(payload);
    if (Array.isArray(embedding) && embedding.length) {
      embeddingCache.set(text, embedding);
      return embedding;
    }
  } catch (error) {
    console.warn("Embedding lookup failed:", error?.message || error);
  }

  return null;
}

export async function retrieveLessonExemplar({ questionText = "", sourceSummary = {} }) {
  const query = String(sourceSummary.cleanedQuestion || questionText || "").trim();
  if (!query) {
    return {
      exemplar: EXEMPLARS[0],
      strategy: "default",
      score: 0,
      exemplars: EXEMPLARS,
    };
  }

  const queryEmbedding = await embedText(query);
  if (queryEmbedding) {
    let best = null;
    let bestScore = -Infinity;

    for (const exemplar of EXEMPLARS) {
      const exemplarEmbedding = await embedText(exemplar.question);
      if (!exemplarEmbedding) continue;
      const score = cosineSimilarity(queryEmbedding, exemplarEmbedding);
      if (score > bestScore) {
        best = exemplar;
        bestScore = score;
      }
    }

    if (best) {
      return {
        exemplar: best,
        strategy: "embeddings",
        score: Number(bestScore.toFixed(3)),
        exemplars: EXEMPLARS,
      };
    }
  }

  let best = EXEMPLARS[0];
  let bestScore = -Infinity;
  for (const exemplar of EXEMPLARS) {
    const score = lexicalScore(query, exemplar);
    if (score > bestScore) {
      best = exemplar;
      bestScore = score;
    }
  }

  return {
    exemplar: best,
    strategy: "lexical",
    score: Number(bestScore.toFixed(3)),
    exemplars: EXEMPLARS,
  };
}
