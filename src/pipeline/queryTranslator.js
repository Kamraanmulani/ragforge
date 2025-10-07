// orchestrates multiple techniques together

// src/pipeline/queryTranslator.js
const { hyde } = require("../techniques/hyde");
const { cot } = require("../techniques/cot");
const { stepback } = require("../techniques/stepback");
const { fanout } = require("../techniques/fanout");
const { logInfo, sanitizeText } = require("../core/utils");

async function translate(query, options = {}) {
  /**
   * options:
   *  - techniques: array e.g. ['hyde','cot','stepback','fanout']
   *  - fanoutCount: number (handled inside fanout)
   */
  const techs = options.techniques || ["hyde", "cot", "fanout"];
  const out = {
    originalQuery: query,
    hyde: null,
    cot: null,
    stepback: null,
    fanout: null,
    subQueries: [] // useful for rag retrieval
  };

  logInfo(`[queryTranslator] Running techniques: ${techs.join(", ")}`);

  // Run HyDE if requested
  if (techs.includes("hyde")) {
    try {
      const hydeAns = await hyde(query);
      out.hyde = sanitizeText(hydeAns);
      // Use hyde answer itself as a potential retrieval sub-query
      out.subQueries.push(out.hyde);
    } catch (err) {
      logInfo("[queryTranslator] hyde failed: " + (err.message || err));
    }
  }

  // Chain-of-Thought
  if (techs.includes("cot")) {
    try {
      const cotObj = await cot(query);
      // cot returns { reasoning, refinedQuery } per our template
      out.cot = cotObj;
      if (cotObj && cotObj.refinedQuery) out.subQueries.push(cotObj.refinedQuery);
    } catch (err) {
      logInfo("[queryTranslator] cot failed: " + (err.message || err));
    }
  }

  // Step-back (abstract)
  if (techs.includes("stepback")) {
    try {
      const sb = await stepback(query);
      out.stepback = sb;
      if (sb && sb.abstractQuery) out.subQueries.push(sb.abstractQuery);
    } catch (err) {
      logInfo("[queryTranslator] stepback failed: " + (err.message || err));
    }
  }

  // Fan-out -> returns a summary and typically generates sub-questions
  if (techs.includes("fanout")) {
    try {
      const fan = await fanout(query);
      // fanout returns a summary string in our template; if you later make it return subqueries, adapt accordingly
      out.fanout = fan;
      // If fanout produced sub-questions, try to detect them (it may just be a summary string)
      // For now, we push fanout summary as a retrieval query
      if (fan) out.subQueries.push(sanitizeText(fan));
    } catch (err) {
      logInfo("[queryTranslator] fanout failed: " + (err.message || err));
    }
  }

  // Always add the original short query as a fallback retrieval item
  out.subQueries.push(query);

  // Deduplicate subQueries keeping order
  out.subQueries = [...new Set(out.subQueries.map((s) => sanitizeText(s)).filter(Boolean))];

  return out;
}

module.exports = { translate };
