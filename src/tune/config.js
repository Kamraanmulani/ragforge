// ragforge.config.json: the setup `ragforge tune` picked, read by createRagforge({ config })
const fs = require("fs");
const path = require("path");
const { parseTechnique } = require("../eval/evaluate");
const { checkChunking } = require("../eval/chunk");

const CONFIG_VERSION = 1;

/**
 * loadConfig
 * Reads and checks a tuned config: an object, or a path to its JSON file.
 * Unknown keys are ignored, so later versions of tune can add fields.
 * @param {string|object} input
 * @param {object} [options]
 * @param {string} [options.cwd=process.cwd()] - Base for a relative path
 * @returns {object} the config, with defaults filled in
 */
function loadConfig(input, { cwd = process.cwd() } = {}) {
  let config = input;
  let where = "config";
  if (typeof input === "string") {
    const file = path.resolve(cwd, input);
    where = input;
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      throw new Error(`[ragforge] config: cannot read ${input}. Create it with: npx ragforge tune --docs <path>`);
    }
    try {
      config = JSON.parse(text);
    } catch (err) {
      throw new Error(`[ragforge] config: ${input} is not valid JSON (${err.message})`);
    }
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("[ragforge] config must be a ragforge.config.json object or a path to one");
  }
  if (config.version !== CONFIG_VERSION) {
    throw new Error(`[ragforge] ${where}: version ${config.version} is not supported (expected ${CONFIG_VERSION}). Re-run ragforge tune with this version of ragforge.`);
  }
  const technique = config.technique ?? "baseline";
  parseTechnique(technique);
  const chunking = checkChunking({
    strategy: config.chunking?.strategy ?? "paragraph",
    size: config.chunking?.size ?? 800,
    overlap: config.chunking?.overlap ?? 0,
  });
  const topK = config.topK ?? 5;
  if (!Number.isInteger(topK) || topK < 1) throw new Error(`[ragforge] ${where}: topK must be a positive whole number`);
  for (const key of ["llm", "embeddings", "chatModel", "embeddingModel", "reranker"]) {
    if (config[key] != null && typeof config[key] !== "string") throw new Error(`[ragforge] ${where}: ${key} must be a name`);
  }
  return {
    ...config,
    technique,
    chunking,
    topK,
    contextual: Boolean(config.contextual),
    hybrid: Boolean(config.hybrid),
    rerank: Boolean(config.rerank),
    reranker: config.reranker ?? null,
  };
}

module.exports = { loadConfig, CONFIG_VERSION };
