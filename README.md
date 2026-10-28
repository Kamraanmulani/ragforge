<div align="center">

# 🚀 ragforge

### Advanced RAG Techniques Made Simple

**A lightweight, developer-friendly toolkit that brings cutting-edge query translation techniques to your Retrieval-Augmented Generation (RAG) pipeline with minimal code.**

[![npm version](https://img.shields.io/npm/v/ragforge?color=blue&logo=npm)](https://www.npmjs.com/package/ragforge)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/node/v/ragforge)](https://nodejs.org)
[![GitHub Stars](https://img.shields.io/github/stars/Kamraanmulani/ragforge?style=social)](https://github.com/Kamraanmulani/ragforge)

[Features](#-features) • [Installation](#-installation) • [Quick Start](#-quick-start) • [Documentation](#-documentation) • [Examples](#-examples)

---

</div>

## 🎯 What is ragforge?

**ragforge** is a lightweight npm package that simplifies the implementation of advanced RAG query translation techniques. Stop writing complex prompts from scratch—use production-ready implementations of:

- 🔮 **HyDE** (Hypothetical Document Embeddings)
- 🧠 **Chain of Thought** (CoT)
- 🔙 **Step-Back Prompting**
- 🔄 **Reciprocal Rank Fusion** (RRF)
- 🌟 **Fan-Out Retrieval**

### The Problem

Building RAG systems with advanced techniques is **hard**:

- ❌ **Complex Implementation**: Each technique requires specialized prompt engineering and orchestration
- ❌ **Time-Consuming**: Hours spent coding, debugging, and testing each method
- ❌ **Vendor Lock-In**: Tight coupling with specific vector databases or LLM providers
- ❌ **Inconsistent Results**: No standardized way to compare techniques

### The Solution

✅ **Simple API**: Integrate advanced techniques in just a few lines  
✅ **Database Agnostic**: Works with Qdrant, Pinecone, Weaviate, or any vector database  
✅ **LLM Agnostic**: Compatible with OpenAI, Anthropic, Gemini, or custom models  
✅ **Production-Ready**: Battle-tested implementations with comprehensive examples  
✅ **Lightweight**: Minimal dependencies, maximum flexibility

---

## 📖 Table of Contents

- [Features](#-features)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Instances, Providers, Cost & Caching](#%EF%B8%8F-instances-providers-cost--caching)
- [Core Concepts](#-core-concepts)
- [Available Techniques](#-available-techniques)
- [API Reference](#-api-reference)
- [Complete Examples](#-complete-examples)
- [Configuration](#-configuration)
- [Testing](#-testing)
- [FAQ](#-faq)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔮 **HyDE** | Hypothetical Document Embeddings - Generate hypothetical answers for better retrieval |
| 🧠 **Chain of Thought** | Step-by-step reasoning to refine complex queries |
| 🔙 **Step-Back Prompting** | Abstract queries to broader concepts for deeper understanding |
| 🔄 **RRF** | Reciprocal Rank Fusion - Merge multiple search strategies intelligently |
| 🌟 **Fan-Out** | Generate multiple query variations for comprehensive coverage |
| � **RAG Pipeline** | Complete end-to-end RAG workflow with technique orchestration |
| 🔌 **Database Agnostic** | Works with any vector database (Qdrant, Pinecone, Weaviate, etc.) |
| 🤖 **LLM Agnostic** | OpenAI and Ollama (local, free) built in, or plug in any provider |
| 💰 **Cost Tracking** | Every pipeline call reports LLM calls, tokens, USD cost and latency |
| ⚡ **Fast & Cached** | Techniques run in parallel; optional cache makes repeat calls free |
| 📦 **Minimal Setup** | Works out of the box with sensible defaults |
| 🟦 **TypeScript Types** | Full type definitions included |
| 🧪 **Well Tested** | Unit tests run without network calls; integration tests against real APIs |

---

## 📦 Installation

```bash
npm install ragforge
```

**Requirements:**
- Node.js 18 or higher
- An OpenAI API key, or a local [Ollama](https://ollama.com) server
- Vector database (optional but recommended)

---

## 🚀 Quick Start

### Step 1: Set Up Environment

Create a `.env` file in your project root:

```env
OPENAI_API_KEY=your_openai_api_key_here
```

ragforge loads `.env` from the directory you start your app in (`process.cwd()`). A variable already set in your environment is used as-is. If the key is missing, the first LLM or embedding call throws an error; requiring ragforge never exits your process.

### Step 2: Basic Usage (Without Vector Database)

```javascript
const { hyde, cot, stepback } = require('ragforge');

// Use HyDE for better query understanding
const answer = await hyde("What are the benefits of machine learning?");
console.log(answer);

// Use Chain of Thought for complex reasoning
const result = await cot("How does climate change affect ocean currents?");
console.log(result.reasoning);

// Use Step-Back for broader context
const abstract = await stepback("What is the capital of France?");
console.log(abstract.abstractQuery); // "What are European capitals and their significance?"
```

### Step 3: Advanced Usage (With Vector Database)

```javascript
const { hyde, setVectorClient } = require('ragforge');
const { QdrantClient } = require('@qdrant/js-client-rest');
const { getEmbedding } = require('ragforge');

// Initialize your vector database
const qdrant = new QdrantClient({ url: 'http://localhost:6333' });

// Configure ragforge to use your database
setVectorClient({
  query: async (vector, topK) => {
    const results = await qdrant.search('your_collection_name', {
      vector,
      limit: topK,
      with_payload: true
    });
    
    return results.map(r => ({
      content: r.payload.content,
      score: r.score,
      metadata: r.payload
    }));
  }
});

// Now HyDE will use your vector database for retrieval
const answer = await hyde("Explain neural networks");
console.log(answer);
```

### Step 4: Complete RAG Pipeline

```javascript
const { ragPipeline, setVectorClient } = require('ragforge');

// After setting up vector client (see Step 3)...

const result = await ragPipeline("What are the advantages of deep learning?", {
  techniques: ["hyde", "fanout"],
  topK: 5
});

console.log('Answer:', result.answer);
console.log('Retrieved docs:', result.retrieved);
console.log('Translation:', result.translation);
```

---

## ⚙️ Instances, Providers, Cost & Caching

The top-level functions above use a default OpenAI instance. For anything else, create your own instance with `createRagforge`:

```javascript
const { createRagforge } = require('ragforge');

const rf = createRagforge({
  llm: 'openai',            // 'openai' (default), 'ollama', or your own provider object
  vectorStore: {            // optional, same shape as setVectorClient
    query: async (vector, topK) => [/* { content, score } */]
  },
  cache: true,              // optional in-memory cache, or any { get, set } (e.g. Redis)
  defaults: { model: 'gpt-4o-mini', temperature: 0.3 },
  debug: true               // log progress (silent by default)
});

const result = await rf.ragPipeline('What is overfitting?', { techniques: ['hyde', 'stepback'] });

console.log(result.answer);
console.log(result.stats);
// { llmCalls: 4, embeddingCalls: 3, cacheHits: 0, inputTokens: 2310,
//   outputTokens: 640, costUSD: 0.000731, latencyMs: 2140 }
```

Every instance method (`hyde`, `cot`, `stepback`, `fanout`, `translate`, `ragPipeline`, `callLLM`, `getEmbedding`) works like the top-level version. Each accepts an `onStats` callback to get the same usage stats:

```javascript
await rf.hyde('Explain transformers', { onStats: (s) => console.log(s.costUSD) });
```

### Run locally and free with Ollama

```javascript
const rf = createRagforge({ llm: 'ollama' }); // http://localhost:11434, llama3.1 + nomic-embed-text

// Or choose models / server
const { createOllamaProvider } = require('ragforge');
const rf2 = createRagforge({
  llm: createOllamaProvider({ chatModel: 'qwen2.5', embeddingModel: 'nomic-embed-text', baseURL: 'http://gpu-box:11434' })
});
```

Ollama calls report `costUSD: 0`. You can also mix providers, e.g. Ollama for chat and OpenAI for embeddings: `createRagforge({ llm: 'ollama', embeddings: 'openai' })`. Your vector store must have been built with the same embedding model you query with.

### Bring your own provider

Any object with `chat` and `embed` works:

```javascript
const myProvider = {
  name: 'my-llm',
  chatModel: 'my-model',
  embeddingModel: 'my-embedder',
  async chat({ prompt, model, temperature, maxTokens }) {
    // call your API
    return { text: '...', usage: { inputTokens: 10, outputTokens: 20 } };
  },
  async embed({ text, model }) {
    return { vector: [/* numbers */], usage: { inputTokens: 5 } };
  }
};

const rf = createRagforge({ llm: myProvider, pricing: { 'my-model': { input: 1, output: 3 } } });
```

### Cost tracking

`costUSD` uses a built-in price table (USD per 1M tokens, exported as `DEFAULT_PRICING`) covering common OpenAI models. Dated snapshots like `gpt-4o-mini-2024-07-18` match their base model. If a model isn't in the table, `costUSD` is `null`; add it with the `pricing` option. Prices change, so check your provider's pricing page.

### Caching

`cache: true` keeps up to 1000 LLM and embedding responses in memory (least recently used are evicted). Identical prompts with identical options are served from the cache and count as `cacheHits` with no cost. Pass your own `{ get(key), set(key, value) }` object to use Redis or another store.

---

## 🧩 Core Concepts

### 1. Query Translation

Traditional RAG directly embeds user queries, which can miss relevant documents. **ragforge** translates queries into forms that match your knowledge base better:

```javascript
// Direct embedding (traditional)
"What is ML?" → [0.23, 0.45, ...] → Search

// Query translation (ragforge)
"What is ML?" → "Machine learning is a subset of AI..." → [0.28, 0.52, ...] → Better Search
```

### 2. Vector Client Abstraction

ragforge doesn't force you to use a specific database. You provide a simple adapter:

```javascript
setVectorClient({
  query: async (vector, topK) => {
    // Your custom logic here
    // Return: [{ content, score, metadata }]
  }
});
```

### 3. Technique Composition

Combine multiple techniques for optimal results:

```javascript
// Use multiple strategies
const result = await ragPipeline(query, {
  techniques: ["hyde", "cot", "fanout"],
  topK: 5
});
```

---

## 🎯 Available Techniques

### 🔮 HyDE (Hypothetical Document Embeddings)

**What it does:** Generates a hypothetical answer to your query, then uses that answer for semantic search instead of the original query.

**Why it works:** Answers are semantically closer to documents in your knowledge base than questions are.

```javascript
const { hyde } = require('ragforge');

const answer = await hyde("What are neural networks?");
console.log(answer);
```

**How it works:**
1. ✍️ Generates hypothetical answer: *"Neural networks are computational models inspired by..."*
2. 🔢 Creates embedding from this answer
3. 🔍 Searches vector database
4. 📝 Synthesizes final answer from retrieved docs

**When to use:**
- ✅ Domain-specific questions
- ✅ Complex technical queries
- ✅ When query-document semantic gap is large
- ❌ Simple factual lookups

---

### 🧠 Chain of Thought (CoT)

**What it does:** Breaks down complex queries into step-by-step reasoning before retrieval.

**Why it works:** Step-by-step thinking helps identify what information is actually needed.

```javascript
const { cot } = require('ragforge');

const result = await cot("How does photosynthesis affect climate?");

console.log('Reasoning:', result.reasoning);
console.log('Refined Query:', result.refinedQuery);
```

**Output:**
```javascript
{
  reasoning: "Step 1: Understand photosynthesis process...\nStep 2: Consider climate factors...",
  refinedQuery: "relationship between photosynthesis carbon dioxide climate regulation"
}
```

**When to use:**
- ✅ Multi-step reasoning problems
- ✅ Causal relationship questions
- ✅ Complex analytical queries
- ❌ Simple definition lookups

---

### 🔙 Step-Back Prompting

**What it does:** Reformulates specific questions into broader, principle-based queries.

**Why it works:** Abstract concepts often provide better foundation for answering specific questions.

```javascript
const { stepback } = require('ragforge');

const result = await stepback("What is the capital of France?");

console.log('Original:', result.originalQuery);
console.log('Abstract:', result.abstractQuery);
console.log('Reasoning:', result.reasoning);
```

**Output:**
```javascript
{
  originalQuery: "What is the capital of France?",
  abstractQuery: "What are the concepts of national capitals and their significance?",
  reasoning: "Understanding capital cities helps answer specific capital questions."
}
```

**When to use:**
- ✅ Questions benefiting from conceptual context
- ✅ Educational queries
- ✅ When you want comprehensive understanding
- ❌ Time-sensitive or very specific queries

---

### 🔄 Reciprocal Rank Fusion (RRF)

**What it does:** Intelligently merges results from multiple retrieval strategies.

**Why it works:** Different search methods find different relevant documents. RRF combines their strengths.

```javascript
const { rrf } = require('ragforge');

// Define multiple search strategies
const searchResults = rrf([
  ['doc1', 'doc2', 'doc3'],  // Results from keyword search
  ['doc2', 'doc4', 'doc1'],  // Results from vector search
  ['doc3', 'doc1', 'doc5']   // Results from hybrid search
], 60); // k constant (default: 60)

console.log(searchResults);
// ['doc1', 'doc2', 'doc3', 'doc4', 'doc5'] - intelligently ranked
```

**How scoring works:**
```
score(doc) = Σ(1 / (k + rank))

Where:
- k = constant (default 60)
- rank = position in each list (0-indexed)
```

**When to use:**
- ✅ Combining keyword + vector search
- ✅ Using multiple embedding models
- ✅ Merging different retrieval strategies
- ✅ Improving recall and precision

---

### 🌟 Fan-Out Retrieval

**What it does:** Generates multiple query variations and retrieves documents for each, then synthesizes a comprehensive answer.

**Why it works:** Different phrasings retrieve different relevant documents, giving broader coverage.

```javascript
const { fanout } = require('ragforge');

const answer = await fanout("What is artificial intelligence?");
console.log(answer);
```

**How it works:**
1. 📝 Original: *"What is artificial intelligence?"*
2. 🌿 Expands to:
   - *"Define artificial intelligence"*
   - *"Explain AI technology and applications"*
   - *"What are the fundamentals of AI?"*
3. 🔍 Retrieves docs for each variation
4. 🎯 Synthesizes comprehensive answer

**When to use:**
- ✅ Broad research questions
- ✅ Ambiguous queries
- ✅ Comprehensive topic exploration
- ❌ Narrow, specific questions (creates noise)

---

### 🔧 RAG Pipeline (Complete Workflow)

**What it does:** Orchestrates multiple techniques in a complete end-to-end RAG workflow.

**Why it works:** Combines the strengths of multiple techniques for optimal retrieval and generation.

```javascript
const { ragPipeline, setVectorClient } = require('ragforge');

// After setting up your vector client...

const result = await ragPipeline(
  "What are the latest advances in machine learning?",
  {
    techniques: ["hyde", "fanout"],  // Techniques to use
    topK: 5,                          // Top results to return
    rerankK: 20,                      // Results to consider for reranking
    finalModelOptions: {              // LLM options for final answer
      temperature: 0.3,
      max_tokens: 500
    }
  }
);

console.log('Final Answer:', result.answer);
console.log('Retrieved Documents:', result.retrieved);
console.log('Query Translation:', result.translation);
```

**Output structure:**
```javascript
{
  query: "original user query",
  translation: {
    hyde: "hypothetical document",
    fanout: "combined fanout result",
    cot: { reasoning: "...", refinedQuery: "..." },
    subQueries: ["query1", "query2", ...]
  },
  retrieved: ["doc1", "doc2", ...],
  answer: "synthesized final answer",
  stats: { llmCalls, embeddingCalls, cacheHits, inputTokens, outputTokens, costUSD, latencyMs }
}
```

**Pipeline flow:**
1. 🔄 Query Translation (applies selected techniques)
2. 🔍 Multi-Query Retrieval (searches for each translated query)
3. 🎯 RRF Merging (combines results intelligently)
4. ✨ Answer Synthesis (generates final response)

---

## 📚 API Reference

### Core Functions

#### `setVectorClient(client)`

Configure your vector database adapter. This must be called before using retrieval-based techniques.

```javascript
setVectorClient({
  query: async (vector, topK) => {
    // Implement your database query logic
    // vector: Array of numbers (embedding)
    // topK: Number of results to return
    
    // Must return: Array of { content, score, metadata }
    return results;
  }
});
```

**Parameters:**
- `client.query` (Function): Async function that queries your vector database
  - `vector` (Array<number>): Embedding vector to search with
  - `topK` (number): Number of results to return
  - Returns: `Promise<Array<{content: string, score: number, metadata: object}>>`

**Example with different databases:**

<details>
<summary>Qdrant</summary>

```javascript
const { QdrantClient } = require('@qdrant/js-client-rest');
const qdrant = new QdrantClient({ url: 'http://localhost:6333' });

setVectorClient({
  query: async (vector, topK) => {
    const results = await qdrant.search('collection_name', {
      vector,
      limit: topK,
      with_payload: true
    });
    return results.map(r => ({
      content: r.payload.content,
      score: r.score,
      metadata: r.payload
    }));
  }
});
```
</details>

<details>
<summary>Pinecone</summary>

```javascript
const { PineconeClient } = require('@pinecone-database/pinecone');
const pinecone = new PineconeClient();
await pinecone.init({ apiKey: 'your-api-key' });
const index = pinecone.Index('your-index');

setVectorClient({
  query: async (vector, topK) => {
    const results = await index.query({
      vector,
      topK,
      includeMetadata: true
    });
    return results.matches.map(m => ({
      content: m.metadata.content,
      score: m.score,
      metadata: m.metadata
    }));
  }
});
```
</details>

<details>
<summary>Weaviate</summary>

```javascript
const weaviate = require('weaviate-client');
const client = weaviate.client({ scheme: 'http', host: 'localhost:8080' });

setVectorClient({
  query: async (vector, topK) => {
    const results = await client.graphql
      .get()
      .withClassName('YourClass')
      .withNearVector({ vector })
      .withLimit(topK)
      .withFields('content _additional { distance }')
      .do();
      
    return results.data.Get.YourClass.map(r => ({
      content: r.content,
      score: 1 - r._additional.distance,
      metadata: r
    }));
  }
});
```
</details>

---

#### `hyde(query, options)`

Hypothetical Document Embeddings technique.

```javascript
const answer = await hyde(query, options);
```

**Parameters:**
- `query` (string): User's question or query
- `options` (object, optional): LLM configuration
  - `model` (string): LLM model to use (default: "gpt-4o-mini")
  - `temperature` (number): Randomness (0-1, default: 0.7)
  - `max_tokens` (number): Maximum response length (default: 500)

**Returns:** `Promise<string>` - Final answer

When a vector client is set, the final answer call defaults to `temperature: 0.3` and `max_tokens: 300`; any options you pass override those.

**Example:**
```javascript
const answer = await hyde("What is quantum computing?", {
  model: "gpt-3.5-turbo",
  temperature: 0.5,
  max_tokens: 300
});
```

---

#### `cot(query, options)`

Chain of Thought reasoning technique.

```javascript
const result = await cot(query, options);
```

**Parameters:**
- `query` (string): User's question
- `options` (object, optional): LLM configuration options

**Returns:** `Promise<{reasoning: string, refinedQuery: string}>`
- `reasoning`: Step-by-step thought process
- `refinedQuery`: Cleaned and refined query

**Example:**
```javascript
const result = await cot("How does machine learning work?");
console.log('Reasoning:', result.reasoning);
console.log('Refined:', result.refinedQuery);
```

---

#### `stepback(query, options)`

Step-Back Prompting technique.

```javascript
const result = await stepback(query, options);
```

**Parameters:**
- `query` (string): Specific user question
- `options` (object, optional): LLM configuration

**Returns:** `Promise<{abstractQuery: string, originalQuery: string, reasoning: string}>`
- `abstractQuery`: Broader, principle-based version
- `originalQuery`: Original specific query
- `reasoning`: Explanation of the abstraction

**Example:**
```javascript
const result = await stepback("What is Python's GIL?");
// abstractQuery: "What are concurrency mechanisms in programming languages?"
// reasoning: "Understanding general concurrency helps explain GIL specifically"
```

---

#### `rrf(rankedLists, k)`

Reciprocal Rank Fusion for merging search results.

```javascript
const merged = rrf(rankedLists, k);
```

**Parameters:**
- `rankedLists` (Array<Array<any>>): Array of ranked result lists
- `k` (number, optional): RRF constant for score calculation (default: 60)

**Returns:** `Array<any>` - Merged and ranked results

**Example:**
```javascript
const keywordResults = ['doc1', 'doc2', 'doc3'];
const vectorResults = ['doc2', 'doc4', 'doc1'];
const hybridResults = ['doc3', 'doc1', 'doc5'];

const merged = rrf([keywordResults, vectorResults, hybridResults], 60);
console.log(merged); // ['doc1', 'doc2', 'doc3', 'doc4', 'doc5']
```

---

#### `fanout(query, options)`

Fan-Out multi-query retrieval technique.

```javascript
const answer = await fanout(query, options);
```

**Parameters:**
- `query` (string): User's question
- `options` (object, optional): Configuration options
  - All standard LLM options
  - Number of variations is fixed at 3

**Returns:** `Promise<string>` - Synthesized answer from all query variations

**Example:**
```javascript
const answer = await fanout("What is deep learning?");
// Internally generates 3 variations, retrieves for each, and synthesizes
```

---

#### `ragPipeline(query, options)`

Complete end-to-end RAG pipeline with technique orchestration.

```javascript
const result = await ragPipeline(query, options);
```

**Parameters:**
- `query` (string): User's question
- `options` (object, optional):
  - `techniques` (Array<string>): Techniques to use (default: `["hyde", "cot", "fanout"]`)
    - Available: `"hyde"`, `"cot"`, `"fanout"`, `"stepback"`
  - `topK` (number): Top results to return (default: 5)
  - `rerankK` (number): Results to consider for reranking (default: 20)
  - `techniqueOptions` (object): LLM options passed to every technique (hyde, cot, stepback, fanout)
  - `finalModelOptions` (object): LLM options for final synthesis
    - `model`, `temperature`, `max_tokens`, etc.

If a vector client is set, each translated sub-query is embedded with `getEmbedding` and passed to your client's `query(vector, topK)`, the same contract `hyde` and `fanout` use. Without a vector client, no retrieval or embedding calls are made and the answer is built from the technique outputs.

**Returns:** `Promise<{query: string, translation: object, retrieved: Array, answer: string}>`

**Example:**
```javascript
const result = await ragPipeline(
  "Explain transformer architecture",
  {
    techniques: ["hyde", "fanout"],
    topK: 5,
    rerankK: 15,
    finalModelOptions: {
      model: "gpt-4",
      temperature: 0.3,
      max_tokens: 600
    }
  }
);

console.log('Answer:', result.answer);
console.log('Sources:', result.retrieved);
console.log('Translation:', result.translation);
```

---

### Utility Functions

#### `getEmbedding(text)`

Generate embeddings using OpenAI's API.

```javascript
const { getEmbedding } = require('ragforge');

const vector = await getEmbedding("Your text here");
console.log(vector.length); // 1536 (for text-embedding-ada-002)
```

#### `callLLM(prompt, options)`

Call the LLM with custom prompts.

```javascript
const { callLLM } = require('ragforge');

const response = await callLLM("Explain quantum physics", {
  model: "gpt-4",
  temperature: 0.7,
  max_tokens: 300
});
```

---

## 💡 Complete Examples

### Example 1: Basic HyDE Usage (No Database)

Perfect for getting started without setting up a vector database.

```javascript
const { hyde } = require('ragforge');

(async () => {
  const answer = await hyde("What are the benefits of exercise?");
  console.log(answer);
})();
```

**Output:**
```
[HyDE] Step 1: Generating hypothetical document...
[HyDE] Generated: Regular exercise provides numerous health benefits...
[HyDE] Step 2: Creating embedding...
[HyDE] Embedding created (1536 dimensions)
[HyDE] Step 3: Searching vector DB...
[HyDE] No DB results, returning hypothetical document
[HyDE] Complete!

Regular exercise provides numerous health benefits including improved cardiovascular health, weight management, enhanced mental well-being, stronger bones and muscles, and reduced risk of chronic diseases...
```

---

### Example 2: HyDE with Qdrant Vector Database

Complete setup with a real vector database for production use.

```javascript
const { hyde, setVectorClient } = require('ragforge');
const { QdrantClient } = require('@qdrant/js-client-rest');
const { getEmbedding } = require('ragforge');

// 1. Initialize Qdrant client
const qdrant = new QdrantClient({ url: 'http://localhost:6333' });
const COLLECTION_NAME = 'my_knowledge_base';

// 2. Configure ragforge to use Qdrant
setVectorClient({
  query: async (vector, topK) => {
    const results = await qdrant.search(COLLECTION_NAME, {
      vector,
      limit: topK,
      with_payload: true
    });
    
    return results.map(r => ({
      content: r.payload.content,
      score: r.score,
      metadata: r.payload
    }));
  }
});

// 3. Use HyDE with database-backed retrieval
(async () => {
  const answer = await hyde("What is machine learning?");
  console.log('Answer:', answer);
})();
```

---

### Example 3: Comparing Techniques

Compare different RAG techniques side-by-side.

```javascript
const { hyde, cot, stepback, fanout } = require('ragforge');

async function compareTechniques(query) {
  console.log('Query:', query);
  console.log('='.repeat(80));
  
  // HyDE
  console.log('\n🔮 HyDE Technique:');
  const hydeAnswer = await hyde(query);
  console.log(hydeAnswer);
  
  // Chain of Thought
  console.log('\n🧠 Chain of Thought:');
  const cotResult = await cot(query);
  console.log('Reasoning:', cotResult.reasoning);
  
  // Step-Back
  console.log('\n🔙 Step-Back Prompting:');
  const stepbackResult = await stepback(query);
  console.log('Abstract Query:', stepbackResult.abstractQuery);
  console.log('Reasoning:', stepbackResult.reasoning);
  
  // Fan-Out
  console.log('\n🌟 Fan-Out Retrieval:');
  const fanoutAnswer = await fanout(query);
  console.log(fanoutAnswer);
}

compareTechniques("How does photosynthesis work?");
```

---

### Example 4: Full RAG Pipeline

Production-ready pipeline with multiple techniques.

```javascript
const { ragPipeline, setVectorClient } = require('ragforge');
const { QdrantClient } = require('@qdrant/js-client-rest');

// Setup (same as Example 2)
const qdrant = new QdrantClient({ url: 'http://localhost:6333' });
setVectorClient({
  query: async (vector, topK) => {
    const results = await qdrant.search('ml_knowledge', {
      vector,
      limit: topK,
      with_payload: true
    });
    return results.map(r => ({
      content: r.payload.content,
      score: r.score,
      metadata: r.payload
    }));
  }
});

// Run complete pipeline
(async () => {
  const result = await ragPipeline(
    "What are the main types of neural networks?",
    {
      techniques: ["hyde", "fanout"],
      topK: 5,
      rerankK: 15,
      finalModelOptions: {
        model: "gpt-4",
        temperature: 0.3,
        max_tokens: 500
      }
    }
  );
  
  console.log('📄 Final Answer:');
  console.log('='.repeat(80));
  console.log(result.answer);
  
  console.log('\n📚 Retrieved Documents:');
  console.log('='.repeat(80));
  result.retrieved.forEach((doc, i) => {
    console.log(`\n[${i + 1}] ${doc.substring(0, 150)}...`);
  });
  
  console.log('\n🔄 Query Translation:');
  console.log('='.repeat(80));
  console.log(JSON.stringify(result.translation, null, 2));
})();
```

---

### Example 5: Reciprocal Rank Fusion

Merge results from multiple search strategies.

```javascript
const { rrf, setVectorClient } = require('ragforge');
const { QdrantClient } = require('@qdrant/js-client-rest');
const { getEmbedding } = require('ragforge');

const qdrant = new QdrantClient({ url: 'http://localhost:6333' });

async function hybridSearch(query) {
  // Strategy 1: Search with original query
  const vector1 = await getEmbedding(query);
  const results1 = await qdrant.search('collection', {
    vector: vector1,
    limit: 10
  });
  
  // Strategy 2: Search with expanded query
  const expandedQuery = query + " explanation tutorial guide";
  const vector2 = await getEmbedding(expandedQuery);
  const results2 = await qdrant.search('collection', {
    vector: vector2,
    limit: 10
  });
  
  // Strategy 3: Search with keywords
  const vector3 = await getEmbedding(query.split(' ').join(' '));
  const results3 = await qdrant.search('collection', {
    vector: vector3,
    limit: 10
  });
  
  // Extract IDs for RRF
  const list1 = results1.map(r => r.id);
  const list2 = results2.map(r => r.id);
  const list3 = results3.map(r => r.id);
  
  // Merge using RRF
  const mergedIds = rrf([list1, list2, list3], 60);
  
  console.log('Merged Results (RRF):', mergedIds.slice(0, 5));
  return mergedIds;
}

hybridSearch("machine learning algorithms");
```

---

### Example 6: Creating a Knowledge Base

Setup a vector database with sample data.

```javascript
const { QdrantClient } = require('@qdrant/js-client-rest');
const { getEmbedding } = require('ragforge');

const qdrant = new QdrantClient({ url: 'http://localhost:6333' });
const COLLECTION_NAME = 'my_docs';

async function setupKnowledgeBase() {
  // Create collection
  await qdrant.createCollection(COLLECTION_NAME, {
    vectors: {
      size: 1536,
      distance: 'Cosine'
    }
  });
  
  // Sample documents
  const documents = [
    {
      id: 1,
      content: "Machine learning is a subset of artificial intelligence that focuses on building systems that learn from data.",
      topic: "ML Basics"
    },
    {
      id: 2,
      content: "Neural networks are computing systems inspired by biological neural networks in animal brains.",
      topic: "Neural Networks"
    },
    {
      id: 3,
      content: "Deep learning uses multiple layers of neural networks to progressively extract higher-level features.",
      topic: "Deep Learning"
    }
  ];
  
  // Add documents with embeddings
  for (const doc of documents) {
    const vector = await getEmbedding(doc.content);
    
    await qdrant.upsert(COLLECTION_NAME, {
      points: [{
        id: doc.id,
        vector,
        payload: {
          content: doc.content,
          topic: doc.topic
        }
      }]
    });
    
    console.log(`✅ Added: ${doc.topic}`);
  }
  
  console.log('\n✨ Knowledge base ready!');
}

setupKnowledgeBase();
```

---

### Example 7: Custom LLM Configuration

Use different models and parameters for different use cases.

```javascript
const { hyde, cot } = require('ragforge');

// Fast, cheap responses
const quickAnswer = await hyde("What is AI?", {
  model: "gpt-3.5-turbo",
  temperature: 0.3,
  max_tokens: 150
});

// Detailed, creative responses
const detailedAnswer = await hyde("Explain quantum computing", {
  model: "gpt-4",
  temperature: 0.8,
  max_tokens: 800
});

// Focused, deterministic responses
const factualAnswer = await cot("What is 2+2?", {
  model: "gpt-3.5-turbo",
  temperature: 0,
  max_tokens: 50
});
```

---

### More Examples

Check out the [`examples/`](examples/) directory for additional working examples:

- **[`fullRAGExample.js`](examples/fullRAGExample.js)** - Complete RAG pipeline demonstration
- **[`compareHydeVsNormal.js`](examples/compareHydeVsNormal.js)** - Side-by-side HyDE vs traditional search
- **[`setupMLCollection.js`](examples/setupMLCollection.js)** - Create ML knowledge base in Qdrant
- **[`testHyDE.js`](examples/testHyDE.js)** - HyDE technique testing
- **[`cotExample.js`](examples/cotExample.js)** - Chain of Thought examples
- **[`testWithDB.js`](examples/testWithDB.js)** - Database integration examples

**Run examples:**
```bash
# Start Qdrant with Docker
docker-compose up -d

# Setup knowledge base
node examples/setupMLCollection.js

# Run examples
node examples/fullRAGExample.js
node examples/compareHydeVsNormal.js
```


## 🔧 Configuration

### Environment Variables

Create a `.env` file in your project root:

```env
# Required: OpenAI API Key
OPENAI_API_KEY=sk-your-openai-api-key-here

# Optional: Custom API Configuration
OPENAI_BASE_URL=https://api.openai.com/v1  # Custom endpoint
OPENAI_ORG_ID=org-your-org-id              # Organization ID
```

To configure the OpenAI client yourself (custom key, base URL, proxy), inject it:

```javascript
const OpenAI = require('openai');
const { setOpenAIClient } = require('ragforge');

setOpenAIClient(new OpenAI({ apiKey: 'sk-...', baseURL: 'https://my-proxy/v1' }));
```

### Default Settings

ragforge uses sensible defaults that work for most use cases. The model comes from the provider (OpenAI: `gpt-4o-mini`, embeddings: `text-embedding-ada-002`; Ollama: `llama3.1`, `nomic-embed-text`). Other defaults, which you can override with `createRagforge({ defaults })`:

```javascript
{
  temperature: 0.7,            // Randomness (0-1)
  maxTokens: 500,              // Max response length
  topP: 1,                     // Nucleus sampling
  frequencyPenalty: 0,         // Repetition penalty
  presencePenalty: 0           // Topic diversity
}
```

### Custom Configuration Per Request

Override defaults for individual requests:

```javascript
const answer = await hyde("Your query", {
  model: "gpt-3.5-turbo",      // Use faster/cheaper model
  temperature: 0.3,            // More focused
  max_tokens: 200,             // Shorter responses
  top_p: 0.9,
  frequency_penalty: 0.5,
  presence_penalty: 0.3
});
```

### Vector Database Configuration

#### Qdrant

```javascript
const { QdrantClient } = require('@qdrant/js-client-rest');

const qdrant = new QdrantClient({
  url: 'http://localhost:6333',
  apiKey: 'your-api-key'  // Optional for Qdrant Cloud
});

setVectorClient({
  query: async (vector, topK) => {
    const results = await qdrant.search('collection_name', {
      vector,
      limit: topK,
      with_payload: true,
      score_threshold: 0.7  // Optional: minimum similarity score
    });
    return results.map(r => ({
      content: r.payload.content,
      score: r.score,
      metadata: r.payload
    }));
  }
});
```

#### Pinecone

```javascript
const { PineconeClient } = require('@pinecone-database/pinecone');

const pinecone = new PineconeClient();
await pinecone.init({
  apiKey: process.env.PINECONE_API_KEY,
  environment: process.env.PINECONE_ENV
});

const index = pinecone.Index('your-index-name');

setVectorClient({
  query: async (vector, topK) => {
    const results = await index.query({
      vector,
      topK,
      includeMetadata: true,
      includeValues: false
    });
    return results.matches.map(m => ({
      content: m.metadata.content,
      score: m.score,
      metadata: m.metadata
    }));
  }
});
```

### Docker Setup (Qdrant)

Use `examples/docker-compose.yml` from the repository:

```yaml
version: '3.8'
services:
  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - ./qdrant_storage:/qdrant/storage
```

**Start Qdrant:**
```bash
docker-compose up -d
```

**Access dashboard:** http://localhost:6333/dashboard

---

## 🧪 Testing

### Run Tests

```bash
# Unit tests: fast, no API key or database needed
npm test

# Unit tests in watch mode
npm run test:watch

# Integration tests: real OpenAI calls (costs money) + Qdrant on localhost:6333
npm run test:integration
```

Unit tests use a fake provider, so they cover techniques, the pipeline, stats, caching, providers and the v1 API without any network calls.

### Writing Your Own Tests

```javascript
const { hyde } = require('ragforge');

describe('HyDE Tests', () => {
  it('should generate hypothetical document', async () => {
    const result = await hyde("What is AI?");
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
```

---

## 📁 Project Structure

```
ragforge/
├── src/
│   ├── createRagforge.js        # Instance factory
│   ├── providers/
│   │   ├── openai.js            # OpenAI adapter
│   │   └── ollama.js            # Ollama adapter (local models)
│   │
│   ├── core/
│   │   ├── context.js           # Per-call LLM/embedding/vector access
│   │   ├── stats.js             # Usage and cost tracking
│   │   ├── pricing.js           # Model price table
│   │   ├── cache.js             # Response cache
│   │   └── utils.js             # Utility functions (logging, sanitization)
│   │
│   ├── techniques/
│   │   ├── hyde.js              # HyDE implementation
│   │   ├── cot.js               # Chain of Thought
│   │   ├── stepback.js          # Step-Back Prompting
│   │   ├── rrf.js               # Reciprocal Rank Fusion
│   │   └── fanout.js            # Fan-Out Retrieval
│   │
│   ├── pipeline/
│   │   ├── queryTranslator.js   # Query transformation orchestrator
│   │   └── ragPipeline.js       # End-to-end RAG workflow
│   │
│   └── config/
│       ├── defaults.js          # Default LLM parameters
│       └── env.js               # Environment configuration
│
├── examples/
│   ├── fullRAGExample.js        # Complete pipeline demo
│   ├── compareHydeVsNormal.js   # HyDE vs traditional search
│   ├── setupMLCollection.js     # Create knowledge base
│   ├── testHyDE.js              # HyDE testing
│   ├── cotExample.js            # Chain of Thought demo
│   └── testWithDB.js            # Database integration
│
├── tests/
│   ├── unit/                    # Mocked tests (npm test)
│   └── integration/             # Real API + Qdrant tests (npm run test:integration)
│
├── index.js                     # Main entry point
├── index.d.ts                   # TypeScript definitions
├── package.json                 # Package configuration
└── README.md                    # Documentation
```

---

## ❓ FAQ

### Q: Do I need a vector database to use ragforge?

**A:** No! ragforge works without a vector database. Techniques like HyDE will generate hypothetical documents and return them directly. However, for production RAG systems, a vector database is highly recommended for better retrieval.

### Q: Can I use ragforge with other LLM providers?

**A:** Yes. OpenAI and Ollama are built in (`createRagforge({ llm: 'ollama' })`). OpenAI-compatible endpoints (Azure OpenAI, LM Studio, proxies) work through `createOpenAIProvider({ baseURL, apiKey })`. For anything else, such as Anthropic Claude or Google Gemini, pass a provider object with `chat` and `embed` methods. See [Bring your own provider](#bring-your-own-provider).

### Q: Which technique should I use?

**A:** It depends on your use case:
- **HyDE**: Best for most RAG scenarios, especially domain-specific queries
- **CoT**: Complex reasoning, multi-step problems
- **Step-Back**: Conceptual understanding, educational content
- **Fan-Out**: Broad research, comprehensive coverage
- **RRF**: Combining multiple search strategies
- **Pipeline**: Production systems combining multiple techniques

### Q: How much does it cost?

**A:** ragforge is **free and open-source**. You only pay for:
- OpenAI API usage (embeddings + completions)
- Vector database hosting (if using cloud service)

Typical costs: ~$0.01-0.05 per query depending on configuration.

### Q: Can I use ragforge in production?

**A:** Yes! ragforge is designed for production use:
- ✅ Comprehensive error handling
- ✅ Configurable timeouts and retries
- ✅ Extensive test coverage
- ✅ Logging and debugging support
- ✅ Scalable architecture

### Q: How do I handle rate limits?

**A:** Implement retry logic in your vector client:

```javascript
setVectorClient({
  query: async (vector, topK, retries = 3) => {
    try {
      const results = await qdrant.search(...);
      return results;
    } catch (error) {
      if (retries > 0 && error.code === 429) {
        await new Promise(r => setTimeout(r, 1000));
        return query(vector, topK, retries - 1);
      }
      throw error;
    }
  }
});
```

### Q: Can I customize the prompts?

**A:** Yes! You can modify prompts in the technique files (`src/techniques/`) or create your own implementations inspired by ragforge's architecture.

### Q: Does ragforge support streaming responses?

**A:** Not currently, but it's on the roadmap. Follow the [GitHub repo](https://github.com/Kamraanmulani/ragforge) for updates.

### Q: How do I contribute?

**A:** See the [Contributing](#-contributing) section below!

---

## 🤝 Contributing

Contributions are welcome and appreciated! Here's how you can help:

### Ways to Contribute

- 🐛 **Report bugs** - Open an issue on [GitHub](https://github.com/Kamraanmulani/ragforge/issues)
- 💡 **Suggest features** - Share your ideas for improvements
- 📝 **Improve documentation** - Help make the docs clearer
- 🔧 **Submit pull requests** - Fix bugs or add features
- ⭐ **Star the repo** - Show your support!

### Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/ragforge.git
   cd ragforge
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create a `.env` file**
   ```bash
   OPENAI_API_KEY=your_api_key_here
   ```

4. **Start Qdrant (for testing)**
   ```bash
   docker-compose up -d
   ```

5. **Run tests**
   ```bash
   npm test
   ```

### Pull Request Process

1. Create a feature branch (`git checkout -b feature/AmazingFeature`)
2. Make your changes
3. Add/update tests as needed
4. Ensure all tests pass (`npm test`)
5. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
6. Push to the branch (`git push origin feature/AmazingFeature`)
7. Open a Pull Request

### Code Style

- Use meaningful variable names
- Add comments for complex logic
- Follow existing code patterns
- Keep functions focused and small
- Write tests for new features

### Roadmap

Planned features for future releases:

- [ ] Streaming response support
- [ ] Additional LLM providers (Anthropic, Gemini, local models)
- [ ] More vector database adapters
- [ ] Query caching
- [ ] Advanced reranking techniques
- [ ] Evaluation metrics
- [ ] Batch processing
- [ ] TypeScript support

---

## 🌟 Acknowledgments

ragforge is built on the shoulders of giants:

- **Technologies**:
  - [OpenAI API](https://openai.com) - LLM provider
  - [Qdrant](https://qdrant.tech) - Vector database
  - [Node.js](https://nodejs.org) - Runtime environment

- **Community**:
  - Built with ❤️ for the RAG and AI community
  - Inspired by feedback from developers worldwide

---

## 📧 Contact & Support

### Author

**Kamraan Mulani**
- GitHub: [@Kamraanmulani](https://github.com/Kamraanmulani)
- Project: [ragforge](https://github.com/Kamraanmulani/ragforge)

### Get Help

- 📖 **Documentation**: You're reading it!
- 🐛 **Issues**: [GitHub Issues](https://github.com/Kamraanmulani/ragforge/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/Kamraanmulani/ragforge/discussions)

### Support the Project

If you find ragforge helpful:

- ⭐ **Star the repo** on [GitHub](https://github.com/Kamraanmulani/ragforge)
- 🐦 **Share it** on social media
- 📝 **Write a blog post** about your experience
- 🤝 **Contribute** code or documentation
- 💬 **Provide feedback** to help improve ragforge

---

## � Quick Links

- [📦 NPM Package](https://www.npmjs.com/package/ragforge)
- [📂 GitHub Repository](https://github.com/Kamraanmulani/ragforge)
- [🐛 Report Issues](https://github.com/Kamraanmulani/ragforge/issues)
- [📖 Full Documentation](#-table-of-contents)
- [💡 Examples](./examples/)

---

<div align="center">

### Built with ❤️ for the RAG Community

**If this project helped you, please consider giving it a ⭐!**

[⬆ Back to Top](#-ragforge)

---

**Made with passion by [Kamraan Mulani](https://github.com/Kamraanmulani)**

</div>
