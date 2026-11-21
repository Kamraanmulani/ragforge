import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";

// Wraps the query's words in <mark>, as React nodes (no HTML strings)
export function Marked({ text, query }) {
  const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? [])];
  if (!words.length) return text;
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(pattern).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

/**
 * useSearch
 * Debounced GET /api/search. Stale replies are dropped.
 */
export function useSearch(query, k = 6) {
  const [state, setState] = useState({ data: null, error: null, loading: false });
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let current = true;
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(() => {
      api
        .search(q, k)
        .then((data) => current && setState({ data, error: null, loading: false }))
        .catch((err) => current && setState({ data: null, error: err.message, loading: false }));
    }, 180);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, k]);
  return state;
}

export function Hits({ data, query, wide = false, scores = false, snippetLength = 160 }) {
  if (!data.results.length) return <p className="note">No passage matches "{query.trim()}". Keyword search needs a word that is in the docs.</p>;
  return (
    <ul className={`hits${wide ? " hits--wide" : ""}`}>
      {data.results.map((hit) => {
        const snippet = hit.snippet.length > snippetLength ? `${hit.snippet.slice(0, snippetLength).trimEnd()}...` : hit.snippet;
        return (
          <li key={hit.id}>
            <Link to={`/docs#${hit.anchor}`}>
              {scores && <span className="hits__score num" title="BM25 score">{hit.score.toFixed(2)}</span>}
              <b>{hit.heading ?? hit.sectionTitle}</b>
              <span><Marked text={snippet} query={query} /></span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
