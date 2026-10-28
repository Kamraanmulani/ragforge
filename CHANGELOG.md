# Changelog

All notable changes to ragforge are documented here. This project follows [Semantic Versioning](https://semver.org).

## [2.0.0] - Unreleased

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

[2.0.0]: https://github.com/Kamraanmulani/ragforge/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/Kamraanmulani/ragforge/releases/tag/v1.1.0
[1.0.3]: https://www.npmjs.com/package/ragforge/v/1.0.3
