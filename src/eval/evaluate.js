// Benchmarks retrieval techniques on the user's own data
const { createCallContext } = require("../core/context");
const { createTracker } = require("../core/stats");
const { mapLimit } = require("../core/limit");
const { sanitizeText, extractText } = require("../core/utils");
const { rrf } = require("../techniques/rrf");
const { hypotheticalDocument } = require("../techniques/hyde");
const { cot } = require("../techniques/cot");
const { generalQuestion } = require("../techniques/stepback");
const { subQuestions } = require("../techniques/fanout");
const { chunkDocuments, checkChunking, passageText } = require("./chunk");
const { createMemoryVectorStore } = require("./memoryVectorStore");
const { judgeAnswer, summarizeAnswers, JUDGE_VERSION } = require("./judge");
const { contextualize } = require("../indexing/contextual");

// The first words of a passage, matched as text (same as label.js; kept here to avoid a cycle)
const openingWords = (text, count = 12) => String(text).trim().split(/\s+/).slice(0, count).join(" ");

/**
 * externalItem
 * A result from your own retriever, whatever its shape: a string, { content },
 * LangChain's { pageContent }, or { text }. Becomes { id, content, score, metadata }.
 */
function externalItem(item) {
  if (typeof item === "string") return { id: null, content: item, score: null, metadata: null };
  const content = item?.content ?? item?.pageContent ?? item?.text ?? "";
  return { id: item?.id ?? item?.metadata?.id ?? null, content: String(content), score: typeof item?.score === "number" ? item.score : null, metadata: item?.metadata ?? null };
}

const DEFAULT_TECHNIQUES = ["baseline", "hybrid", "hyde", "stepback", "fanout"];

// Each technique turns a question into the texts that get embedded and searched.
// Multiple texts are fused with RRF, the same way the pipeline does it.
// "hybrid" also runs a keyword (BM25) search for the original question.
// "rerank" retrieves more candidates and lets the reranker pick the top k.
// "contextual" searches a second index whose chunks carry an LLM-written context line.
const QUERY_BUILDERS = {
  baseline: async (ctx, q) => [q],
  hybrid: async (ctx, q) => [q],
  rerank: async (ctx, q) => [q],
  contextual: async (ctx, q) => [q],
  hyde: async (ctx, q, o) => [await hypotheticalDocument(ctx, q, o)],
  cot: async (ctx, q, o) => [(await cot(ctx, q, o)).refinedQuery],
  stepback: async (ctx, q, o) => [q, await generalQuestion(ctx, q, o)],
  fanout: async (ctx, q, o) => [q, ...(await subQuestions(ctx, q, o))],
};

/**
 * parseTechnique
 * "hyde+stepback" -> ["hyde", "stepback"]
 */
function parseTechnique(name) {
  const parts = name.split("+").map((p) => p.trim()).filter(Boolean);
  const unknown = parts.filter((p) => !QUERY_BUILDERS[p]);
  if (!parts.length || unknown.length) {
    throw new Error(`[ragforge] Unknown eval technique "${name}". Use ${Object.keys(QUERY_BUILDERS).join(", ")}, or combine with "+" (e.g. "hyde+stepback").`);
  }
  return parts;
}

function usesHybrid(technique) {
  return parseTechnique(technique).includes("hybrid");
}

function usesRerank(technique) {
  return parseTechnique(technique).includes("rerank");
}

function usesContextual(technique) {
  return parseTechnique(technique).includes("contextual");
}

// Costs more than plain search: extra LLM calls, a reranker call, or (contextual)
// an LLM call per chunk at index time
function addsCost(row, baseline) {
  return row.avgLlmCalls > baseline.avgLlmCalls || usesRerank(row.technique) || usesContextual(row.technique);
}

async function buildQueries(ctx, technique, question, llmOptions) {
  const lists = await Promise.all(parseTechnique(technique).map((p) => QUERY_BUILDERS[p](ctx, question, llmOptions)));
  return [...new Set(lists.flat().map(sanitizeText).filter(Boolean))];
}

