// ragforge/ai-sdk: ragforge in the Vercel AI SDK, as a tool the model can call and as
// middleware that adds retrieved passages to every call. Needs `ai` (an optional peer dependency).
const { requirePeer, retrieveOptions, checkInstance, toPassages, contextBlock } = require("./shared");

const ADAPTER = "ragforge/ai-sdk";

/**
 * createRagforgeTool
 * An AI SDK tool that searches your documents. The model decides when to call it:
 *   generateText({ model, tools: { searchDocs: createRagforgeTool(rf) }, stopWhen: stepCountIs(3), prompt })
 * @param {object} rf - From createRagforge(), with a vector store
 * @param {object} [options]
 * @param {string} [options.description] - What the model is told the tool does
 * @param {number} [options.topK] - Passages per call (default: the config's, or 5)
 * @param {string} [options.technique] - Always use this technique instead of routing
 * @returns {object} an AI SDK tool; it returns { passages: [{ ref, id, content, score }], technique }
 */
function createRagforgeTool(rf, options = {}) {
  checkInstance(rf, ADAPTER);
  const { tool, jsonSchema } = requirePeer("ai", ADAPTER);
  const opts = retrieveOptions(options);
  return tool({
    description: options.description ?? "Search the documentation. Returns the most relevant passages, numbered, with their ids.",
    inputSchema: jsonSchema({
      type: "object",
      properties: { query: { type: "string", description: "What to look for: a question, keywords, an error code or a name" } },
      required: ["query"],
      additionalProperties: false,
    }),
    execute: async ({ query }) => {
      const result = await rf.retrieve(query, opts);
      return { passages: toPassages(result), technique: result.route.technique };
    },
  });
}

// The text of the last user message in an AI SDK (LanguageModelV4) prompt
function lastUserText(prompt) {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const message = prompt[i];
    if (message.role !== "user") continue;
    const content = Array.isArray(message.content) ? message.content : [{ type: "text", text: String(message.content) }];
    return content
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n")
      .trim();
  }
  return "";
}

/**
 * createRagforgeMiddleware
 * AI SDK middleware that retrieves passages for the last user message and adds them,
 * numbered, to the system prompt, so any model answers from your documents:
 *   const model = wrapLanguageModel({ model: openai('gpt-4o-mini'), middleware: createRagforgeMiddleware(rf) })
 * @param {object} rf - From createRagforge(), with a vector store
 * @param {object} [options]
 * @param {number} [options.topK]
 * @param {string} [options.technique] - Always use this technique instead of routing
 * @param {string} [options.instructions] - Text placed before the passages
 * @param {function} [options.onSources] - Called with { query, sources, route, stats } for each call,
 *   e.g. to show citations next to the answer
 * @returns {object} a LanguageModelMiddleware
 */
function createRagforgeMiddleware(rf, options = {}) {
  checkInstance(rf, ADAPTER);
  const opts = retrieveOptions(options);
  return {
    specificationVersion: "v4",
    async transformParams({ params }) {
      const prompt = params.prompt ?? [];
      const query = lastUserText(prompt);
      if (!query) return params;
      const result = await rf.retrieve(query, opts);
      options.onSources?.({ query, sources: result.sources, route: result.route, stats: result.stats });
      if (!result.sources.length) return params;
      const block = contextBlock(result.sources, { instructions: options.instructions });
      // One system prompt at the start works with every provider (some reject a second one)
      const first = prompt[0];
      const next = first?.role === "system" ? [{ ...first, content: `${first.content}\n\n${block}` }, ...prompt.slice(1)] : [{ role: "system", content: block }, ...prompt];
      return { ...params, prompt: next };
    },
  };
}

module.exports = { createRagforgeTool, createRagforgeMiddleware, lastUserText };
