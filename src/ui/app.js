// The dashboard page: one self-contained HTML file, no external assets.
// All data from files is put on the page as text (textContent), never as HTML, so a
// question, passage or answer can't inject markup or script. The one exception is the
// tune chart, an SVG the server builds with escaped text (src/tune/report.js).

const STYLE = `
:root {
  --bg: #fafaf9; --surface: #ffffff; --text: #1c1917; --muted: #78716c; --border: #e7e5e4;
  --accent: #4f46e5; --accent-soft: #eef2ff; --hit: #15803d; --hit-soft: #dcfce7; --miss: #b91c1c; --miss-soft: #fee2e2;
  --warn: #b45309; --bar: #e7e5e4; --point: #a8a29e; --best: #d97706; --code: #f5f5f4;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0c0a09; --surface: #1c1917; --text: #f5f5f4; --muted: #a8a29e; --border: #292524;
    --accent: #818cf8; --accent-soft: #1e1b4b; --hit: #4ade80; --hit-soft: #14532d; --miss: #f87171; --miss-soft: #450a0a;
    --warn: #fbbf24; --bar: #292524; --point: #57534e; --best: #fbbf24; --code: #292524;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; display: grid; grid-template-columns: 300px minmax(0, 1fr); grid-template-rows: auto 1fr; }
header { grid-column: 1 / -1; display: flex; align-items: center; gap: 12px; padding: 10px 18px; border-bottom: 1px solid var(--border); background: var(--surface); }
header h1 { font-size: 1rem; margin: 0; white-space: nowrap; }
/* A long folder path is cut with an ellipsis instead of widening the page (full path on hover) */
header #root { font-size: .85rem; min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
header button { flex: none; }
html, body { overflow-x: hidden; }
nav { border-right: 1px solid var(--border); overflow-y: auto; padding: 12px 10px 24px; background: var(--surface); }
nav h2 { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 16px 8px 6px; }
nav a { display: block; padding: 7px 10px; border-radius: 8px; color: inherit; text-decoration: none; margin-bottom: 2px; }
nav a:hover { background: var(--accent-soft); }
nav a.active { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
nav a .name { display: block; font-weight: 500; overflow-wrap: anywhere; }
nav a .sub { display: block; font-size: .78rem; color: var(--muted); }
main { overflow-y: auto; padding: 24px 28px 64px; min-width: 0; }
main h2 { font-size: 1.25rem; margin: 0 0 4px; overflow-wrap: anywhere; }
main h3 { font-size: 1rem; margin: 28px 0 10px; }
.muted { color: var(--muted); }
.callout { margin: 16px 0; padding: 14px 18px; border-radius: 12px; background: var(--accent-soft); border: 1px solid var(--border); }
.callout strong { color: var(--accent); }
.meta { display: flex; flex-wrap: wrap; gap: 6px 20px; margin-top: 8px; color: var(--muted); font-size: .85rem; }
.table-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
thead th { font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); white-space: nowrap; position: sticky; top: 0; background: var(--surface); }
tbody tr:last-child > * { border-bottom: 0; }
tr.rec { background: var(--accent-soft); }
tr.click { cursor: pointer; }
tr.click:hover { background: var(--accent-soft); }
tr.open { background: var(--accent-soft); }
td.num, th.num { text-align: right; white-space: nowrap; }
.badge { display: inline-block; font-size: .7rem; font-weight: 600; color: var(--accent); border: 1px solid var(--accent); border-radius: 999px; padding: 0 7px; margin-left: 6px; vertical-align: 1px; }
.badge.warn { color: var(--warn); border-color: var(--warn); }
.badge.plain { color: var(--muted); border-color: var(--border); }
.bar { display: inline-block; width: 80px; height: 7px; border-radius: 4px; background: var(--bar); margin-right: 8px; vertical-align: middle; overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--accent); }
.rank { display: inline-block; min-width: 26px; text-align: center; border-radius: 6px; padding: 0 5px; font-weight: 600; font-size: .85rem; }
.rank.hit { color: var(--hit); background: var(--hit-soft); }
.rank.miss { color: var(--miss); background: var(--miss-soft); }
.rank.err { color: var(--warn); }
.up { color: var(--hit); } .down { color: var(--miss); }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 10px 0; }
button, select, input { font: inherit; color: inherit; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 5px 10px; }
button { cursor: pointer; }
button:hover { border-color: var(--accent); }
button.on { background: var(--accent); color: #fff; border-color: var(--accent); }
input[type=search], input[type=text] { min-width: 260px; }
.detail { background: var(--bg); }
.detail > td { padding: 14px 16px 18px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; min-width: 0; }
.card h4 { margin: 0 0 6px; font-size: .9rem; }
.passage { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--code); border-radius: 8px; padding: 8px 10px; margin: 6px 0; font-size: .85rem; }
.passage.hit { box-shadow: inset 3px 0 0 var(--hit); }
/* Long answers scroll inside their card instead of stretching the page */
.card .passage { max-height: 240px; overflow-y: auto; }
td.hitcell { white-space: nowrap; }
ol.ids { margin: 4px 0; padding-left: 22px; font-size: .85rem; }
ol.ids li.hit { color: var(--hit); font-weight: 600; }
code { font-size: .85em; overflow-wrap: anywhere; }
pre.json { background: var(--code); border-radius: 10px; padding: 12px; overflow: auto; font-size: .8rem; }
.empty { padding: 48px 0; text-align: center; color: var(--muted); }
.error { color: var(--miss); }
.chart { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px; }
.chart svg { width: 100%; height: auto; display: block; }
.chart svg text { fill: var(--muted); font-size: 11px; }
.chart svg .grid { stroke: var(--border); }
.chart svg .pt { fill: var(--point); }
.chart svg .front { fill: var(--accent); }
.chart svg .default { fill: none; stroke: var(--text); stroke-width: 2; }
.chart svg .frontline { fill: none; stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 4 3; }
.chart svg .best path { fill: var(--best); }
.stats { display: flex; flex-wrap: wrap; gap: 10px; margin: 12px 0; }
.stat { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 8px 14px; }
.stat b { display: block; font-size: 1.1rem; }
.stat span { color: var(--muted); font-size: .8rem; }
@media (max-width: 800px) { body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto 1fr; } nav { max-height: 40vh; border-right: 0; border-bottom: 1px solid var(--border); } }
`;

