import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";

const REGION = process.env.AWS_REGION || "us-east-1";

let client = null;

function getClient() {
  if (!client) {
    client = new BedrockRuntimeClient({
      region: REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN || undefined,
      },
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
  return content[0].text;
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

export const MODEL_IDS = {
  NOVA_PRO: process.env.NOVA_PRO_MODEL_ID || "amazon.nova-pro-v1:0",
  NOVA_LITE: process.env.NOVA_LITE_MODEL_ID || "amazon.nova-lite-v1:0",
  NOVA_SONIC: process.env.NOVA_SONIC_MODEL_ID || "amazon.nova-sonic-v1:0",
};
