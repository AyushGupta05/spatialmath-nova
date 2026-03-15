# Nova Prism

Nova Prism turns flat spatial-maths prompts into interactive 3D lessons that students can inspect, manipulate, and talk to.

The app is built for the Amazon Nova hackathon story:
- `multimodal understanding`: combine text prompts and uploaded worksheet diagrams
- `voice coaching`: generate spoken tutoring responses with a Sonic-backed voice path and graceful fallback
- `agentic lesson flow`: explicit source, planning, evaluation, and coaching stages

## What the product does

- Converts a maths prompt or worksheet diagram into a guided 3D lesson scene
- Shows extracted givens, diagram evidence, and an agent trace before the build starts
- Walks learners through `Orient -> Build -> Predict -> Check -> Reflect -> Challenge`
- Evaluates the live scene as the learner builds and adjusts objects
- Supports typed follow-ups plus push-to-talk voice coaching

## Stack

- Browser UI with `three.js`
- Node.js + Hono server
- Amazon Bedrock runtime client for Nova planning, tutoring, voice, and retrieval
- Optional webcam-based hand tracking for spatial interaction

## Local setup

### Requirements

- Node.js  20+
- npm
- Webcam for hand tracking
- Microphone for push-to-talk voice mode

### Install

```bash
npm install
```

### Environment

Create `.env.local` in the project root.

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_SESSION_TOKEN=your_session_token

# Optional overrides
NOVA_TEXT_MODEL_ID=us.amazon.nova-2-lite-v1:0
NOVA_SONIC_MODEL_ID=amazon.nova-2-sonic-v1:0
NOVA_EMBED_MODEL_ID=amazon.nova-2-multimodal-embeddings-v1:0
```

The app still runs without Bedrock credentials, but multimodal planning, Sonic voice, and embedding-backed retrieval will fall back to the local non-AWS path.

## Run

```bash
npm run dev
```

Then open [http://localhost:3000/index.html](http://localhost:3000/index.html).

## Quality checks

```bash
npm run lint
npm test
```
