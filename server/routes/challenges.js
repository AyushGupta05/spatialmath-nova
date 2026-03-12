import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const challenges = new Hono();

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "..", "data", "challenges.json");

let cachedChallenges = null;

async function loadChallenges() {
  if (!cachedChallenges) {
    const raw = await readFile(DATA_PATH, "utf-8");
    cachedChallenges = JSON.parse(raw);
  }
  return cachedChallenges;
}

challenges.get("/", async (c) => {
  try {
    const data = await loadChallenges();
    return c.json({ challenges: data });
  } catch (err) {
    console.error("Challenges list error:", err);
    return c.json({ error: "Failed to load challenges" }, 500);
  }
});

challenges.post("/:id/check", async (c) => {
  try {
    const { id } = c.req.param();
    const { answer } = await c.req.json();
    const data = await loadChallenges();
    const challenge = data.find((ch) => ch.id === id);

    if (!challenge) {
      return c.json({ error: "Challenge not found" }, 404);
    }

    const expected = challenge.expectedAnswer;
    const tolerance = challenge.tolerance || 0.01;

    let correct = false;
    if (typeof expected === "number" && typeof answer === "number") {
      correct = Math.abs(answer - expected) <= tolerance * Math.abs(expected);
    } else {
      correct = String(answer).trim().toLowerCase() === String(expected).trim().toLowerCase();
    }

    return c.json({
      correct,
      feedback: correct
        ? challenge.successMessage || "Correct! Great work!"
        : `Not quite. Try again! Hint: ${challenge.hints?.[0] || "Think about the formula."}`,
      expectedAnswer: correct ? expected : undefined,
    });
  } catch (err) {
    console.error("Challenge check error:", err);
    return c.json({ error: err.message || "Internal server error" }, 500);
  }
});

export default challenges;
