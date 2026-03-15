const CANONICAL_SONIC_MODEL_ID = "amazon.nova-2-sonic-v1:0";
const LEGACY_SONIC_MODEL_ALIASES = new Set([
  "us.amazon.nova-2-sonic-v1:0",
  "global.amazon.nova-2-sonic-v1:0",
  "eu.amazon.nova-2-sonic-v1:0",
  "jp.amazon.nova-2-sonic-v1:0",
]);

function normalizeModelId(kind, value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (kind !== "voice") return normalized;
  if (LEGACY_SONIC_MODEL_ALIASES.has(normalized)) {
    return CANONICAL_SONIC_MODEL_ID;
  }
  return normalized;
}

function getDefaultModels() {
  return {
    text: [
      process.env.NOVA_TEXT_MODEL_ID,
      "us.amazon.nova-2-lite-v1:0",
      process.env.NOVA_LITE_MODEL_ID,
      process.env.NOVA_PRO_MODEL_ID,
      "amazon.nova-lite-v1:0",
      "amazon.nova-pro-v1:0",
    ],
    voice: [
      process.env.NOVA_SONIC_MODEL_ID,
      CANONICAL_SONIC_MODEL_ID,
      "amazon.nova-sonic-v1:0",
    ],
    embeddings: [
      process.env.NOVA_EMBED_MODEL_ID,
      "amazon.nova-2-multimodal-embeddings-v1:0",
    ],
  };
}

const workingModelByKind = new Map();

function uniqueNonEmpty(values = []) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

export function hasAwsCredentials() {
  return Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

export function resolveModelCandidates(kind) {
  return uniqueNonEmpty((getDefaultModels()[kind] || []).map((value) => normalizeModelId(kind, value)));
}

export function rememberWorkingModel(kind, modelId) {
  const normalizedKind = String(kind || "").trim();
  const normalizedModelId = String(modelId || "").trim();
  if (!normalizedKind || !normalizedModelId) return null;
  workingModelByKind.set(normalizedKind, normalizedModelId);
  return normalizedModelId;
}

export function clearWorkingModelCache(kind = null) {
  if (!kind) {
    workingModelByKind.clear();
    return;
  }
  workingModelByKind.delete(String(kind || "").trim());
}

export function getWorkingModelId(kind) {
  return workingModelByKind.get(String(kind || "").trim()) || null;
}

export function getModelCandidateOrder(kind) {
  return uniqueNonEmpty([
    getWorkingModelId(kind),
    ...resolveModelCandidates(kind),
  ]);
}

export function resolveModelId(kind) {
  return getModelCandidateOrder(kind)[0] || null;
}

export function getCapabilitySnapshot() {
  const configured = hasAwsCredentials();
  const textModel = resolveModelId("text");
  const voiceModel = resolveModelId("voice");
  const embeddingModel = resolveModelId("embeddings");

  return {
    configured,
    models: {
      text: {
        preferred: textModel,
        candidates: getModelCandidateOrder("text"),
      },
      voice: {
        preferred: voiceModel,
        candidates: getModelCandidateOrder("voice"),
      },
      embeddings: {
        preferred: embeddingModel,
        candidates: getModelCandidateOrder("embeddings"),
      },
    },
    inputs: {
      camera: true,
      mic: true,
    },
    fallbacks: {
      text: configured ? "heuristic-plan" : "heuristic-plan (AWS credentials missing)",
      voice: configured ? "browser-caption" : "browser-caption (AWS credentials missing)",
      embeddings: configured ? "lexical-retrieval" : "lexical-retrieval (AWS credentials missing)",
    },
  };
}
