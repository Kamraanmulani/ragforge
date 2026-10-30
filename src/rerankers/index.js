// Rerankers: re-score retrieved candidates against the query, best first.
// A reranker is any { name, model, rerank({ query, documents, topN, chat }) }
// returning { results: [{ index, score }], usage?: { searchUnits?, inputTokens? } }.

/**
 * createLLMReranker
 * Listwise reranking with the instance's own chat model: one call per query.
 * @param {object} [options]
 * @param {number} [options.maxChars=600] - Characters of each passage shown to the LLM
 * @param {object} [options.llmOptions] - Extra chat options (model, ...)
 */
function createLLMReranker({ maxChars = 600, llmOptions = {} } = {}) {
  return {
    name: "llm",
    model: null,
    async rerank({ query, documents, topN = documents.length, chat }) {
      if (!chat) throw new Error("[ragforge] The llm reranker needs a chat function");
      const passages = documents.map((d, i) => `[${i + 1}] ${String(d).replace(/\s+/g, " ").slice(0, maxChars)}`).join("\n\n");
      const prompt = `Rank the passages by how well they answer the search query, most relevant first.

Query: "${query}"

${passages}

Return only the passage numbers, comma-separated, e.g. 3, 1, 2.`;

      const answer = await chat(prompt, { temperature: 0, max_tokens: Math.min(400, 6 * documents.length + 20), ...llmOptions });
      const order = [];
      for (const match of String(answer).match(/\d+/g) ?? []) {
        const index = Number(match) - 1;
        if (index >= 0 && index < documents.length && !order.includes(index)) order.push(index);
      }
      // Passages the LLM left out keep their retrieval order, after the ranked ones
      documents.forEach((_, i) => order.includes(i) || order.push(i));
      return { results: order.slice(0, topN).map((index, rank) => ({ index, score: 1 / (rank + 1) })) };
    },
  };
}

function apiKeyFrom(option, envName, label) {
  const key = option ?? process.env[envName];
  if (!key) throw new Error(`[ragforge] Missing ${envName} for the ${label} reranker. Set it or pass { apiKey }.`);
  return key;
}

async function postJSON(fetchImpl, url, apiKey, body, label) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[ragforge] ${label} rerank failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * createCohereReranker
 * @param {object} [options]
 * @param {string} [options.apiKey] - Defaults to COHERE_API_KEY
 * @param {string} [options.model="rerank-v3.5"]
 * @param {string} [options.baseURL="https://api.cohere.com"]
 * @param {function} [options.fetch] - Custom fetch (tests, proxies)
 */
function createCohereReranker({ apiKey, model = "rerank-v3.5", baseURL = "https://api.cohere.com", fetch: fetchImpl = globalThis.fetch } = {}) {
  return {
    name: "cohere",
    model,
    async rerank({ query, documents, topN = documents.length }) {
      const key = apiKeyFrom(apiKey, "COHERE_API_KEY", "Cohere");
      const data = await postJSON(fetchImpl, `${baseURL}/v2/rerank`, key, { model, query, documents, top_n: topN }, "Cohere");
      return {
        results: data.results.map((r) => ({ index: r.index, score: r.relevance_score })),
        usage: { searchUnits: data.meta?.billed_units?.search_units ?? 1 },
      };
    },
  };
}

/**
 * createJinaReranker
 * @param {object} [options]
 * @param {string} [options.apiKey] - Defaults to JINA_API_KEY
 * @param {string} [options.model="jina-reranker-v2-base-multilingual"]
 * @param {string} [options.baseURL="https://api.jina.ai"]
 * @param {function} [options.fetch] - Custom fetch (tests, proxies)
 */
function createJinaReranker({ apiKey, model = "jina-reranker-v2-base-multilingual", baseURL = "https://api.jina.ai", fetch: fetchImpl = globalThis.fetch } = {}) {
  return {
    name: "jina",
    model,
    async rerank({ query, documents, topN = documents.length }) {
      const key = apiKeyFrom(apiKey, "JINA_API_KEY", "Jina");
      const data = await postJSON(fetchImpl, `${baseURL}/v1/rerank`, key, { model, query, documents, top_n: topN, return_documents: false }, "Jina");
      return {
        results: data.results.map((r) => ({ index: r.index, score: r.relevance_score })),
        usage: { inputTokens: data.usage?.total_tokens ?? 0 },
      };
    },
  };
}

const builtIn = {
  llm: createLLMReranker,
  cohere: createCohereReranker,
  jina: createJinaReranker,
};

/**
 * resolveReranker
 * "llm" | "cohere" | "jina" | a reranker object | null
 */
function resolveReranker(reranker) {
  if (reranker == null) return null;
  if (typeof reranker === "string") {
    const factory = builtIn[reranker];
    if (!factory) throw new Error(`[ragforge] Unknown reranker "${reranker}". Use one of: ${Object.keys(builtIn).join(", ")}, or pass a reranker object.`);
    return factory();
  }
  if (typeof reranker === "object" && typeof reranker.rerank === "function") return reranker;
  throw new Error("[ragforge] reranker must be a name or an object with rerank()");
}

module.exports = { createLLMReranker, createCohereReranker, createJinaReranker, resolveReranker };
