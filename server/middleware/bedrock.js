import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  InvokeModelCommand,
  InvokeModelWithBidirectionalStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";

const REGION = process.env.AWS_REGION || "us-east-1";

let client = null;

function getClient() {
  if (!client) {
    const credentials = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN || undefined,
      }
      : undefined;
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

export async function invokeBidirectionalStream(modelId, events) {
  async function* eventBody() {
    for (const event of events) {
      yield {
        chunk: {
          bytes: Buffer.from(JSON.stringify(event)),
        },
      };
    }
  }

  const response = await getClient().send(new InvokeModelWithBidirectionalStreamCommand({
    modelId,
    body: eventBody(),
  }));

  const decodedEvents = [];
  for await (const output of response.body || []) {
    if (output.chunk?.bytes) {
      const raw = Buffer.from(output.chunk.bytes).toString("utf-8").trim();
      if (raw) {
        decodedEvents.push(JSON.parse(raw));
      }
      continue;
    }
    if (output.internalServerException) {
      throw new Error(output.internalServerException.message || "Bedrock internal server exception");
    }
    if (output.modelStreamErrorException) {
      throw new Error(output.modelStreamErrorException.message || "Bedrock stream error");
    }
    if (output.validationException) {
      throw new Error(output.validationException.message || "Bedrock validation error");
    }
    if (output.throttlingException) {
      throw new Error(output.throttlingException.message || "Bedrock throttling error");
    }
    if (output.modelTimeoutException) {
      throw new Error(output.modelTimeoutException.message || "Bedrock model timeout");
    }
    if (output.serviceUnavailableException) {
      throw new Error(output.serviceUnavailableException.message || "Bedrock service unavailable");
    }
  }

  return decodedEvents;
}

export const MODEL_IDS = {
  NOVA_PRO: process.env.NOVA_PRO_MODEL_ID || "amazon.nova-pro-v1:0",
  NOVA_LITE: process.env.NOVA_LITE_MODEL_ID || "amazon.nova-lite-v1:0",
  NOVA_SONIC: process.env.NOVA_SONIC_MODEL_ID || "amazon.nova-sonic-v1:0",
};
