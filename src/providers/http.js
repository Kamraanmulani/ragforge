// Shared HTTP helpers for the built-in providers (plain fetch, no SDK dependency)
require("../config/env");

/**
 * requireKey
 * Read lazily, so requiring ragforge never fails when a provider isn't used
 */
function requireKey(provider, envName, apiKey) {
  const key = apiKey ?? process.env[envName];
  if (!key) {
    throw new Error(`[ragforge] Missing ${envName} for ${provider}. Set it in your environment or in a .env file in your project root.`);
  }
  return key;
}

/**
 * postJson
 * POST a JSON body and return the parsed JSON reply. Non-2xx replies throw with the provider's message.
 */
async function postJson(provider, url, headers, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`[ragforge] ${provider} request failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * streamPost
 * POST and return the response with its body still open, for streamed replies
 */
async function streamPost(provider, url, headers, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`[ragforge] ${provider} request failed: ${res.status} ${await res.text()}`);
  }
  return res;
}

/**
 * readLines
 * Splits a streamed body into lines. Works for SSE ("data: ...") and NDJSON.
 * Chunks may split a line anywhere, so text is buffered until a newline arrives.
 */
async function* readLines(body) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      yield buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield buffer.replace(/\r$/, "");
}

module.exports = { requireKey, postJson, streamPost, readLines };
