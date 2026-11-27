// Helpers shared by the framework adapters (LangChain, AI SDK, LlamaIndex, Mastra)

/**
 * requirePeer
 * Loads a framework package the user installed, with an install hint when it's missing.
 * Each adapter needs its framework only when it is used, so ragforge itself stays small.
 */
function requirePeer(name, adapter, install = name) {
  try {
    return require(name);
  } catch (err) {
    if (err.code === "MODULE_NOT_FOUND" && String(err.message).includes(name)) {
      throw new Error(`[ragforge] ${adapter} needs the "${install}" package: npm install ${install}`);
    }
    // ESM-only packages (ai 7, parts of @mastra/core) load through require() on Node 20.19+ and 22.12+
    if (err.code === "ERR_REQUIRE_ESM" || err.code === "ERR_REQUIRE_ASYNC_MODULE") {
      throw new Error(`[ragforge] ${adapter} loads "${install}", an ES module, with require(). That needs Node.js 20.19+ or 22.12+ (this is ${process.version}). Upgrade Node.js to use it.`);
    }
    throw err;
  }
}

// Options passed through to rf.retrieve(): how many passages, and which technique
function retrieveOptions(options = {}) {
  const { topK, technique, hybrid, rerank, router, from, techniques } = options;
  return Object.fromEntries(Object.entries({ topK, technique, hybrid, rerank, router, from, techniques }).filter(([, v]) => v !== undefined));
}

function checkInstance(rf, adapter) {
  if (!rf || typeof rf.retrieve !== "function") {
    throw new Error(`[ragforge] ${adapter} needs a ragforge instance from createRagforge()`);
  }
}

// Plain-object passages: what tools hand to an agent
function toPassages(result) {
  return result.sources.map((s) => ({ ref: s.ref, id: s.id, content: s.content, score: s.score }));
}

/**
 * contextBlock
 * Numbered passages for a prompt, asking for [n] citations like ragforge's own answers
 */
function contextBlock(sources, { instructions } = {}) {
  const intro = instructions ?? "Answer using the numbered passages below when they are relevant. Cite the passages you use by number in square brackets, like [1] or [2][3]. If they don't contain the answer, say so.";
  const passages = sources.map((s) => `[${s.ref}]${s.id ? ` (${s.id})` : ""} ${s.content}`).join("\n\n");
  return `${intro}\n\n${passages}`;
}

module.exports = { requirePeer, retrieveOptions, checkInstance, toPassages, contextBlock };
