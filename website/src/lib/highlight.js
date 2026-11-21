import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import sql from "highlight.js/lib/languages/sql";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("sql", sql);

const ALIASES = { js: "javascript", sh: "bash", shell: "bash" };

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Returns escaped HTML with highlight spans; unknown languages come back as plain escaped text
export function highlight(code, lang) {
  const language = ALIASES[lang] ?? lang;
  if (language && hljs.getLanguage(language)) return hljs.highlight(code, { language }).value;
  return escapeHtml(code);
}
