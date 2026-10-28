# ragforge v2 implementation plan

**Goal:** make ragforge the package that tells you which RAG query technique works on *your* data, then applies it automatically.

**Headline for the release:** "Benchmark RAG query techniques on your own data, then use the winner automatically."

Work happens on the `v2` branch; `main` stays on 1.x until release.

---

## Phase 1: Foundation (needed by everything else)

| Item | Why | Status |
|---|---|---|
| `createRagforge({ llm, embeddings, vectorStore, cache, debug })` factory | Multiple configured instances, no global state, testable | Done |
| Provider adapters: OpenAI, Ollama | Provider-agnostic for real; Ollama makes eval free to run locally | Done |
| Per-call stats: `{ llmCalls, embeddingCalls, cacheHits, inputTokens, outputTokens, costUSD, latencyMs }` | Eval scoreboard needs cost/latency; users want to see cost | Done |
| Pricing table (overridable) | Turns token counts into USD | Done |
| Pluggable cache (in-memory LRU built in, any `{get,set}` adapter) | Repeat queries and eval re-runs become free | Done |
| Techniques run in parallel in `translate` / pipeline retrieval | ~2-3x faster default pipeline | Done |
| Silent by default, `debug: true` or custom `logger` | Library shouldn't spam the console | Done |
| v1 API keeps working (`hyde(q)`, `setVectorClient`, ...) via a default instance | Existing users can upgrade without code changes | Done |
| TypeScript declarations (`index.d.ts`) | Autocomplete, expected by most users | Done |
| `"files"`, `"types"`, `"engines"`; drop unused deps (axios, nodemon); qdrant to devDeps | Smaller install, clean tarball | Done |
| Mocked unit tests (`npm test`), real-API tests moved to `npm run test:integration` | Runs in CI for free | Done |
| Default chat model `gpt-4` → `gpt-4o-mini` | ~200x cheaper, faster; embedding model unchanged so existing vector collections keep working | Done |

## Phase 2: `ragforge eval`

- API: `rf.evaluate({ documents, questions?, techniques, topK })` → scoreboard rows `{ technique, hitAtK, mrr, avgLatencyMs, avgCostUSD }`.
- If `questions` is omitted, generate N questions from random document chunks with the LLM; the source chunk is the ground truth.
- Built-in in-memory vector store (cosine similarity) so eval needs no database.
- CLI: `npx ragforge eval --docs ./docs --questions 20 [--provider ollama] [--html report.html]`.
- Baseline (plain embedding search) always included for comparison.
- HTML report (single file) for sharing.

## Phase 3: Auto-router

- `rf.auto(query, options)` picks a technique per query.
- Rule-based classifier first (length, comparison words like "vs"/"compare"/"difference", specificity), optional cheap LLM classifier (`router: "llm"`).
- Can be seeded from an eval result: `rf.auto(query, { from: evalResult })`.
- Returns `{ technique, reason, ...pipelineResult }` so the choice is visible.

## Phase 4: Release and launch

1. Bump to `2.0.0`, CHANGELOG with migration notes (mostly none).
2. Run eval on a public dataset; put the scoreboard in the README.
3. README hero: GIF of the eval CLI.
4. Blog post: "I benchmarked 5 RAG query techniques so you don't have to".
5. Post to r/LocalLLaMA, r/node, Show HN, dev.to, LinkedIn.
6. GitHub Actions CI + badges.

## Later (2.x)

Anthropic/Gemini adapters, streaming answers, citations, vector store adapters (`ragforge/qdrant`, `ragforge/pgvector`), hybrid BM25 + vector with RRF, trace viewer, playground site.
