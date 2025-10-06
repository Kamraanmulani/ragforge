# 🚀 ragify

**Developer-friendly toolkit for integrating cutting-edge query translation and reasoning strategies into any RAG pipeline with minimal code.**

Stop hand-writing complex prompts for HyDE, Chain-of-Thought, Step-Back, and other advanced RAG techniques. **ragify** gives you a simple, pluggable API to supercharge your retrieval systems.

[![npm version](https://badge.fury.io/js/ragify.svg)](https://www.npmjs.com/package/ragify)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 📖 Table of Contents

- [Why ragify?](#-why-ragify)
- [Features](#-features)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Techniques](#-techniques)
- [API Reference](#-api-reference)
- [Examples](#-examples)
- [Project Structure](#-project-structure)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🤔 Why ragify?

### The Problem

Developers building RAG (Retrieval-Augmented Generation) systems face several challenges:

- ❌ **Time-Consuming**: Hand-writing code for each query translation technique (HyDE, CoT, Step-Back, etc.)
- ❌ **Deep Expertise Required**: Need advanced prompting knowledge and understanding of each technique
- ❌ **Inconsistent Implementation**: No standardized way to implement and compare different strategies
- ❌ **Complex Integration**: Difficult to plug into existing vector databases and LLM providers

### The Solution: ragify

✅ **Easy, Pluggable API**: One-line integration for advanced RAG techniques  
✅ **Pre-built Techniques**: Battle-tested implementations of HyDE, CoT, Step-Back, RRF, and Fan-Out  
✅ **Vector DB Agnostic**: Works with Qdrant, Pinecone, Weaviate, or any vector database  
✅ **LLM Agnostic**: Compatible with OpenAI, Anthropic, local models, or any LLM provider  
✅ **Production-Ready**: Clean, minimal code with comprehensive examples

---

## ✨ Features

- 🔮 **HyDE (Hypothetical Document Embeddings)** - Generate hypothetical answers to improve retrieval
- 🧠 **Chain of Thought (CoT)** - Step-by-step reasoning for complex queries
- 🔙 **Step-Back Prompting** - Abstract reasoning before specific retrieval
- 🔄 **Reciprocal Rank Fusion (RRF)** - Merge results from multiple search strategies
- 🌟 **Fan-Out Retrieval** - Generate multiple query variations for comprehensive results
- 🔌 **Pluggable Architecture** - Bring your own vector DB and LLM
- 📦 **Zero Config** - Works out of the box with sensible defaults

---

## 📦 Installation

```bash
npm install ragify
```

### Requirements

- Node.js 14+
- OpenAI API Key (or your preferred LLM provider)
- Vector Database (Qdrant, Pinecone, etc.)

---

## 🚀 Quick Start

### 1. Basic Setup

```javascript
const { hyde, setVectorClient } = require('ragify');
const { QdrantClient } = require('@qdrant/js-client-rest');
const { getEmbedding } = require('./your-embedding-function');

// Configure your vector database
const qdrant = new QdrantClient({ url: 'http://localhost:6333' });

setVectorClient({
  query: async (vector, topK) => {
    const results = await qdrant.search('your-collection', {
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

### 2. Use HyDE for Better Retrieval

```javascript
// Traditional approach - direct query
const answer1 = await simpleRAG("What are the benefits of machine learning?");

// ragify approach - HyDE enhanced
const answer2 = await hyde("What are the benefits of machine learning?");

// HyDE automatically:
// 1. Generates a hypothetical answer
// 2. Embeds the hypothetical answer
// 3. Retrieves more relevant documents
// 4. Generates a better final answer
```

### 3. Environment Setup

Create a `.env` file:

```env
OPENAI_API_KEY=your_openai_api_key_here
```

---

## 🎯 Techniques

### HyDE (Hypothetical Document Embeddings)

Generates a hypothetical answer first, then uses it for retrieval. More effective than embedding the query directly.

```javascript
const { hyde } = require('ragify');

const answer = await hyde("Explain neural networks");
```

**When to use**: Complex queries, domain-specific questions, or when query-document mismatch is an issue.

---

### Chain of Thought (CoT)

Breaks down complex reasoning into steps before retrieval.

```javascript
const { cot } = require('ragify');

const answer = await cot("How does climate change affect ocean currents?");
```

**When to use**: Multi-step reasoning, mathematical problems, or causal relationships.

---

### Step-Back Prompting

Abstracts the query to higher-level concepts before specific retrieval.

```javascript
const { stepback } = require('ragify');

const answer = await stepback("What is the capital of France?");
// Abstracts to: "What are European capitals?"
```

**When to use**: Queries that benefit from broader context or conceptual understanding.

---

### Reciprocal Rank Fusion (RRF)

Merges results from multiple retrieval strategies for better coverage.

```javascript
const { rrf } = require('ragify');

const results = await rrf([
  async () => await searchMethod1("machine learning"),
  async () => await searchMethod2("machine learning"),
  async () => await searchMethod3("machine learning")
]);
```

**When to use**: When you want to combine multiple search approaches (keyword + vector, multiple embeddings, etc.).

---

### Fan-Out Retrieval

Generates multiple query variations and retrieves from all of them.

```javascript
const { fanout } = require('ragify');

const answer = await fanout("What is AI?");
// Generates: "What is AI?", "Explain artificial intelligence", "Define AI technology"
```

**When to use**: Broad topics, ambiguous queries, or comprehensive research.

---

## 📚 API Reference

### `setVectorClient(client)`

Configure your vector database client.

```javascript
setVectorClient({
  query: async (vector, topK) => {
    // Return array of { content, score, metadata }
  }
});
```

### `hyde(query, options)`

Hypothetical Document Embeddings retrieval.

- **query** (string): User question
- **options** (object, optional): Custom LLM parameters
- **Returns**: Final answer string

### `cot(query, options)`

Chain of Thought reasoning.

- **query** (string): User question
- **options** (object, optional): Custom LLM parameters
- **Returns**: Final answer with reasoning steps

### `stepback(query, options)`

Step-Back Prompting.

- **query** (string): User question
- **options** (object, optional): Custom LLM parameters
- **Returns**: Final answer with abstracted context

### `rrf(searchFunctions, weights)`

Reciprocal Rank Fusion.

- **searchFunctions** (array): Array of async search functions
- **weights** (array, optional): Weight for each search method
- **Returns**: Merged and ranked results

### `fanout(query, variations)`

Fan-Out multi-query retrieval.

- **query** (string): User question
- **variations** (number, optional): Number of query variations (default: 3)
- **Returns**: Final answer from all variations

---

## 💡 Examples

Check out the [`examples/`](examples/) directory for complete working examples:

- [`hydeExample.js`](examples/hydeExample.js) - HyDE technique demo
- [`cotExample.js`](examples/cotExample.js) - Chain of Thought demo
- [`compareHydeVsNormal.js`](examples/compareHydeVsNormal.js) - Side-by-side comparison
- [`testWithDB.js`](examples/testWithDB.js) - Full integration with Qdrant
- [`setupMLCollection.js`](examples/setupMLCollection.js) - Create sample ML knowledge base

### Run Examples

```bash
# Setup ML knowledge collection in Qdrant
node examples/setupMLCollection.js

# Compare HyDE vs Normal search
node examples/compareHydeVsNormal.js

# Test with real database
node examples/testWithDB.js
```

---

## 📁 Project Structure

```
ragify/
├── src/
│   ├── core/
│   │   ├── openaiClient.js    # LLM API integration
│   │   ├── vectorClient.js    # Vector DB integration
│   │   └── utils.js           # Helper functions
│   ├── techniques/
│   │   ├── hyde.js            # HyDE implementation
│   │   ├── cot.js             # Chain of Thought
│   │   ├── stepback.js        # Step-Back Prompting
│   │   ├── rrf.js             # Reciprocal Rank Fusion
│   │   └── fanout.js          # Fan-Out Retrieval
│   ├── pipeline/
│   │   ├── queryTranslator.js # Query orchestration
│   │   └── ragPipeline.js     # End-to-end RAG flow
│   └── config/
│       ├── defaults.js        # Default parameters
│       └── env.js             # Environment config
├── examples/                  # Working examples
├── tests/                     # Unit tests
└── index.js                   # Main entry point
```

---

## 🔧 Configuration

### Default LLM Settings

```javascript
// src/config/defaults.js
module.exports = {
  model: "gpt-4",
  temperature: 0.7,
  maxTokens: 500,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0
};
```

### Custom Configuration

```javascript
const answer = await hyde(query, {
  model: "gpt-3.5-turbo",
  temperature: 0.3,
  max_tokens: 300
});
```

---

## 🧪 Testing

```bash
npm test
```

Tests cover:
- ✅ HyDE technique
- ✅ Chain of Thought
- ✅ Step-Back Prompting
- ✅ Reciprocal Rank Fusion
- ✅ Fan-Out Retrieval
- ✅ RAG Pipeline integration

---

## 🐳 Docker Support

Start Qdrant vector database:

```bash
docker-compose up -d
```

Access Qdrant dashboard: `http://localhost:6333/dashboard`

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- Inspired by research on HyDE, Chain-of-Thought, and Step-Back Prompting
- Built with ❤️ for the RAG community
- Powered by OpenAI and Qdrant

---

## 📧 Contact

**Kamraan Mulani** - [@Kamraanmulani](https://github.com/Kamraanmulani)

Project Link: [https://github.com/Kamraanmulani/ragify](https://github.com/Kamraanmulani/ragify)

---

## 🌟 Star History

If you find this project useful, please consider giving it a ⭐!

---

**Happy RAG-ing! 🚀**
