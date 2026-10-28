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

## Phase 4: Release and launch (in progress)

| Item | Status |
|---|---|
| README rewritten: logo, tagline, badges, eval hero, quick start, eval, routing, techniques, providers, vector stores, API, upgrade guide, FAQ | Done |
| `assets/logo.svg` (light/dark) and `assets/eval-demo.svg` (terminal hero mirroring real CLI output) | Done |
| `CHANGELOG.md` with 2.0 migration notes, shipped in the package | Done |
| GitHub Actions CI (Node 18/20/22: tests, typecheck, CLI smoke, pack) + `npm run typecheck` | Done |
| Real eval run (OpenAI, 12 npm package READMEs, 437 chunks, 30 queries, $0.033): baseline 77% / MRR 0.672 matched or beat every technique; HyDE 67% at ~350× the cost. `eval-demo.svg` shows this run | Done |
| Fixed from the real run: unanswerable generated questions ("the tool mentioned in the text"), single question style, colliding ids for same-named docs | Done |
| Release (steps below) | To do |
| Blog post: "I benchmarked 5 RAG query techniques so you don't have to" | To do |
| Post to r/LocalLLaMA, r/node, Show HN, dev.to, LinkedIn | To do |

### Release checklist

The README loads images from `raw.githubusercontent.com/.../main/assets/`, and the CI badge reads `main`, so merge and push **before** publishing, or npm will show broken images.

```bash
git checkout main
git merge --no-ff v2
git push origin main
# wait for the CI run on main to pass
npm version major          # 2.0.0: bumps package.json, commits, tags v2.0.0
git push origin main --follow-tags
npm publish
```

Then set the `[2.0.0] - Unreleased` heading in CHANGELOG.md to the release date (in the same commit as `npm version`, via `git commit --amend`, before pushing) and create a GitHub release from the `v2.0.0` tag with the changelog section as notes.

## Later (2.x)

Anthropic/Gemini adapters, streaming answers, citations, vector store adapters (`ragforge/qdrant`, `ragforge/pgvector`), hybrid BM25 + vector with RRF, trace viewer, playground site.
