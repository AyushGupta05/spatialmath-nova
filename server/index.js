import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import dotenv from "dotenv";
import net from "node:net";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env.local from project roo
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "..", ".env.local") });

// Import routes
import planRoute from "./routes/plan.js";
import tutorRoute from "./routes/tutor.js";
import voiceRoute from "./routes/voice.js";
import challengesRoute from "./routes/challenges.js";
import buildRoute from "./routes/build.js";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", cors());

// API routes
app.route("/api/plan", planRoute);
app.route("/api/tutor", tutorRoute);
app.route("/api/voice", voiceRoute);
app.route("/api/challenges", challengesRoute);
app.route("/api/build", buildRoute);

// Health check
app.get("/api/health", (c) => c.json({ status: "ok", timestamp: Date.now() }));

// Serve static files from project root (relative to CWD)
app.use("/*", serveStatic({ root: "./" }));

const DEFAULT_PORT = parseInt(process.env.PORT || "3000", 10);

function probePort(port) {
  return new Promise((resolveProbe) => {
    const tester = net.createServer();
    tester.unref();
    tester.once("error", () => resolveProbe(false));
    tester.once("listening", () => {
      tester.close(() => resolveProbe(true));
    });
    tester.listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(startPort, attempts = 10) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const candidate = startPort + offset;
    if (await probePort(candidate)) {
      return candidate;
    }
  }
  throw new Error(`No open port found between ${startPort} and ${startPort + attempts - 1}`);
}

const PORT = await findAvailablePort(DEFAULT_PORT);

if (PORT !== DEFAULT_PORT) {
  console.warn(`Port ${DEFAULT_PORT} is busy, starting SpatialMath Nova on ${PORT} instead.`);
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`SpatialMath Nova server running at http://localhost:${info.port}`);
  console.log(`  API: http://localhost:${info.port}/api/health`);
  console.log(`  App: http://localhost:${info.port}/index.html`);
  console.log(`  AWS Region: ${process.env.AWS_REGION || "us-east-1"}`);
});
