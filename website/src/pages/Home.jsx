import { useState } from "react";
import { Link } from "react-router-dom";
import Board from "../components/Board.jsx";
import Code from "../components/Code.jsx";
import { Command } from "../components/Copy.jsx";
import RouterDemo from "../components/RouterDemo.jsx";
import { MCP_TOOLS, PROVIDERS, QUESTIONS, SAMPLES, STORES } from "../data/site.js";

function Samples() {
  const [active, setActive] = useState(SAMPLES[0].id);
  const sample = SAMPLES.find((s) => s.id === active);

  function onKeyDown(e) {
    const i = SAMPLES.findIndex((s) => s.id === active);
    const next = e.key === "ArrowDown" || e.key === "ArrowRight" ? i + 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const target = SAMPLES[(next + SAMPLES.length) % SAMPLES.length];
    setActive(target.id);
    document.getElementById(`tab-${target.id}`)?.focus();
  }

  return (
    <div className="switch">
      <div className="switch__tabs" role="tablist" aria-label="Code samples" aria-orientation="vertical" onKeyDown={onKeyDown}>
        {SAMPLES.map((s) => (
          <button
            key={s.id}
            id={`tab-${s.id}`}
            type="button"
            role="tab"
            aria-selected={s.id === active}
            aria-controls="sample-panel"
            tabIndex={s.id === active ? 0 : -1}
            onClick={() => setActive(s.id)}
          >
            <b>{s.name}</b>
            <span>{s.line}</span>
          </button>
        ))}
      </div>
      <div id="sample-panel" role="tabpanel" aria-labelledby={`tab-${sample.id}`}>
        <Code code={sample.code} lang={sample.lang} label={`${sample.name} sample`} slot="sample" />
      </div>
    </div>
  );
}

// One answer open at a time; a closed answer is not in the page
function Questions() {
  const [open, setOpen] = useState(null);
  return (
    <div className="faq__list">
      {QUESTIONS.map((item, i) => {
        const isOpen = open === i;
        return (
          <div className="faq__item" key={item.q}>
            <h3>
              <button type="button" aria-expanded={isOpen} aria-controls={`faq-${i}`} onClick={() => setOpen(isOpen ? null : i)}>
                {item.q}
                <span aria-hidden="true">{isOpen ? "−" : "+"}</span>
              </button>
            </h3>
            {isOpen && <p id={`faq-${i}`}>{item.a}</p>}
          </div>
        );
      })}
    </div>
  );
}

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="container hero__grid">
          <div>
            <h1>Know which RAG technique earns its cost.</h1>
            <p className="lead">Benchmark retrieval on your own documents, then route every query automatically.</p>
            <div className="hero__actions">
              <Command primary>npm install ragforge</Command>
              <Link className="btn" to="/playground">Route a query live</Link>
            </div>
            <p className="hero__terms">MIT licence. Node 18 or newer.</p>
          </div>
          <Board />
        </div>
      </section>

      <section className="section band--paper">
        <div className="container">
          <div className="head">
            <h2>Measure first. Then route.</h2>
            <p className="lead">HyDE and Step-Back help on some data and do nothing on other data.</p>
          </div>
          <ol className="stations">
            <li>
              <h3>Measure</h3>
              <p>Scores every technique on questions written from your documents.</p>
              <code>npx ragforge eval --docs ./docs</code>
            </li>
            <li>
              <h3>Route</h3>
              <p>Sends each query to the technique that won.</p>
              <code>rf.auto(query, {"{ from: evalResult }"})</code>
            </li>
            <li>
              <h3>Answer</h3>
              <p>Returns a cited answer, its sources and the exact cost.</p>
              <code>result.answer, result.sources, result.stats</code>
            </li>
          </ol>
        </div>
      </section>

      <section className="section--s band--ink" aria-labelledby="router-head">
        <div className="container">
          <div className="head">
            <h2 id="router-head">Type a query. Watch it route.</h2>
            <p className="lead">This is rf.route() from the package, running on this site's server. No model is called and no key is needed.</p>
          </div>
          <RouterDemo />
        </div>
      </section>

      <section className="section--l">
        <div className="container">
          <div className="head head--stack">
            <h2>From eval to answer, in code.</h2>
          </div>
          <Samples />
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="head">
            <h2>Runs on what you already have.</h2>
            <p className="lead">Seven built-in providers, six vector store adapters, or any object with a query method.</p>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Provider</th>
                  <th scope="col">Chat model</th>
                  <th scope="col">Embedding model</th>
                  <th scope="col">Key</th>
                </tr>
              </thead>
              <tbody>
                {PROVIDERS.map((p) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td className={p.chat ? undefined : "quiet"}>{p.chat ?? "embeddings only"}</td>
                    <td className={p.embed ? undefined : "quiet"}>{p.embed ?? "chat only"}</td>
                    <td className="quiet">{p.key}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="stores">
            <span id="stores-label">Vector stores</span>
            <ul aria-labelledby="stores-label">
              {STORES.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="section band--paper">
        <div className="container split">
          <div>
            <h2>Give your coding agent the docs.</h2>
            <p className="lead">One command serves a folder to Claude Code, Cursor or Windsurf over MCP. It needs no API key.</p>
            <Command>npx ragforge mcp --docs ./docs</Command>
          </div>
          <ul className="rows">
            {MCP_TOOLS.map((tool) => (
              <li key={tool.name}>
                <b>{tool.name}</b>
                <span>{tool.line}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section">
        <div className="container faq">
          <h2>Questions</h2>
          <Questions />
        </div>
      </section>

      <section className="section--s band--ink">
        <div className="container close">
          <h2>Run it on your own docs.</h2>
          <div className="close__actions">
            <Command>npx ragforge eval --docs ./docs</Command>
            <Link className="btn" to="/docs#quick-start">Read the quick start</Link>
          </div>
        </div>
      </section>
    </>
  );
}
