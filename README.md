<div align="center">

<img src="https://raw.githubusercontent.com/Kamraanmulani/ragforge/main/assets/logo.svg" alt="ragforge" width="420">

<h3>Find the RAG query technique that works on <em>your</em> data.<br>Then use it automatically.</h3>

HyDE · Step-Back · Fan-Out · Chain-of-Thought · Reciprocal Rank Fusion<br>
benchmarked on your documents, routed per query, with cost tracking built in.

<br>

[![npm version](https://img.shields.io/npm/v/ragforge?color=4f46e5&label=npm)](https://www.npmjs.com/package/ragforge)
[![tests](https://img.shields.io/github/actions/workflow/status/Kamraanmulani/ragforge/ci.yml?branch=main&label=tests)](https://github.com/Kamraanmulani/ragforge/actions/workflows/ci.yml)
[![types](https://img.shields.io/badge/types-included-3178c6)](./index.d.ts)
[![node](https://img.shields.io/node/v/ragforge?color=339933)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/ragforge?color=16a34a)](./LICENSE)

[Quick start](#quick-start) ·
[Eval](#benchmark-techniques-on-your-data) ·
[Auto-routing](#auto-routing) ·
[Techniques](#techniques) ·
[API](#api-reference) ·
[Changelog](./CHANGELOG.md)

</div>

<br>

<div align="center">
<img src="https://raw.githubusercontent.com/Kamraanmulani/ragforge/main/assets/eval-demo.gif" alt="Animated terminal: npx ragforge eval runs on 12 npm READMEs, prints a scoreboard of techniques and recommends plain search" width="860">
<br>
<sub>A real run on 12 popular npm package READMEs (30 queries, gpt-4o-mini, total cost 3 cents). On these docs, plain search matched or beat every technique, and HyDE cost 350× more per query while finding the right chunk less often. Your data may say otherwise. That's why you measure.</sub>
</div>

<br>

## Why ragforge?

Query techniques like HyDE and Step-Back can lift retrieval a lot on some data, do nothing on other data, and every one of them costs extra LLM calls. Most libraries hand you the techniques and leave you guessing.

ragforge answers the question first:

- **📊 Measure.** `npx ragforge eval` builds a test set from your documents and scores every technique on hit rate, MRR, latency and cost. It recommends plain search when the techniques don't earn their cost.
- **🧭 Route.** `rf.auto(query)` picks a technique per query, from the eval's per-category winners or from built-in rules, so simple lookups stay cheap.
- **🔌 Plug in anything.** OpenAI or a local Ollama model (free), any vector database, any custom provider. Stats, caching and TypeScript types included.

## Installation

```bash
npm install ragforge
```

Requires Node.js 18+, and an `OPENAI_API_KEY` (in your environment or a `.env` file in your project root) or a running [Ollama](https://ollama.com) server.

## Quick start

**1. Find out what works on your documents.** No database needed; this indexes them in memory.

```bash
npx ragforge eval --docs ./docs --json eval.json
```

**2. Use the winner in your app, per query.**

```js
const { createRagforge } = require('ragforge');

const rf = createRagforge({ vectorStore: myVectorStore });

const result = await rf.auto('How do refunds work for annual plans?', {
  from: require('./eval.json'),
});

console.log(result.answer);
console.log(result.route.reason); // why this technique was chosen
console.log(result.stats);        // { llmCalls, inputTokens, outputTokens, costUSD, latencyMs, ... }
```

**Or call a technique directly:**

```js
const { hyde, stepback } = require('ragforge');

const answer = await hyde('What are the benefits of vector databases?');
const { abstractQuery } = await stepback("Why did my Postgres query stop using the index?");
```

<details>
<summary><b>Free and local with Ollama</b></summary>

```bash
ollama pull llama3.1 && ollama pull nomic-embed-text
npx ragforge eval --docs ./docs --provider ollama
```

```js
const rf = createRagforge({ llm: 'ollama' });
```

</details>

## Benchmark techniques on your data

```bash
npx ragforge eval --docs ./docs
```

1. **Index.** Reads `.txt`, `.md`, `.mdx` and `.rst` files, splits them into chunks and embeds them into an in-memory store.
2. **Generate questions.** The LLM writes a test query for chunks spread across your documents, mixing three styles real users have: full questions, short keyword searches and vague *why/how* questions. The chunk it came from is the right answer. Queries that only make sense next to the passage ("the function described…") are thrown out and replaced.
3. **Run.** Every technique runs on every question, and ragforge checks whether it retrieved that chunk in the top *k*.
4. **Score and recommend.** You get hit@k, MRR, latency, cost per query and LLM calls for each technique. A technique that adds LLM calls has to beat plain search by **5 points** to be recommended. Hybrid search adds none, so it only has to rank higher.

| Option | Default | |
|---|---|---|
| `--docs <path>` | | File or folder, repeatable |
| `--questions <n>` | `10` | Questions to generate |
| `--questions-file <file>` | | Your own: `[{ "question": "...", "expectedText": "..." }]` |
| `--question-styles <list>` | `question,keywords,conceptual` | Which generated query styles to mix |
| `--techniques <list>` | `baseline,hybrid,hyde,stepback,fanout` | Also `cot`; combine with `+`, e.g. `hybrid+hyde` |
| `--provider <name>` | `openai` | `openai` or `ollama` |
| `--embeddings <name>` | same as provider | Mix providers |
| `--model <name>` | provider default | Chat model |
| `--embedding-model <name>` | provider default | Embedding model |
| `--reranker <name>` | | `llm`, `cohere` or `jina`; adds `rerank` and `hybrid+rerank` to the techniques |
| `--rerank-candidates <n>` | `20` | Candidates retrieved before reranking |
| `--top-k <n>` | `5` | Results per search |
| `--chunk-size <n>` | `800` | Max characters per chunk |
| `--concurrency <n>` | `4` | Parallel requests |
| `--html <file>` | | Shareable report, works in light and dark mode |
| `--json <file>` | | Full results, usable with `auto({ from })` |

With OpenAI, a 10-question run on the default techniques makes about 40 small `gpt-4o-mini` calls plus embeddings. The scoreboard shows the exact cost.

<details>
<summary><b>From code, or against your production vector store</b></summary>

```js
const fs = require('fs');
const { createRagforge, formatTable, renderHtmlReport } = require('ragforge');
const rf = createRagforge();

const result = await rf.evaluate({
  documents: [{ id: 'handbook.md', content: handbookText }],
  techniques: ['baseline', 'hybrid', 'hyde', 'stepback', 'hybrid+hyde'],
  numQuestions: 20,
});

console.log(formatTable(result));
fs.writeFileSync('report.html', renderHtmlReport(result));

// Test the store you already have, with your own questions
rf.setVectorStore(myQdrantStore);
await rf.evaluate({
  questions: [{ question: 'How long do refunds take?', expectedText: 'within 5 business days' }],
});
```

</details>

## Auto-routing

`auto()` picks a technique for each query, then runs the pipeline with it.

```js
const result = await rf.auto('PostgreSQL vs MySQL for analytics');

result.route;
// {
//   technique: 'fanout',
//   category: 'comparison',
//   classifier: 'rules',
//   decidedBy: 'rules',
//   reason: 'The query compares things or asks several questions, so each part gets its own search.'
// }
```

| Category | Example query | Default technique |
|---|---|---|
| `comparison` | "PostgreSQL vs MySQL", two questions in one | `fanout` |
| `exact` | "What does error E404 mean?", quotes, `snake_case`, file names | `baseline` |
| `short` | "refund policy" | `hyde` |
| `conceptual` | "Why does a higher learning rate make the loss diverge?" | `stepback` |
| `simple` | any other clear question | `baseline` |

There are three ways to decide:

- **Rules** (default). Free and instant.
- **`{ router: 'llm' }`**. One temperature-0, 10-token classification call, for fuzzier queries.
- **`{ from: evalResult }`** (recommended). Uses the technique that actually won for each category in your eval. A category needs 3 eval questions (`minSamples`) before its result is trusted; otherwise the eval's overall pick is used.

```js
await rf.route(query);                                        // decision only, nothing runs
await rf.auto(query, { techniques: ['baseline', 'hyde'] });   // limit the choices
await rf.auto(query, { rules: { short: 'hyde+stepback' } });  // change a category's technique
```

## Techniques

| Technique | What it does | Best for | LLM calls* |
|---|---|---|---|
| **Hybrid** | Adds a BM25 keyword search for the query and fuses it with vector search | Error codes, names, IDs, exact terms | 0 |
| **Rerank** | Retrieves 20 candidates, then a reranker picks the best *k* | The right chunk is retrieved but ranked too low | 0 (1 with the `llm` reranker), plus 1 reranker call |
| **HyDE** | Writes a hypothetical answer and searches with *that* | Short or vague queries | 1, or 2 with a vector store |
| **Step-Back** | Rewrites the question into a broader, principle-level one | Specific *why/how* questions | 2 |
| **Fan-Out** | Splits the query into 3 sub-questions and searches each | Comparisons, multi-part questions | 2 |
| **Chain-of-Thought** | Reasons step by step; the reasoning becomes a search query | Multi-step reasoning | 1 |
| **RRF** | Merges several ranked result lists into one | Combining searches | 0 |
| **Pipeline** | Runs techniques in parallel, retrieves, fuses with RRF, writes the answer | End-to-end RAG | techniques + 1 |

<sub>* When the technique is called on its own. In the eval, techniques only build search queries, so each costs 1 call: Step-Back searches with the broader question plus the original, Fan-Out with the sub-questions plus the original. Hybrid combines with any of them (`hybrid+hyde`) and adds the original question to both vector and keyword search.</sub>

### Hybrid search

Embeddings are good at meaning and bad at exact strings like `E_CONNRESET`, `maxTokens` or a product SKU. Hybrid search runs a BM25 keyword search next to the vector search and merges both with RRF. It costs no LLM calls, and the eval tells you whether it actually helps on your data. On some corpora it doesn't.

```js
await rf.ragPipeline(query, { hybrid: true });      // per call
createRagforge({ vectorStore, hybrid: true });      // as the default
await rf.auto(query, { from: evalResult });         // on when the eval picked a hybrid technique
```

The keyword search comes from the vector store's optional `searchText(text, topK)` method. `createMemoryVectorStore()` has one built in, using ragforge's zero-dependency BM25 index. For your own database, see [Vector stores](#vector-stores).

### Reranking

Vector search ranks by similarity, which isn't the same as "answers the question". A reranker reads the query and each candidate together and re-scores them. ragforge retrieves a deeper pool (`rerankK`, default 20), reranks it and keeps the top *k*.

```js
const rf = createRagforge({ vectorStore, reranker: 'cohere' });  // COHERE_API_KEY

await rf.ragPipeline(query, { rerank: true });                   // per call
createRagforge({ vectorStore, reranker: 'cohere', rerank: true }); // as the default
await rf.auto(query, { from: evalResult });                      // on when the eval picked a rerank technique
```

```bash
npx ragforge eval --docs ./docs --reranker cohere   # adds rerank and hybrid+rerank to the scoreboard
```

| Reranker | | Cost |
|---|---|---|
| `'cohere'` | Cohere `rerank-v3.5`, key from `COHERE_API_KEY` | about $0.002 per search, tracked in `stats` |
| `'jina'` | Jina `jina-reranker-v2-base-multilingual`, key from `JINA_API_KEY` | token-based; add its price via `pricing` to see it in `stats` |
| `'llm'` | Your chat model ranks the candidates in one call | one LLM call per query |
| your own | Any `{ name, model, rerank({ query, documents, topN }) }` returning `{ results: [{ index, score }] }` | |

Use `createCohereReranker({ apiKey, model })`, `createJinaReranker(...)` or `createLLMReranker({ maxChars })` for custom settings. Reranking adds a call and some latency, so like the query techniques it has to beat plain search by 5 points before the eval recommends it.

```js
const { hyde, cot, stepback, fanout, rrf, ragPipeline } = require('ragforge');

await hyde(query);                       // string
await cot(query);                        // { reasoning, refinedQuery }
await stepback(query);                   // { abstractQuery, originalQuery, reasoning }
await fanout(query);                     // string (synthesized from all sub-questions)
rrf([listA, listB, listC]);              // merged ranking
await ragPipeline(query, { techniques: ['hyde', 'stepback'], topK: 5 });
```

Every technique accepts LLM options as its second argument: `{ model, temperature, max_tokens, ... }`.

## Providers

```js
createRagforge({ llm: 'openai' });                         // default: gpt-4o-mini + text-embedding-ada-002
createRagforge({ llm: 'ollama' });                         // llama3.1 + nomic-embed-text on localhost:11434
createRagforge({ llm: 'ollama', embeddings: 'openai' });   // mix and match
```

<details>
<summary><b>Custom models, endpoints and providers</b></summary>

```js
const { createOpenAIProvider, createOllamaProvider } = require('ragforge');

// Azure OpenAI, LM Studio, proxies: anything OpenAI-compatible
createRagforge({ llm: createOpenAIProvider({ baseURL: 'https://my-proxy/v1', apiKey, chatModel: 'gpt-4o' }) });

// A remote Ollama box
createRagforge({ llm: createOllamaProvider({ baseURL: 'http://gpu-box:11434', chatModel: 'qwen2.5' }) });

// Anything else (Anthropic, Gemini, your own API): implement chat and embed
const myProvider = {
  name: 'my-llm',
  chatModel: 'my-model',
  embeddingModel: 'my-embedder',
  async chat({ prompt, model, temperature, maxTokens }) {
    return { text: '...', usage: { inputTokens: 0, outputTokens: 0 } };
  },
  async embed({ text, model }) {
    return { vector: [/* ... */], usage: { inputTokens: 0 } };
  },
};
createRagforge({ llm: myProvider, pricing: { 'my-model': { input: 1, output: 3 } } });
```

The embedding model must match the one your vector store was built with. The OpenAI default stays `text-embedding-ada-002` so existing 1536-dimension collections keep working.

</details>

## Vector stores

ragforge works with any database. Give it an object with a `query(vector, topK)` method that returns results with a `content` field:

```js
const { QdrantClient } = require('@qdrant/js-client-rest');
const qdrant = new QdrantClient({ url: 'http://localhost:6333' });

const rf = createRagforge({
  vectorStore: {
    async query(vector, topK) {
      const hits = await qdrant.search('docs', { vector, limit: topK, with_payload: true });
      return hits.map((h) => ({ id: h.id, content: h.payload.content, score: h.score }));
    },
  },
});
```

<details>
<summary><b>Pinecone, Weaviate, pgvector</b></summary>

```js
// Pinecone
async query(vector, topK) {
  const res = await index.query({ vector, topK, includeMetadata: true });
  return res.matches.map((m) => ({ id: m.id, content: m.metadata.content, score: m.score }));
}

// Weaviate
async query(vector, topK) {
  const res = await client.graphql.get().withClassName('Doc')
    .withNearVector({ vector }).withLimit(topK)
    .withFields('content _additional { id distance }').do();
  return res.data.Get.Doc.map((d) => ({ id: d._additional.id, content: d.content, score: 1 - d._additional.distance }));
}

// pgvector (node-postgres)
async query(vector, topK) {
  const { rows } = await pool.query(
    'SELECT id, content, 1 - (embedding <=> $1) AS score FROM docs ORDER BY embedding <=> $1 LIMIT $2',
    [JSON.stringify(vector), topK]
  );
  return rows;
}
```

</details>

<details>
<summary><b>Hybrid search with your own store</b></summary>

Add `searchText(text, topK)` and return the same shape as `query`. Use your database's full-text search, or ragforge's BM25 index if your corpus fits in memory:

```js
// Postgres full-text search next to pgvector
async searchText(text, topK) {
  const { rows } = await pool.query(
    `SELECT id, content, ts_rank(tsv, q) AS score FROM docs, plainto_tsquery('english', $1) q
     WHERE tsv @@ q ORDER BY score DESC LIMIT $2`,
    [text, topK]
  );
  return rows;
}

// Or ragforge's in-memory BM25 index
const { createBM25Index } = require('ragforge');
const bm25 = createBM25Index();
bm25.add(chunks); // [{ id, content }]
const store = { query: myVectorQuery, searchText: async (text, topK) => bm25.search(text, topK) };
```

Return the same `id` from both methods, so results found by both searches merge into one.

</details>

Without a vector store, techniques still work: HyDE returns its hypothetical document, and the pipeline answers from the technique outputs. No embedding calls are made.

## Cost, caching and logging

```js
const rf = createRagforge({
  cache: true,   // in-memory LRU (1000 entries), or any { get, set } such as Redis
  debug: true,   // log progress; silent by default. Or pass logger: { info, error }
});

const { stats } = await rf.ragPipeline('What is overfitting?');
// Default techniques (hyde, cot, fanout) + the final answer, no vector store:
// { llmCalls: 5, embeddingCalls: 0, cacheHits: 0, inputTokens: 2214,
//   outputTokens: 1630, costUSD: 0.00131, latencyMs: 2870 }

await rf.hyde('...', { onStats: (s) => metrics.record(s) }); // techniques, pipeline and auto accept onStats
```

Costs use a built-in price table for common OpenAI models (`DEFAULT_PRICING`, USD per 1M tokens). For a model not in the table, `costUSD` is `null`; add it with `createRagforge({ pricing })`. Ollama calls cost `0`.

## API reference

<details>
<summary><b><code>createRagforge(options)</code></b></summary>

| Option | Type | Default |
|---|---|---|
| `llm` | `'openai'` \| `'ollama'` \| provider | `'openai'` |
| `embeddings` | `'openai'` \| `'ollama'` \| provider | same as `llm` |
| `vectorStore` | `{ query(vector, topK), searchText?(text, topK) }` | none |
| `hybrid` | `boolean`, default for `ragPipeline` and `auto` | `false` |
| `reranker` | `'llm'` \| `'cohere'` \| `'jina'` \| reranker | none |
| `rerank` | `boolean`, default for `ragPipeline` and `auto` | `false` |
| `cache` | `boolean` \| `{ get, set }` | `false` |
| `pricing` | `{ [model]: { input, output } }` | `DEFAULT_PRICING` |
| `defaults` | LLM options | `{ temperature: 0.7, maxTokens: 500 }` |
| `debug` | `boolean` | `false` |
| `logger` | `{ info, error }` | silent |

</details>

<details>
<summary><b>Instance methods</b></summary>

| Method | Returns |
|---|---|
| `evaluate(options)` | Scoreboard, recommendation and per-question results |
| `auto(query, options)` | Pipeline result plus `route` |
| `route(query, options)` | `{ technique, category, classifier, decidedBy, reason }` |
| `ragPipeline(query, options)` | `{ query, translation, retrieved, answer, stats }` |
| `translate(query, options)` | Technique outputs and retrieval sub-queries |
| `hyde` / `cot` / `stepback` / `fanout` `(query, options)` | See [Techniques](#techniques) |
| `callLLM(prompt, options)` | `string` |
| `getEmbedding(text, { model })` | `number[]` |
| `rrf(lists, k = 60)` | Merged ranking |
| `setVectorStore(store)` | |

**Pipeline options:** `techniques`, `topK` (5), `rerankK` (20), `hybrid` (false), `rerank` (false), `techniqueOptions`, `finalModelOptions`, `onStats`.
**Route options:** `router` (`'rules'` \| `'llm'`), `from`, `techniques`, `rules`, `routerOptions`, `minSamples` (3), `minImprovement` (0.05).
**Evaluate options:** `documents`, `questions`, `numQuestions` (10), `questionStyles`, `techniques`, `topK` (5), `rerankCandidates` (20), `chunkSize` (800), `concurrency` (4), `minImprovement` (0.05), `llmOptions`, `onProgress`.

</details>

<details>
<summary><b>Other exports</b></summary>

`createOpenAIProvider`, `createOllamaProvider`, `createMemoryCache`, `createLLMReranker`, `createCohereReranker`, `createJinaReranker`, `createMemoryVectorStore`, `createBM25Index`, `chunkText`, `classifyQuery`, `formatTable`, `renderHtmlReport`, `DEFAULT_PRICING`, `DEFAULT_RULES`.

The top-level `hyde`, `cot`, `stepback`, `fanout`, `ragPipeline`, `auto`, `callLLM`, `getEmbedding`, `setVectorClient` and `setOpenAIClient` use a default OpenAI instance, as in 1.x.

</details>

Full TypeScript definitions ship with the package.

## Upgrading from 1.x

Most code works unchanged. The differences:

- The default chat model is **`gpt-4o-mini`** instead of `gpt-4` (about 200× cheaper). Pass `{ model: 'gpt-4' }` to keep the old one. Embeddings are unchanged.
- Logging is **off by default**. Use `createRagforge({ debug: true })`.
- An unknown technique name (e.g. `'hide'`) now **throws** instead of being ignored.
- Deep imports such as `ragforge/src/core/openaiClient` are gone. Import from `ragforge`.

See the [changelog](./CHANGELOG.md) for everything else.

## FAQ

<details>
<summary><b>Do I need a vector database?</b></summary>

No. The eval indexes documents in memory, and the techniques work without one. For production retrieval you'll want one; any database works through `vectorStore`.
</details>

<details>
<summary><b>How is this different from LangChain or LlamaIndex?</b></summary>

They're full frameworks. ragforge does one thing: it tells you which query technique helps on your data and applies it per query. It has two runtime dependencies and works alongside whatever you already use. Point the eval at your existing store with `setVectorStore`.
</details>

<details>
<summary><b>Is the eval reliable?</b></summary>

It measures whether each technique retrieves the chunk a question was written from. That's a good proxy for retrieval quality but not a full answer-quality benchmark. Use 20+ questions for stable numbers, and add your own real user questions with `--questions-file`.
</details>

<details>
<summary><b>What does it cost?</b></summary>

ragforge is free. With the default `gpt-4o-mini`, a full pipeline query typically costs a fraction of a cent. Every result reports the exact `costUSD`. With Ollama it's free.
</details>

## Contributing

```bash
git clone https://github.com/Kamraanmulani/ragforge.git
cd ragforge && npm install
npm test                    # unit tests, no API key needed
npm run typecheck           # TypeScript definitions
npm run test:integration    # real OpenAI + local Qdrant
```

Issues and pull requests are welcome on [GitHub](https://github.com/Kamraanmulani/ragforge/issues).

## License

[MIT](./LICENSE) © Kamraan Mulani

<div align="center">
<br>
<sub>If ragforge saved you a guess, a ⭐ on <a href="https://github.com/Kamraanmulani/ragforge">GitHub</a> helps others find it.</sub>
</div>
