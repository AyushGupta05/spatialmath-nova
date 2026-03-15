import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  InvokeModelCommand,
  InvokeModelWithBidirectionalStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";

const REGION = process.env.AWS_REGION || "us-east-1";

let client = null;
let suppressedBearerToken = null;

function getStaticAwsCredentials() {
  if (!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)) {
    return null;
  }
  return {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN || undefined,
  };
}

function getClient() {
  if (!client) {
    const credentials = getStaticAwsCredentials();
    if (credentials && process.env.AWS_BEARER_TOKEN_BEDROCK) {
      suppressedBearerToken = process.env.AWS_BEARER_TOKEN_BEDROCK;
      delete process.env.AWS_BEARER_TOKEN_BEDROCK;
    }
    client = new BedrockRuntimeClient({
      region: REGION,
      credentials,
    });
  }
  return client;
}

/** Reset client (useful if credentials rotate) */
export function resetClient() {
  client = null;
  if (!process.env.AWS_BEARER_TOKEN_BEDROCK && suppressedBearerToken) {
    process.env.AWS_BEARER_TOKEN_BEDROCK = suppressedBearerToken;
  }
  suppressedBearerToken = null;
}

/**
 * Call a Nova model synchronously via the Converse API.
 * Returns the full response text.
 */
export async function converseNova(modelId, systemPrompt, messages, options = {}) {
  const cmd = new ConverseCommand({
    modelId,
    system: [{ text: systemPrompt }],
    messages,
    inferenceConfig: {
      maxTokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.3,
      topP: options.topP ?? 0.9,
    },
  });
  const response = await getClient().send(cmd);
  const content = response.output?.message?.content;
  if (!content || content.length === 0) {
    throw new Error("Empty response from Nova model");
  }
  const text = content
    .map((block) => block?.text || "")
    .join("")
    .trim();
  if (!text) {
    throw new Error("Nova model returned no text content");
  }
  return text;
}

/**
 * Stream a Nova model response via the Converse API.
 * Yields text chunks as they arrive.
 */
export async function* converseNovaStream(modelId, systemPrompt, messages, options = {}) {
  const cmd = new ConverseStreamCommand({
    modelId,
    system: [{ text: systemPrompt }],
    messages,
    inferenceConfig: {
      maxTokens: options.maxTokens || 2048,
      temperature: options.temperature ?? 0.4,
      topP: options.topP ?? 0.9,
    },
  });
  const response = await getClient().send(cmd);
  for await (const event of response.stream) {
    if (event.contentBlockDelta?.delta?.text) {
      yield event.contentBlockDelta.delta.text;
    }
  }
}

export async function invokeModelJson(modelId, payload, options = {}) {
  const response = await getClient().send(new InvokeModelCommand({
    modelId,
    contentType: "application/json",
    accept: options.accept || "application/json",
    body: Buffer.from(JSON.stringify(payload)),
  }));

  const raw = Buffer.from(response.body || []).toString("utf-8").trim();
  if (!raw) {
    throw new Error("Empty response from model invocation");
  }
  return JSON.parse(raw);
}

function normalizeBidirectionalBody(events) {
  if (events?.[Symbol.asyncIterator]) {
    return (async function* bidirectionalBody() {
      for await (const event of events) {
        yield {
          chunk: {
            bytes: Buffer.from(JSON.stringify(event)),
          },
        };
      }
    }());
  }

  return (async function* bidirectionalBody() {
    for (const event of events || []) {
      yield {
        chunk: {
          bytes: Buffer.from(JSON.stringify(event)),
        },
      };
    }
  }());
}

function describeBedrockResponseDetails(error) {
  const parts = [];
  const statusCode = error?.$metadata?.httpStatusCode || error?.$response?.statusCode || null;
  const requestId = error?.$metadata?.requestId || error?.$response?.headers?.["x-amzn-requestid"] || null;
  const cfId = error?.$response?.headers?.["x-amz-cf-id"] || null;

  if (statusCode) {
    parts.push(`status=${statusCode}`);
  }
  if (requestId) {
    parts.push(`requestId=${requestId}`);
  }
  if (cfId) {
    parts.push(`cfId=${cfId}`);
  }

  return parts.length ? ` (${parts.join(", ")})` : "";
}

function formatBedrockCommandError(modelId, error) {
  const rawMessage = error?.message || "Bedrock request failed";
  return new Error(`Bidirectional stream failed for ${modelId}: ${rawMessage}${describeBedrockResponseDetails(error)}`);
}

function parseBidirectionalError(modelId, output) {
  if (output.internalServerException) {
    throw new Error(`${modelId}: ${output.internalServerException.message || "Bedrock internal server exception"} | ${JSON.stringify(output.internalServerException)}`);
  }
  if (output.modelStreamErrorException) {
    throw new Error(`${modelId}: ${output.modelStreamErrorException.message || "Bedrock stream error"} | ${JSON.stringify(output.modelStreamErrorException)}`);
  }
  if (output.validationException) {
    throw new Error(`${modelId}: ${output.validationException.message || "Bedrock validation error"} | ${JSON.stringify(output.validationException)}`);
  }
  if (output.throttlingException) {
    throw new Error(`${modelId}: ${output.throttlingException.message || "Bedrock throttling error"} | ${JSON.stringify(output.throttlingException)}`);
  }
  if (output.modelTimeoutException) {
    throw new Error(`${modelId}: ${output.modelTimeoutException.message || "Bedrock model timeout"} | ${JSON.stringify(output.modelTimeoutException)}`);
  }
  if (output.serviceUnavailableException) {
    throw new Error(`${modelId}: ${output.serviceUnavailableException.message || "Bedrock service unavailable"} | ${JSON.stringify(output.serviceUnavailableException)}`);
  }
}

export async function startBidirectionalStream(modelId, events) {
  let response;
  try {
    response = await getClient().send(new InvokeModelWithBidirectionalStreamCommand({
      modelId,
      body: normalizeBidirectionalBody(events),
    }));
  } catch (error) {
    throw formatBedrockCommandError(modelId, error);
  }

  return (async function* decodedStream() {
    for await (const output of response.body || []) {
      if (output.chunk?.bytes) {
        const raw = Buffer.from(output.chunk.bytes).toString("utf-8").trim();
        if (raw) {
          yield JSON.parse(raw);
        }
        continue;
      }

      parseBidirectionalError(modelId, output);
    }
  }());
}

export async function invokeBidirectionalStream(modelId, events) {
  const decodedEvents = [];
  for await (const event of await startBidirectionalStream(modelId, events)) {
    decodedEvents.push(event);
  }
  return decodedEvents;
}

export const MODEL_IDS = {
  NOVA_PRO: process.env.NOVA_PRO_MODEL_ID || "amazon.nova-pro-v1:0",
  NOVA_LITE: process.env.NOVA_LITE_MODEL_ID || "amazon.nova-lite-v1:0",
  NOVA_SONIC: process.env.NOVA_SONIC_MODEL_ID || "amazon.nova-2-sonic-v1:0",
};
