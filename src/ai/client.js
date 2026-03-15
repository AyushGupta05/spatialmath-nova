const API_BASE = "/api";

async function readJsonOrError(response, fallbackMessage) {
  if (response.ok) return response.json();
  const payload = await response.json().catch(() => ({ error: fallbackMessage }));
  throw new Error(payload.error || fallbackMessage);
}

export async function requestScenePlan({ questionText = "", question = "", imageFile = null, sceneSnapshot = null, mode = "guided" }) {
  const nextQuestion = String(questionText || question || "");
  let response;

  if (imageFile) {
    const formData = new FormData();
    formData.set("question", nextQuestion);
    formData.set("mode", mode);
    if (sceneSnapshot) {
      formData.set("sceneSnapshot", JSON.stringify(sceneSnapshot));
    }
    formData.set("image", imageFile);
    response = await fetch(`${API_BASE}/plan`, {
      method: "POST",
      body: formData,
    });
  } else {
    response = await fetch(`${API_BASE}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionText: nextQuestion, sceneSnapshot, mode }),
    });
  }

  const payload = await readJsonOrError(response, "Failed to generate scene plan");
  if (payload?.scenePlan) {
    payload.scenePlan = {
      ...payload.scenePlan,
      sourceEvidence: payload.sourceEvidence || payload.scenePlan.sourceEvidence || null,
      agentTrace: payload.agentTrace || payload.scenePlan.agentTrace || [],
      demoPreset: payload.demoPreset || payload.scenePlan.demoPreset || null,
    };
  }
  return payload;
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
  let latestMeta = null;

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
      if (payload.type === "meta" && payload.content) {
        latestMeta = payload.content;
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

  return { text: fullText, assessment: latestAssessment, ...latestMeta };
}

export async function requestSimilarTutorQuestions({ plan, limit = 3 }) {
  const response = await fetch(`${API_BASE}/tutor/similar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, limit }),
  });
  return readJsonOrError(response, "Failed to load similar tutor questions");
}

export async function requestVoiceResponse(input, playbackMode = "auto") {
  const payload = typeof input === "string"
    ? { text: input, playbackMode, mode: "narrate" }
    : { playbackMode, ...input };
  const response = await fetch(`${API_BASE}/voice/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    return {
      transcript: typeof input === "string" ? input : input?.text || "",
      audioBase64: null,
      contentType: null,
      source: "browser-fallback",
      fallbackUsed: true,
    };
  }
  return response.json();
}

export async function createVoiceSession() {
  const response = await fetch(`${API_BASE}/voice/session`, {
    method: "POST",
  });
  return readJsonOrError(response, "Failed to create a voice session");
}

export function subscribeToVoiceSession(sessionId, { onEvent, onError } = {}) {
  const source = new EventSource(`${API_BASE}/voice/session/${encodeURIComponent(sessionId)}/events`);
  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      onEvent?.(payload);
    } catch (error) {
      onError?.(error);
    }
  };
  source.onerror = (error) => {
    onError?.(error);
  };
  return () => source.close();
}

export async function startVoiceSessionTurn({
  sessionId,
  playbackMode = "auto",
  voiceId = null,
  mode = "coach",
  context = null,
  text = "",
}) {
  const response = await fetch(`${API_BASE}/voice/session/${encodeURIComponent(sessionId)}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playbackMode,
      voiceId,
      mode,
      context,
      text,
    }),
  });
  return readJsonOrError(response, "Failed to start the voice session");
}

export async function appendVoiceSessionAudio({
  sessionId,
  audioBase64,
  mimeType = "audio/lpcm;rate=16000;channels=1;sampleSizeBits=16",
}) {
  const response = await fetch(`${API_BASE}/voice/session/${encodeURIComponent(sessionId)}/audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audioBase64,
      mimeType,
    }),
  });
  return readJsonOrError(response, "Failed to stream microphone audio");
}

export async function stopVoiceSessionTurn(sessionId) {
  const response = await fetch(`${API_BASE}/voice/session/${encodeURIComponent(sessionId)}/stop`, {
    method: "POST",
  });
  return readJsonOrError(response, "Failed to stop the voice session");
}

export async function interruptVoiceSessionTurn(sessionId) {
  const response = await fetch(`${API_BASE}/voice/session/${encodeURIComponent(sessionId)}/interrupt`, {
    method: "POST",
  });
  return readJsonOrError(response, "Failed to interrupt the voice session");
}

export async function fetchCapabilities() {
  const response = await fetch(`${API_BASE}/capabilities`);
  return readJsonOrError(response, "Failed to load capabilities");
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
