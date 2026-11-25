// `ragforge tune`: finds the retrieval setup that works best on your documents.
//
// It searches chunking strategy x chunk size x embedding model (the "index setup",
// which needs a fresh index) and the query technique (hybrid, HyDE, rerank,
// contextual, ...) by successive halving:
//   1. Screen: every index setup with the techniques that add no LLM calls.
//   2. Refine: the best few setups with the techniques that do.
// Every step is estimated first and the run stays within a USD budget. Each
// distinct API call is made once and reused (same question, same HyDE draft,
// same chunk embedding), but cost per query is still reported as production would pay.
const { createTracker } = require("../core/stats");
const { createCallContext } = require("../core/context");
const { findPrice } = require("../core/pricing");
const { evaluate, generateQuestions, parseTechnique, usesHybrid, usesRerank, usesContextual, DEFAULT_QUESTION_STYLES } = require("../eval/evaluate");
const { chunkDocuments, checkChunking } = require("../eval/chunk");
const { openingWords } = require("../eval/label");
const { estimateContextCost } = require("../indexing/contextual");
const pkg = require("../../package.json");

const TUNE_VERSION = 1;
const DEFAULT_CHUNK_STRATEGIES = ["paragraph", "markdown-heading", "sentence"];
const DEFAULT_CHUNK_SIZES = [400, 800, 1200];
const DEFAULT_SETUP = { chunkStrategy: "paragraph", chunkSize: 800 };
// Techniques that add no LLM call per query: cheap enough to try on every setup
const SCREEN_TECHNIQUES = ["baseline", "hybrid"];
const LLM_PARTS = new Set(["hyde", "cot", "stepback", "fanout"]);
// Rough token counts for estimates (about 4 characters per token)
const LLM_IN_TOKENS = 300;
const LLM_OUT_TOKENS = 300;
const QUERY_TOKENS = 20;
const RERANK_PASSAGE_TOKENS = 150;

const tokens = (text) => Math.ceil(String(text).length / 4);
const setupId = (s) => `${s.chunkStrategy}/${s.chunkSize}/${s.embeddingModel}`;

/**
 * defaultRefineTechniques
 * Query techniques tried on the best setups: LLM query rewriting, alone and with
 * keyword search, plus rerank and contextual when they are available.
 */
function defaultRefineTechniques({ reranker = false, contextual = false } = {}) {
  const techniques = ["hyde", "stepback", "fanout", "hybrid+hyde", "hybrid+stepback", "hybrid+fanout"];
  if (reranker) techniques.push("rerank", "hybrid+rerank");
  if (contextual) techniques.push("contextual", "contextual+hybrid");
  return techniques;
}

/**
 * suggestedEmbeddingModels
 * The embedder's own model. For OpenAI, also text-embedding-3-small: the default
 * (ada-002) is kept for old collections, but 3-small is newer and 5x cheaper.
 */
