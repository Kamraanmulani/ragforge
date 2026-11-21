import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, useApi } from "../lib/api.js";
import Markdown from "../components/Markdown.jsx";
import { Hits, useSearch } from "../components/DocSearch.jsx";

// Marks the section being read: the last one whose top has passed under the nav
function useActiveSection(sections) {
  const [active, setActive] = useState(null);
  useEffect(() => {
    if (!sections?.length) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = sections[0].id;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= 140) current = s.id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [sections]);
  return active;
}

export default function Docs() {
  const { data, error, loading } = useApi(api.docs, []);
  const { hash } = useLocation();
  const [query, setQuery] = useState("");
  const search = useSearch(query, 6);
  const active = useActiveSection(data?.sections);

  // Anchors exist only once the docs have loaded
  useEffect(() => {
    if (!data || !hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [data, hash]);

  return (
    <>
      <div className="page-head">
        <div className="container">
          <h1>Docs</h1>
          <p className="lead">Everything in the README{data ? `, for ragforge ${data.version}` : ""}.</p>
        </div>
      </div>
      <div className="container page-body">
        {loading && <p className="status">Loading the docs...</p>}
        {error && <p className="status note--error" role="alert">{error}</p>}
        {data && (
          <div className="docs">
            <aside className="docs__side">
              <label htmlFor="doc-search">Search the docs</label>
              <input
                id="doc-search"
                className="field"
                type="search"
                value={query}
                maxLength={300}
                autoComplete="off"
                placeholder="rerankK, hybrid, MCP"
                onChange={(e) => setQuery(e.target.value)}
              />
              {search.error && <p className="note note--error" role="alert">{search.error}</p>}
              {search.data ? (
                <div aria-live="polite">
                  <Hits data={search.data} query={query} snippetLength={110} />
                  <p className="note">
                    <small>ragforge's own BM25 index, {search.data.passages} passages.</small>
                  </p>
                </div>
              ) : (
                <nav aria-label="Contents">
                  <ul className="toc">
                    {data.sections.map((s) => (
                      <li key={s.id}>
                        <a href={`#${s.id}`} aria-current={active === s.id ? "true" : undefined}>{s.title}</a>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}
            </aside>
            <div>
              {data.sections.map((s) => (
                <section key={s.id} id={s.id} className="docs__section">
                  <h2>{s.title}</h2>
                  <Markdown>{s.markdown}</Markdown>
                </section>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
