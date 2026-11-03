// Helpers shared by the vector store adapters. An adapter is a thin wrapper that
// turns your database client into the VectorStore shape ragforge uses:
//   query(vector, topK) -> [{ id, content, score, metadata }]
//   searchText(text, topK)  (optional, enables hybrid search)

/**
 * toResult
 * One match in the shape evaluate() and the pipeline read. `content` is the passage text.
 */
function toResult({ id, content, score, metadata }) {
  return { id: String(id), content: content ?? "", score: typeof score === "number" ? score : null, metadata: metadata ?? null };
}

/**
 * requireClient
 * Adapters take the client you already have. Failing early gives a clearer error than a crash later.
 */
function requireClient(name, client, methods) {
  if (!client || methods.some((m) => typeof client[m] !== "function")) {
    throw new Error(`[ragforge] ${name} adapter needs a client with ${methods.join(", ")}`);
  }
  return client;
}

/**
 * checkTopK
 * Positive whole numbers only, so a bad value never reaches the database
 */
function checkTopK(topK) {
  if (!Number.isInteger(topK) || topK < 1) throw new Error("[ragforge] topK must be a positive whole number");
  return topK;
}

// Table and column names are spliced into SQL, so only plain identifiers are allowed
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;
function sqlIdentifier(name, label) {
  if (!IDENTIFIER.test(name)) throw new Error(`[ragforge] ${label} "${name}" must be a plain SQL identifier like documents or public.documents`);
  return name;
}

module.exports = { toResult, requireClient, checkTopK, sqlIdentifier };