function suggestedEmbeddingModels(embedder) {
  const models = [embedder.embeddingModel];
  if (embedder.name === "openai" && embedder.embeddingModel !== "text-embedding-3-small") models.push("text-embedding-3-small");
  return models;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * createOnce
 * Runs each distinct call once. A repeat gets the same result after waiting as
 * long as the real call took, so latency measured on a reused call is still
 * what production would see. A failed call is forgotten, so it can be retried.
 */
function createOnce({ replayLatency = true } = {}) {
  const calls = new Map();
  const once = (key, call, record) => {
    const entry = calls.get(key);
    if (entry) {
      // Still in flight: waiting for it takes real time already
      if (entry.ms === null) return entry.pending;
      return entry.pending.then(async (result) => {
        if (replayLatency && entry.ms > 0) await sleep(entry.ms);
        return result;
      });
    }
    const started = Date.now();
    const fresh = { ms: null, pending: null };
    fresh.pending = call().then((result) => {
      fresh.ms = Date.now() - started;
      record(result);
      return result;
    });
    fresh.pending.catch(() => calls.delete(key));
    calls.set(key, fresh);
    return fresh.pending;
  };
  return { once, has: (key) => calls.has(key) };
}

/**
 * memoize
 * Wraps a provider so each distinct call is made once. Repeats get the first
 * result, usage included, and take as long as it did, so a run's stats still
 * show what production pays and waits, while `ledger` records only what was really spent.
 * @param {object} [options]
 * @param {boolean} [options.replayLatency=true] - Make repeats wait as long as the real call took
 */
function memoize(provider, ledger, options = {}) {
  const { once, has } = createOnce(options);
  const wrapped = Object.create(provider);
  if (typeof provider.chat === "function") {
    wrapped.chat = (params) => once(`chat\u0000${JSON.stringify(params)}`, () => provider.chat(params), (r) => ledger.recordChat(provider, r.model ?? params.model, r.usage));
  }
  if (typeof provider.embed === "function") {
    wrapped.embed = (params) => once(`embed\u0000${params.model}\u0000${params.text}`, () => provider.embed(params), (r) => ledger.recordEmbedding(provider, r.model ?? params.model, r.usage));
  }
  // Tune never streams; the plain chat above is memoized instead
  wrapped.chatStream = undefined;
  wrapped.isEmbedded = (model, text) => has(`embed\u0000${model}\u0000${text}`);
  return wrapped;
}

function memoizeReranker(reranker, ledger) {
  if (!reranker) return null;
  const { once } = createOnce();
  const wrapped = Object.create(reranker);
  wrapped.rerank = (params) =>
    once(JSON.stringify([params.query, params.documents, params.topN]), () => reranker.rerank(params), (r) => ledger.recordRerank(reranker, r.usage));
  return wrapped;
}

// An embedder that uses another model, with everything else (and the memo) shared
function withEmbeddingModel(embedder, model) {
  return Object.create(embedder, { embeddingModel: { value: model, enumerable: true } });
}

/**
 * netWins
 * Paired comparison on the same questions: how many more questions `a` ranked
 * the right chunk higher on than `b` did (a miss ranks lowest). Trials without
 * per-question ranks can't be compared, and count as a clear win.
 */
function netWins(a, b) {
  if (!a.ranks || !b.ranks) return Infinity;
  const score = (rank) => (rank > 0 ? 1 / rank : 0);
  let net = 0;
  a.ranks.forEach((rank, i) => {
    const x = score(rank);
    const y = score(b.ranks[i] ?? 0);
    if (x > y) net++;
    else if (x < y) net--;
  });
  return net;
}

/**
 * pickWinner
 * Which trial to ship. A challenger replaces what it competes with only on a
 * clear win, because the best of many noisy scores is often just lucky:
 *   - a setup without extra calls replaces the default setup when it finds at
 *     least as many answers and ranks the right chunk higher on `minGainQuestions`
 *     more questions than it ranks it lower (paired, on the same questions)
 *   - among the setups that clear that bar, a materially cheaper one (20% or more,
 *     per query or to index) replaces the best when it is about as good: the best
 *     doesn't clearly beat it, and finds fewer than `minGainQuestions` more answers
 *   - a trial that adds cost per query (LLM calls, rerank) or at index time
 *     (contextual) must also beat the chosen free trial by `minImprovement` hit rate
 * Ties keep the default: a tie is no reason to rebuild an index.
 */
function pickWinner(trials, defaultTrial, minImprovement, minGainQuestions = 2) {
  const cost = (t) => (t.avgCostUSD === null ? Infinity : t.avgCostUSD);
  const costly = (t) => t.avgLlmCalls > 0 || usesRerank(t.technique) || usesContextual(t.technique);
  const ranked = [...trials].sort((a, b) => b.hitRate - a.hitRate || b.mrr - a.mrr || cost(a) - cost(b) || Number(b.isDefault) - Number(a.isDefault) || a.avgLatencyMs - b.avgLatencyMs);
  const pct = (x) => `${Math.round(x * 100)}%`;
  const vsDefault = (t) => (defaultTrial && t !== defaultTrial ? ` vs ${pct(defaultTrial.hitRate)} for the default setup` : "");
  const clear = (challenger, incumbent) => netWins(challenger, incumbent) >= minGainQuestions;
  if (!ranked.length) return { trial: null, reason: "No trial finished." };

  const freeTrials = ranked.filter((t) => !costly(t));
  const topFree = freeTrials[0] ?? null;
  let free = topFree;
  let pricier = null;
  if (defaultTrial && !costly(defaultTrial)) {
    const beatDefault = freeTrials.filter((t) => t === defaultTrial || (t.hitRate >= defaultTrial.hitRate && clear(t, defaultTrial)));
    const best = beatDefault[0] ?? defaultTrial;
    // Among those, a materially cheaper one that is about as good: e.g. a 5x cheaper
    // embedding model that found one answer fewer. "About as good": the best doesn't rank
    // higher on clearly more questions, and finds fewer than minGainQuestions more answers
    const indexCost = (t) => (t.indexCostUSD === null || t.indexCostUSD === undefined ? Infinity : t.indexCostUSD);
    const hits = (t) => (t.ranks ? t.ranks.filter((r) => r > 0).length : null);
    const closeTo = (t) => !clear(best, t) && (hits(best) === null || hits(t) === null ? best.hitRate - t.hitRate < minImprovement - 1e-9 : hits(best) - hits(t) < minGainQuestions);
    // At least 20% cheaper per query, or as cheap per query and 20% cheaper to index: smaller gaps are rounding
    const cheaper = (t, than) => cost(t) <= cost(than) * 0.8 || (cost(t) <= cost(than) && indexCost(t) <= indexCost(than) * 0.8);
    free = beatDefault
      .filter((t) => t !== best && closeTo(t) && cheaper(t, best))
      .reduce((a, b) => (cheaper(b, a) ? b : a), best);
    if (free !== best) pricier = best;
  }
  const topPaid = ranked.find(costly) ?? null;
  // The epsilon keeps 0.85 - 0.8 (0.04999...) from failing a 0.05 threshold
  const paid = ranked.find((t) => costly(t) && (!free || (t.hitRate - free.hitRate >= minImprovement - 1e-9 && clear(t, free)))) ?? null;

  if (paid) {
    const gain = free ? ` (+${Math.round((paid.hitRate - free.hitRate) * 100)} points over the best setup without extra calls)` : "";
    return { trial: paid, reason: `${paid.technique} on ${paid.setupId} found the right chunk ${pct(paid.hitRate)} of the time${vsDefault(paid)}${gain}.` };
  }
  if (!free) return { trial: ranked[0], reason: "No trial finished." };

  const notes = [];
  if (pricier) {
    notes.push(`${pricier.technique} on ${pricier.setupId} scored ${pct(pricier.hitRate)}, not clearly better than this cheaper setup.`);
  } else if (topFree && free !== topFree && (topFree.hitRate > free.hitRate || topFree.mrr > free.mrr)) {
    const net = netWins(topFree, free);
    notes.push(`${topFree.technique} on ${topFree.setupId} scored ${pct(topFree.hitRate)} (MRR ${topFree.mrr.toFixed(3)}), but ranked the right chunk higher on only ${net} more question${net === 1 ? "" : "s"} than it ranked it lower: not a clear win.`);
  }
  if (topPaid && (topPaid.hitRate > free.hitRate || topPaid.mrr > free.mrr)) {
    notes.push(`${topPaid.technique} on ${topPaid.setupId} scored ${pct(topPaid.hitRate)}, not a clear enough gain to justify its extra cost.`);
  }
  const note = notes.length ? ` ${notes.join(" ")}` : "";
  if (free === defaultTrial) {
    return { trial: free, reason: `The default setup (${pct(free.hitRate)}) was not clearly beaten, so there's no reason to change it.${note}` };
  }
  return { trial: free, reason: `${free.technique} on ${free.setupId} found the right chunk ${pct(free.hitRate)} of the time${vsDefault(free)}, with no extra LLM calls.${note}` };
}

/**
 * paretoFront
 * Trials no other trial beats on both quality (hit rate, then MRR) and cost per
 * query, cheapest first. These are the setups worth choosing between.
 */
function paretoFront(trials) {
  const cost = (t) => (t.avgCostUSD === null ? Infinity : t.avgCostUSD);
  const dominates = (b, a) =>
    cost(b) <= cost(a) && b.hitRate >= a.hitRate && b.mrr >= a.mrr && (cost(b) < cost(a) || b.hitRate > a.hitRate || b.mrr > a.mrr);
  return trials.filter((a) => !trials.some((b) => b !== a && dominates(b, a))).sort((a, b) => cost(a) - cost(b) || b.hitRate - a.hitRate);
}

function checkList(name, list, check) {
  if (!Array.isArray(list) || !list.length) throw new Error(`[ragforge] tune: ${name} must be a non-empty list`);
  list.forEach(check);
  return [...new Set(list)];
}

/**
 * tune
 * @param {object} config - Instance config from createRagforge
 * @param {object} options
 * @param {Array} options.documents - Corpus to tune on
 * @param {Array<{question, expectedText}>} [options.questions] - Ground truth; generated when omitted.
 *   Matched by text, since chunk ids change with the chunking
 * @param {number} [options.numQuestions=20]
 * @param {string[]} [options.chunkStrategies=["paragraph","markdown-heading","sentence"]]
 * @param {number[]} [options.chunkSizes=[400,800,1200]]
 * @param {string[]} [options.embeddingModels] - Default: the embedder's model
 * @param {string[]} [options.techniques] - Refine-stage techniques (default: hyde, stepback, fanout,
 *   their hybrid variants, plus rerank and contextual when enabled)
 * @param {boolean} [options.contextual=false] - Also try contextual retrieval on the best setups
 * @param {object} [options.contextOptions] - For contextual: { model, cache, maxDocumentChars }
 * @param {number} [options.topSetups=3] - Setups that go on to the refine stage
 * @param {number|null} [options.budgetUSD=0.5] - Spending limit for the whole run; null for none
 * @param {number} [options.topK=5]
 * @param {number} [options.rerankCandidates=20]
 * @param {number} [options.minImprovement=0.05] - Hit rate a costlier technique must gain over the best free one
 * @param {number} [options.minGainQuestions=2] - To replace what it competes with, a trial must rank the right
 *   chunk higher on this many more questions than it ranks it lower
 * @param {number} [options.concurrency=4]
 * @param {object} [options.llmOptions]
 * @param {function} [options.onPlan] - Called with the plan and its estimate before anything is spent
 * @param {function} [options.onProgress] - ({ phase, step, steps, setup, done, total }) => void
 */
async function tune(config, options = {}) {
  const {
    documents,
    numQuestions = 20,
    contextual = false,
    contextOptions = {},
    topSetups = 3,
    topK = 5,
    rerankCandidates = 20,
    minImprovement = 0.05,
    minGainQuestions = 2,
    concurrency = 4,
    llmOptions = {},
    questionStyles = DEFAULT_QUESTION_STYLES,
    onPlan = () => {},
    onProgress = () => {},
  } = options;
  const budgetUSD = options.budgetUSD === undefined ? 0.5 : options.budgetUSD;

  // 1. Validate everything before any call
  if (!documents || !documents.length) throw new Error("[ragforge] tune needs `documents`");
  const strategies = checkList("chunkStrategies", options.chunkStrategies ?? DEFAULT_CHUNK_STRATEGIES, (s) => checkChunking({ strategy: s }));
  const sizes = checkList("chunkSizes", options.chunkSizes ?? DEFAULT_CHUNK_SIZES, (n) => checkChunking({ size: n }));
  const defaultModel = config.embedder.embeddingModel;
  const models = checkList("embeddingModels", options.embeddingModels ?? suggestedEmbeddingModels(config.embedder), (m) => {
    if (typeof m !== "string" || !m) throw new Error("[ragforge] tune: embeddingModels must be model names");
  });
  const refineTechniques = checkList("techniques", options.techniques ?? defaultRefineTechniques({ reranker: Boolean(config.reranker), contextual }), parseTechnique);
  if (!config.reranker && refineTechniques.some(usesRerank)) throw new Error('[ragforge] tune: rerank techniques need a reranker, e.g. createRagforge({ reranker: "cohere" })');
  if (!Number.isInteger(minGainQuestions) || minGainQuestions < 0) throw new Error("[ragforge] tune: minGainQuestions must be a whole number, 0 or more");
  if (!Number.isInteger(topSetups) || topSetups < 0) throw new Error("[ragforge] tune: topSetups must be a whole number, 0 or more");
  if (budgetUSD !== null && !(typeof budgetUSD === "number" && budgetUSD >= 0)) throw new Error("[ragforge] tune: budgetUSD must be an amount in US dollars, or null for no limit");

  const givenQuestions = options.questions?.length ? options.questions : null;
  givenQuestions?.forEach((q) => {
    if (!q?.question || (q.expectedText == null && typeof q.source !== "string")) {
      throw new Error("[ragforge] tune: each question needs `question` and `expectedText`. Chunk ids change with the chunking, so tune matches the passage by its text.");
    }
  });
  const chatModel = llmOptions.model ?? config.defaults.model ?? config.llm.chatModel;
  const needsChat = !givenQuestions || refineTechniques.some((t) => parseTechnique(t).some((p) => LLM_PARTS.has(p)) || usesContextual(t)) || config.reranker?.name === "llm";
  if (needsChat && !chatModel) {
    throw new Error(`[ragforge] tune needs a chat model (to write questions and try LLM techniques), and the ${config.llm.name} provider has none. Use a chat provider, or pass questions and techniques without LLM calls.`);
  }

  // Prices must be known to keep to a budget
  const price = (provider, model) => (provider.free ? { input: 0, output: 0, perSearch: 0 } : findPrice(config.pricing, model));
  if (budgetUSD !== null) {
    const unpriced = [
      ...(needsChat && !price(config.llm, chatModel) ? [chatModel] : []),
      ...models.filter((m) => !price(config.embedder, m)),
      ...(config.reranker && config.reranker.name !== "llm" && refineTechniques.some(usesRerank) && !price(config.reranker, config.reranker.model) ? [config.reranker.model] : []),
    ];
    if (unpriced.length) {
      throw new Error(`[ragforge] tune: no price known for ${[...new Set(unpriced)].join(", ")}, so the budget can't be kept. Add prices with createRagforge({ pricing }), or set no budget.`);
    }
  }

  // 2. Shared, memoized providers and the ledger of real spending
  const ledger = createTracker(config.pricing);
  const llm = memoize(config.llm, ledger);
  const embedder = config.embedder === config.llm ? llm : memoize(config.embedder, ledger);
  const reranker = memoizeReranker(config.reranker, ledger);
  const configFor = (model) => ({ ...config, llm, embedder: withEmbeddingModel(embedder, model), reranker, cache: null });
  const spent = () => ledger.snapshot().costUSD;

  const setups = [];
  const add = (s) => !setups.some((x) => setupId(x) === setupId(s)) && setups.push(s);
  // The default setup goes first, so the comparison exists even if the budget runs out
  add({ ...DEFAULT_SETUP, embeddingModel: defaultModel, isDefault: true });
  for (const model of models) for (const chunkStrategy of strategies) for (const chunkSize of sizes) add({ chunkStrategy, chunkSize, embeddingModel: model, isDefault: false });

  // Chunk every setup now (no API calls, except semantic): needed for the estimates
  const chunksFor = new Map();
  for (const s of setups) {
    const key = `${s.chunkStrategy}/${s.chunkSize}`;
    if (!chunksFor.has(key)) {
      // Semantic chunks depend on embeddings; plain sentences stand in for the estimate
      const strategy = s.chunkStrategy === "semantic" ? "sentence" : s.chunkStrategy;
      chunksFor.set(key, await chunkDocuments(documents, { strategy, size: s.chunkSize }));
    }
  }

  // 3. Estimates
  const usd = (p, input, output = 0) => (p ? (input * (p.input ?? 0) + output * (p.output ?? 0)) / 1e6 : null);
  const sum = (values) => (values.some((v) => v === null) ? null : values.reduce((a, b) => a + b, 0));
  const seenParts = new Set();
  const questionCount = givenQuestions ? givenQuestions.length : numQuestions;

  async function estimateStep(setup, techniques) {
    const chunks = chunksFor.get(`${setup.chunkStrategy}/${setup.chunkSize}`);
    const embedPrice = price(config.embedder, setup.embeddingModel);
    const newText = chunks.filter((c) => !embedder.isEmbedded(setup.embeddingModel, c.content)).reduce((n, c) => n + tokens(c.content), 0);
    const parts = [usd(embedPrice, newText * (setup.chunkStrategy === "semantic" ? 2 : 1))];
    const chat = price(config.llm, chatModel);
    const newParts = new Set();
    for (const t of techniques) {
      parts.push(usd(embedPrice, questionCount * QUERY_TOKENS * parseTechnique(t).length));
      for (const p of parseTechnique(t)) if (LLM_PARTS.has(p) && !seenParts.has(p)) newParts.add(p);
      if (usesRerank(t)) {
        if (config.reranker.name === "llm") parts.push(usd(chat, questionCount * (rerankCandidates * RERANK_PASSAGE_TOKENS + 100), questionCount * 60));
        else {
          const rp = price(config.reranker, config.reranker.model);
          parts.push(rp ? questionCount * ((rp.perSearch ?? 0) + (rerankCandidates * RERANK_PASSAGE_TOKENS * (rp.input ?? 0)) / 1e6) : null);
        }
      }
    }
    parts.push(usd(chat, newParts.size * questionCount * LLM_IN_TOKENS, newParts.size * questionCount * LLM_OUT_TOKENS));
    if (techniques.some(usesContextual)) {
      const e = await estimateContextCost({ ...config, llm }, chunks, documents, contextOptions);
      parts.push(e.costUSD, usd(embedPrice, chunks.reduce((n, c) => n + tokens(c.content) + 40, 0)));
    }
    return sum(parts);
  }

  // Questions are written from short passages of whole sentences, smaller than the chunks of
  // any setup and cut differently from all of them: each answer fits inside one chunk of every
  // setup, and no setup is favoured by having chunks that line up with the questions
  const passageSize = Math.max(120, Math.min(300, Math.round(Math.min(...sizes) / 2)));
  const passages = givenQuestions ? [] : await chunkDocuments(documents, { strategy: "sentence", size: passageSize });
  if (!givenQuestions && !passages.length) throw new Error("[ragforge] tune: the documents contained no text");
  const avgChunkTokens = passages.reduce((n, c) => n + tokens(c.content), 0) / Math.max(1, passages.length);
  const questionsEstimate = givenQuestions ? 0 : usd(price(config.llm, chatModel), Math.ceil(numQuestions * 1.3) * (avgChunkTokens + 120), Math.ceil(numQuestions * 1.3) * 40);
  const screenEstimates = await Promise.all(setups.map((s) => estimateStep(s, SCREEN_TECHNIQUES)));
  // Refining: the first setup pays for the LLM techniques; later ones reuse their outputs
  const refineCount = Math.min(topSetups, setups.length);
  const refineFirst = refineCount ? await estimateStep(setups[0], refineTechniques) : 0;
  const refineRest = refineCount > 1 ? await estimateStep(setups[0], refineTechniques.filter((t) => usesRerank(t) || usesContextual(t))) : 0;
  const refineEstimate = sum([refineFirst, ...Array(Math.max(0, refineCount - 1)).fill(refineRest)]);
  const plan = {
    setups: setups.length,
    chunkStrategies: strategies,
    chunkSizes: sizes,
    embeddingModels: models,
    screenTechniques: SCREEN_TECHNIQUES,
    refineTechniques,
    topSetups: refineCount,
    questions: questionCount,
    generateQuestions: !givenQuestions,
    budgetUSD,
    estimate: { questions: questionsEstimate, screening: sum(screenEstimates), refining: refineEstimate, total: sum([questionsEstimate, sum(screenEstimates), refineEstimate]) },
  };
  onPlan(plan);

  const mustFit = sum([questionsEstimate, sum(screenEstimates)]);
  if (budgetUSD !== null && mustFit !== null && mustFit > budgetUSD) {
    throw new Error(
      `[ragforge] tune: writing the questions and screening ${setups.length} setups would cost about $${mustFit.toFixed(4)}, over the budget of $${budgetUSD}. ` +
        "Try fewer chunk sizes, strategies or embedding models, fewer questions, or a larger budget."
    );
  }

  const warnings = [];
  let stopped = null;
  const affordable = (estimate) => budgetUSD === null || estimate === null || (spent() ?? 0) + estimate <= budgetUSD;
  const overBudget = () => budgetUSD !== null && (spent() ?? 0) > budgetUSD;

  // 4. Questions: given, or generated once from the default chunking and matched by text everywhere
  let questions;
  if (givenQuestions) {
    // Chunk ids (expectedId) and earlier runs don't carry over to other chunkings: match by text
    questions = givenQuestions.map(({ expectedId, runs, ...q }) => ({ ...q, expectedText: q.expectedText ?? openingWords(q.source) }));
  } else {
    const ctx = createCallContext(configFor(defaultModel), createTracker(config.pricing));
    const generated = await generateQuestions(ctx, passages, numQuestions, llmOptions, concurrency, ({ done, total }) => onProgress({ phase: "questions", done, total }), questionStyles);
    questions = generated.map(({ question, style, source }) => ({ question, style, expectedText: openingWords(source), source }));
  }
  if (questions.length < 20) warnings.push(`Only ${questions.length} questions: differences of a few points are noise. Use 20 or more for a reliable pick.`);

  // 5. Run a step: one index setup with a list of techniques
  const trials = [];
  async function runStep(setup, techniques, stage, step, steps) {
    const result = await evaluate(configFor(setup.embeddingModel), {
      documents,
      questions,
      techniques,
      topK,
      rerankCandidates,
      chunkSize: setup.chunkSize,
      chunkStrategy: setup.chunkStrategy,
      concurrency,
      minImprovement,
      llmOptions,
      contextOptions,
      onProgress: ({ phase, done, total }) => onProgress({ phase: stage, step, steps, setup: setupId(setup), detail: phase, done, total }),
    });
    for (const t of techniques) parseTechnique(t).forEach((p) => seenParts.add(p));
    for (const row of result.results) {
      trials.push({
        id: `${setupId(setup)} ${row.technique}`,
        setupId: setupId(setup),
        setup: { chunkStrategy: setup.chunkStrategy, chunkSize: setup.chunkSize, embeddingModel: setup.embeddingModel },
        isDefault: setup.isDefault && row.technique === "baseline",
        technique: row.technique,
        stage,
        hitRate: row.hitRate,
        mrr: row.mrr,
        avgCostUSD: row.avgCostUSD,
        avgLatencyMs: row.avgLatencyMs,
        avgLlmCalls: row.avgLlmCalls,
        errors: row.errors,
        // Rank of the right chunk for each question (0: not found), for paired comparisons
        ranks: result.questions.map((q) => q.runs[row.technique]?.rank ?? 0),
        chunkCount: result.chunkCount,
        // Bigger chunks find more but send more text to the LLM with every answer
        avgChunkChars: Math.round(chunksFor.get(`${setup.chunkStrategy}/${setup.chunkSize}`).reduce((n, c) => n + c.content.length, 0) / Math.max(1, result.chunkCount ?? 1)),
        // Paid once per index build: embedding the chunks, plus context lines for contextual
        indexCostUSD: usesContextual(row.technique) && result.contextual ? sum([result.setup.costUSD, result.contextual.usage.costUSD]) : result.setup.costUSD,
      });
    }
    return result;
  }

  // 6. Screen every setup with the free techniques
  for (const [i, setup] of setups.entries()) {
    if (overBudget() || !affordable(screenEstimates[i])) {
      stopped = `The budget ran out while screening, after ${i} of ${setups.length} setups.`;
      break;
    }
    await runStep(setup, SCREEN_TECHNIQUES, "screen", i + 1, setups.length);
  }

  // 7. Refine the best setups with the techniques that cost more
  const best = new Map();
  for (const t of trials) {
    const b = best.get(t.setupId);
    if (!b || t.hitRate > b.hitRate || (t.hitRate === b.hitRate && t.mrr > b.mrr)) best.set(t.setupId, t);
  }
  const screened = setups.filter((s) => best.has(setupId(s)));
  const order = [...screened].sort((a, b) => {
    const x = best.get(setupId(a));
    const y = best.get(setupId(b));
    return y.hitRate - x.hitRate || y.mrr - x.mrr || Number(b.isDefault) - Number(a.isDefault);
  });
  const refineSetups = stopped ? [] : order.slice(0, topSetups);
  for (const [i, setup] of refineSetups.entries()) {
    if (overBudget()) {
      stopped = `The budget ran out while refining, after ${i} of ${refineSetups.length} setups.`;
      break;
    }
    // Drop the costliest groups until the step fits what is left
    let techniques = refineTechniques;
    const groups = [usesContextual, usesRerank, (t) => parseTechnique(t).some((p) => LLM_PARTS.has(p))];
    let estimate = await estimateStep(setup, techniques);
    const dropped = [];
    for (const group of groups) {
      if (affordable(estimate) || !techniques.length) break;
      const removed = techniques.filter(group);
      if (!removed.length) continue;
      techniques = techniques.filter((t) => !group(t));
      dropped.push(...removed);
      estimate = await estimateStep(setup, techniques);
    }
    if (dropped.length) warnings.push(`Skipped ${dropped.join(", ")} on ${setupId(setup)} to stay within the budget.`);
    if (!techniques.length || !affordable(estimate)) continue;
    await runStep(setup, techniques, "refine", i + 1, refineSetups.length);
  }

  // 8. Pick the winner and the setups worth choosing between
  if (!trials.length) throw new Error("[ragforge] tune: no setup could be evaluated within the budget");
  const defaultTrial = trials.find((t) => t.isDefault) ?? null;
  const winner = pickWinner(trials, defaultTrial, minImprovement, minGainQuestions);
  const pareto = paretoFront(trials);
  const total = ledger.snapshot();
  if (overBudget()) warnings.push(`Spent $${total.costUSD.toFixed(4)}, over the $${budgetUSD} budget: an estimate was low.`);

  const w = winner.trial;
  const chosen = {
    version: TUNE_VERSION,
    llm: config.llm.name,
    chatModel,
    embeddings: config.embedder.name,
    embeddingModel: w.setup.embeddingModel,
    chunking: { strategy: w.setup.chunkStrategy, size: w.setup.chunkSize, overlap: 0 },
    contextual: usesContextual(w.technique),
    technique: w.technique,
    hybrid: usesHybrid(w.technique),
    rerank: usesRerank(w.technique),
    reranker: usesRerank(w.technique) ? config.reranker.name : null,
    topK,
    tuned: {
      at: new Date().toISOString(),
      ragforge: pkg.version,
      questions: questions.length,
      hitRate: w.hitRate,
      mrr: w.mrr,
      avgCostUSD: w.avgCostUSD,
      indexCostUSD: w.indexCostUSD,
      default: defaultTrial ? { hitRate: defaultTrial.hitRate, mrr: defaultTrial.mrr } : null,
      reason: winner.reason,
    },
  };

  return {
    version: TUNE_VERSION,
    topK,
    questionCount: questions.length,
    budgetUSD,
    spent: total,
    stopped,
    plan,
    best: w.id,
    default: defaultTrial?.id ?? null,
    reason: winner.reason,
    pareto: pareto.map((t) => t.id),
    trials,
    config: chosen,
    provider: { llm: config.llm.name, chatModel, embeddings: config.embedder.name },
    warnings,
    questions,
  };
}

module.exports = {
  tune,
  pickWinner,
  netWins,
  paretoFront,
  memoize,
  defaultRefineTechniques,
  suggestedEmbeddingModels,
  TUNE_VERSION,
  DEFAULT_CHUNK_STRATEGIES,
  DEFAULT_CHUNK_SIZES,
  SCREEN_TECHNIQUES,
};
