// LanceDB adapter. Pass a table from @lancedb/lancedb (npm install @lancedb/lancedb).
const { toResult, requireClient, checkTopK } = require("./shared");

/**
 * createLanceDBStore
 * LanceDB returns a distance (L2 by default). Score is 1 / (1 + distance), so higher still means closer.
 * @param {object} options
 * @param {object} options.table - LanceDB table (needs search(vector))
 * @param {string} [options.idField="id"]
 * @param {string} [options.textField="text"]
 */
function createLanceDBStore(options) {
  const { table, idField = "id", textField = "text" } = options;
  requireClient("LanceDB", table, ["search"]);

  return {
    async query(vector, topK = 5) {
      const rows = await table.search(vector).limit(checkTopK(topK)).toArray();
      return rows.map((row) => {
        const { [idField]: id, [textField]: content, _distance, vector: _vector, ...metadata } = row;
        return toResult({ id, content, score: typeof _distance === "number" ? 1 / (1 + _distance) : null, metadata });
      });
    },
  };
}

module.exports = { createLanceDBStore };
