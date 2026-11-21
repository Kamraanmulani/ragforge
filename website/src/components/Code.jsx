import { useMemo } from "react";
import { highlight } from "../lib/highlight.js";
import Copy from "./Copy.jsx";

// `slot` marks a built product sample (the page's picture), as on the home page
export default function Code({ code, lang, label, slot }) {
  const html = useMemo(() => highlight(code, lang), [code, lang]);
  return (
    <div className="code" data-slot={slot}>
      <pre tabIndex={0} aria-label={label ?? `${lang || "code"} sample`}>
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
      <Copy text={code} />
    </div>
  );
}
