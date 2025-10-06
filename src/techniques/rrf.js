// Reciprocal Rank Fusion for merging search results

// src/techniques/rrf.js
/**
 * RRF merges multiple ranked lists of results
 * @param {Array[]} rankedLists - Array of arrays of results
 * @param {number} k - constant for scoring
 */
function rrf(rankedLists, k = 60) {
  const scoreMap = {};

  rankedLists.forEach((list) => {
    list.forEach((item, idx) => {
      const score = 1 / (k + idx + 1);
      scoreMap[item] = (scoreMap[item] || 0) + score;
    });
  });

  // sort descending by score
  return Object.entries(scoreMap)
    .sort((a, b) => b[1] - a[1])
    .map(([item]) => item);
}

module.exports = { rrf };
