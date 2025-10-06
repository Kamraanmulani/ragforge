// handles vector DB interactions (Qdrant now, pluggable later)

// src/core/vectorClient.js
let client = null;

/**
 * setVectorClient
 * Allows user to inject their own vector DB client
 */
function setVectorClient(userClient) {
  client = userClient;
}

/**
 * upsertVector
 * Stores vector in DB
 */
async function upsertVector(vector, metadata) {
  if (!client) return null; // DB optional
  return client.upsert(vector, metadata); // user-defined DB client
}

/**
 * queryVector
 * Queries DB for similar vectors
 */
async function queryVector(vector, topK = 5) {
  if (!client) return []; // fallback empty
  return client.query(vector, topK); // user-defined DB client
}

module.exports = { setVectorClient, upsertVector, queryVector };
