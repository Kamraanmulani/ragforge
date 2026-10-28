// Picks a retrieval technique per query: rules, an LLM classifier, or eval results
const { classifyQuery, CATEGORIES, DEFAULT_RULES, REASONS } = require("./classify");
const { parseTechnique, DEFAULT_TECHNIQUES } = require("../eval/evaluate");

/**
 * classifyWithLLM
 * One short, deterministic LLM call. Falls back to the rules if the
 * answer isn't a known category.
 */
async function classifyWithLLM(ctx, query, llmOptions = {}) {
  const prompt = `Classify the search query into exactly one category:
comparison - compares things or asks several questions at once
exact - looks up an exact name, code, number, error message or quoted phrase
short - very short or vague, just a few keywords
conceptual - a specific why/how question that needs background principles
simple - a clear, self-contained question

Query: "${query}"

Answer with the category name only.`;

  const answer = await ctx.chat(prompt, { temperature: 0, max_tokens: 10, ...llmOptions });
  const category = CATEGORIES.find((c) => answer.toLowerCase().includes(c));
  if (!category) {
    const fallback = classifyQuery(query);
    return { ...fallback, classifier: "rules", reason: `${fallback.reason} (LLM answer "${answer.trim()}" was not a category, used rules.)` };
  }
  return { category, classifier: "llm", reason: `The query ${REASONS[category]}.` };
}

// Learned tables are pure functions of the eval result, so compute once per result
const learnedCache = new WeakMap();

/**
 * learnFromEval
 * Classifies the eval's questions with the rules, then finds the best technique
 * per category. Categories with fewer than `minSamples` questions use the
 * eval's overall recommendation.
 */
function learnFromEval(evalResult, { minSamples = 3, minImprovement = 0.05 } = {}) {
  const key = `${minSamples}:${minImprovement}`;
  const cached = learnedCache.get(evalResult)?.[key];
  if (cached) return cached;

  if (!evalResult || !Array.isArray(evalResult.questions) || !Array.isArray(evalResult.techniques)) {
    throw new Error("[ragforge] `from` must be a result returned by evaluate() (or its saved JSON)");
  }

  const llmCalls = Object.fromEntries((evalResult.results ?? []).map((r) => [r.technique, r.avgLlmCalls ?? 0]));
  const groups = {};
  for (const q of evalResult.questions) {
    const { category } = classifyQuery(q.question);
    (groups[category] ??= []).push(q);
  }

  const byCategory = {};
  for (const [category, qs] of Object.entries(groups)) {
    if (qs.length < minSamples) continue;
    const rate = (t) => qs.filter((q) => q.runs?.[t]?.rank > 0).length / qs.length;
    const scored = evalResult.techniques
      .map((t) => ({ technique: t, hitRate: rate(t) }))
      // Ties go to the cheaper technique
      .sort((a, b) => b.hitRate - a.hitRate || (llmCalls[a.technique] ?? 0) - (llmCalls[b.technique] ?? 0));
    let best = scored[0];
    const baseline = scored.find((s) => s.technique === "baseline");
    if (baseline && best.technique !== "baseline" && best.hitRate - baseline.hitRate < minImprovement) best = baseline;
    byCategory[category] = { ...best, baselineHitRate: baseline ? baseline.hitRate : null, samples: qs.length };
  }

  const learned = { byCategory, fallback: evalResult.recommendation?.technique ?? "baseline" };
  learnedCache.set(evalResult, { ...learnedCache.get(evalResult), [key]: learned });
  return learned;
}

const pct = (x) => `${Math.round(x * 100)}%`;

/**
 * route
 * @param {object} ctx - Call context from createCallContext
 * @param {string} query
 * @param {object} options
 * @param {"rules"|"llm"} [options.router="rules"] - How to classify the query
 * @param {object} [options.from] - evaluate() result to learn technique choices from
 * @param {string[]} [options.techniques] - Techniques the router may pick (ignored with `from`)
 * @param {object} [options.rules] - Category -> technique overrides
 * @param {object} [options.routerOptions] - LLM options for the "llm" classifier
 * @returns {Promise<{technique, category, classifier, decidedBy, reason}>}
 */
async function route(ctx, query, options = {}) {
  const { router = "rules", from, rules = {}, routerOptions = {} } = options;
  if (router !== "rules" && router !== "llm") {
    throw new Error(`[ragforge] router must be "rules" or "llm", got "${router}"`);
  }

  const classification = router === "llm" ? await classifyWithLLM(ctx, query, routerOptions) : { ...classifyQuery(query), classifier: "rules" };
  const { category, classifier } = classification;

  if (from) {
    const learned = learnFromEval(from, options);
    const entry = learned.byCategory[category];
    if (entry) {
      const vs = entry.baselineHitRate !== null && entry.technique !== "baseline" ? ` vs ${pct(entry.baselineHitRate)} for plain search` : "";
      return {
        technique: entry.technique,
        category,
        classifier,
        decidedBy: "eval",
        reason: `On ${entry.samples} ${category} questions in your eval, ${entry.technique} found the right chunk ${pct(entry.hitRate)} of the time${vs}.`,
      };
    }
    return {
      technique: learned.fallback,
      category,
      classifier,
      decidedBy: "eval",
      reason: `Your eval had too few ${category} questions to judge, so the overall recommendation (${learned.fallback}) is used.`,
    };
  }

  const allowed = options.techniques ?? DEFAULT_TECHNIQUES;
  allowed.forEach(parseTechnique);
  const mapping = { ...DEFAULT_RULES, ...rules };
  parseTechnique(mapping[category]);

  let technique = mapping[category];
  let reason = classification.reason;
  if (!allowed.includes(technique)) {
    const fallback = allowed.includes("baseline") ? "baseline" : allowed[0];
    reason += ` ${technique} is not in the allowed techniques, so ${fallback} is used.`;
    technique = fallback;
  }
  return { technique, category, classifier, decidedBy: "rules", reason };
}

/**
 * pipelineTechniques
 * Eval technique name -> ragPipeline techniques ("baseline" means none)
 */
function pipelineTechniques(technique) {
  return parseTechnique(technique).filter((t) => t !== "baseline");
}

module.exports = { route, learnFromEval, classifyWithLLM, pipelineTechniques };
