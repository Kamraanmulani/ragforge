import { api, useApi } from "../lib/api.js";
import Markdown from "../components/Markdown.jsx";

function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export default function Changelog() {
  const { data, error, loading } = useApi(api.changelog, []);
  return (
    <>
      <div className="page-head">
        <div className="container">
          <h1>Changelog</h1>
          <p className="lead">Every release, newest first. ragforge follows semantic versioning.</p>
        </div>
      </div>
      <div className="container page-body">
        {loading && <p className="status">Loading releases...</p>}
        {error && <p className="status note--error" role="alert">{error}</p>}
        {data?.releases.map((release) => (
          <article key={release.version} id={`v${release.version}`} className="release">
            <header>
              <h2 className="release__ver">{release.version}</h2>
              {release.date && <time dateTime={release.date}>{formatDate(release.date)}</time>}
            </header>
            <Markdown>{release.markdown}</Markdown>
          </article>
        ))}
      </div>
    </>
  );
}
