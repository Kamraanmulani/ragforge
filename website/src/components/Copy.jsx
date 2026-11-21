import { useEffect, useRef, useState } from "react";

// Copies text and says so on the button itself for two seconds
export default function Copy({ text, label = "Copy", className = "btn" }) {
  const [state, setState] = useState("idle");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button type="button" className={className} onClick={copy}>
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : label}</span>
    </button>
  );
}

// A shell command on a plate with its copy button
export function Command({ children, primary = false, wide = false }) {
  return (
    <div className={`cmd${wide ? " cmd--wide" : ""}`}>
      <code tabIndex={0}>{children}</code>
      <Copy text={children} className={primary ? "btn btn--primary" : "btn"} />
    </div>
  );
}
