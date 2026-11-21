// LLM-judge metrics for answer quality: an answer is written from the retrieved
// passages with the pipeline's own prompt, then graded.
//
// The prompts below are fixed so scores stay comparable between runs. Any change
// to their wording or to the scoring must bump JUDGE_VERSION.
const { sanitizeText } = require("../core/utils");
const { answerPrompt } = require("../pipeline/ragPipeline");

const JUDGE_VERSION = 1;
const ANSWER_METRICS = ["faithfulness", "answerRelevance", "contextRecall", "citationAccuracy"];

const numbered = (passages) => (passages.length ? passages.map((p, i) => `[${i + 1}] ${p}`).join("\n\n") : "(none)");

// Every "yes" verdict has to come with the passage words that back it. Asked for a bare
// true/false, a judge model waves almost everything through; the quote is checked in code.
const PROMPTS = {
  faithfulness: ({ passages, answer }) => `You are a strict grader checking whether an answer is supported by the passages it was written from.

Passages:
${numbered(passages)}

Answer:
${answer}

List every factual claim the answer makes, one claim per item. For each claim give:
- "quote": the exact words, copied from a passage, that state the claim. Use null when no passage states it.
- "supported": true when the quote says what the claim says, in the same or other words. false when the claim adds facts the quote does not contain, or rests on general knowledge, even when it is true in the real world.

Skip sentences that only say information is missing or uncertain.

Return only JSON in this shape:
{"claims":[{"claim":"...","quote":"exact words from a passage","supported":true},{"claim":"...","quote":null,"supported":false}]}
Return {"claims":[]} when the answer makes no factual claims.`,

  answerRelevance: ({ question, answer }) => `You are grading whether an answer addresses the question that was asked. Judge relevance only, not whether the answer is correct.

Question:
${question}

Answer:
${answer}

Scores:
2 = answers the question directly and completely
1 = answers only part of it, or buries the answer in unrelated material
0 = does not answer it: off-topic, or says it cannot answer

Return only JSON in this shape: {"score":2}`,

  contextRecall: ({ question, reference, passages }) => `You are a strict grader checking whether retrieved passages contain the information needed to answer a question.

Question:
${question}

Reference (known to contain the answer):
${reference}

Retrieved passages:
${numbered(passages)}

List the facts from the reference that are needed to answer the question, at most 5. For each fact give:
- "quote": the exact words, copied from a retrieved passage, that state the fact. The reference does not count. Use null when no retrieved passage states it.
- "found": true when the quote says what the fact says, in the same or other words.

Return only JSON in this shape:
{"facts":[{"fact":"...","quote":"exact words from a retrieved passage","found":true},{"fact":"...","quote":null,"found":false}]}`,

  citationAccuracy: ({ passages, answer }) => `You are a strict grader checking the citations in an answer. The answer cites passages by number in square brackets, like [1].

Passages:
${numbered(passages)}

Answer:
${answer}

List every citation in the answer. A statement followed by [1][2] has two citations. For each citation give:
- "statement": the statement the citation is attached to.
- "passage": the number of the cited passage.
- "quote": the exact words, copied from that passage, that support the statement. Use null when that passage does not support it.
- "supported": true when the quote backs the statement. false when the statement says more than the quote does.

Return only JSON in this shape:
{"citations":[{"statement":"...","passage":1,"quote":"exact words from passage 1","supported":true},{"statement":"...","passage":2,"quote":null,"supported":false}]}`,
};

/**
 * parseJudgeJson
 * Reads the first JSON object in the reply. Models wrap JSON in prose or code
 * fences, and sometimes add text after it.
 */
function parseJudgeJson(text) {
  const s = String(text ?? "");
  const start = s.indexOf("{");
  if (start === -1) throw new Error("the judge did not return JSON");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error("the judge's JSON was cut off");
}

// Letters and digits only, so a quote still matches when the judge drops Markdown or changes spacing
const plain = (text) => String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * isQuoted
 * Whether `quote` really appears in one of the passages. An ellipsis joins
 * fragments, and each one has to be there.
 */
function isQuoted(quote, passages) {
  if (typeof quote !== "string") return false;
  const parts = quote.split(/\.{3,}|…/).map(plain).filter(Boolean);
  if (parts.join("").length < 4) return false;
  const haystacks = passages.map(plain);
  return parts.every((part) => haystacks.some((h) => h.includes(part)));
}

const yes = (value) => value === true || /^(true|yes)$/i.test(String(value).trim());
const list = (value, name) => {
  if (!Array.isArray(value)) throw new Error(`the judge returned no "${name}" list`);
  return value;
};
// A verdict only counts with a quote that is really in the passages
const backed = (item, verdict, passages) => yes(item?.[verdict]) && isQuoted(item.quote, passages);

