// Supabase adapter. Uses an RPC function you create with pgvector (see the README for the SQL).
const { toResult, requireClient, checkTopK } = require("./shared");

/**
 * createSupabaseStore
 * @param {object} options
 * @param {object} options.client - Supabase client (needs rpc(name, args))
 * @param {string} [options.fn="match_documents"] - RPC function taking a query embedding and a count
 * @param {string} [options.textField="content"]
 */
function createSupabaseStore(options) {
  const { client, fn = "match_documents", textField = "content" } = options;
  requireClient("Supabase", client, ["rpc"]);

  return {
    async query(vector, topK = 5) {
      const { data, error } = await client.rpc(fn, { query_embedding: vector, match_count: checkTopK(topK) });
      if (error) throw new Error(`[ragforge] Supabase ${fn} failed: ${error.message ?? error}`);
      return (data ?? []).map((row) => {
        const { id, [textField]: content, similarity, ...metadata } = row;
        return toResult({ id, content, score: similarity ?? null, metadata });
      });
    },
  };
}

module.exports = { createSupabaseStore };
