// Compares two evaluate() results, so CI can fail when retrieval or answer quality drops
const { answerHeaders, answerCells, answerNote } = require("./report");

const pct = (x) => `${Math.round(x * 100)}%`;
const ms = (x) => (x >= 1000 ? `${(x / 1000).toFixed(1)}s` : `${x}ms`);

function usd(x) {
  if (x === null || x === undefined) return "n/a";
  if (x === 0) return "$0";
  if (x < 0.000001) return "<$0.000001";
  return x < 0.01 ? `$${x.toFixed(6)}` : `$${x.toFixed(4)}`;
}

function assertEvalResult(value, label) {
  const ok =
    value &&
    Array.isArray(value.results) &&
    value.results.length > 0 &&
    value.results.every((r) => r && typeof r.technique === "string" && typeof r.hitRate === "number");
  if (!ok) {
    throw new Error(`[ragforge] compareEvals: ${label} is not an eval result. Use the file written by \`ragforge eval --json\`, or the object returned by evaluate().`);
  }
}

function pair(before, after, digits) {
  const has = (x) => x !== null && x !== undefined;
  return {
    before: has(before) ? before : null,
    after: has(after) ? after : null,
    delta: has(before) && has(after) ? Number((after - before).toFixed(digits)) : null,
  };
}

// The same questions asked in both runs, whatever their order
function sameQuestions(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  const texts = (list) => list.map((q) => String(q?.question ?? "").trim().toLowerCase()).sort();
  const left = texts(a);
  const right = texts(b);
  return left.length === right.length && left.every((t, i) => t === right[i]);
}

/**
 * compareEvals
 * Lines up the techniques of two eval results and reports what changed.
 * With `failOnDrop`, a technique whose hit rate fell by more than that many
 * points is a regression, and `passed` is false. When both runs have answer
 * scores, the same limit applies to faithfulness.
 *
 * @param {object} baseline - Earlier eval result (e.g. from the main branch)
 * @param {object} current - New eval result
 * @param {object} [options]
 * @param {number} [options.failOnDrop] - Allowed hit-rate drop in points (0-100). Omit to only report
 * @returns {{ topK, failOnDrop, answers, rows, regressions, passed, warnings }}
 */