// Client code. Runs in the browser; it only talks to this server's /api.
const SCRIPT = String.raw`
(() => {
  "use strict";
  const $main = document.querySelector("main");
  const $nav = document.querySelector("nav");
  const $root = document.querySelector("#root");
  let files = [];

  // el("td", { class: "num", title: "x" }, "text", childNode): text is always text
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "onclick") node.addEventListener("click", v);
      else if (k === "oninput") node.addEventListener("input", v);
      else if (k === "onchange") node.addEventListener("change", v);
      else if (k === "onkeydown") node.addEventListener("keydown", v);
      else node.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }
  // Like el()'s children: arrays are flattened, null/undefined/false are left out. The DOM's
  // own replaceChildren() would print them as "null" or "[object HTMLDivElement]"
  function fill(target, ...children) {
    target.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false).map((c) => (c instanceof Node ? c : document.createTextNode(String(c)))));
  }
  const pct = (x) => (typeof x === "number" ? Math.round(x * 100) + "%" : "n/a");
  const fixed = (x, d = 3) => (typeof x === "number" ? x.toFixed(d) : "n/a");
  const ms = (x) => (typeof x !== "number" ? "n/a" : x >= 1000 ? (x / 1000).toFixed(1) + "s" : Math.round(x) + "ms");
  function usd(x) {
    if (x === null || x === undefined) return "n/a";
    if (x === 0) return "$0";
    if (x < 0.000001) return "<$0.000001";
    return x < 0.01 ? "$" + x.toFixed(6) : "$" + x.toFixed(4);
  }
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString(); };
  function bar(fraction) {
    const b = el("span", { class: "bar" }, el("span"));
    b.firstChild.style.width = Math.max(0, Math.min(1, fraction || 0)) * 100 + "%";
    return b;
  }
  function rankCell(run, topK) {
    if (!run) return el("span", { class: "muted" }, "");
    if (run.error) return el("span", { class: "rank err", title: run.error }, "error");
    return run.rank > 0 ? el("span", { class: "rank hit", title: "found at rank " + run.rank + " of " + topK }, String(run.rank)) : el("span", { class: "rank miss", title: "not in the top " + topK }, "✗");
  }
  const delta = (d, digits, points) => {
    if (d === null || d === undefined) return el("span", { class: "muted" }, "n/a");
    const v = points ? Math.round(d * 1000) / 10 : Number(d.toFixed(digits));
    if (v === 0) return el("span", { class: "muted" }, "0");
    return el("span", { class: v > 0 ? "up" : "down" }, (v > 0 ? "+" : "") + v + (points ? " pts" : ""));
  };

  async function get(url) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || res.status + " " + res.statusText);
    return body;
  }

  const KINDS = [
    ["eval", "Eval runs"],
    ["tune", "Tune runs"],
    ["traces", "Trace logs"],
    ["index", "Saved indexes"],
    ["config", "Tuned configs"],
  ];
  function subtitle(f) {
    const s = f.summary || {};
    if (f.kind === "eval") return s.questions + " questions · top " + s.topK + " · best " + pct(s.best) + (s.recommended ? " · ★ " + s.recommended : "");
    if (f.kind === "tune") return s.trials + " trials · best " + pct(s.hitRate);
    if (f.kind === "traces") return s.traces + " traces";
    if (f.kind === "index") return s.chunks + " chunks · " + s.documents + " docs";
    if (f.kind === "config") return s.technique + " · " + s.chunking.strategy + "/" + s.chunking.size;
    return "";
  }
  function renderNav() {
    fill($nav);
    const current = decodeURIComponent(location.hash.slice(1));
    for (const [kind, label] of KINDS) {
      const list = files.filter((f) => f.kind === kind);
      if (!list.length) continue;
      $nav.append(el("h2", {}, label + " (" + list.length + ")"));
      for (const f of list) {
        const href = "#" + encodeURIComponent(kind + ":" + f.id);
        $nav.append(el("a", { href, class: current === kind + ":" + f.id ? "active" : null, title: f.id }, el("span", { class: "name" }, f.id), el("span", { class: "sub" }, subtitle(f) + " · " + when(f.modified))));
      }
    }
    if (!files.length) $nav.append(el("p", { class: "muted" }, "Nothing found yet."));
  }

  async function loadFiles() {
    const body = await get("/api/files");
    files = body.files;
    $root.textContent = body.root;
    $root.title = body.root;
    renderNav();
  }

  function welcome() {
    const counts = KINDS.map(([k, l]) => [l, files.filter((f) => f.kind === k).length]).filter(([, n]) => n);
    fill($main, 
      el("h2", {}, "ragforge ui"),
      el("p", { class: "muted" }, "Eval runs, tune runs, trace logs and saved indexes found in this folder and below. Pick one on the left."),
      counts.length
        ? el("div", { class: "stats" }, counts.map(([l, n]) => el("div", { class: "stat" }, el("b", {}, String(n)), el("span", {}, l))))
        : el("div", { class: "card" },
            el("h4", {}, "Nothing to show yet"),
            el("p", {}, "Write some results into this folder, then press Reload:"),
            el("pre", { class: "json" }, "npx ragforge eval --docs ./docs --json eval.json\nnpx ragforge tune --docs ./docs --json tune.json\nnpx ragforge index --docs ./docs\ncreateRagforge({ onTrace: 'traces.jsonl' })")
          )
    );
  }

  // ---------- Eval run ----------
  function evalView(file) {
    const r = file.data;
    const answers = Boolean(r.answers);
    const others = files.filter((f) => f.kind === "eval" && f.id !== file.id);
    const metaBits = [
      r.questionCount + " questions",
      "top " + r.topK,
      r.provider ? r.provider.llm + " " + (r.provider.chatModel || "") + " / " + (r.provider.embeddingModel || "") : null,
      r.chunkCount ? r.chunkCount + " chunks" + (r.chunking ? " (" + r.chunking.strategy + ", " + r.chunking.size + " chars)" : "") : null,
      r.setup ? "setup cost " + usd(r.setup.costUSD) : null,
      r.contextual ? "contextual index cost " + usd(r.contextual.usage && r.contextual.usage.costUSD) : null,
      answers ? "answers judged by " + r.answers.judgeModel + " (judge v" + r.answers.judgeVersion + ")" : null,
    ].filter(Boolean);

    const ordered = r.ranking.map((t) => r.results.find((x) => x.technique === t)).filter(Boolean);
    const answerCols = answers ? [["faithfulness", "Faithful"], ["answerRelevance", "Relevance"], ["contextRecall", "Ctx recall"], ["citationAccuracy", "Citations"]] : [];
    const scoreboard = el("div", { class: "table-wrap" }, el("table", {},
      el("thead", {}, el("tr", {}, el("th", {}, "Technique"), el("th", {}, "Hit@" + r.topK), el("th", { class: "num" }, "MRR"), answerCols.map(([, l]) => el("th", { class: "num" }, l)), el("th", { class: "num" }, "Latency"), el("th", { class: "num" }, "Cost / query"), el("th", { class: "num" }, "LLM calls"), el("th", { class: "num" }, "Errors"))),
      el("tbody", {}, ordered.map((row) => el("tr", { class: row.technique === r.recommendation.technique ? "rec" : null },
        el("th", { scope: "row" }, row.technique, row.technique === r.recommendation.technique ? el("span", { class: "badge" }, "recommended") : null, row.external ? el("span", { class: "badge plain" }, "yours") : null),
        el("td", { class: "hitcell" }, bar(row.hitRate), el("b", {}, pct(row.hitRate))),
        el("td", { class: "num" }, fixed(row.mrr)),
        answerCols.map(([k]) => el("td", { class: "num" }, row.answers ? pct(row.answers[k]) : "n/a")),
        el("td", { class: "num" }, ms(row.avgLatencyMs)),
        el("td", { class: "num" }, usd(row.avgCostUSD)),
        el("td", { class: "num" }, row.external ? "n/a" : String(row.avgLlmCalls)),
        el("td", { class: "num" }, row.errors ? String(row.errors) : "")
      )))
    ));

    // Questions, with each technique's rank; a row opens its details
    const techniques = r.ranking;
    let filter = "all";
    let text = "";
    const tbody = el("tbody");
    const disagree = (q) => new Set(techniques.map((t) => (q.runs[t] && q.runs[t].rank > 0 ? "hit" : "miss"))).size > 1;
    const missed = (q) => techniques.some((t) => !(q.runs[t] && q.runs[t].rank > 0));
    function drawQuestions() {
      fill(tbody);
      const shown = r.questions.map((q, i) => [q, i]).filter(([q]) => (filter === "all" || (filter === "misses" ? missed(q) : disagree(q))) && (!text || q.question.toLowerCase().includes(text)));
      count.textContent = shown.length + " of " + r.questions.length + " questions";
      for (const [q, i] of shown) {
        const row = el("tr", { class: "click", title: "Show what each technique retrieved" },
          el("td", { class: "num muted" }, String(i + 1)),
          el("td", {}, q.question, q.style ? el("span", { class: "badge plain" }, q.style) : null),
          techniques.map((t) => el("td", { class: "num" }, rankCell(q.runs[t], r.topK)))
        );
        row.addEventListener("click", () => {
          const next = row.nextSibling;
          if (next && next.classList.contains("detail")) { next.remove(); row.classList.remove("open"); return; }
          row.classList.add("open");
          row.after(el("tr", { class: "detail" }, el("td", { colspan: techniques.length + 2 }, questionDetail(q, techniques, r.topK))));
        });
        tbody.append(row);
      }
      if (!shown.length) tbody.append(el("tr", {}, el("td", { colspan: techniques.length + 2, class: "empty" }, "No questions match.")));
    }
    const count = el("span", { class: "muted" });
    const buttons = [["all", "All"], ["misses", "Any miss"], ["disagree", "Techniques disagree"]].map(([k, l]) => el("button", { class: k === filter ? "on" : null, onclick: (e) => { filter = k; buttons.forEach((b) => b.classList.remove("on")); e.target.classList.add("on"); drawQuestions(); } }, l));
    const searchBox = el("input", { type: "search", placeholder: "Filter questions", oninput: (e) => { text = e.target.value.trim().toLowerCase(); drawQuestions(); } });

    const compare = others.length
      ? el("label", {}, "Compare with ", el("select", { onchange: (e) => { if (e.target.value) location.hash = "#" + encodeURIComponent("compare:" + e.target.value + "|" + file.id); } },
          el("option", { value: "" }, "an earlier run…"),
          others.map((f) => el("option", { value: f.id }, f.id + " (" + when(f.modified) + ")"))))
      : null;

    fill($main, 
      el("h2", {}, file.id),
      el("p", { class: "muted" }, "Eval run · " + when(file.modified)),
      el("div", { class: "callout" }, "Recommended: ", el("strong", {}, r.recommendation.technique), el("div", {}, r.recommendation.reason), el("div", { class: "meta" }, metaBits.map((b) => el("span", {}, b)))),
      el("div", { class: "toolbar" }, compare),
      scoreboard,
      el("p", { class: "muted" }, "Hit@" + r.topK + ": share of questions whose passage was retrieved. MRR: mean of 1/rank (higher is better). Cost and latency are averages per question, for retrieval only."),
      el("h3", {}, "Questions"),
      el("div", { class: "toolbar" }, buttons, searchBox, count),
      el("div", { class: "table-wrap" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", { class: "num" }, "#"), el("th", {}, "Question"), techniques.map((t) => el("th", { class: "num" }, t)))), tbody))
    );
    drawQuestions();
  }

  function questionDetail(q, techniques, topK) {
    const expected = q.expectedId != null ? "Expected chunk " + q.expectedId : "Expected text: " + q.expectedText;
    return el("div", {},
      el("p", {}, el("b", {}, expected)),
      q.source ? el("div", {}, el("span", { class: "muted" }, "The question was written from:"), el("div", { class: "passage hit" }, q.source)) : null,
      el("div", { class: "grid" }, techniques.map((t) => {
        const run = q.runs[t];
        if (!run) return null;
        return el("div", { class: "card" },
          el("h4", {}, t, " ", rankCell(run, topK)),
          run.error ? el("p", { class: "error" }, run.error) : null,
          run.queries && run.queries.length && !(run.queries.length === 1 && run.queries[0] === q.question) ? el("div", {}, el("span", { class: "muted" }, "Searched for:"), el("ol", { class: "ids" }, run.queries.map((x) => el("li", {}, x)))) : null,
          run.retrieved && run.retrieved.length ? el("div", {}, el("span", { class: "muted" }, "Retrieved:"), el("ol", { class: "ids" }, run.retrieved.map((id, i) => el("li", { class: i + 1 === run.rank ? "hit" : null }, id)))) : null,
          run.answer ? el("div", {}, el("span", { class: "muted" }, "Answer:"), el("div", { class: "passage" }, run.answer)) : null,
          run.scores ? el("div", { class: "meta" }, Object.entries(run.scores).map(([k, v]) => el("span", {}, k + " " + (typeof v === "number" ? pct(v) : "n/a")))) : null,
          run.findings ? el("div", {}, Object.entries(run.findings).map(([k, list]) => el("div", {}, el("span", { class: "muted" }, k + ":"), el("ul", {}, (list || []).map((x) => el("li", {}, typeof x === "string" ? x : JSON.stringify(x))))))) : null
        );
      }))
    );
  }

  // ---------- Compare two eval runs ----------
  async function compareView(a, b) {
    fill($main, el("p", { class: "muted" }, "Comparing…"));
    let drop = "";
    async function draw() {
      const body = await get("/api/compare?a=" + encodeURIComponent(a) + "&b=" + encodeURIComponent(b) + (drop !== "" ? "&failOnDrop=" + encodeURIComponent(drop) : ""));
      const c = body.comparison;
      const status = drop === "" ? null : c.passed ? el("span", { class: "badge" }, "passes") : el("span", { class: "badge warn" }, "fails: " + c.regressions.length + " regression(s)");
      const dropInput = el("input", { type: "text", value: drop, placeholder: "e.g. 3", size: 6, onchange: async (e) => { drop = e.target.value.trim(); await draw(); } });
      fill($main, 
        el("h2", {}, "Compare eval runs"),
        el("p", { class: "muted" }, "Baseline ", el("code", {}, body.baseline), " → current ", el("code", {}, body.current)),
        el("div", { class: "toolbar" }, el("label", {}, "Fail on a drop of more than ", dropInput, " points"), status),
        c.warnings.length ? el("div", { class: "callout" }, c.warnings.map((w) => el("div", {}, "⚠ " + w))) : null,
        el("div", { class: "table-wrap" }, el("table", {},
          el("thead", {}, el("tr", {}, el("th", {}, "Technique"), el("th", {}, "Hit@" + c.topK), el("th", { class: "num" }, "Δ"), el("th", {}, "MRR"), el("th", { class: "num" }, "Δ"), c.answers ? [el("th", {}, "Faithful"), el("th", { class: "num" }, "Δ")] : null, el("th", {}, "Latency"), el("th", {}, "Cost / query"), el("th", {}, ""))),
          el("tbody", {}, c.rows.map((row) => el("tr", {},
            el("th", { scope: "row" }, row.technique),
            el("td", {}, pct(row.hitRate.before) + " → " + pct(row.hitRate.after)),
            el("td", { class: "num" }, delta(row.hitRate.delta, 3, true)),
            el("td", {}, fixed(row.mrr.before) + " → " + fixed(row.mrr.after)),
            el("td", { class: "num" }, delta(row.mrr.delta, 3)),
            c.answers ? [el("td", {}, pct(row.faithfulness.before) + " → " + pct(row.faithfulness.after)), el("td", { class: "num" }, delta(row.faithfulness.delta, 3, true))] : null,
            el("td", {}, ms(row.avgLatencyMs.before) + " → " + ms(row.avgLatencyMs.after)),
            el("td", {}, usd(row.avgCostUSD.before) + " → " + usd(row.avgCostUSD.after)),
            el("td", {}, row.status === "regressed" ? el("span", { class: "badge warn" }, "regressed") : row.status && row.status !== "same" ? el("span", { class: "badge plain" }, row.status) : "")
          )))
        )),
        el("h3", {}, "Questions that changed"),
        el("p", { class: "muted" }, body.questions.shared + " questions were asked in both runs. A rank going down, or to ✗, is worse."),
        body.questions.changes.length
          ? el("div", { class: "table-wrap" }, el("table", {},
              el("thead", {}, el("tr", {}, el("th", {}, "Question"), el("th", {}, "Technique"), el("th", { class: "num" }, "Before"), el("th", { class: "num" }, "After"), el("th", {}, ""))),
              el("tbody", {}, body.questions.changes.map((x) => el("tr", {},
                el("td", {}, x.question), el("td", {}, x.technique),
                el("td", { class: "num" }, rankCell({ rank: x.before }, c.topK)), el("td", { class: "num" }, rankCell({ rank: x.after }, c.topK)),
                el("td", {}, el("span", { class: x.change === "better" ? "up" : "down" }, x.change))
              )))
            ))
          : el("p", { class: "empty" }, "No question changed rank.")
      );
    }
    await draw();
  }

  // ---------- Tune run ----------
  function tuneView(file) {
    const r = file.data;
    const byId = new Map(r.trials.map((t) => [t.id, t]));
    const best = byId.get(r.best);
    const pareto = new Set(r.pareto);
    const chart = el("div", { class: "chart" });
    // Built by the server from escaped text (src/tune/report.js paretoChart)
    chart.innerHTML = file.chart;
    const ranked = r.trials.slice().sort((x, y) => y.hitRate - x.hitRate || y.mrr - x.mrr || (x.avgCostUSD ?? Infinity) - (y.avgCostUSD ?? Infinity));
    fill($main, 
      el("h2", {}, file.id),
      el("p", { class: "muted" }, "Tune run · " + when(file.modified) + " · " + r.questionCount + " questions · " + r.trials.length + " trials"),
      el("div", { class: "callout" }, "Best: ", el("strong", {}, best ? best.setupId + " · " + best.technique : r.best), el("div", {}, r.reason),
        el("div", { class: "meta" },
          best ? el("span", {}, "hit@" + r.topK + " " + pct(best.hitRate) + " · MRR " + fixed(best.mrr)) : null,
          best ? el("span", {}, usd(best.avgCostUSD) + " per query") : null,
          el("span", {}, "spent " + usd(r.spent && r.spent.costUSD) + (r.budgetUSD !== null && r.budgetUSD !== undefined ? " of $" + r.budgetUSD : "")))),
      r.stopped || (r.warnings && r.warnings.length) ? el("ul", { class: "muted" }, r.stopped ? el("li", {}, "Stopped early: " + r.stopped) : null, (r.warnings || []).map((w) => el("li", {}, w))) : null,
      el("h3", {}, "Quality against cost"),
      chart,
      el("p", { class: "muted" }, "★ best · ◯ default setup · ● Pareto front: no other trial is both better and cheaper. Hover a point for details."),
      el("h3", {}, "All trials"),
      el("div", { class: "table-wrap" }, el("table", {},
        el("thead", {}, el("tr", {}, el("th", {}, "Setup"), el("th", {}, "Technique"), el("th", {}, "Hit@" + r.topK), el("th", { class: "num" }, "MRR"), el("th", { class: "num" }, "Chars / chunk"), el("th", { class: "num" }, "Cost / query"), el("th", { class: "num" }, "Index cost"), el("th", { class: "num" }, "Latency"), el("th", {}, "Stage"))),
        el("tbody", {}, ranked.map((t) => el("tr", { class: t.id === r.best ? "rec" : null },
          el("td", {}, t.setupId, t.isDefault ? el("span", { class: "badge plain" }, "default") : null),
          el("td", {}, t.technique, t.id === r.best ? el("span", { class: "badge" }, "best") : null, pareto.has(t.id) ? el("span", { class: "badge plain" }, "pareto") : null),
          el("td", { class: "hitcell" }, bar(t.hitRate), el("b", {}, pct(t.hitRate))),
          el("td", { class: "num" }, fixed(t.mrr)),
          el("td", { class: "num" }, t.avgChunkChars ?? ""),
          el("td", { class: "num" }, usd(t.avgCostUSD)),
          el("td", { class: "num" }, usd(t.indexCostUSD)),
          el("td", { class: "num" }, ms(t.avgLatencyMs)),
          el("td", {}, t.stage)
        )))
      )),
      el("h3", {}, "Written config"),
      el("pre", { class: "json" }, JSON.stringify(r.config, null, 2))
    );
  }

  // ---------- Trace log ----------
  function tracesView(file) {
    const traces = file.data.slice().reverse();
    const techniques = {};
    let cost = 0;
    let costKnown = true;
    let latency = 0;
    for (const t of traces) {
      const k = (t.route && t.route.technique) || "(none)";
      techniques[k] = (techniques[k] || 0) + 1;
      if (t.stats && typeof t.stats.costUSD === "number") cost += t.stats.costUSD; else costKnown = false;
      latency += (t.stats && t.stats.latencyMs) || 0;
    }
    let text = "";
    const tbody = el("tbody");
    const count = el("span", { class: "muted" });
    function draw() {
      fill(tbody);
      const shown = traces.filter((t) => !text || t.query.toLowerCase().includes(text));
      count.textContent = shown.length + " of " + traces.length;
      for (const t of shown.slice(0, 1000)) {
        const row = el("tr", { class: "click" },
          el("td", { class: "muted" }, when(t.timestamp)),
          el("td", {}, t.query),
          el("td", {}, (t.route && t.route.technique) || ""),
          el("td", { class: "num" }, String((t.sources || []).length)),
          el("td", { class: "num" }, t.stats ? ms(t.stats.latencyMs) : ""),
          el("td", { class: "num" }, t.stats ? usd(t.stats.costUSD) : ""),
          el("td", {}, t.type || "")
        );
        row.addEventListener("click", () => {
          const next = row.nextSibling;
          if (next && next.classList.contains("detail")) { next.remove(); row.classList.remove("open"); return; }
          row.classList.add("open");
          row.after(el("tr", { class: "detail" }, el("td", { colspan: 7 },
            t.route ? el("p", {}, el("b", {}, t.route.technique), " · " + (t.route.reason || "")) : null,
            (t.sources || []).map((s) => el("div", {}, el("span", { class: "muted" }, "[" + s.ref + "] " + (s.id || "passage") + (typeof s.score === "number" ? " · score " + s.score.toFixed(3) : "") + (s.cited ? " · cited" : "")), s.content ? el("div", { class: s.cited ? "passage hit" : "passage" }, s.content) : null)),
            t.answer ? el("div", {}, el("span", { class: "muted" }, "Answer:"), el("div", { class: "passage" }, t.answer)) : null
          )));
        });
        tbody.append(row);
      }
      if (!shown.length) tbody.append(el("tr", {}, el("td", { colspan: 7, class: "empty" }, "No traces match.")));
    }
    fill($main, 
      el("h2", {}, file.id),
      el("p", { class: "muted" }, "Trace log · " + when(file.modified) + (file.total > file.shown ? " · showing the latest " + file.shown + " of " + file.total : "") + (file.skipped ? " · " + file.skipped + " unreadable lines skipped" : "")),
      el("div", { class: "stats" },
        el("div", { class: "stat" }, el("b", {}, String(traces.length)), el("span", {}, "queries")),
        el("div", { class: "stat" }, el("b", {}, ms(traces.length ? latency / traces.length : 0)), el("span", {}, "average latency")),
        el("div", { class: "stat" }, el("b", {}, costKnown ? usd(cost) : "n/a"), el("span", {}, "total cost")),
        Object.entries(techniques).sort((a, b) => b[1] - a[1]).map(([k, n]) => el("div", { class: "stat" }, el("b", {}, String(n)), el("span", {}, k)))
      ),
      el("p", { class: "muted" }, "To test on these queries: npx ragforge label --from-logs " + file.id + " --docs <path>, then eval --from-logs."),
      el("div", { class: "toolbar" }, el("input", { type: "search", placeholder: "Filter queries", oninput: (e) => { text = e.target.value.trim().toLowerCase(); draw(); } }), count),
      el("div", { class: "table-wrap" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Time"), el("th", {}, "Query"), el("th", {}, "Technique"), el("th", { class: "num" }, "Sources"), el("th", { class: "num" }, "Latency"), el("th", { class: "num" }, "Cost"), el("th", {}, "Call"))), tbody))
    );
    draw();
  }

  // ---------- Saved index, with live search ----------
  function indexView(file) {
    const m = file.data;
    const docs = Object.entries(m.documents);
    const keywordOnly = !m.settings.embeddings;
    const results = el("div");
    const technique = el("select", {}, keywordOnly ? el("option", { value: "keyword" }, "keyword (BM25)") : [el("option", { value: "hybrid" }, "hybrid (vectors + BM25)"), el("option", { value: "baseline" }, "baseline (vectors)"), el("option", { value: "keyword" }, "keyword (BM25, no API call)")]);
    const topK = el("select", {}, [3, 5, 10, 20].map((n) => el("option", { value: n, selected: n === 5 }, "top " + n)));
    const query = el("input", { type: "search", placeholder: "Search this index", onkeydown: (e) => { if (e.key === "Enter") run(); } });
    async function run() {
      const q = query.value.trim();
      if (!q) return;
      fill(results, el("p", { class: "muted" }, "Searching…"));
      try {
        const res = await fetch("/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ index: file.id, query: q, technique: technique.value, topK: Number(topK.value) }) });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || res.statusText);
        fill(results, 
          el("p", { class: "muted" }, body.results.length + " passages · " + body.technique + " · " + ms(body.latencyMs) + (body.stats ? " · " + usd(body.stats.costUSD) : "")),
          body.results.length ? body.results.map((x) => el("div", { class: "card" },
            el("h4", {}, "[" + x.ref + "] " + (x.id || "passage"), typeof x.score === "number" ? el("span", { class: "badge plain" }, "score " + x.score.toFixed(3)) : null),
            x.context ? el("p", { class: "muted" }, "Context: " + x.context) : null,
            el("div", { class: "passage" }, x.content)
          )) : el("p", { class: "empty" }, "Nothing matched.")
        );
      } catch (err) {
        fill(results, el("p", { class: "error" }, "Search failed: " + err.message));
      }
    }
    const s = m.settings;
    fill($main, 
      el("h2", {}, file.id.replace(/\/manifest\.json$/, "")),
      el("p", { class: "muted" }, "Saved index · saved " + when(m.savedAt) + " by ragforge " + m.ragforge),
      el("div", { class: "stats" },
        el("div", { class: "stat" }, el("b", {}, String(m.chunkCount)), el("span", {}, "chunks")),
        el("div", { class: "stat" }, el("b", {}, String(docs.length)), el("span", {}, "documents")),
        el("div", { class: "stat" }, el("b", {}, s.chunking.strategy + " / " + s.chunking.size), el("span", {}, "chunking" + (s.chunking.overlap ? ", overlap " + s.chunking.overlap : ""))),
        el("div", { class: "stat" }, el("b", {}, s.embeddings || "none"), el("span", {}, "embeddings")),
        el("div", { class: "stat" }, el("b", {}, s.contextual || "off"), el("span", {}, "context lines"))
      ),
      el("h3", {}, "Search"),
      el("p", { class: "muted" }, keywordOnly ? "Keyword search over the saved chunks. No API key needed." : "Hybrid and baseline embed your query with " + s.embeddings + " (one embedding call, needs its API key). Keyword search needs no key."),
      el("div", { class: "toolbar" }, query, technique, topK, el("button", { onclick: run }, "Search")),
      results,
      el("h3", {}, "Documents"),
      el("div", { class: "table-wrap" }, el("table", {},
        el("thead", {}, el("tr", {}, el("th", {}, "Document"), el("th", { class: "num" }, "Chunks"), el("th", {}, "Content hash"), el("th", {}, "Source"))),
        el("tbody", {}, docs.map(([id, d]) => el("tr", {}, el("td", {}, id), el("td", { class: "num" }, String(d.chunks.length)), el("td", {}, el("code", {}, d.hash.slice(0, 12))), el("td", { class: "muted" }, d.source || ""))))
      ))
    );
    query.focus();
  }

  function configView(file) {
    const c = file.data;
    fill($main, 
      el("h2", {}, file.id),
      el("p", { class: "muted" }, "Tuned config · " + when(file.modified)),
      c.tuned ? el("div", { class: "callout" }, el("strong", {}, c.technique + " on " + c.chunking.strategy + "/" + c.chunking.size), el("div", {}, c.tuned.reason || ""), el("div", { class: "meta" }, el("span", {}, "hit " + pct(c.tuned.hitRate) + (c.tuned.default ? " vs " + pct(c.tuned.default.hitRate) + " default" : "")), el("span", {}, c.tuned.questions + " questions"), el("span", {}, "tuned " + when(c.tuned.at)))) : null,
      el("p", {}, "Use it with ", el("code", {}, "createRagforge({ config: '" + file.id + "' })"), " or ", el("code", {}, "--config " + file.id), "."),
      el("pre", { class: "json" }, JSON.stringify(c, null, 2))
    );
  }

  async function route() {
    renderNav();
    const hash = decodeURIComponent(location.hash.slice(1));
    if (!hash) return welcome();
    const colon = hash.indexOf(":");
    const kind = hash.slice(0, colon);
    const id = hash.slice(colon + 1);
    fill($main, el("p", { class: "muted" }, "Loading…"));
    try {
      if (kind === "compare") {
        const [a, b] = id.split("|");
        return await compareView(a, b);
      }
      const file = await get("/api/file?path=" + encodeURIComponent(id));
      ({ eval: evalView, tune: tuneView, traces: tracesView, index: indexView, config: configView })[file.kind](file);
      $main.scrollTop = 0;
    } catch (err) {
      fill($main, el("h2", {}, "Can't show this"), el("p", { class: "error" }, err.message));
    }
  }

  document.querySelector("#reload").addEventListener("click", async () => { await loadFiles(); await route(); });
  window.addEventListener("hashchange", route);
  loadFiles().then(route).catch((err) => fill($main, el("p", { class: "error" }, "Can't reach the ragforge ui server: " + err.message)));
})();
`;

/**
 * renderApp
 * The page, with a per-response nonce for its one style and one script block
 * (the Content-Security-Policy allows nothing else)
 */
function renderApp({ nonce }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ragforge ui</title>
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<header><h1>ragforge ui</h1><span class="muted" id="root"></span><button id="reload" title="Look for new and changed files">Reload</button></header>
<nav></nav>
<main><p class="muted">Loading…</p></main>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;
}

module.exports = { renderApp };
