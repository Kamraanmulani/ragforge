# Changelog

All notable changes to ragforge are documented here. This project follows [Semantic Versioning](https://semver.org).

## [Unreleased]

### Added

- **Framework adapters.** Use ragforge's retrieval inside the framework you already have. Each is a subpath export that loads its framework (an optional peer dependency) only when used:
  - `ragforge/langchain`: `createRagforgeRetriever(rf)`, a real `BaseRetriever` returning LangChain `Document`s. It works with `.invoke()`, `.pipe()` and `.batch()`.
  - `ragforge/ai-sdk`: `createRagforgeTool(rf)`, a tool the model calls, and `createRagforgeMiddleware(rf)`, which adds the retrieved passages, numbered, to the system prompt of every call. Built for AI SDK 7.
  - `ragforge/llamaindex`: `createRagforgeRetriever(rf)`, a real `BaseRetriever` returning `TextNode`s with scores.
  - `ragforge/mastra`: `createRagforgeTool(rf)`, a tool for Mastra agents and workflows, with a plain JSON schema.
  - All take `topK` and `technique`. They are tested against the real packages, including a Mastra `Agent` calling the tool.
- **`rf.retrieve(query)`.** Routes and retrieves like `auto()` but writes no answer, for frameworks that generate it themselves. `auto()` and `retrieve()` take `technique` to skip routing (`route.decidedBy: 'option'`).
- **Score your own retriever.** `evaluate({ retrievers: { mine: fn } })` scores any `async (query, topK) => passages` next to the techniques, matched on passage text. `fromLangChainRetriever()` and `fromLlamaIndexRetriever()` wrap existing retrievers. They show as `(yours)` on the scoreboard and are never the recommendation.

- **`npx ragforge index`.** Saves the index of your documents in `.ragforge/index` (`--index <dir>`) and keeps it up to date. Only new and edited files are chunked and embedded again, and deleted files are removed.
  - A content-hash manifest tells which documents changed. Inside an edited document, a chunk whose text didn't change keeps its vector, so a one-paragraph edit re-embeds about one chunk. With `--contextual`, only changed documents get new context lines.
  - Changing the chunking, embedding model or contextual settings rebuilds the index, and the summary says why. Vectors from the same model are reused where the text matches.
  - Saves go through temporary files, and the two index files are checked against each other, so an interrupted save is rebuilt instead of half-used. A damaged index is rebuilt too.
  - `--watch` keeps running and updates the index when a file changes. Hidden folders (such as `.ragforge` itself) and `node_modules` are ignored, and it works on Node 18 on Linux, which lacks recursive file watching.
- `chat --index` and `mcp --index` start from the saved index. `mcp --watch` updates it while serving; searches use the previous index until the new one is ready.
- `rf.index(documents, { dir })` does the same in code and returns what changed. `rf.loadIndex(dir)` serves a saved index without reading the documents, and refuses one built with another embedding model.

- **`npx ragforge tune`.** Finds the retrieval setup that works best on your documents: chunking strategy × chunk size × embedding model × query technique (hybrid, HyDE, Step-Back, Fan-Out, rerank, contextual), within a USD budget (`--budget`, default $0.50). It writes the winner to `ragforge.config.json`.
  - Successive halving: every index setup is screened with plain and hybrid search, then the best few (`--top-setups`) also try the techniques that add LLM calls, reranking or context lines.
  - The plan and its estimated cost are printed before anything is spent. Every step is estimated and checked against the budget, steps that don't fit are skipped and listed, and the run won't start if screening alone is over budget.
  - Each distinct API call is made once: a chunk embedded for two setups, or a HyDE draft used by two techniques, is paid for once. Cost per query is still reported as production would pay.
  - Questions are generated once from short passages and matched by their text, so every setup is scored on the same questions.
  - The pick needs a clear win, since the best of many noisy scores is often just lucky. A setup replaces the default only when, question by question, it ranks the right chunk higher on at least 2 more questions than it ranks it lower (`minGainQuestions`). A materially cheaper setup that is about as good is preferred. A technique that adds cost must also beat the chosen free setup by 5 points. Ties keep the default.
  - Reused calls wait as long as the original call took, so the latency reported for every trial is real.
  - The report lists the best trials, what changed from the default and the spend. `--html` adds a chart of hit rate against cost per query that marks the Pareto front. Tables show the average chunk length, since bigger chunks send more text to the LLM.
  - `rf.tune(options)` does the same in code. `formatTuneTable()`, `renderTuneHtml()` and `loadConfig()` are exported.
- **`createRagforge({ config })`.** Loads `ragforge.config.json` (object or path): providers, models, `topK`, and the technique every `auto()` call uses (`route.decidedBy: 'config'`). Options you pass still win.
- **`rf.index(documents)`.** Builds and uses an in-memory index (vectors and BM25), chunked the way the config says and with context lines when it is contextual. `rf.config` is the loaded config.
- `chat` and `mcp` take `--config ragforge.config.json`.

### Fixed

- `ragforge tune` could pick a different winner from run to run when two trials tied exactly (e.g. `baseline` and `hybrid` on the same setup): the tie was decided by sub-millisecond latency. Exact ties now go to the simpler technique.

- `mcp --top-k` now sets the default number of passages per `search_docs` and `ask` call. The help described it, but the server ignored it.
- `chat` prints each source on one line, including chunks that start with a heading trail.

- **Contextual retrieval.** At index time, an LLM writes a line that places each chunk in its document. The line is embedded and keyword-indexed with the chunk, while sources and answers keep the chunk as written.
  - `npx ragforge eval --contextual` scores two new techniques, `contextual` and `contextual+hybrid`, next to the others. `contextual` combines with the rest (`contextual+rerank`, `contextual+hyde`). In code: `evaluate({ contextual: true })`, or list them in `techniques`.
  - The cost is estimated and printed before any line is written. `--context-budget <usd>` (`contextOptions.budgetUSD`) stops when the estimate is higher, or when the model has no known price. `--context-model` picks the model that writes the lines.
  - Lines are cached in `.ragforge/context-cache.json` (`--context-cache <file>`, or `none`) and reused while the chunk, its document and the model are unchanged. Documents over 24,000 characters are cut to a window around each chunk.
  - The scoreboard and HTML report show the context lines as a one-time index cost, apart from cost per query. The result has `contextual: { model, chunks, contextualized, cached, failed, estimate, usage }`. A contextual technique has to beat plain search by `minImprovement` to be recommended, like other techniques that add LLM calls.
  - A chunk whose call fails is indexed without context and counted in `failed`. If every call fails, the run stops with the error.
  - `npx ragforge chat --contextual` and `npx ragforge mcp --provider <name> --contextual` index with context lines too.
  - `rf.contextualize(chunks, documents, options)` returns chunks with `context` and `indexText` for your own index. `rf.estimateContextCost()` gives the estimate without calling the LLM.
- `createFileCache(file)`: a `{ get, set }` cache kept in a JSON file, so entries survive between runs.
- `createMemoryVectorStore()` and `createBM25Index()` accept `indexText` on an entry: it is searched, and results return `content`.

- **Chunking strategies.** `--chunk-strategy` (`chunkStrategy` in `evaluate()`, `chunkStrategy` in `startMcpServer()`) picks how documents are split, in `eval`, `chat`, `mcp` and `label`:
  - `paragraph`: packs whole paragraphs. The default, and unchanged, so existing chunk ids and CI baselines don't move.
  - `fixed`: windows of characters cut at a word.
  - `sentence`: packs whole sentences, never cutting one. Version numbers, file names and abbreviations such as "e.g." don't end a sentence.
  - `markdown-heading`: one section per chunk, starting with its heading trail (`Setup > Windows`). `#` lines inside code fences are not headings.
  - `semantic`: splits where the topic shifts, measured by embedding similarity between sentences. Costs one embedding call per sentence, counted in the eval's setup cost.
  - `code`: splits source files by top-level declaration, keeping comments, docstrings and decorators with the code below them. Other documents are split by paragraph. With this strategy, `--docs` folders also yield source files (`.js`, `.ts`, `.py`, `.go`, `.rs`, `.java` and more), skipping `dist`, `build`, `vendor` and minified files.
- `--chunk-overlap <n>` (`chunkOverlap`) repeats text between chunks, for the `fixed` and `sentence` strategies.
- The eval result has `chunking: { strategy, size, overlap }`, and the scoreboard shows it next to the chunk count.
- Questions replayed with `--questions-file` (and `--from-logs` labels) find their passage under any strategy: `expectedText` matching now ignores Markdown heading marks, heading-trail separators and differences in whitespace, and generated questions and labels remember a `markdown-heading` passage without its trail.
- `chunkDocuments()` and `CHUNK_STRATEGIES` are exported. `chunkText()` takes `strategy` and `overlap`. `loadDocuments()` takes `code: true`.

## [2.3.1] - 2026-11-21

### Fixed

- The eval no longer recommends a technique that only tied with plain search. When a free technique such as `hybrid` matched plain search on both hit@k and MRR, the pick was decided by a sub-millisecond latency difference and could change from run to run, with a reason claiming it "ranked the right chunk higher". A tie now recommends plain search.

## [2.3.0] - 2026-11-21

Trust: measure answer quality, catch regressions in CI, and test on the queries real users ask.

### Added

- **`npx ragforge chat --docs ./docs`.** Ask questions about a folder from the terminal. The answer streams in, followed by the passages it cites, the technique used, the cost and the latency. Works with every provider, including fully local with Ollama.
- **`npx ragforge init [dir]`.** Scaffolds a working RAG app: an Express server with `POST /ask` (or a Next.js route with `--template next`), a sample document, golden questions, npm scripts for the eval and a GitHub workflow that fails pull requests when retrieval quality drops. In an existing project it keeps your files and only adds missing scripts and dependencies to `package.json`.
- **Eval on real queries.** Three steps: log, label, evaluate.
  - `createRagforge({ onTrace })` is called with a trace of every `auto()` and `ragPipeline()` call: query, route, sources, citations, answer and stats. A file path (`onTrace: 'traces.jsonl'`) appends them as JSONL. `createTraceLogger(file, { includeText: false })` leaves passage text and answers out of the log. A hook that throws never fails the call.
  - `npx ragforge label --from-logs traces.jsonl --docs ./docs` shows each real query with candidate passages and asks which one answers it. It uses keyword search, so it needs no API key. Labels are saved after every answer and later runs continue where you stopped.
  - `npx ragforge eval --from-logs traces.jsonl --docs ./docs` runs the eval on the labelled real queries. It works with `--answers`, `--compare` and `--fail-on-drop`.
  - `readTraces()` is exported.
- **Answer-quality eval.** `npx ragforge eval --answers` (or `evaluate({ answers: true })`) writes an answer from each technique's passages, with the pipeline's own prompt, and grades it with an LLM judge. Four new columns sit next to the retrieval scores: **faithfulness** (claims supported by the passages), **answer relevance**, **context recall** and **citation accuracy**, each with a 95% interval across questions. `--judge-model` (`judgeOptions`) picks a different model for the judge.
- The judge has to quote the passage for every claim, fact or citation it accepts, and the quote is checked in code. A verdict without a valid quote doesn't count. Each question's run lists what lowered its scores in `findings`.
- Judge prompts are fixed and versioned (`JUDGE_VERSION`, in the result as `answers.judgeVersion`) and run at temperature 0, so scores stay comparable between runs.
- Techniques that retrieved the same passages share one answer and one set of grades. Answer and judge usage is reported apart from the techniques' cost and latency, which stay retrieval-only.
- Questions can carry an `expectedAnswer`, used as the reference for context recall.
- With `--answers` on both runs, `--fail-on-drop` also fails on a faithfulness drop.
- **CI regression checks.** `npx ragforge eval --compare main.json` prints what changed against an earlier `--json` result: hit@k, MRR, latency and cost for each technique. Add `--fail-on-drop 3` to exit with code 1 when a technique lost more than 3 points of hit@k. It warns when the two runs can't be compared fairly (different questions, top-k or embedding model).
- `--questions-file` also takes an earlier `--json` result and asks its questions again, so a saved baseline is all a CI check needs. Generated questions are matched on the opening words of their passage, so they follow the content when chunk ids move.
- `--markdown <file>` writes the scoreboard as Markdown, with the comparison when `--compare` is set.
- **GitHub Action.** `uses: Kamraanmulani/ragforge@v2.3.0` runs the eval, adds the scoreboard to the job summary, posts it as a pull request comment that is updated on each push, and fails the job on a regression.
- `compareEvals()`, `formatComparison()` and `renderMarkdownReport()` are exported.

### Fixed

- `--techniques` and `--question-styles` accept spaces as well as commas. On Windows, an npm script's `--techniques baseline,hybrid` reached the CLI as `baseline hybrid` and was rejected as an unknown technique.

## [2.2.0] - 2026-11-13

Reach: ragforge works inside the AI coding tools developers already use.

### Added

- **MCP server.** `npx ragforge mcp --docs ./docs` indexes a folder and serves it to MCP clients over stdio (Claude Code, Cursor, Windsurf). Three tools: `search_docs` (hybrid search: BM25 always, vectors when embeddings are configured, fused with RRF), `get_chunk` (a passage with its neighbours) and `ask` (a cited answer when a chat model is configured, otherwise the matching passages). It needs no API key: keyword search runs on its own. `--provider ollama` enables answers and vector search fully locally. Also exported as `startMcpServer()`.
- The MCP server speaks JSON-RPC directly, so the core keeps its two dependencies.

- **More providers.** Built in: `anthropic` (Claude, chat only), `gemini`, `mistral` and `cohere` (chat and embeddings), alongside `openai` and `ollama`. Use them with `createRagforge({ llm: 'anthropic' })`, or on the CLI with `--provider` and `--embeddings`. They use plain `fetch`, so the core still has 2 dependencies. Prices for their main models are in `DEFAULT_PRICING`.
- `createAnthropicProvider`, `createGeminiProvider`, `createMistralProvider` and `createCohereProvider` are exported.

- **Local embeddings, no API key.** `local` runs a small embedding model in-process with the optional `@huggingface/transformers` package (default `Xenova/bge-small-en-v1.5`). Use it with `createRagforge({ embeddings: 'local' })`, `npx ragforge mcp --embeddings local`, or `npx ragforge eval --provider local --questions-file ...` for a free retrieval-only eval. `createLocalProvider()` is exported. The model is downloaded on first use.

- **Vector store adapters.** `ragforge/pgvector`, `ragforge/qdrant`, `ragforge/chroma`, `ragforge/pinecone`, `ragforge/lancedb` and `ragforge/supabase`. Each wraps a client you already have (no database package is loaded by ragforge) and returns `{ id, content, score, metadata }`, so `evaluate()` works against production data. The pgvector adapter also adds `searchText` (Postgres full-text search) for hybrid retrieval.
- The package now has an `exports` map for the adapter subpaths. The root import is unchanged, and deep imports such as `ragforge/src/cli` keep working.

- **Streaming answers.** `rf.auto(q, { stream: true })` and `rf.ragPipeline(q, { stream: true })` return the sources and route right away, plus a `stream` of answer tokens. `answer`, `citations`, `done` and `stats` resolve once the stream has ended. OpenAI, Ollama and Anthropic stream tokens. Other providers fall back to a single chunk. Providers can add a `chatStream` generator.

### Changed

- `--provider` no longer defaults to `openai` in the CLI parser. `eval` still uses `openai` when you don't pass it, so existing commands behave as before.

## [2.1.0] - 2026-10-30

Hybrid search, reranking, PDF/DOCX/HTML/URL loading and citations, all measurable with the eval.

### Added

- **Hybrid search.** A new `hybrid` technique adds a BM25 keyword search next to vector search and fuses both with RRF, at no extra LLM calls. It combines with the other techniques (`hybrid+hyde`) and is in the eval's default technique list. `ragPipeline` and `auto` take `hybrid: true` (or `createRagforge({ hybrid: true })`), and `auto({ from })` turns it on when the eval picked a hybrid technique.
- **Reranking.** `createRagforge({ reranker })` with built-in `'cohere'`, `'jina'` and `'llm'` rerankers, or any `{ rerank() }` object. A new `rerank` technique (`rerank`, `hybrid+rerank`, ...) retrieves 20 candidates (`rerankCandidates`) and lets the reranker pick the top *k*. The eval adds both to its defaults when a reranker is set, and `npx ragforge eval --reranker cohere` does the same from the CLI. `ragPipeline` and `auto` take `rerank: true`, and `auto({ from })` turns it on when the eval picked a rerank technique.
- **PDF, DOCX, HTML and URLs.** `npx ragforge eval --docs` and the new `loadDocuments()` read `.html`/`.htm` (main content, no page chrome), `.pdf` (with the optional `unpdf` package) and `.docx` (with the optional `mammoth` package), plus http(s) URLs by content type. `htmlToText()` is exported too.
- **Citations.** `ragPipeline` and `auto` return `sources` (the passages the answer was written from, numbered, with the store's `id`, `score` and `metadata`) and `citations` (the numbers the answer cites). The answer prompt now asks for `[1]`-style markers. Turn this off with `citations: false`.
- Stats include `rerankCalls`, and reranker cost is tracked (`perSearch` prices, `rerank-v3.5` included).
- `createMemoryVectorStore()` now has `searchText(text, topK)`, backed by a new zero-dependency BM25 index, also exported as `createBM25Index()`. Your own vector store can opt in to hybrid search by adding a `searchText` method.

### Changed

- Techniques that add no cost (no extra LLM or reranker calls, such as `hybrid`) are recommended when they rank above plain search, without having to clear the 5-point `minImprovement` bar.

## [2.0.0] - 2026-10-28

ragforge 2 adds tools that tell you which query technique works on your data, and apply it per query.

### Added

- **`npx ragforge eval`** and **`rf.evaluate()`**. Benchmarks techniques on your documents. It generates test questions from your chunks, runs every technique, and reports hit@k, MRR, latency, cost and LLM calls. Generated test queries mix full questions, keyword searches and vague why/how questions, and queries that only make sense next to their passage are replaced. It recommends a technique, or plain search when no technique beats it by 5 points. Supports combined techniques (`hyde+stepback`), your own questions (`--questions-file`), your existing vector store, and HTML and JSON reports.
- **`rf.auto()`** and **`rf.route()`**. Picks a technique per query, using built-in rules, a small LLM classifier (`router: 'llm'`), or the per-category winners from an eval result (`from: evalResult`). Every result explains its choice in `route.reason`.
- **`createRagforge(options)`**. Configured instances with no global state.
- **Providers.** OpenAI and Ollama (local, free) built in; any object with `chat` and `embed` works. Chat and embedding providers can be mixed.
- **Stats on every call:** LLM and embedding calls, tokens, USD cost and latency. `ragPipeline` and `auto` return `stats`; every technique accepts `onStats`. The price table is overridable.
- **Caching.** Built-in in-memory LRU cache, or any `{ get, set }` store such as Redis.
- **TypeScript definitions.**
- New exports: `createMemoryVectorStore`, `chunkText`, `classifyQuery`, `formatTable`, `renderHtmlReport`, `DEFAULT_PRICING`, `DEFAULT_RULES`.

### Changed

- Default chat model is now `gpt-4o-mini` (was `gpt-4`). The embedding model is unchanged (`text-embedding-ada-002`), so existing collections keep working.
- Techniques run in parallel in the pipeline, and retrieval for sub-queries runs in parallel too.
- One failing technique no longer fails the whole pipeline.
- Logging is off by default. Enable it with `debug: true` or a custom `logger`.
- HyDE and Fan-Out make no embedding calls when no vector store is set.
- Package size went from 174 kB to 108 kB unpacked, despite the new features. Tests and examples are no longer published, and the unused `axios` and `nodemon` dependencies were removed.
- Requires Node.js 18 or later.

### Breaking

- Unknown technique names now throw instead of being silently ignored.
- Deep imports (`ragforge/src/core/openaiClient`, `ragforge/src/core/vectorClient`) were removed. Import `callLLM`, `getEmbedding`, `setOpenAIClient` and `setVectorClient` from `ragforge`.
- Node.js 14 and 16 are no longer supported.

### Migrating from 1.x

Most code needs no changes: `hyde`, `cot`, `stepback`, `fanout`, `ragPipeline`, `setVectorClient` and friends still work through a default OpenAI instance. To keep using GPT-4, pass `{ model: 'gpt-4' }` per call, or `createRagforge({ defaults: { model: 'gpt-4' } })`.

## [1.1.0] - 2026-10-28

### Fixed

- `.env` is loaded from your project root instead of from inside `node_modules`.
- A missing `OPENAI_API_KEY` throws on the first call instead of exiting your process when the package is required.
- `ragPipeline` now embeds sub-queries before querying the vector client, matching `hyde` and `fanout`.
- Options passed to `hyde`, `cot`, `stepback` and `fanout` are applied instead of ignored.
- `temperature: 0` and other falsy options are respected.

### Added

- `callLLM`, `getEmbedding` and `setOpenAIClient` are exported from the package root.

## [1.0.3] - 2025-10-07

First stable release with HyDE, Chain-of-Thought, Step-Back, Fan-Out, RRF and the RAG pipeline.

[2.3.1]: https://github.com/Kamraanmulani/ragforge/compare/v2.3.0...v2.3.1
[2.3.0]: https://github.com/Kamraanmulani/ragforge/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/Kamraanmulani/ragforge/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/Kamraanmulani/ragforge/compare/v2.0.1...v2.1.0
[2.0.0]: https://github.com/Kamraanmulani/ragforge/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/Kamraanmulani/ragforge/releases/tag/v1.1.0
[1.0.3]: https://www.npmjs.com/package/ragforge/v/1.0.3