function compareEvals(baseline, current, options = {}) {
  assertEvalResult(baseline, "the baseline");
  assertEvalResult(current, "the current result");

  const failOnDrop = options.failOnDrop ?? null;
  if (failOnDrop !== null && (typeof failOnDrop !== "number" || !Number.isFinite(failOnDrop) || failOnDrop < 0)) {
    throw new Error("[ragforge] compareEvals: failOnDrop must be a number of points, 0 or more");
  }

  const before = new Map(baseline.results.map((r) => [r.technique, r]));
  const after = new Map(current.results.map((r) => [r.technique, r]));
  // Current ranking first, then techniques that are no longer run
  const order = [...(current.ranking ?? current.results.map((r) => r.technique))];
  for (const name of before.keys()) if (!after.has(name)) order.push(name);

  const rows = order.map((technique) => {
    const b = before.get(technique);
    const a = after.get(technique);
    const hitRate = pair(b?.hitRate, a?.hitRate, 3);
    const faithfulness = pair(b?.answers?.faithfulness, a?.answers?.faithfulness, 3);
    // Points lost (positive = worse)
    const drop = lostPoints(hitRate);
    const regressedOn = [];
    if (failOnDrop !== null && drop > failOnDrop) regressedOn.push("hitRate");
    if (failOnDrop !== null && lostPoints(faithfulness) > failOnDrop) regressedOn.push("faithfulness");

    let status;
    if (!b) status = "new";
    else if (!a) status = "removed";
    else if (regressedOn.length) status = "regressed";
    else if (drop > 0) status = "down";
    else if (drop < 0) status = "up";
    else status = "same";

    return {
      technique,
      status,
      regressedOn,
      hitRate,
      mrr: pair(b?.mrr, a?.mrr, 3),
      faithfulness,
      avgLatencyMs: pair(b?.avgLatencyMs, a?.avgLatencyMs, 0),
      avgCostUSD: pair(b?.avgCostUSD, a?.avgCostUSD, 8),
    };
  });

  const warnings = [];
  if (baseline.topK !== current.topK) {
    warnings.push(`top-k differs (${baseline.topK} in the baseline, ${current.topK} now), so the hit rates are not comparable.`);
  }
  const same = sameQuestions(baseline.questions, current.questions);
  if (same === false || (same === null && baseline.questionCount !== current.questionCount)) {
    warnings.push(
      `The two runs used different questions (${baseline.questionCount} in the baseline, ${current.questionCount} now). Use the same --questions-file for both, or the scores will move for reasons other than retrieval.`
    );
  }
  const model = (r) => r.provider?.embeddingModel;
  if (model(baseline) && model(current) && model(baseline) !== model(current)) {
    warnings.push(`The embedding model changed (${model(baseline)} in the baseline, ${model(current)} now).`);
  }
  const judged = (r) => Boolean(r.answers) || r.results.some((row) => row.answers);
  if (judged(baseline) !== judged(current)) {
    warnings.push(`Only ${judged(current) ? "the current run" : "the baseline"} has answer scores, so faithfulness was not compared. Run both with --answers.`);
  } else if (baseline.answers && current.answers) {
    const judge = (r) => `${r.answers.judgeModel} (judge v${r.answers.judgeVersion})`;
    if (judge(baseline) !== judge(current)) {
      warnings.push(`The answers were graded by different judges (${judge(baseline)} in the baseline, ${judge(current)} now), so the answer scores are not comparable.`);
    }
  }
  if (!rows.some((r) => r.hitRate.delta !== null)) {
    warnings.push("The two runs share no technique, so nothing was compared.");
  }

  const regressions = rows.filter((r) => r.status === "regressed").map((r) => r.technique);
  return {
    topK: current.topK,
    failOnDrop,
    // Whether faithfulness was compared for at least one technique
    answers: rows.some((r) => r.faithfulness.delta !== null),
    rows,
    regressions,
    passed: regressions.length === 0,
    warnings,
  };
}

// Points a score fell by: 0.8 to 0.7 is 10. Never negative zero
const lostPoints = ({ delta }) => (delta === null ? 0 : Math.round(-delta * 1000) / 10 || 0);

const points = (delta) => {
  if (delta === null) return "";
  const p = Math.round(delta * 1000) / 10;
  return p > 0 ? `+${p}` : String(p);
};
const signed = (delta, digits) => (delta === null ? "" : `${delta > 0 ? "+" : ""}${delta.toFixed(digits)}`);

// "80% → 70%", or a single value for a technique in only one of the runs
function change({ before, after }, format) {
  if (before === null && after === null) return "n/a";
  if (before === null) return format(after);
  if (after === null) return format(before);
  return `${format(before)} → ${format(after)}`;
}

const STATUS_TEXT = { regressed: "✗ regressed", down: "down", up: "up", same: "", new: "new", removed: "removed" };

function cells(row, diff) {
  return [
    row.technique,
    change(row.hitRate, pct),
    points(row.hitRate.delta),
    change(row.mrr, (x) => x.toFixed(3)),
    signed(row.mrr.delta, 3),
    ...(diff.answers ? [change(row.faithfulness, pct), points(row.faithfulness.delta)] : []),
    change(row.avgLatencyMs, ms),
    change(row.avgCostUSD, usd),
    STATUS_TEXT[row.status],
  ];
}

function headerCells(diff) {
  return ["technique", `hit@${diff.topK}`, "Δ pts", "MRR", "Δ", ...(diff.answers ? ["faithful", "Δ pts"] : []), "latency", "cost/query", ""];
}

