// Files written by `ragforge init`. Each template is a working RAG app with
// sample docs, golden questions and a CI check that fails when retrieval drops.

const SAMPLE_DOC = `# Acme Notes handbook

This is a sample document. Replace the files in this folder with your own docs.

## Plans and billing

Acme Notes has a free plan with up to 3 notebooks and a Pro plan at 8 dollars per month with unlimited notebooks. Annual billing gives two months free.

Refunds are issued to the original payment method within 5 business days. Annual plans can be refunded in full during the first 30 days.

## Sync and offline use

Notes sync across devices every 30 seconds while you are online. Offline edits are stored on the device and merged the next time it connects. If the same note was edited on two devices, both versions are kept and marked as a conflict.

## Export and import

You can export a notebook as Markdown or PDF from the notebook menu. Imports accept Markdown, plain text and Evernote ENEX files up to 50 MB.

## Security

All notes are encrypted in transit with TLS and at rest with AES-256. Two-factor authentication can be turned on under Settings, Security, using any authenticator app.
`;

// expectedText is matched inside the retrieved passage, case-insensitively
const GOLDEN = [
  { question: "How long do refunds take?", expectedText: "within 5 business days" },
  { question: "How much does the Pro plan cost?", expectedText: "8 dollars per month" },
  { question: "what happens to edits made offline", expectedText: "Offline edits are stored on the device" },
  { question: "export formats", expectedText: "export a notebook as Markdown or PDF" },
  { question: "How is my data encrypted?", expectedText: "AES-256" },
];

const ENV_EXAMPLE = `# Copy to .env and fill in. ragforge reads .env from the project root.
OPENAI_API_KEY=
`;

const EVAL_SCRIPTS = {
  // Scores retrieval on the golden questions and saves the result as the baseline
  "eval:baseline": "ragforge eval --docs ./docs --questions-file golden.json --techniques baseline,hybrid --json ragforge-baseline.json",
  // Scores again and fails when a technique lost more than 3 points against the baseline
  eval: "ragforge eval --docs ./docs --questions-file golden.json --techniques baseline,hybrid --compare ragforge-baseline.json --fail-on-drop 3",
  chat: "ragforge chat --docs ./docs",
};

const WORKFLOW = `# Fails the build when retrieval quality drops against ragforge-baseline.json.
# Create the baseline once with: npm run eval:baseline (then commit the file).
name: rag eval
on: pull_request

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run eval
        env:
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
`;

// Shared by both templates; only the module syntax differs
const ragModule = ({ esm }) => `// Loads ./docs, embeds it into an in-memory store and answers questions with ragforge.
// For production, replace the memory store with your vector database:
// https://github.com/Kamraanmulani/ragforge#vector-stores
${
  esm
    ? `import ragforge from "ragforge";

const { createRagforge, createMemoryVectorStore, loadDocuments, chunkText } = ragforge;`
    : `const { createRagforge, createMemoryVectorStore, loadDocuments, chunkText } = require("ragforge");`
}

const rf = createRagforge({
  hybrid: true, // keyword search next to vector search
  onTrace: "traces.jsonl", // logs real queries, for: npx ragforge label --from-logs traces.jsonl --docs ./docs
});

let ready;

async function buildIndex() {
  const documents = await loadDocuments(["./docs"]);
  const store = createMemoryVectorStore();
  for (const doc of documents) {
    const chunks = chunkText(doc.content);
    const vectors = await Promise.all(chunks.map((chunk) => rf.getEmbedding(chunk)));
    store.add(chunks.map((content, i) => ({ id: \`\${doc.id}#\${i + 1}\`, content, vector: vectors[i] })));
  }
  rf.setVectorStore(store);
}

// The index is built on the first question and reused. A failed build is retried on the next one.
function whenReady() {
  ready ??= buildIndex().catch((err) => {
    ready = undefined;
    throw err;
  });
  return ready;
}

${esm ? "export " : ""}async function ask(question) {
  await whenReady();
  const { answer, sources, citations, route, stats } = await rf.auto(question);
  return {
    answer,
    // The passages the answer cites, by the [n] numbers used in the answer
    sources: sources.filter((s) => citations.includes(s.ref)).map((s) => ({ ref: s.ref, id: s.id, content: s.content })),
    technique: route.technique,
    costUSD: stats.costUSD,
    latencyMs: stats.latencyMs,
  };
}
${esm ? "" : "\nmodule.exports = { ask };\n"}`;

const EXPRESS_SERVER = `// A minimal RAG API. Start it with: npm start
// Ask with: curl -X POST localhost:3000/ask -H "content-type: application/json" -d '{"question":"How long do refunds take?"}'
const express = require("express");
const { ask } = require("./rag");

const app = express();
app.use(express.json());

app.get("/", (req, res) => res.json({ ok: true, usage: 'POST /ask { "question": "..." }' }));

app.post("/ask", async (req, res) => {
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!question) return res.status(400).json({ error: 'Send JSON like { "question": "..." }' });
  try {
    res.json(await ask(question));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(\`RAG API on http://localhost:\${port}\`));
`;

const nextRoute = (ragImport) => `// POST /api/ask with { "question": "..." }
import { ask } from "${ragImport}";

// ragforge reads files and keeps an in-memory index, so this route needs the Node.js runtime
export const runtime = "nodejs";

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return Response.json({ error: 'Send JSON like { "question": "..." }' }, { status: 400 });
  try {
    return Response.json(await ask(question));
  } catch (err) {
    console.error(err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
`;

const common = () => ({
  "docs/acme-notes.md": SAMPLE_DOC,
  "golden.json": `${JSON.stringify(GOLDEN, null, 2)}\n`,
  ".env.example": ENV_EXAMPLE,
  ".github/workflows/rag-eval.yml": WORKFLOW,
});

/**
 * TEMPLATES
 * files(ctx) returns { path: content }. ctx.srcDir is "src/" when the project keeps its app in src/.
 * packageJson is merged into the project's: only missing keys are added.
 */
const TEMPLATES = {
  express: {
    description: "Express server with a POST /ask route",
    files: () => ({ ...common(), "rag.js": ragModule({ esm: false }), "server.js": EXPRESS_SERVER }),
    packageJson: ({ version }) => ({
      scripts: { start: "node server.js", ...EVAL_SCRIPTS },
      dependencies: { express: "^4.21.0", ragforge: `^${version}` },
    }),
    next: ["cp .env.example .env   # then add your OPENAI_API_KEY", "npm install", "npm start"],
    tryIt: `curl -X POST localhost:3000/ask -H "content-type: application/json" -d '{"question":"How long do refunds take?"}'`,
  },
  next: {
    description: "Next.js App Router route at /api/ask",
    files: ({ srcDir }) => ({
      ...common(),
      [`${srcDir}lib/rag.js`]: ragModule({ esm: true }),
      [`${srcDir}app/api/ask/route.js`]: nextRoute("../../../lib/rag.js"),
    }),
    packageJson: ({ version }) => ({
      scripts: { dev: "next dev", build: "next build", start: "next start", ...EVAL_SCRIPTS },
      dependencies: { next: "^15.0.0", react: "^19.0.0", "react-dom": "^19.0.0", ragforge: `^${version}` },
    }),
    next: ["cp .env.example .env   # then add your OPENAI_API_KEY", "npm install", "npm run dev"],
    tryIt: `curl -X POST localhost:3000/api/ask -H "content-type: application/json" -d '{"question":"How long do refunds take?"}'`,
  },
};

module.exports = { TEMPLATES, GOLDEN, SAMPLE_DOC };
