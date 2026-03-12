/**
 * Frontend API client for Nova backend routes.
 * All AI calls go through the server to keep credentials secure.
 */

const API_BASE = "/api";

/**
 * Parse a geometry question into a SceneSpec.
 * @param {string} question - The geometry question text
 * @returns {Promise<{sceneSpec: object, explanation: string}>}
 */
export async function parseQuestion(question) {
  const res = await fetch(`${API_BASE}/parse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Network error" }));
    throw new Error(err.error || `Parse failed (${res.status})`);
  }

  return res.json();
}

/**
 * Send a message to the tutor and receive a streaming response.
 * @param {object} params
 * @param {object} params.sceneSpec - Current scene specification
 * @param {Array} params.history - Conversation history [{role, content}]
 * @param {string} params.userMessage - The user's message
 * @param {string} params.phase - Current tutor phase
 * @param {number} params.currentStep - Current walkthrough step index
 * @param {number} params.hintsUsed - Number of hints used
 * @param {function} params.onChunk - Callback for each text chunk
 * @returns {Promise<string>} - The full response text
 */
export async function askTutor({ sceneSpec, history, userMessage, phase, currentStep, hintsUsed, onChunk }) {
  const res = await fetch(`${API_BASE}/tutor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sceneSpec, history, userMessage, phase, currentStep, hintsUsed }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Network error" }));
    throw new Error(err.error || `Tutor request failed (${res.status})`);
  }

  // Read SSE stream
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === "text" && data.content) {
          fullText += data.content;
          if (onChunk) onChunk(data.content);
        } else if (data.type === "error") {
          throw new Error(data.content || "Stream error");
        }
      } catch (e) {
        if (e.message === "Stream error") throw e;
        // Ignore JSON parse errors for malformed chunks
      }
    }
  }

  return fullText;
}

/**
 * Request voice synthesis for text.
 * Returns audio playback info or text for browser TTS fallback.
 * @param {string} text - Text to speak
 * @returns {Promise<{text: string, method: string}>}
 */
export async function speak(text) {
  const res = await fetch(`${API_BASE}/voice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    // Fallback to browser TTS
    return { text, method: "browser-tts" };
  }

  return res.json();
}

/**
 * Fetch available challenges.
 * @returns {Promise<{challenges: Array}>}
 */
export async function fetchChallenges() {
  const res = await fetch(`${API_BASE}/challenges`);
  if (!res.ok) throw new Error("Failed to load challenges");
  return res.json();
}

/**
 * Check a challenge answer.
 * @param {string} challengeId
 * @param {number|string} answer
 * @returns {Promise<{correct: boolean, feedback: string}>}
 */
export async function checkChallenge(challengeId, answer) {
  const res = await fetch(`${API_BASE}/challenges/${challengeId}/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer }),
  });
  if (!res.ok) throw new Error("Failed to check answer");
  return res.json();
}
