// Renders tune() results: a terminal summary, and an HTML page with the cost/quality chart
const { usd, esc, pct, ms } = require("../eval/report");

const byId = (result) => new Map(result.trials.map((t) => [t.id, t]));
const label = (t) => `${t.setupId} · ${t.technique}`;

function rankTrials(trials) {
  const cost = (t) => (t.avgCostUSD === null ? Infinity : t.avgCostUSD);
  return [...trials].sort((a, b) => b.hitRate - a.hitRate || b.mrr - a.mrr || cost(a) - cost(b));
}

/**
 * formatTuneTable
 * The best trials, the winner and what it changes from the default setup
 * @param {object} result - From tune()
 * @param {object} [options]
 * @param {number} [options.rows=12] - Trials listed
 */
function formatTuneTable(result, { rows = 12 } = {}) {
  const trials = byId(result);
  const best = trials.get(result.best);
  const def = result.default ? trials.get(result.default) : null;
  const pareto = new Set(result.pareto);
  const ranked = rankTrials(result.trials);
  const shown = ranked.slice(0, rows);
  for (const id of [result.best, result.default]) if (id && !shown.some((t) => t.id === id)) shown.push(trials.get(id));

  const header = ["setup (strategy/size/embedding model)", "technique", `hit@${result.topK}`, "MRR", "chars/chunk", "cost/query", "index cost", "latency", ""];
  const tableRows = shown.map((t) => [
    t.setupId,
    t.technique,
    pct(t.hitRate),
    t.mrr.toFixed(3),
    String(t.avgChunkChars ?? ""),
    usd(t.avgCostUSD),
    usd(t.indexCostUSD),
    ms(t.avgLatencyMs),
    [t.id === result.best ? "★ best" : "", t.id === result.default ? "default" : "", pareto.has(t.id) ? "pareto" : "", t.errors ? `${t.errors} errors` : ""].filter(Boolean).join(", "),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...tableRows.map((r) => r[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("   ").trimEnd();

  const setups = new Set(result.trials.map((t) => t.setupId)).size;
  const out = [
    `ragforge tune · ${result.questionCount} questions · ${setups} setups · ${result.trials.length} trials · top ${result.topK} · ${result.provider.llm} ${result.provider.chatModel ?? ""}`.trimEnd(),
    "",
    line(header),
    line(widths.map((w) => "-".repeat(w))),
    ...tableRows.map(line),
  ];
  if (ranked.length > shown.length) out.push(`(${ranked.length - shown.length} more trials in --json and --html)`);
  out.push("", `★ Best: ${label(best)}`, `  ${result.reason}`);
  if (def && best.id !== def.id) {
    const changes = [];
    if (best.setup.chunkStrategy !== def.setup.chunkStrategy) changes.push(`chunking ${def.setup.chunkStrategy} → ${best.setup.chunkStrategy}`);
    if (best.setup.chunkSize !== def.setup.chunkSize) changes.push(`chunk size ${def.setup.chunkSize} → ${best.setup.chunkSize}`);
    if (best.setup.embeddingModel !== def.setup.embeddingModel) changes.push(`embeddings ${def.setup.embeddingModel} → ${best.setup.embeddingModel}`);
    if (best.technique !== def.technique) changes.push(`technique ${def.technique} → ${best.technique}`);
    const points = Math.round((best.hitRate - def.hitRate) * 100);
    out.push(`  Changes from the default: ${changes.join(", ")}. hit@${result.topK} ${pct(def.hitRate)} → ${pct(best.hitRate)} (${points >= 0 ? "+" : ""}${points} points).`);
  }
  const spent = result.spent.costUSD;
  out.push(`Spent ${usd(spent)}${result.budgetUSD !== null ? ` of a $${result.budgetUSD} budget` : ""} (estimated ${usd(result.plan.estimate.total)}).`);
  if (result.stopped) out.push(`Stopped early: ${result.stopped}`);
  for (const w of result.warnings) out.push(`Note: ${w}`);
  return out.join("\n");
}

// Log scale for cost per query: free techniques sit near the left edge
function scaleCost(trials, width) {
  const costs = trials.map((t) => t.avgCostUSD).filter((c) => typeof c === "number" && c > 0);
  const floor = costs.length ? Math.min(...costs) / 2 : 1e-7;
  const lo = Math.log10(floor);
  const hi = Math.log10(Math.max(floor * 10, ...costs) * 1.5);
  return { x: (c) => ((Math.log10(Math.max(c ?? floor, floor)) - lo) / (hi - lo)) * width, lo, hi };
}

/**
 * paretoChart
 * SVG scatter: cost per query (log) against hit rate. The Pareto front is joined,
 * the winner is a star, the default setup a ring. Hover a point for its trial.
 */
function paretoChart(result) {
  const W = 640;
  const H = 320;
  const pad = { l: 52, r: 16, t: 16, b: 44 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const trials = result.trials.filter((t) => t.avgCostUSD !== null);
  const { x, lo, hi } = scaleCost(trials, iw);
  const y = (hit) => ih - hit * ih;
  const front = new Set(result.pareto);
  const ticks = [];
  for (let e = Math.ceil(lo); e <= Math.floor(hi); e++) ticks.push(e);

  const points = trials
    .map((t) => {
      const cx = (pad.l + x(t.avgCostUSD)).toFixed(1);
      const cy = (pad.t + y(t.hitRate)).toFixed(1);
      const title = `<title>${esc(label(t))}: hit ${pct(t.hitRate)}, MRR ${t.mrr.toFixed(3)}, ${usd(t.avgCostUSD)}/query</title>`;
      if (t.id === result.best) return `<g class="best"><path d="M${cx} ${Number(cy) - 9} l2.6 6.2 6.8.5-5.2 4.4 1.7 6.6-5.9-3.6-5.9 3.6 1.7-6.6-5.2-4.4 6.8-.5z"/>${title}</g>`;
      const cls = [front.has(t.id) ? "front" : "pt", t.id === result.default ? "default" : ""].join(" ").trim();
      return `<circle class="${cls}" cx="${cx}" cy="${cy}" r="${t.id === result.default ? 6 : 4}">${title}</circle>`;
    })
    .join("\n");
  const frontPath = trials
    .filter((t) => front.has(t.id))
    .sort((a, b) => a.avgCostUSD - b.avgCostUSD)
    .map((t, i) => `${i ? "L" : "M"}${(pad.l + x(t.avgCostUSD)).toFixed(1)} ${(pad.t + y(t.hitRate)).toFixed(1)}`)
    .join(" ");
  const yTicks = [0, 0.25, 0.5, 0.75, 1]
    .map((v) => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + y(v)}" y2="${pad.t + y(v)}"/><text x="${pad.l - 8}" y="${pad.t + y(v) + 4}" text-anchor="end">${pct(v)}</text>`)
    .join("");
  const xTicks = ticks
    .map((e) => {
      const px = (pad.l + ((e - lo) / (hi - lo)) * iw).toFixed(1);
      return `<line class="grid" x1="${px}" x2="${px}" y1="${pad.t}" y2="${pad.t + ih}"/><text x="${px}" y="${H - pad.b + 18}" text-anchor="middle">$${Number(`1e${e}`).toPrecision(1)}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hit rate against cost per query for each trial">
${yTicks}${xTicks}
<text x="${pad.l + iw / 2}" y="${H - 6}" text-anchor="middle">cost per query (log scale)</text>
<text x="14" y="${pad.t + ih / 2}" text-anchor="middle" transform="rotate(-90 14 ${pad.t + ih / 2})">hit@${result.topK}</text>
${frontPath ? `<path class="frontline" d="${frontPath}"/>` : ""}
${points}
</svg>`;
}

/**
 * renderTuneHtml
 * A self-contained page: the winner, the cost/quality chart and every trial
 */
function renderTuneHtml(result, { title = "ragforge tune report" } = {}) {
  const trials = byId(result);
  const best = trials.get(result.best);
  const front = new Set(result.pareto);
  const rows = rankTrials(result.trials)
    .map(
      (t) => `<tr${t.id === result.best ? ' class="rec"' : ""}>
  <td>${esc(t.setupId)}${t.id === result.default ? ' <span class="badge">default</span>' : ""}</td>
  <td>${esc(t.technique)}${t.id === result.best ? ' <span class="badge">best</span>' : ""}${front.has(t.id) ? ' <span class="tag">pareto</span>' : ""}</td>
  <td><div class="bar"><span style="width:${(t.hitRate * 100).toFixed(1)}%"></span></div><b>${pct(t.hitRate)}</b></td>
  <td>${t.mrr.toFixed(3)}</td>
  <td>${t.avgChunkChars ?? ""}</td>
  <td>${usd(t.avgCostUSD)}</td>
  <td>${usd(t.indexCostUSD)}</td>
  <td>${ms(t.avgLatencyMs)}</td>
  <td>${t.stage}</td>
</tr>`
    )
    .join("\n");
  const notes = [...(result.stopped ? [`Stopped early: ${result.stopped}`] : []), ...result.warnings].map((n) => `<li>${esc(n)}</li>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root {
  --bg: #fafaf9; --surface: #ffffff; --text: #1c1917; --muted: #78716c; --border: #e7e5e4;
  --accent: #4f46e5; --accent-soft: #eef2ff; --best: #d97706; --bar: #e7e5e4; --point: #a8a29e;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0c0a09; --surface: #1c1917; --text: #f5f5f4; --muted: #a8a29e; --border: #292524;
    --accent: #818cf8; --accent-soft: #1e1b4b; --best: #fbbf24; --bar: #292524; --point: #57534e;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1000px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 1.6rem; margin: 0 0 4px; }
h2 { font-size: 1.1rem; margin: 40px 0 12px; }
.muted { color: var(--muted); }
.callout { margin: 24px 0; padding: 16px 20px; border-radius: 12px; background: var(--accent-soft); border: 1px solid var(--border); }
.callout strong { color: var(--accent); font-size: 1.15rem; }
.meta { display: flex; flex-wrap: wrap; gap: 8px 24px; margin-top: 8px; color: var(--muted); font-size: .9rem; }
.chart { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px; }
svg { width: 100%; height: auto; display: block; }
svg text { fill: var(--muted); font-size: 11px; }
svg .grid { stroke: var(--border); }
svg .pt { fill: var(--point); }
svg .front { fill: var(--accent); }
svg .default { fill: none; stroke: var(--text); stroke-width: 2; }
svg .frontline { fill: none; stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 4 3; }
svg .best path { fill: var(--best); }
.legend { display: flex; flex-wrap: wrap; gap: 16px; font-size: .85rem; color: var(--muted); margin-top: 8px; }
.table-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { padding: 9px 12px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
thead th { font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
tbody tr:last-child > * { border-bottom: 0; }
tr.rec { background: var(--accent-soft); }
.badge { font-size: .7rem; font-weight: 600; color: var(--accent); border: 1px solid var(--accent); border-radius: 999px; padding: 1px 8px; margin-left: 6px; }
.tag { font-size: .7rem; color: var(--muted); margin-left: 6px; }
td .bar { display: inline-block; width: 90px; height: 8px; border-radius: 4px; background: var(--bar); margin-right: 10px; vertical-align: middle; overflow: hidden; }
td .bar span { display: block; height: 100%; background: var(--accent); }
code { font-size: .85em; }
</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
<p class="muted">Each trial is one index setup (chunking strategy, chunk size, embedding model) with one query technique, scored on the same ${result.questionCount} questions.</p>

<div class="callout">
  Best: <strong>${esc(label(best))}</strong>
  <div>${esc(result.reason)}</div>
  <div class="meta">
    <span>hit@${result.topK} ${pct(best.hitRate)} · MRR ${best.mrr.toFixed(3)}</span>
    <span>${usd(best.avgCostUSD)} per query</span>
    <span>Index cost ${usd(best.indexCostUSD)} (one-time)</span>
    <span>Spent ${usd(result.spent.costUSD)}${result.budgetUSD !== null ? ` of $${result.budgetUSD}` : ""}</span>
  </div>
</div>

<h2>Quality against cost</h2>
<div class="chart">
${paretoChart(result)}
<div class="legend"><span>★ best</span><span>◯ default setup</span><span>● on the Pareto front (no other trial is both better and cheaper)</span><span>Hover a point for details</span></div>
</div>
${notes ? `<ul class="muted">${notes}</ul>` : ""}

<h2>All trials</h2>
<div class="table-wrap">
<table>
<thead><tr><th>Setup</th><th>Technique</th><th>Hit@${result.topK}</th><th>MRR</th><th>Chars / chunk</th><th>Cost / query</th><th>Index cost</th><th>Latency</th><th>Stage</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
<p class="muted">Setups are written as strategy/size/embedding model. Screen: every setup with techniques that add no LLM calls. Refine: the best setups with techniques that do. Index cost is paid once when the index is built. Chars / chunk: bigger chunks find more but send more text to the LLM with every answer (top ${result.topK} chunks per query).</p>
<p class="muted">Generated by ragforge.</p>
</main>
</body>
</html>`;
}

module.exports = { formatTuneTable, renderTuneHtml, paretoChart };
