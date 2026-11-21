import { useState } from "react";
import { api, useApi } from "../lib/api.js";
import RouterDemo from "../components/RouterDemo.jsx";
import { Hits, useSearch } from "../components/DocSearch.jsx";
import { TECHNIQUES } from "../data/site.js";

const EXAMPLES = {
  comparison: "PostgreSQL vs MySQL, or two questions in one",
  exact: "an error code, a quoted phrase, snake_case, a file name",
  short: "refund policy",
  conceptual: "Why does a higher learning rate make the loss diverge?",
  simple: "any other clear question",
};

function Rules({ rules }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Kind of query</th>
            <th scope="col">Looks like</th>
            <th scope="col">Default technique</th>
            <th scope="col">What it does</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(rules).map(([category, technique]) => (
            <tr key={category}>
              <td>{category}</td>
              <td className="quiet">{EXAMPLES[category] ?? ""}</td>
              <td>{technique}</td>
              <td className="quiet">{TECHNIQUES[technique] ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Search() {
  const [query, setQuery] = useState("hybrid search");
  const search = useSearch(query, 8);
  return (
    <>
      <label className="visually-hidden" htmlFor="pg-search">Search ragforge's docs</label>
      <input
        id="pg-search"
        className="field"
        type="search"
        value={query}
        maxLength={300}
        autoComplete="off"
        placeholder="E_CONNRESET, maxTokens, rerank"
        onChange={(e) => setQuery(e.target.value)}
      />
      {search.error && <p className="note note--error" role="alert">{search.error}</p>}
      <div aria-live="polite">
        {search.data && (
          <>
            <p className="note">
              {search.data.results.length} of {search.data.passages} passages, ranked in {search.data.tookMs} ms. The number on each is its BM25 score.
            </p>
            <Hits data={search.data} query={query} wide scores snippetLength={220} />
          </>
        )}
        {!search.data && !search.error && <p className="note">Type two letters or more.</p>}
      </div>
    </>
  );
}

export default function Playground() {
  const meta = useApi(api.meta, []);
  return (
    <>
      <div className="page-head">
        <div className="container">
          <h1>Playground</h1>
          <p className="lead">Two parts of ragforge that need no API key, running on this site's server.</p>
        </div>
      </div>
      <div className="container page-body">
        <section className="tool" style={{ paddingTop: 0 }}>
          <h2>The router</h2>
          <p className="lead">rf.route() sorts a query into one of five kinds with plain rules, then picks a technique for it.</p>
          <div className="band--ink tool--ink">
            <RouterDemo id="pg-router" />
          </div>
          {meta.data && (
            <div style={{ marginTop: "var(--space-2xl)" }}>
              <Rules rules={meta.data.rules} />
            </div>
          )}
          <p className="note">
            With an eval result, auto() replaces these defaults with whatever won for each kind on your data.
          </p>
        </section>
        <section className="tool">
          <h2>Keyword search</h2>
          <p className="lead">The BM25 index behind hybrid search and the MCP server, here indexing ragforge's own docs. Exact terms such as option names work best.</p>
          <Search />
        </section>
      </div>
    </>
  );
}
