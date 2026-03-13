const DEFAULT_MODELS = {
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
    "global.amazon.nova-2-sonic-v1:0",
    "us.amazon.nova-2-sonic-v1:0",
    "amazon.nova-sonic-v1:0",
  ],
  embeddings: [
    process.env.NOVA_EMBED_MODEL_ID,
    "amazon.nova-2-multimodal-embeddings-v1:0",
  ],
};

function uniqueNonEmpty(values = []) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

export function hasAwsCredentials() {
  return Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

export function resolveModelCandidates(kind) {
  return uniqueNonEmpty(DEFAULT_MODELS[kind] || []);
}

export function resolveModelId(kind) {
  return resolveModelCandidates(kind)[0] || null;
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
        candidates: resolveModelCandidates("text"),
      },
      voice: {
        preferred: voiceModel,
        candidates: resolveModelCandidates("voice"),
      },
      embeddings: {
        preferred: embeddingModel,
        candidates: resolveModelCandidates("embeddings"),
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
