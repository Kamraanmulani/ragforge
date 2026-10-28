// Sorts queries into categories that tend to favour different techniques

const CATEGORIES = ["comparison", "exact", "short", "conceptual", "simple"];

// Default technique per category (overridable with `rules`)
const DEFAULT_RULES = {
  comparison: "fanout", // several things to look up: one search per part
  exact: "baseline", // rewriting could drop the exact term being searched for
  short: "hyde", // few words to match on: a hypothetical answer adds context
  conceptual: "stepback", // needs background principles, not just the specific fact
  simple: "baseline", // clear question: extra LLM calls rarely pay off
};

const REASONS = {
  comparison: "compares things or asks several questions, so each part gets its own search",
  exact: "contains an exact term (code, number, identifier or quote) that rewriting could lose",
  short: "is short, so a hypothetical answer gives the search more to match on",
  conceptual: "is a specific why/how question that benefits from broader background",
  simple: "is clear and self-contained, so plain search is usually enough",
};

const STOPWORDS = new Set(
  "a an the is are was were be been being am do does did of to in on at for with by from about as into than then that this these those it its i me my we our you your he she they them their what which who whom whose when where why how can could should would will shall may might must has have had not no or and but if so there here please tell give show explain describe".split(" ")
);

const COMPARISON = /\b(vs\.?|versus|compare[ds]?|comparing|comparison|difference(s)? between|differ(s)? from|pros and cons|advantages and disadvantages|better than|worse than|which is better)\b/i;
const MULTI_QUESTION = /\b(what|how|why|when|where|which|who)\b[^?]*\band\b[^?]*\b(what|how|why|when|where|which|who)\b/i;

const EXACT_PATTERNS = [
  /["“`][^"”`]{2,}["”`]/, // quoted phrase
  /\b[A-Za-z]*\d+[A-Za-z0-9._-]*\b/, // token with a digit: E404, v2.1, 2024, ISO9001
  /\b[a-z0-9]+_[a-z0-9_]+\b/i, // snake_case
  /\b[a-z]+[A-Z][A-Za-z0-9]*\b/, // camelCase
  /\b[\w-]+\.(js|ts|py|json|md|ya?ml|java|go|rs|cpp|c|h|html|css|sql|sh|toml|xml|csv)\b/i, // file names
];

// "How do I/we/you ..." asks for steps, not principles, so it is excluded
const CONCEPTUAL_START = /^\s*(why\b|how (does|did|can|could|would|is|are)\b|how do (?!(i|we|you)\b))/i;
const CONCEPTUAL_WORDS = /\b(explain|principle|concept|reason|cause[sd]?|mechanism|underlying|theory|affect|effect|impact)\b/i;

/**
 * classifyQuery
 * Cheap, deterministic, no LLM call.
 * @returns {{ category: string, reason: string }}
 */
function classifyQuery(query) {
  const q = String(query ?? "").trim();
  const words = q.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const contentWords = words.filter((w) => !STOPWORDS.has(w));
  const questionMarks = (q.match(/\?/g) ?? []).length;

  let category = "simple";
  if (COMPARISON.test(q) || questionMarks > 1 || MULTI_QUESTION.test(q)) category = "comparison";
  else if (EXACT_PATTERNS.some((re) => re.test(q))) category = "exact";
  else if (contentWords.length <= 3) category = "short";
  else if ((CONCEPTUAL_START.test(q) || CONCEPTUAL_WORDS.test(q)) && words.length >= 8) category = "conceptual";

  return { category, reason: `The query ${REASONS[category]}.` };
}

module.exports = { classifyQuery, CATEGORIES, DEFAULT_RULES, REASONS };
