import {
  converseNova,
  converseNovaStream,
  invokeBidirectionalStream,
  invokeModelJson,
} from "../middleware/bedrock.js";
import { getModelCandidateOrder, rememberWorkingModel } from "./modelRouter.js";

function normalizeModelIds(kind, modelIds = null) {
  const ids = Array.isArray(modelIds) ? modelIds : getModelCandidateOrder(kind);
  return [...new Set(
    ids
      .map((modelId) => String(modelId || "").trim())
      .filter(Boolean)
  )];
}

function buildAggregateModelError(kind, attempts = []) {
  const detail = attempts
    .map(({ modelId, error }) => `${modelId}: ${error?.message || error}`)
    .join(" | ");
  return new Error(detail
    ? `All ${kind} model candidates failed. ${detail}`
    : `All ${kind} model candidates failed.`);
}

export async function runWithModelFailover(kind, run, options = {}) {
  const modelIds = normalizeModelIds(kind, options.modelIds);
  if (!modelIds.length) {
    throw new Error(`No ${kind} model candidates are configured.`);
  }

  const attempts = [];
  for (const modelId of modelIds) {
    try {
      const result = await run(modelId);
      rememberWorkingModel(kind, modelId);
      return result;
    } catch (error) {
      attempts.push({ modelId, error });
    }
  }

  throw buildAggregateModelError(kind, attempts);
}

export async function converseWithModelFailover(kind, systemPrompt, messages, options = {}, deps = {}) {
  const converse = deps.converseNova || converseNova;
  return runWithModelFailover(kind, (modelId) => converse(modelId, systemPrompt, messages, options), deps);
}

export async function invokeJsonWithModelFailover(kind, payload, options = {}, deps = {}) {
  const invokeJson = deps.invokeModelJson || invokeModelJson;
  return runWithModelFailover(kind, (modelId) => invokeJson(modelId, payload, options), deps);
}

export async function invokeBidirectionalStreamWithModelFailover(kind, events, deps = {}) {
  const invokeStream = deps.invokeBidirectionalStream || invokeBidirectionalStream;
  return runWithModelFailover(kind, (modelId) => invokeStream(modelId, events), deps);
}

export async function* converseStreamWithModelFailover(kind, systemPrompt, messages, options = {}, deps = {}) {
  const streamConverse = deps.converseNovaStream || converseNovaStream;
  const modelIds = normalizeModelIds(kind, deps.modelIds);
  if (!modelIds.length) {
    throw new Error(`No ${kind} model candidates are configured.`);
  }

  const attempts = [];
  for (const modelId of modelIds) {
    let yieldedChunk = false;
    try {
      for await (const chunk of streamConverse(modelId, systemPrompt, messages, options)) {
        yieldedChunk = true;
        yield chunk;
      }
      rememberWorkingModel(kind, modelId);
      return;
    } catch (error) {
      attempts.push({ modelId, error });
      if (yieldedChunk) {
        throw error;
      }
    }
  }

  throw buildAggregateModelError(kind, attempts);
}
