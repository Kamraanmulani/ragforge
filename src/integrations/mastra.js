// ragforge/mastra: a Mastra tool that searches your documents with ragforge.
// Needs @mastra/core (an optional peer dependency).
const { requirePeer, retrieveOptions, checkInstance, toPassages } = require("./shared");

const ADAPTER = "ragforge/mastra";

/**
 * createRagforgeTool
 * A Mastra tool for agents and workflows:
 *   new Agent({ name, instructions, model, tools: { searchDocs: createRagforgeTool(rf) } })
 * @param {object} rf - From createRagforge(), with a vector store
 * @param {object} [options]
 * @param {string} [options.id="search-docs"] - Tool id
 * @param {string} [options.description] - What the agent is told the tool does
 * @param {number} [options.topK]
 * @param {string} [options.technique] - Always use this technique instead of routing
 * @returns {object} a Mastra Tool; it returns { passages: [{ ref, id, content, score }], technique }
 */
function createRagforgeTool(rf, options = {}) {
  checkInstance(rf, ADAPTER);
  const { createTool } = requirePeer("@mastra/core/tools", ADAPTER, "@mastra/core");
  const opts = retrieveOptions(options);
  return createTool({
    id: options.id ?? "search-docs",
    description: options.description ?? "Search the documentation. Returns the most relevant passages, numbered, with their ids.",
    // Plain JSON Schema: Mastra accepts it, so no schema library is needed
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "What to look for: a question, keywords, an error code or a name" } },
      required: ["query"],
      additionalProperties: false,
    },
    execute: async (input) => {
      const result = await rf.retrieve(input.query, opts);
      return { passages: toPassages(result), technique: result.route.technique };
    },
  });
}

module.exports = { createRagforgeTool };
