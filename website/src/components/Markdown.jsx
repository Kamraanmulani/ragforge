import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router-dom";
import Code from "./Code.jsx";
import { LINKS } from "../data/site.js";
import { slugify, textOf } from "../lib/slug.js";

// README links are written for GitHub; point them at the right place on this site
function DocLink({ href = "", children }) {
  if (href.startsWith("#")) return <a href={href}>{children}</a>;
  if (/CHANGELOG\.md$/i.test(href)) return <Link to="/changelog">{children}</Link>;
  if (href.startsWith("./")) return <a href={LINKS.blob + href.slice(2)}>{children}</a>;
  return <a href={href} rel="noreferrer">{children}</a>;
}

function heading(Tag) {
  return function Heading({ children }) {
    return <Tag id={slugify(textOf(children))}>{children}</Tag>;
  };
}

const components = {
  a: DocLink,
  h3: heading("h3"),
  h4: heading("h4"),
  // A fenced block arrives as <pre><code class="language-x">
  pre({ children }) {
    const code = Array.isArray(children) ? children[0] : children;
    const lang = /language-(\w+)/.exec(code?.props?.className ?? "")?.[1];
    return <Code code={textOf(code?.props?.children).replace(/\n$/, "")} lang={lang} />;
  },
  table({ children }) {
    return (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    );
  },
};

export default function Markdown({ children }) {
  return (
    <div className="prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