function cleanQuestion(text) {
  return sanitizeText(text)
    .replace(/^(question|q)\s*[:.-]\s*/i, "")
    .replace(/^["'“]+|["'”]+$/g, "")
    .trim();
}

// Real users don't only ask tidy questions; a mix keeps the eval from favouring
// plain search and gives the router data for its short/conceptual categories
const QUESTION_STYLES = {
  question: "Write one question a user might ask that this passage answers. Do not copy the passage's wording.",
  keywords: "Write the short search query (2 to 5 words, no question mark) a user would type into a documentation search box to find this passage. Do not copy a full phrase from the passage.",
  conceptual: "Write one why or how question about the idea behind this passage, phrased the way someone who doesn't know the exact terms would ask it.",
};
const DEFAULT_QUESTION_STYLES = ["question", "keywords", "conceptual"];

// Questions that point at the passage instead of naming their subject can't be answered by search
const VAGUE_REFERENCE = /\b(the|this) (text|passage|excerpt|snippet|article|section)\b|\bthis (tool|library|package|function|method|module|content|document)\b|\b(described|mentioned)\b|\bprovided (text|content|passage|documentation)\b/i;

function questionPrompt(style, chunk) {
  return `The passage below is from "${chunk.docId}".
${QUESTION_STYLES[style]}
It must make sense on its own to someone who hasn't seen the passage: name the specific library, function, option or concept, and never refer to "the passage", "the text" or "the described function".
Return only the ${style === "keywords" ? "query" : "question"}.

Passage:
${chunk.content}`;
}

/**
 * generateQuestions
 * Picks chunks spread evenly across the corpus and asks the LLM for a question
 * each chunk answers, cycling through question styles. That chunk becomes the
 * ground truth. Vague questions are retried on another chunk (up to 3 tries).
 */
async function generateQuestions(ctx, chunks, count, llmOptions, concurrency, onProgress = () => {}, styles = DEFAULT_QUESTION_STYLES) {
  const substantial = chunks.filter((c) => c.content.length >= 150);
  const pool = substantial.length >= count ? substantial : chunks;
  const n = Math.min(count, pool.length);
  const pickedIdx = Array.from({ length: n }, (_, i) => Math.floor((i * pool.length) / n));
  const picked = new Set(pickedIdx);
  // Spare chunks for retries, in a deterministic scattered order
  const spares = pool.filter((_, i) => !picked.has(i)).sort((a, b) => (hash(a.id) % 9973) - (hash(b.id) % 9973));
  let done = 0;

  const results = await mapLimit(pickedIdx, concurrency, async (poolIndex, slot) => {
    const style = styles[slot % styles.length];
    let chunk = pool[poolIndex];
    for (let attempt = 0; attempt < 3 && chunk; attempt++) {
      const question = cleanQuestion(await ctx.chat(questionPrompt(style, chunk), { temperature: 0.3, max_tokens: 100, ...llmOptions }));
      if (question && !VAGUE_REFERENCE.test(question)) {
        onProgress({ phase: "questions", done: ++done, total: n });
        return { question, style, expectedId: chunk.id, source: passageText(chunk) };
      }
      chunk = spares.shift();
    }
    onProgress({ phase: "questions", done: ++done, total: n });
    return null;
  });

  const questions = results.filter(Boolean);
  if (!questions.length) throw new Error("[ragforge] evaluate: could not generate usable questions from the documents");
  return questions;
}

function hash(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function resultKey(item) {
  return item && typeof item === "object" && item.id != null ? String(item.id) : extractText(item);
}

/**
 * matchText
 * Text compared for expectedText matches: lowercased, whitespace collapsed, and
 * without Markdown heading marks ("## ") or heading-trail separators (" > "), so a
 * passage still matches after it moved to a chunk made by another strategy.
 */
function matchText(text) {
  return String(text)
    .toLowerCase()
    .replace(/(^|\s)#{1,6}(?=\s)/g, " ")
    .replace(/\s>\s/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMatch(item, key, q) {
  if (q.expectedId != null) return key === String(q.expectedId);
  return matchText(extractText(item)).includes(matchText(q.expectedText));
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function summarize(technique, runs) {
  const n = runs.length;
  const costs = runs.map((r) => r.stats.costUSD);
  const costKnown = costs.every((c) => c !== null);
  return {
    technique,
    hitRate: Number((runs.filter((r) => r.rank > 0).length / n).toFixed(3)),
    mrr: Number(mean(runs.map((r) => (r.rank ? 1 / r.rank : 0))).toFixed(3)),
    avgLatencyMs: Math.round(mean(runs.map((r) => r.stats.latencyMs))),
    avgCostUSD: costKnown ? Number(mean(costs).toFixed(8)) : null,
    totalCostUSD: costKnown ? Number(costs.reduce((a, b) => a + b, 0).toFixed(8)) : null,
    avgLlmCalls: Number(mean(runs.map((r) => r.stats.llmCalls)).toFixed(2)),
    errors: runs.filter((r) => r.error).length,
  };
}

function rankRows(rows) {
  const cost = (r) => (r.avgCostUSD === null ? Infinity : r.avgCostUSD);
  return [...rows].sort((a, b) => b.hitRate - a.hitRate || b.mrr - a.mrr || cost(a) - cost(b) || a.avgLatencyMs - b.avgLatencyMs);
}

/**
 * recommend
 * The top scorer, unless it beats plain search by less than `minImprovement`
 * hit rate, in which case the extra cost isn't worth it. A technique with no
 * extra cost (plain hybrid search) only has to rank above plain search.
 */
function recommend(ranked, topK, minImprovement) {
  const best = ranked[0];
  const baseline = ranked.find((r) => r.technique === "baseline");
  const pct = (x) => `${Math.round(x * 100)}%`;

  if (!baseline || best.technique === "baseline") {
    return {
      technique: best.technique,
      reason: baseline
        ? `Plain embedding search had the best hit@${topK} (${pct(best.hitRate)}); query techniques didn't help on this data.`
        : `Best hit@${topK} (${pct(best.hitRate)}) of the techniques tested.`,
    };
  }

  const gain = best.hitRate - baseline.hitRate;
  // A tie on both scores was decided by cost or latency, which is noise at this size:
  // the pick would flip from run to run. Plain search is the simpler choice.
  if (gain === 0 && best.mrr === baseline.mrr) {
    return {
      technique: "baseline",
      reason: `${best.technique} tied with plain search (hit@${topK} ${pct(best.hitRate)}, MRR ${best.mrr}), so there's no reason to switch.`,
    };
  }
  if (!addsCost(best, baseline)) {
    return {
      technique: best.technique,
      reason: gain > 0
        ? `${best.technique} found the right chunk ${pct(best.hitRate)} of the time vs ${pct(baseline.hitRate)} for plain search (+${Math.round(gain * 100)} points), with no extra LLM calls.`
        : `${best.technique} matched plain search's hit@${topK} (${pct(best.hitRate)}) and ranked the right chunk higher (MRR ${best.mrr} vs ${baseline.mrr}), with no extra LLM calls.`,
    };
  }
  if (gain < minImprovement) {
    return {
      technique: "baseline",
      reason: `${best.technique} beat plain search by only ${Math.round(gain * 100)} points of hit@${topK}, not enough to justify its extra cost.`,
    };
  }
  return {
    technique: best.technique,
    reason: `${best.technique} found the right chunk ${pct(best.hitRate)} of the time vs ${pct(baseline.hitRate)} for plain search (+${Math.round(gain * 100)} points).`,
  };
}

/**
 * evaluate
 * @param {object} config - Instance config from createRagforge
 * @param {object} options
 * @param {Array<string|{id?, content}>} [options.documents] - Corpus to index in memory
 * @param {Array<{question, expectedId?, expectedText?}>} [options.questions] - Ground-truth questions
 * @param {number} [options.numQuestions=10] - Questions to generate when none are given
 * @param {string[]} [options.questionStyles] - Generated question mix: question, keywords, conceptual
 * @param {string[]} [options.techniques] - e.g. ["baseline", "hybrid", "hyde", "hybrid+hyde"]
 * @param {number} [options.topK=5]
 * @param {number} [options.rerankCandidates=20] - Candidates retrieved for rerank techniques
 * @param {number} [options.chunkSize=800]
 * @param {string} [options.chunkStrategy="paragraph"] - paragraph, fixed, sentence, markdown-heading, semantic or code
 * @param {number} [options.chunkOverlap=0] - Characters repeated between chunks (fixed and sentence)
 * @param {number} [options.concurrency=4]
 * @param {number} [options.minImprovement=0.05] - Hit-rate gain needed to recommend over baseline
 * @param {object} [options.llmOptions] - LLM options for techniques, question generation and answers
 * @param {boolean} [options.answers=false] - Also write an answer from each technique's passages and
 *   grade it with an LLM judge: faithfulness, answer relevance, context recall, citation accuracy
 * @param {object} [options.judgeOptions] - LLM options for the judge, e.g. { model } (default: llmOptions at temperature 0)
 * @param {boolean} [options.contextual=false] - Add "contextual" and "contextual+hybrid" to the default techniques
 * @param {object} [options.contextOptions] - For contextual techniques: { model, cache, budgetUSD,
 *   maxDocumentChars, llmOptions, onEstimate }, see src/indexing/contextual.js
 * @param {object} [options.retrievers] - Your own retrievers to score next to the techniques, e.g.
 *   { langchain: fromLangChainRetriever(retriever) }: name -> async (query, topK) => results. They
 *   search their own index, so they are matched on the passage text, not chunk ids. Their cost isn't
 *   known, and they are never the recommendation (auto() can't route to them)
 * @param {function} [options.onProgress] - ({ phase, done, total }) => void
 */
async function evaluate(config, options = {}) {
  const {
    documents,
    numQuestions = 10,
    questionStyles = DEFAULT_QUESTION_STYLES,
    topK = 5,
    rerankCandidates = 20,
    chunkSize = 800,
    chunkStrategy = "paragraph",
    chunkOverlap = 0,
    concurrency = 4,
    minImprovement = 0.05,
    llmOptions = {},
    answers = false,
    judgeOptions = {},
    contextOptions = {},
    onProgress = () => {},
  } = options;

  const hasDocuments = Boolean(documents && documents.length);
  // Hybrid needs keyword search: the in-memory store has it, your own store needs searchText()
  const textSearch = hasDocuments || typeof config.vectorStore?.searchText === "function";
  const defaults = [
    ...DEFAULT_TECHNIQUES,
    ...(config.reranker ? ["rerank", "hybrid+rerank"] : []),
    ...(options.contextual ? ["contextual", "contextual+hybrid"] : []),
  ];
  const techniques = options.techniques ?? defaults.filter((t) => textSearch || !usesHybrid(t));
  if (options.contextual && options.techniques && !options.techniques.some(usesContextual)) {
    throw new Error('[ragforge] evaluate: `contextual` adds contextual techniques to the defaults, but `techniques` lists none. Add e.g. "contextual" or "contextual+hybrid" to techniques.');
  }

  // Validate everything before spending any API calls
  techniques.forEach(parseTechnique);
  const retrievers = Object.entries(options.retrievers ?? {});
  for (const [name, fn] of retrievers) {
    if (typeof fn !== "function") throw new Error(`[ragforge] evaluate: retriever "${name}" must be a function (query, topK) => results`);
    if (QUERY_BUILDERS[name.split("+")[0]] || techniques.includes(name)) throw new Error(`[ragforge] evaluate: retriever name "${name}" is taken by a technique; pick another name`);
  }
  const chunking = checkChunking({ strategy: chunkStrategy, size: chunkSize, overlap: chunkOverlap });
  if (!textSearch && techniques.some(usesHybrid)) {
    throw new Error("[ragforge] evaluate: hybrid techniques need keyword search. Pass `documents`, or add `searchText(text, topK)` to your vector store.");
  }
  const contextual = techniques.some(usesContextual);
  if (contextual && !hasDocuments) {
    throw new Error("[ragforge] evaluate: contextual techniques index `documents` a second time with context lines, so they need `documents`. For your own vector store, index it with rf.contextualize().");
  }
  if (contextual && config.llm.chatModel === null && !contextOptions.model) {
    throw new Error(`[ragforge] evaluate: contextual techniques need a chat model to write context lines, and the ${config.llm.name} provider has none.`);
  }
  if (!config.reranker && techniques.some(usesRerank)) {
    throw new Error('[ragforge] evaluate: rerank techniques need a reranker, e.g. createRagforge({ reranker: "cohere" })');
  }
  if (!questionStyles.length || questionStyles.some((s) => !QUESTION_STYLES[s])) {
    throw new Error(`[ragforge] evaluate: questionStyles must be some of ${Object.keys(QUESTION_STYLES).join(", ")}`);
  }
  if (answers && config.llm.chatModel === null) {
    throw new Error(`[ragforge] evaluate: answers need a chat model, and the ${config.llm.name} provider has none. Use a chat provider for llm and keep ${config.embedder.name} for embeddings.`);
  }
  if (!hasDocuments && !config.vectorStore) {
    throw new Error("[ragforge] evaluate needs `documents`, or a vectorStore on the instance plus `questions`");
  }
  const givenQuestions = options.questions && options.questions.length ? options.questions : null;
  if (!hasDocuments && !givenQuestions) {
    throw new Error("[ragforge] evaluate: pass `questions` when evaluating against your own vector store");
  }
  givenQuestions?.forEach((q) => {
    if (!q || !q.question || (q.expectedId == null && q.expectedText == null)) {
      throw new Error("[ragforge] evaluate: each question needs `question` and `expectedId` or `expectedText`");
    }
    // Your own retrievers search their own index, so chunk ids mean nothing to them: match on text.
    // (Generated questions always carry their passage, so this only concerns questions you give)
    if (retrievers.length && q.expectedText == null && typeof q.source !== "string") {
      throw new Error("[ragforge] evaluate: your own retrievers are matched on the passage text, so each question needs `expectedText`");
    }
  });

  const setupTracker = createTracker(config.pricing);
  const setupCtx = createCallContext(config, setupTracker);

  // 1. Corpus: index documents in memory, or use the instance's vector store
  let store;
  let chunks = [];
  let contextStore = null;
  let contextRun = null;
  // Context lines and their embeddings are a one-time index cost, reported apart from setup
  const contextTracker = createTracker(config.pricing);
  if (hasDocuments) {
    // Semantic chunking embeds every sentence; that usage counts toward the setup cost
    chunks = await chunkDocuments(documents, { ...chunking, concurrency: concurrency * 2, embed: (text) => setupCtx.embed(text) });
    if (!chunks.length) throw new Error("[ragforge] evaluate: documents contained no text");

    // Contextual: write the context lines first, so the estimate and budget check come before most spending
    if (contextual) {
      const contextCtx = createCallContext(config, contextTracker);
      contextRun = await contextualize(contextCtx, config, chunks, documents, {
        llmOptions,
        ...contextOptions,
        concurrency,
        onProgress,
      });
      contextStore = createMemoryVectorStore();
      let embedded = 0;
      const contextVectors = await mapLimit(contextRun.chunks, concurrency * 2, async (c) => {
        const v = await contextCtx.embed(c.indexText);
        onProgress({ phase: "context-index", done: ++embedded, total: contextRun.chunks.length });
        return v;
      });
      contextStore.add(contextRun.chunks.map((c, i) => ({ id: c.id, content: c.content, indexText: c.indexText, vector: contextVectors[i] })));
    }

    store = createMemoryVectorStore();
    let done = 0;
    const vectors = await mapLimit(chunks, concurrency * 2, async (c) => {
      const v = await setupCtx.embed(c.content);
      onProgress({ phase: "index", done: ++done, total: chunks.length });
      return v;
    });
    store.add(chunks.map((c, i) => ({ ...c, vector: vectors[i] })));
  } else {
    store = config.vectorStore;
  }

  // 2. Questions: given, or generated from the chunks
  let questions;
  if (givenQuestions) {
    questions = givenQuestions.map((q) => ({ ...q }));
  } else {
    questions = await generateQuestions(setupCtx, chunks, numQuestions, llmOptions, concurrency, onProgress, questionStyles);
  }

  // 3. Run every technique on every question
  const tasks = questions.flatMap((q, qi) => [
    ...techniques.map((technique) => ({ q, qi, technique })),
    ...retrievers.map(([name, fn]) => ({ q, qi, technique: name, external: fn })),
  ]);
  let done = 0;
  const runs = await mapLimit(tasks, concurrency, async ({ q, qi, technique, external }) => {
    if (external) {
      const run = { technique, questionIndex: qi, rank: 0, queries: [q.question], retrieved: [], external: true };
      const started = Date.now();
      try {
        const items = ((await external(q.question, topK)) ?? []).map(externalItem).slice(0, topK);
        const textQuestion = { expectedText: q.expectedText ?? openingWords(q.source) };
        run.rank = items.findIndex((item) => isMatch(item, null, textQuestion)) + 1;
        run.retrieved = items.map((item, i) => item.id ?? `#${i + 1}`);
        run.passages = items.map((item) => item.content);
      } catch (err) {
        run.error = err.message || String(err);
      }
      // What your retriever spends isn't visible to ragforge
      run.stats = { llmCalls: 0, embeddingCalls: 0, rerankCalls: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0, costUSD: null, latencyMs: Date.now() - started };
      onProgress({ phase: "run", done: ++done, total: tasks.length });
      return run;
    }
    const searched = usesContextual(technique) ? contextStore : store;
    const ctx = createCallContext({ ...config, vectorStore: searched });
    const run = { technique, questionIndex: qi, rank: 0, queries: [], retrieved: [] };
    try {
      run.queries = await buildQueries(ctx, technique, q.question, llmOptions);
      const items = new Map();
      const toKeys = (results) =>
        results.map((item) => {
          const key = resultKey(item);
          if (!items.has(key)) items.set(key, item);
          return key;
        });
      const rerank = usesRerank(technique);
      const depth = rerank ? Math.max(rerankCandidates, topK) : topK;
      const searches = run.queries.map(async (text) => toKeys(await ctx.queryVectors(await ctx.embed(text), depth)));
      if (usesHybrid(technique)) searches.push(searched.searchText(q.question, depth).then((results) => toKeys(results ?? [])));
      const lists = await Promise.all(searches);
      let ranked = (lists.length === 1 ? lists[0] : rrf(lists)).slice(0, depth);
      if (rerank) {
        const order = await ctx.rerank(q.question, ranked.map((key) => extractText(items.get(key))), topK);
        ranked = order.map((i) => ranked[i]);
      }
      ranked = ranked.slice(0, topK);
      run.rank = ranked.findIndex((key) => isMatch(items.get(key), key, q)) + 1;
      run.retrieved = ranked;
      run.passages = ranked.map((key) => extractText(items.get(key)));
    } catch (err) {
      run.error = err.message || String(err);
    }
    run.stats = ctx.tracker.snapshot();
    onProgress({ phase: "run", done: ++done, total: tasks.length });
    return run;
  });

  // 4. Answers (optional): write an answer from what each technique retrieved, then grade it.
  // Usage is tracked apart from the techniques', so cost per query stays the cost of retrieval.
  const answerTracker = createTracker(config.pricing);
  if (answers) {
    const answerCtx = createCallContext(config, answerTracker);
    // Techniques that retrieved the same passages in the same order share one answer and one
    // set of grades: fewer calls, and identical input can't get two different scores
    const jobs = new Map();
    for (const run of runs) {
      if (run.error) continue;
      const key = `${run.questionIndex}\u0000${run.retrieved.join("\u0001")}`;
      if (!jobs.has(key)) jobs.set(key, { run, shared: [] });
      jobs.get(key).shared.push(run);
    }
    let judged = 0;
    await mapLimit([...jobs.values()], concurrency, async ({ run, shared }) => {
      const q = questions[run.questionIndex];
      const result = await judgeAnswer(answerCtx, {
        question: q.question,
        passages: run.passages,
        hit: run.rank > 0,
        reference: q.expectedAnswer ?? q.source ?? q.expectedText,
        answerOptions: llmOptions,
        judgeOptions: { ...llmOptions, ...judgeOptions },
      });
      for (const r of shared) r.judged = result;
      onProgress({ phase: "answers", done: ++judged, total: jobs.size });
    });
  }

  // 5. Score
  const rows = [...techniques, ...retrievers.map(([name]) => name)].map((t) => {
    const own = runs.filter((r) => r.technique === t);
    const row = summarize(t, own);
    if (retrievers.some(([name]) => name === t)) row.external = true;
    if (answers) row.answers = summarizeAnswers(own.filter((r) => r.judged).map((r) => r.judged));
    return row;
  });
  const ranked = rankRows(rows);
  // Recommend only what auto() can run: your own retrievers are compared, not routed to
  const rankedTechniques = ranked.filter((r) => !r.external);
  const answerUsage = answerTracker.snapshot();

  return {
    topK,
    questionCount: questions.length,
    chunkCount: chunks.length || null,
    // How the documents were split; null when evaluating your own vector store
    chunking: hasDocuments ? chunking : null,
    techniques,
    provider: {
      llm: config.llm.name,
      chatModel: llmOptions.model ?? config.defaults.model ?? config.llm.chatModel,
      embeddings: config.embedder.name,
      embeddingModel: config.embedder.embeddingModel,
    },
    setup: setupTracker.snapshot(),
    ...(contextRun && {
      contextual: {
        model: contextRun.estimate.model,
        chunks: contextRun.chunks.length,
        // Chunks that got a context line (the rest are indexed as they are)
        contextualized: contextRun.chunks.filter((c) => c.context).length,
        cached: contextRun.cached,
        failed: contextRun.failed,
        estimate: contextRun.estimate,
        // Context lines plus embedding the contextual chunks: a one-time index cost
        usage: contextTracker.snapshot(),
      },
    }),
    results: rows,
    ranking: ranked.map((r) => r.technique),
    best: rankedTechniques[0].technique,
    recommendation: recommend(rankedTechniques, topK, minImprovement),
    ...(retrievers.length && { retrievers: retrievers.map(([name]) => name) }),
    ...(answers && {
      answers: {
        judgeVersion: JUDGE_VERSION,
        judgeModel: judgeOptions.model ?? llmOptions.model ?? config.defaults.model ?? config.llm.chatModel,
        // Answers written and graded; fewer than questions x techniques when techniques retrieved the same passages
        generated: new Set(runs.filter((r) => r.judged?.answer).map((r) => r.judged)).size,
        usage: answerUsage,
      },
    }),
    questions: questions.map((q, qi) => ({
      ...q,
      runs: Object.fromEntries(
        runs
          .filter((r) => r.questionIndex === qi)
          .map((r) => [
            r.technique,
            {
              rank: r.rank,
              queries: r.queries,
              retrieved: r.retrieved,
              error: r.error,
              ...(r.judged && {
                answer: r.judged.answer,
                scores: r.judged.scores,
                // What lowered a score: unsupportedClaims, missingFacts, wrongCitations
                ...(Object.keys(r.judged.findings).length && { findings: r.judged.findings }),
                ...(Object.keys(r.judged.errors).length && { judgeErrors: r.judged.errors }),
              }),
            },
          ])
      ),
    })),
  };
}

module.exports = { evaluate, matchText, DEFAULT_TECHNIQUES, DEFAULT_QUESTION_STYLES, parseTechnique, usesHybrid, usesRerank, usesContextual, addsCost, generateQuestions, recommend, rankRows };
