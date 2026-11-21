import { useEffect, useState } from "react";

async function request(path, options) {
  let res;
  try {
    res = await fetch(`/api${path}`, options);
  } catch {
    throw new Error("The site's API is not reachable. Check that the server is running.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `The request failed (${res.status}).`);
  return body;
}

export const api = {
  meta: () => request("/meta"),
  docs: () => request("/docs"),
  changelog: () => request("/changelog"),
  search: (q, k = 6) => request(`/search?q=${encodeURIComponent(q)}&k=${k}`),
  route: (query) =>
    request("/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    }),
};

/**
 * useApi
 * Runs an API call on mount (and when deps change). A reply that arrives after
 * the component has moved on is dropped.
 */
export function useApi(call, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  useEffect(() => {
    let current = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    call()
      .then((data) => current && setState({ data, error: null, loading: false }))
      .catch((error) => current && setState({ data: null, error: error.message, loading: false }));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
