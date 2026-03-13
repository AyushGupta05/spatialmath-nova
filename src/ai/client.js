const API_BASE = "/api";

async function readJsonOrError(response, fallbackMessage) {
  if (response.ok) return response.json();
  const payload = await response.json().catch(() => ({ error: fallbackMessage }));
  throw new Error(payload.error || fallbackMessage);
}

export async function requestScenePlan({ question, sceneSnapshot = null, mode = "guided" }) {
  const response = await fetch(`${API_BASE}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, sceneSnapshot, mode }),
  });
  return readJsonOrError(response, "Failed to generate scene plan");
}

export async function evaluateBuild({ plan, sceneSnapshot, currentStepId = null }) {
  const response = await fetch(`${API_BASE}/build/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, sceneSnapshot, currentStepId }),
  });
  return readJsonOrError(response, "Failed to evaluate build");
}

export async function askTutor({ plan, sceneSnapshot, sceneContext = null, learningState, userMessage, contextStepId, onChunk, onAssessment }) {
  const response = await fetch(`${API_BASE}/tutor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, sceneSnapshot, sceneContext, learningState, userMessage, contextStepId }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Tutor request failed" }));
    throw new Error(payload.error || "Tutor request failed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let latestAssessment = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop();

    for (const part of parts) {
      if (!part.startsWith("data: ")) continue;
      const payload = JSON.parse(part.slice(6));
      if (payload.type === "text" && payload.content) {
        fullText += payload.content;
        onChunk?.(payload.content);
      }
      if (payload.type === "assessment" && payload.content) {
        latestAssessment = payload.content;
        onAssessment?.(latestAssessment);
      }
      if (payload.type === "error") {
        throw new Error(payload.content || "Tutor stream error");
      }
    }
  }

  return { text: fullText, assessment: latestAssessment };
}

export async function requestVoiceResponse(text, playbackMode = "auto") {
  const response = await fetch(`${API_BASE}/voice/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, playbackMode }),
  });
  if (!response.ok) {
    return { transcript: text, audioBase64: null, contentType: null, source: "browser-fallback" };
  }
  return response.json();
}

export async function fetchChallenges() {
  const response = await fetch(`${API_BASE}/challenges`);
  return readJsonOrError(response, "Failed to load challenges");
}

export async function checkChallenge(challengeId, answer) {
  const response = await fetch(`${API_BASE}/challenges/${challengeId}/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer }),
  });
  return readJsonOrError(response, "Failed to check challenge answer");
}
