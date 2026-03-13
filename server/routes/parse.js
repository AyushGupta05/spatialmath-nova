import { Hono } from "hono";
import { converseNova, MODEL_IDS } from "../middleware/bedrock.js";

const parse = new Hono();

const SYSTEM_PROMPT = `You are a spatial geometry expert and 3D scene designer. Your job is to parse geometry questions and produce structured 3D scene specifications.

Given a geometry question, return a JSON object with EXACTLY this structure (no markdown, no explanation outside JSON):

{
  "question": "<the original question>",
  "questionType": "volume" | "surface_area" | "composite" | "spatial" | "comparison",
  "objects": [
    {
      "id": "A",
      "shape": "cube" | "cuboid" | "sphere" | "cylinder" | "cone" | "pyramid" | "plane",
      "params": {
        "size": <number for cube side length>,
        "radius": <number for sphere/cylinder radius>,
        "height": <number for cylinder height>,
        "width": <number for cuboid width>,
        "depth": <number for cuboid depth>
      },
      "position": [x, y, z],
      "rotation": [0, 0, 0],
      "color": "<hex color>",
      "highlight": false
    }
  ],
  "labels": [
    {
      "text": "<label text, e.g. 'r = 3'>",
      "attachTo": "<object id>",
      "offset": [0, 1.5, 0],
      "style": "dimension" | "name" | "formula"
    }
  ],
  "dimensions": [
    {
      "from": [x1, y1, z1],
      "to": [x2, y2, z2],
      "label": "<e.g. '5 cm'>"
    }
  ],
  "camera": {
    "position": [x, y, z],
    "target": [0, 0, 0]
  },
  "answer": {
    "value": <number or string>,
    "unit": "<e.g. 'cubic units', 'square units'>",
    "formula": "<e.g. 'V = a^3'>",
    "steps": [
      {
        "text": "<step explanation>",
        "formula": "<formula used>",
        "highlightObjects": ["A"]
      }
    ]
  }
}

Rules:
- Position objects so they don't overlap unless the question says they should
- Use distinct, visually appealing colors: #7cf7e4, #ff7ca8, #48c9ff, #ffd966, #b088f9
- Place objects near the origin, resting on the ground plane (y=0 is the floor)
- For cubes/cuboids, the object bottom should touch y=0 (position.y = height/2)
- For spheres, position.y = radius (resting on ground)
- For cylinders/cones/pyramids, position.y = height/2
- For planes, position.y = 0 (flat on ground)
- Camera should be positioned to see all objects clearly, typically at [8, 6, 8] looking at [0, 0, 0]
- Break the answer into clear, numbered steps showing the work
- Include dimension labels showing key measurements
- For pyramids, use params: {base: number, height: number}
- For cones, use params: {radius: number, height: number}
- For planes, use params: {width: number, depth: number}
- The "params" field should only include parameters relevant to the shape type
- Return ONLY valid JSON, no markdown fences, no extra text`;

parse.post("/", async (c) => {
  try {
    const { question } = await c.req.json();

    if (!question || typeof question !== "string" || question.trim().length === 0) {
      return c.json({ error: "Question is required" }, 400);
    }

    const messages = [
      {
        role: "user",
        content: [{ text: question.trim() }],
      },
    ];

    const responseText = await converseNova(MODEL_IDS.NOVA_PRO, SYSTEM_PROMPT, messages, {
      maxTokens: 4096,
      temperature: 0.2,
    });

    // Parse the JSON response, stripping any markdown fences if present
    let cleaned = responseText.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    let sceneSpec;
    try {
      sceneSpec = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse Nova response as JSON:", cleaned);
      return c.json(
        { error: "Model returned invalid JSON", raw: cleaned },
        502
      );
    }

    return c.json({ sceneSpec, explanation: sceneSpec.answer?.steps?.map(s => s.text).join(" ") || "" });
  } catch (err) {
    console.error("Parse route error:", err);
    return c.json({ error: err.message || "Internal server error" }, 500);
  }
});

export default parse;
