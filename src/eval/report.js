// Renders evaluate() results as a console table or a standalone HTML report

const pct = (x) => `${Math.round(x * 100)}%`;
const ms = (x) => (x >= 1000 ? `${(x / 1000).toFixed(1)}s` : `${x}ms`);

function usd(x) {
  if (x === null || x === undefined) return "n/a";
  if (x === 0) return "$0";
  if (x < 0.000001) return "<$0.000001";
  return x < 0.01 ? `$${x.toFixed(6)}` : `$${x.toFixed(4)}`;
}

/**
 * formatTable
 * Plain-text scoreboard for terminals
 */
function formatTable(result) {
  const { topK, provider } = result;
  const header = ["technique", `hit@${topK}`, "MRR", "latency", "cost/query", "LLM calls", "errors"];
  const rows = result.ranking.map((name) => {
    const r = result.results.find((x) => x.technique === name);
    return [
      name === result.recommendation.technique ? `${name} ★` : name,
      pct(r.hitRate),
      r.mrr.toFixed(3),
      ms(r.avgLatencyMs),
      usd(r.avgCostUSD),
      String(r.avgLlmCalls),
      r.errors ? String(r.errors) : "",
    ];
  });

  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("   ").trimEnd();

  const setupParts = [];
  if (result.chunkCount) setupParts.push(`${result.chunkCount} chunks indexed`);
  setupParts.push(`${result.questionCount} questions`);
  setupParts.push(`setup cost ${usd(result.setup.costUSD)}`);

  return [
    `ragforge eval · ${result.questionCount} questions · top ${topK} · ${provider.llm} ${provider.chatModel} / ${provider.embeddingModel}`,
    "",
    line(header),
    line(widths.map((w) => "-".repeat(w))),
    ...rows.map(line),
    "",
    `★ Recommended: ${result.recommendation.technique}. ${result.recommendation.reason}`,
    `Setup: ${setupParts.join(", ")}`,
  ].join("\n");
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * renderHtmlReport
 * Single self-contained HTML file (no external assets), light and dark mode
 */
function renderHtmlReport(result, { title = "ragforge eval report" } = {}) {
  const { topK, provider, recommendation } = result;
  const ordered = result.ranking.map((name) => result.results.find((r) => r.technique === name));

  const tableRows = ordered
    .map((r) => {
      const rec = r.technique === recommendation.technique;
      return `<tr${rec ? ' class="rec"' : ""}>
  <th scope="row">${esc(r.technique)}${rec ? ' <span class="badge">recommended</span>' : ""}</th>
  <td><div class="bar"><span style="width:${(r.hitRate * 100).toFixed(1)}%"></span></div><b>${pct(r.hitRate)}</b></td>
  <td>${r.mrr.toFixed(3)}</td>
  <td>${ms(r.avgLatencyMs)}</td>
  <td>${usd(r.avgCostUSD)}</td>
  <td>${r.avgLlmCalls}</td>
  <td>${r.errors || ""}</td>
</tr>`;
    })
    .join("\n");

  const questionRows = result.questions
    .map((q, i) => {
      const cells = result.ranking
        .map((t) => {
          const run = q.runs[t];
          if (!run) return "";
          if (run.error) return `<li class="err" title="${esc(run.error)}">${esc(t)}: error</li>`;
          return run.rank
            ? `<li class="hit">${esc(t)}: #${run.rank}</li>`
            : `<li class="miss">${esc(t)}: miss</li>`;
        })
        .join("");
      const expected = q.expectedId != null ? `expected chunk <code>${esc(q.expectedId)}</code>` : `expected text “${esc(q.expectedText)}”`;
      return `<details>
  <summary><span class="qn">${i + 1}</span> ${esc(q.question)}</summary>
  <ul class="runs">${cells}</ul>
  <p class="muted">${expected}</p>
  ${q.source ? `<blockquote>${esc(q.source)}</blockquote>` : ""}
</details>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root {
  --bg: #fafaf9; --surface: #ffffff; --text: #1c1917; --muted: #78716c; --border: #e7e5e4;
  --accent: #4f46e5; --accent-soft: #eef2ff; --hit: #15803d; --miss: #b91c1c; --bar: #e7e5e4;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0c0a09; --surface: #1c1917; --text: #f5f5f4; --muted: #a8a29e; --border: #292524;
    --accent: #818cf8; --accent-soft: #1e1b4b; --hit: #4ade80; --miss: #f87171; --bar: #292524;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 1.6rem; margin: 0 0 4px; }
h2 { font-size: 1.1rem; margin: 40px 0 12px; }
.muted { color: var(--muted); }
.callout { margin: 24px 0; padding: 16px 20px; border-radius: 12px; background: var(--accent-soft); border: 1px solid var(--border); }
.callout strong { color: var(--accent); font-size: 1.15rem; }
.meta { display: flex; flex-wrap: wrap; gap: 8px 24px; margin-top: 8px; color: var(--muted); font-size: .9rem; }
.table-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
thead th { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
tbody tr:last-child > * { border-bottom: 0; }
tr.rec { background: var(--accent-soft); }
.badge { font-size: .7rem; font-weight: 600; color: var(--accent); border: 1px solid var(--accent); border-radius: 999px; padding: 1px 8px; margin-left: 6px; }
td .bar { display: inline-block; width: 120px; height: 8px; border-radius: 4px; background: var(--bar); margin-right: 10px; vertical-align: middle; overflow: hidden; }
td .bar span { display: block; height: 100%; background: var(--accent); }
@media (max-width: 600px) { td .bar { width: 48px; } th, td { padding: 8px 10px; } }
details { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; margin-bottom: 8px; }
summary { cursor: pointer; }
.qn { display: inline-block; min-width: 1.8em; color: var(--muted); font-variant-numeric: tabular-nums; }
.runs { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; padding: 0; margin: 10px 0 4px; }
.runs li { font-size: .85rem; padding: 2px 10px; border-radius: 999px; border: 1px solid var(--border); }
.runs .hit { color: var(--hit); } .runs .miss, .runs .err { color: var(--miss); }
blockquote { margin: 8px 0 0; padding: 8px 12px; border-left: 3px solid var(--border); color: var(--muted); font-size: .9rem; }
code { font-size: .85em; }
</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
<p class="muted">How often each query technique retrieved the right chunk in the top ${topK} results.</p>

<div class="callout">
  Recommended: <strong>${esc(recommendation.technique)}</strong>
  <div>${esc(recommendation.reason)}</div>
  <div class="meta">
    <span>${result.questionCount} questions</span>
    ${result.chunkCount ? `<span>${result.chunkCount} chunks</span>` : ""}
    <span>LLM: ${esc(provider.llm)} ${esc(provider.chatModel)}</span>
    <span>Embeddings: ${esc(provider.embeddingModel)}</span>
    <span>Setup cost: ${usd(result.setup.costUSD)}</span>
  </div>
</div>

<div class="table-wrap">
<table>
<thead><tr><th>Technique</th><th>Hit@${topK}</th><th>MRR</th><th>Latency</th><th>Cost / query</th><th>LLM calls</th><th>Errors</th></tr></thead>
<tbody>
${tableRows}
</tbody>
</table>
</div>
<p class="muted">Hit@${topK}: share of questions whose source chunk was retrieved. MRR: mean of 1/rank of that chunk (higher is better). Cost and latency are averages per question.</p>

<h2>Questions</h2>
${questionRows}

<p class="muted">Generated by ragforge.</p>
</main>
</body>
</html>
`;
}

module.exports = { formatTable, renderHtmlReport };