// Turns each judge's JSON into a score from 0 to 1 (null when there is nothing to score)
// and the items that failed, so a low score can be traced to what caused it
const SCORERS = {
  // An answer with no claims (such as "the passages don't say") states nothing unsupported
  faithfulness(json, { passages }) {
    const claims = list(json.claims, "claims");
    const failed = claims.filter((c) => !backed(c, "supported", passages));
    return { score: claims.length ? 1 - failed.length / claims.length : 1, count: claims.length, failed: failed.map((c) => String(c?.claim ?? "")) };
  },
  answerRelevance(json) {
    const score = Number(json.score);
    if (![0, 1, 2].includes(score)) throw new Error("the judge returned no score of 0, 1 or 2");
    return { score: score / 2 };
  },
  contextRecall(json, { passages }) {
    const facts = list(json.facts, "facts");
    const failed = facts.filter((f) => !backed(f, "found", passages));
    return { score: facts.length ? 1 - failed.length / facts.length : null, failed: failed.map((f) => String(f?.fact ?? "")) };
  },
  // The quote has to come from the cited passage itself. A passage number that doesn't exist is wrong
  citationAccuracy(json, { passages }) {
    const citations = list(json.citations, "citations");
    const cited = (c) => {
      const n = Number(c?.passage);
      return Number.isInteger(n) && n >= 1 && n <= passages.length ? [passages[n - 1]] : [];
    };
    const failed = citations.filter((c) => !backed(c, "supported", cited(c)));
    return { score: citations.length ? 1 - failed.length / citations.length : null, failed: failed.map((c) => `[${c?.passage}] ${c?.statement ?? ""}`) };
  },
};

const FAILED_AS = { faithfulness: "unsupportedClaims", contextRecall: "missingFacts", citationAccuracy: "wrongCitations" };
const HAS_CITATION = /\[\d+(?:\s*[,–-]\s*\d+)*\]/;

/**
 * judgeAnswer
 * Writes an answer from the retrieved passages and grades it.
 *
 * - faithfulness: share of the answer's claims that the passages support
 * - answerRelevance: does the answer address the question (0, 0.5 or 1)
 * - contextRecall: share of the facts needed for the answer that were retrieved.
 *   1 when the expected passage was retrieved; otherwise judged against the
 *   reference text, or 0 when there is no reference to judge against
 * - citationAccuracy: share of the answer's [n] citations whose passage supports
 *   the cited statement. 0 for an answer with claims and no citations
 *
 * The judge must quote the passage for every claim, fact or citation it accepts,
 * and a quote that isn't in the passages doesn't count.
 * A metric is null when it could not be scored; `errors` says why.
 *
 * @param {object} ctx - Call context; its tracker collects the answer and judge usage
 * @param {object} input
 * @param {string} input.question
 * @param {string[]} input.passages - Retrieved passages, in rank order
 * @param {boolean} input.hit - Whether the expected passage was retrieved
 * @param {string} [input.reference] - Text known to contain the answer
 * @param {object} [input.answerOptions] - LLM options for writing the answer
 * @param {object} [input.judgeOptions] - LLM options for the judge
 * @returns {Promise<{ answer: string|null, scores: object, findings: object, errors: object }>}
 *   `findings` lists what lowered a score: unsupportedClaims, missingFacts, wrongCitations
 */
async function judgeAnswer(ctx, { question, passages, hit, reference, answerOptions = {}, judgeOptions = {} }) {
  const scores = Object.fromEntries(ANSWER_METRICS.map((m) => [m, null]));
  const findings = {};
  const errors = {};

  let answer;
  try {
    answer = sanitizeText(await ctx.chat(answerPrompt(question, passages), answerOptions));
    if (!answer) throw new Error("the model returned an empty answer");
  } catch (err) {
    errors.answer = err.message || String(err);
    return { answer: null, scores, findings, errors };
  }

  const details = {};
  const grade = async (metric, input) => {
    try {
      const text = await ctx.chat(PROMPTS[metric](input), { temperature: 0, max_tokens: 1500, ...judgeOptions });
      details[metric] = SCORERS[metric](parseJudgeJson(text), input);
      scores[metric] = details[metric].score;
      if (details[metric].failed?.length) findings[FAILED_AS[metric]] = details[metric].failed;
    } catch (err) {
      errors[metric] = err.message || String(err);
    }
  };

  const cites = HAS_CITATION.test(answer);
  const jobs = [grade("faithfulness", { passages, answer }), grade("answerRelevance", { question, answer })];
  if (cites) jobs.push(grade("citationAccuracy", { passages, answer }));
  if (hit) scores.contextRecall = 1;
  else if (reference) jobs.push(grade("contextRecall", { question, reference, passages }));
  else scores.contextRecall = 0;
  await Promise.all(jobs);

  // Asked to cite and didn't: wrong for an answer that makes claims, not applicable otherwise
  if (!cites && details.faithfulness) scores.citationAccuracy = details.faithfulness.count > 0 ? 0 : null;

  for (const metric of ANSWER_METRICS) if (scores[metric] !== null) scores[metric] = Number(scores[metric].toFixed(3));
  return { answer, scores, findings, errors };
}

/**
 * summarizeAnswers
 * Mean of each metric over the runs that have a score, with the half-width of
 * its 95% confidence interval across questions (null with fewer than 2 scores).
 * @param {Array<{ scores?: object, errors?: object }>} judged - One entry per question
 */
function summarizeAnswers(judged) {
  const summary = { ci: {}, judged: judged.filter((j) => j.answer).length, errors: judged.filter((j) => Object.keys(j.errors ?? {}).length).length };
  for (const metric of ANSWER_METRICS) {
    const values = judged.map((j) => j.scores?.[metric]).filter((v) => typeof v === "number");
    const n = values.length;
    const mean = n ? values.reduce((a, b) => a + b, 0) / n : null;
    summary[metric] = mean === null ? null : Number(mean.toFixed(3));
    if (n < 2) {
      summary.ci[metric] = null;
      continue;
    }
    const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1);
    summary.ci[metric] = Number((1.96 * Math.sqrt(variance / n)).toFixed(3));
  }
  return summary;
}

module.exports = { judgeAnswer, summarizeAnswers, parseJudgeJson, isQuoted, JUDGE_VERSION, ANSWER_METRICS, JUDGE_PROMPTS: PROMPTS };
