import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env.local from project root
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "..", ".env.local") });

// Import routes
import parseRoute from "./routes/parse.js";
import tutorRoute from "./routes/tutor.js";
import voiceRoute from "./routes/voice.js";
import challengesRoute from "./routes/challenges.js";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", cors());

// API routes
app.route("/api/parse", parseRoute);
app.route("/api/tutor", tutorRoute);
app.route("/api/voice", voiceRoute);
app.route("/api/challenges", challengesRoute);

// Health check
app.get("/api/health", (c) => c.json({ status: "ok", timestamp: Date.now() }));

// Serve static files from project root (relative to CWD)
app.use("/*", serveStatic({ root: "./" }));

const PORT = parseInt(process.env.PORT || "3000", 10);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`SpatialMath Nova server running at http://localhost:${info.port}`);
  console.log(`  API: http://localhost:${info.port}/api/health`);
  console.log(`  App: http://localhost:${info.port}/index.html`);
  console.log(`  AWS Region: ${process.env.AWS_REGION || "us-east-1"}`);
});