// One sentence on the outcome, or null when nothing was gated
function verdict(diff) {
  if (diff.failOnDrop === null) return null;
  const names = { hitRate: `hit@${diff.topK}`, faithfulness: "faithfulness" };
  if (diff.passed) {
    return `✓ No regression: no technique lost more than ${diff.failOnDrop} points of ${names.hitRate}${diff.answers ? " or faithfulness" : ""}.`;
  }
  const worst = diff.rows.flatMap((r) => r.regressedOn.map((metric) => `${r.technique} lost ${lostPoints(r[metric])} points of ${names[metric]}`));
  return `✗ Regression: ${worst.join(", ")} (allowed: ${diff.failOnDrop}).`;
}

/**
 * formatComparison
 * Plain-text diff of two eval results for terminals and CI logs
 * @param {object} diff - From compareEvals
 * @param {object} [options]
 * @param {string} [options.baselineName="baseline"] - What to call the earlier run
 */
function formatComparison(diff, { baselineName = "baseline" } = {}) {
  const header = headerCells(diff);
  const rows = diff.rows.map((row) => cells(row, diff));
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (c) => c.map((cell, i) => cell.padEnd(widths[i])).join("   ").trimEnd();

  const out = [`Compared with ${baselineName}`, "", line(header), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)];
  const summary = verdict(diff);
  if (summary) out.push("", summary);
  if (diff.warnings.length) out.push("", ...diff.warnings.map((w) => `Warning: ${w}`));
  return out.join("\n");
}

const mdCell = (text) => String(text).replace(/\|/g, "\\|");

/**
 * renderMarkdownReport
 * Scoreboard as Markdown, for pull request comments and CI job summaries.
 * With `comparison`, each score is shown next to the baseline's.
 * @param {object} result - From evaluate()
 * @param {object} [options]
 * @param {object} [options.comparison] - From compareEvals(baseline, result)
 * @param {string} [options.baselineName="baseline"]
 * @param {string} [options.title="ragforge eval"]
 */
function renderMarkdownReport(result, { comparison, baselineName = "baseline", title = "ragforge eval" } = {}) {
  const { topK, provider } = result;
  const out = [`## ${title}`, ""];
  const table = (header, rows, align) => {
    out.push(`| ${header.map(mdCell).join(" | ")} |`, `| ${align.join(" | ")} |`, ...rows.map((r) => `| ${r.map(mdCell).join(" | ")} |`));
  };
  const star = (name) => (name === result.recommendation?.technique ? `${name} ★` : name);

  if (comparison) {
    const summary = verdict(comparison);
    if (summary) out.push(`**${summary}**`, "");
    out.push(`Compared with ${baselineName}.`, "");
    const rows = comparison.rows.map((row) => {
      const c = cells(row, comparison);
      c[0] = star(c[0]);
      return c;
    });
    const header = headerCells(comparison);
    header[header.length - 1] = "result";
    table(header, rows, header.map((_, i) => (i === 0 || i === header.length - 1 ? "---" : "---:")));
  } else {
    const rows = result.ranking.map((name) => {
      const r = result.results.find((x) => x.technique === name);
      return [star(name), pct(r.hitRate), r.mrr.toFixed(3), ...answerCells(result, r), ms(r.avgLatencyMs), usd(r.avgCostUSD), String(r.avgLlmCalls), r.errors ? String(r.errors) : ""];
    });
    const header = ["technique", `hit@${topK}`, "MRR", ...answerHeaders(result), "latency", "cost/query", "LLM calls", "errors"];
    table(header, rows, header.map((_, i) => (i === 0 ? "---" : "---:")));
  }

  out.push("");
  if (result.recommendation) out.push(`★ Recommended: **${result.recommendation.technique}**. ${result.recommendation.reason}`, "");
  const models = provider ? ` · ${provider.llm} ${provider.chatModel} / ${provider.embeddingModel}` : "";
  out.push(`${result.questionCount} questions · top ${topK}${models}`);
  if (result.answers) out.push("", answerNote(result));
  for (const w of comparison?.warnings ?? []) out.push("", `> ⚠ ${w}`);
  return `${out.join("\n")}\n`;
}

module.exports = { compareEvals, formatComparison, renderMarkdownReport };
