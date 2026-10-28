// orchestrates multiple techniques together
const { hyde } = require("../techniques/hyde");
const { cot } = require("../techniques/cot");
const { stepback } = require("../techniques/stepback");
const { fanout } = require("../techniques/fanout");
const { sanitizeText } = require("../core/utils");

const TECHNIQUES = { hyde, cot, stepback, fanout };

// How each technique's output becomes a retrieval sub-query
const toSubQuery = {
  hyde: (out) => out,
  cot: (out) => out && out.refinedQuery,
  stepback: (out) => out && out.abstractQuery,
  fanout: (out) => out,
};

/**
 * translate
 * Runs the selected techniques in parallel and collects retrieval sub-queries.
 * @param {object} ctx - Call context from createCallContext
 * @param {string} query
 * @param {object} options
 *  - techniques: array e.g. ['hyde','cot','stepback','fanout']
 *  - techniqueOptions: LLM options passed to each technique (model, temperature, ...)
 */
async function translate(ctx, query, options = {}) {
  const techs = options.techniques ?? ["hyde", "cot", "fanout"];
  const llmOpts = options.techniqueOptions ?? {};

  const unknown = techs.filter((t) => !TECHNIQUES[t]);
  if (unknown.length) {
    throw new Error(`[ragforge] Unknown technique(s): ${unknown.join(", ")}. Available: ${Object.keys(TECHNIQUES).join(", ")}`);
  }

  const out = {
    originalQuery: query,
    hyde: null,
    cot: null,
    stepback: null,
    fanout: null,
    subQueries: [] // useful for rag retrieval
  };

  ctx.log(`[queryTranslator] Running techniques: ${techs.join(", ")}`);

  // Techniques are independent, so run them concurrently
  const settled = await Promise.allSettled(techs.map((t) => TECHNIQUES[t](ctx, query, llmOpts)));

  // Collect in a fixed order so sub-queries are deterministic
  for (const name of Object.keys(TECHNIQUES)) {
    const idx = techs.indexOf(name);
    if (idx === -1) continue;
    const res = settled[idx];
    if (res.status === "rejected") {
      ctx.log(`[queryTranslator] ${name} failed: ${res.reason?.message || res.reason}`);
      continue;
    }
    out[name] = name === "hyde" || name === "fanout" ? sanitizeText(res.value) : res.value;
    const subQ = toSubQuery[name](out[name]);
    if (subQ) out.subQueries.push(subQ);
  }

  // Always add the original short query as a fallback retrieval item
  out.subQueries.push(query);

  // Deduplicate subQueries keeping order
  out.subQueries = [...new Set(out.subQueries.map((s) => sanitizeText(s)).filter(Boolean))];

  return out;
}

module.exports = { translate, TECHNIQUES };
