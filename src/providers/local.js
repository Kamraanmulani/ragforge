// Local embeddings: runs a small embedding model in-process with @huggingface/transformers.
// No API key and no server. The package is an optional peer dependency, loaded on first use,
// and the model downloads once and is cached by the library.

const DEFAULT_MODEL = "Xenova/bge-small-en-v1.5";

/**
 * createLocalProvider
 * Embeddings only. Chat is not available, so use it with `embeddings` next to another provider,
 * or with eval's --questions-file and retrieval-only techniques.
 * @param {object} [options]
 * @param {string} [options.embeddingModel="Xenova/bge-small-en-v1.5"] - Any feature-extraction model on the Hugging Face hub
 * @param {function} [options.importer] - Loads the package (tests replace it)
 */
function createLocalProvider(options = {}) {
  const { embeddingModel = DEFAULT_MODEL, importer = (name) => import(name) } = options;

  // One extractor per provider, created on first use so requiring ragforge stays cheap.
  // A failed load is not cached, so a later call can retry after the install.
  let extractorPromise = null;
  function getExtractor() {
    extractorPromise ??= loadExtractor().catch((err) => {
      extractorPromise = null;
      throw err;
    });
    return extractorPromise;
  }

  async function loadExtractor() {
    let transformers;
    try {
      transformers = await importer("@huggingface/transformers");
    } catch (err) {
      if (err.code === "ERR_MODULE_NOT_FOUND" || err.code === "MODULE_NOT_FOUND") {
        throw new Error('[ragforge] Local embeddings need the "@huggingface/transformers" package: npm install @huggingface/transformers');
      }
      throw err;
    }
    return transformers.pipeline("feature-extraction", embeddingModel, { dtype: "fp32" });
  }

  return {
    name: "local",
    // Local models cost nothing, so they add no price to a run
    free: true,
    chatModel: null,
    embeddingModel,

    async chat() {
      throw new Error(
        '[ragforge] The local provider has no chat model. Use it for embeddings, or pick a chat provider (openai, ollama, ...) and pass embeddings: "local". Eval can run without chat using --questions-file.'
      );
    },

    async embed({ text, model }) {
      const extract = await getExtractor();
      // Mean pooling and normalization give unit vectors, the same as the hosted embedding models
      const output = await extract(text, { pooling: "mean", normalize: true });
      return {
        vector: Array.from(output.data),
        model: model ?? embeddingModel,
        // Token counts aren't reported; the local model's cost is zero anyway
        usage: { inputTokens: 0 },
      };
    },
  };
}

module.exports = { createLocalProvider, DEFAULT_LOCAL_MODEL: DEFAULT_MODEL };
