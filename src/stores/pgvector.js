// pgvector adapter (PostgreSQL). Pass a `pg` Pool or Client: `npm install pg`.
const { toResult, requireClient, checkTopK, sqlIdentifier } = require("./shared");

/**
 * createPgvectorStore
 * @param {object} options
 * @param {object} options.client - pg Pool or Client (needs query(text, params))
 * @param {string} options.table - Table holding the chunks, e.g. "documents"
 * @param {string} [options.idColumn="id"]
 * @param {string} [options.contentColumn="content"]
 * @param {string} [options.vectorColumn="embedding"] - pgvector column
 * @param {string} [options.metadataColumn="metadata"] - jsonb column
 * @param {string} [options.language="english"] - Text search config for searchText()
 */
function createPgvectorStore(options) {
  const {
    client,
    table,
    idColumn = "id",
    contentColumn = "content",
    vectorColumn = "embedding",
    metadataColumn = "metadata",
    language = "english",
  } = options;
  requireClient("pgvector", client, ["query"]);
  const t = sqlIdentifier(table, "table");
  const id = sqlIdentifier(idColumn, "column");
  const content = sqlIdentifier(contentColumn, "column");
  const vec = sqlIdentifier(vectorColumn, "column");
  const meta = sqlIdentifier(metadataColumn, "column");
  const lang = sqlIdentifier(language, "language");

  return {
    async query(vector, topK = 5) {
      const k = checkTopK(topK);
      // <=> is cosine distance, so 1 - distance is the similarity score
      const { rows } = await client.query(
        `SELECT ${id} AS id, ${content} AS content, ${meta} AS metadata, 1 - (${vec} <=> $1::vector) AS score
           FROM ${t} ORDER BY ${vec} <=> $1::vector LIMIT $2`,
        [`[${vector.join(",")}]`, k]
      );
      return rows.map(toResult);
    },

    async searchText(text, topK = 5) {
      const k = checkTopK(topK);
      const { rows } = await client.query(
        `SELECT ${id} AS id, ${content} AS content, ${meta} AS metadata,
                ts_rank(to_tsvector('${lang}', ${content}), plainto_tsquery('${lang}', $1)) AS score
           FROM ${t}
          WHERE to_tsvector('${lang}', ${content}) @@ plainto_tsquery('${lang}', $1)
          ORDER BY score DESC LIMIT $2`,
        [text, k]
      );
      return rows.map(toResult);
    },
  };
}

module.exports = { createPgvectorStore };
