import { Link, NavLink } from "react-router-dom";
import { LINKS } from "../data/site.js";

export default function Nav() {
  return (
    <header className="nav">
      <nav className="container nav__in" aria-label="Main">
        <ul className="nav__links nav__site">
          <li><NavLink to="/docs">Docs</NavLink></li>
          <li><NavLink to="/playground">Playground</NavLink></li>
          <li><NavLink to="/changelog">Changelog</NavLink></li>
        </ul>
        <Link className="wordmark" to="/" aria-label="ragforge, home">
          <img src="/mark.svg" alt="" width="36" height="36" />
          ragforge
        </Link>
        <ul className="nav__links nav__links--end">
          <li><a href={LINKS.github}>GitHub</a></li>
          <li><a href={LINKS.npm}>npm</a></li>
        </ul>
      </nav>
    </header>
  );
}
