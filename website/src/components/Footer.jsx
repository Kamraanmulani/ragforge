import { Link } from "react-router-dom";
import { LINKS } from "../data/site.js";

export default function Footer({ version }) {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          <div className="footer__brand">
            <img className="footer__logo" src="/logo.svg" alt="ragforge" width="480" height="112" />
          </div>
          <nav aria-label="Site">
            <h2>Site</h2>
            <ul>
              <li><Link to="/docs">Docs</Link></li>
              <li><Link to="/playground">Playground</Link></li>
              <li><Link to="/changelog">Changelog</Link></li>
            </ul>
          </nav>
          <nav aria-label="Read">
            <h2>Read</h2>
            <ul>
              <li><Link to="/docs#quick-start">Quick start</Link></li>
              <li><Link to="/docs#benchmark-techniques-on-your-data">The eval</Link></li>
              <li><Link to="/docs#auto-routing">Auto-routing</Link></li>
              <li><Link to="/docs#mcp-server-for-coding-agents">MCP server</Link></li>
              <li><Link to="/docs#api-reference">API reference</Link></li>
            </ul>
          </nav>
          <nav aria-label="Package">
            <h2>Package</h2>
            <ul>
              <li><a href={LINKS.npm}>npm</a></li>
              <li><a href={LINKS.github}>GitHub</a></li>
              <li><a href={LINKS.issues}>Issues</a></li>
              <li><a href={LINKS.license}>MIT licence</a></li>
            </ul>
          </nav>
        </div>
        <p className="footer__legal">
          <span>MIT licence. Made by Kamraan Mulani.</span>
          {version && <span>ragforge {version}</span>}
        </p>
      </div>
    </footer>
  );
}
