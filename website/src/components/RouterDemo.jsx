import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { SAMPLE_QUERIES, TECHNIQUES } from "../data/site.js";

function describePipeline({ techniques, hybrid, rerank }) {
  const parts = [techniques.length ? techniques.join(" + ") : "plain vector search"];
  if (hybrid) parts.push("keyword search");
  if (rerank) parts.push("a reranker");
  return parts.join(", then ");
}

/**
 * RouterDemo
 * Sends the query to POST /api/route, which calls rf.route() from the package.
 * The first sample is routed on load, so the panel always shows a real decision.
 */
export default function RouterDemo({ id = "router-query" }) {
  const [query, setQuery] = useState(SAMPLE_QUERIES[0]);
  const [routed, setRouted] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  async function run(text) {
    const q = text.trim();
    if (!q) {
      setError("Type a query to route.");
      return;
    }
    const call = ++latest.current;
    setBusy(true);
    setError(null);
    try {
      const result = await api.route(q);
      if (call === latest.current) setRouted(result);
    } catch (err) {
      if (call === latest.current) setError(err.message);
    } finally {
      if (call === latest.current) setBusy(false);
    }
  }

  useEffect(() => {
    run(SAMPLE_QUERIES[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="router">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(query);
        }}
      >
        <label className="visually-hidden" htmlFor={id}>Query to route</label>
        <div className="field-row">
          <input
            id={id}
            className="field"
            type="text"
            value={query}
            maxLength={300}
            autoComplete="off"
            spellCheck="false"
            placeholder="Ask something the way a user would"
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn" type="submit" aria-busy={busy}>Route it</button>
        </div>
      </form>

      <ul className="router__samples" aria-label="Sample queries">
        {SAMPLE_QUERIES.map((sample) => (
          <li key={sample}>
            <button
              type="button"
              className="cell"
              aria-pressed={routed?.query === sample}
              onClick={() => {
                setQuery(sample);
                run(sample);
              }}
            >
              {sample}
            </button>
          </li>
        ))}
      </ul>

      {error && <p className="note note--error" role="alert">{error}</p>}

      <dl className="verdict" data-slot="route" aria-live="polite" aria-busy={busy}>
        <div>
          <dt>Kind of query</dt>
          <dd className="verdict__big">{routed ? routed.category : "\u00a0"}</dd>
          {routed && <p className="verdict__note">Classified by {routed.classifier}, no model call.</p>}
        </div>
        <div>
          <dt>Technique</dt>
          <dd className="verdict__big verdict__big--amber">{routed ? routed.technique : "\u00a0"}</dd>
          {routed && <p className="verdict__note">{TECHNIQUES[routed.technique] ?? ""}</p>}
        </div>
        <div>
          <dt>Why</dt>
          <dd>{routed ? routed.reason : "\u00a0"}</dd>
          {routed && <p className="verdict__note">auto() would run {describePipeline(routed.pipeline)}, then write the cited answer.</p>}
        </div>
      </dl>
    </div>
  );
}
