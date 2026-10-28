# ragforge v2 implementation plan

**Goal:** make ragforge the package that tells you which RAG query technique works on *your* data, then applies it automatically.

**Headline for the release:** "Benchmark RAG query techniques on your own data, then use the winner automatically."

Work happens on the `v2` branch; `main` stays on 1.x until release.

---

## Phase 1: Foundation (done)

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

## Phase 2: `ragforge eval` (done)

| Item | Status |
|---|---|
| `rf.evaluate({ documents, questions?, techniques, topK })` → rows `{ technique, hitRate, mrr, avgLatencyMs, avgCostUSD, avgLlmCalls, errors }` | Done |
| Question generation from chunks spread evenly across the corpus; source chunk is ground truth | Done |
| User questions with `expectedId` or `expectedText`; can run against the instance's own vector store | Done |
| Techniques: baseline, hyde, cot, stepback, fanout, and `+` combinations fused with RRF | Done |
| Recommendation: best technique, or baseline when the gain is under `minImprovement` (5 points) | Done |
| In-memory cosine vector store, paragraph-aware chunker (no overlap, for fair scoring) | Done |
| Bounded concurrency to avoid rate limits; input validated before any API calls | Done |
| CLI `npx ragforge eval` with `--provider ollama`, `--html`, `--json`, `--questions-file` | Done |
| Console table and self-contained HTML report (light/dark) | Done |

Not yet verified against a real provider (needs an OpenAI key or a running Ollama).

## Phase 3: Auto-router (done)

| Item | Status |
|---|---|
| `classifyQuery()`: rules sort queries into comparison / exact / short / conceptual / simple | Done |
| Default category → technique map (fanout / baseline / hyde / stepback / baseline), overridable via `rules` | Done |
| `router: "llm"`: one temperature-0, 10-token classification call; falls back to rules on a bad answer | Done |
| `from: evalResult`: per-category winner learned from eval questions (`minSamples` 3, `minImprovement` 5 points, ties to the cheaper technique); works with saved JSON | Done |
| `rf.route()` (decision only) and `rf.auto()` (route + pipeline); result carries `route: { technique, category, classifier, decidedBy, reason }` | Done |
| `techniques` limits what the router may pick | Done |

Note: the result keeps the pipeline shape and adds `route`, rather than spreading `technique`/`reason` at the top level as first sketched.

## Phase 4: Release and launch

1. Bump to `2.0.0`, CHANGELOG with migration notes (mostly none).
2. Run eval on a public dataset; put the scoreboard in the README.
3. README hero: GIF of the eval CLI.
4. Blog post: "I benchmarked 5 RAG query techniques so you don't have to".
5. Post to r/LocalLLaMA, r/node, Show HN, dev.to, LinkedIn.
6. GitHub Actions CI + badges.

## Later (2.x)

Anthropic/Gemini adapters, streaming answers, citations, vector store adapters (`ragforge/qdrant`, `ragforge/pgvector`), hybrid BM25 + vector with RRF, trace viewer, playground site.
