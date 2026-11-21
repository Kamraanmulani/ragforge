import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="container page-body">
      <h1>This page is not on the board.</h1>
      <p className="lead" style={{ marginTop: "var(--space-lg)" }}>The address may be mistyped, or the page has moved.</p>
      <p style={{ marginTop: "var(--space-xl)", display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
        <Link className="btn btn--primary" to="/">Go to the home page</Link>
        <Link className="btn" to="/docs">Read the docs</Link>
      </p>
    </div>
  );
}
