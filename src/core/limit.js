// Runs async tasks with at most `concurrency` in flight (avoids API rate limits)

/**
 * mapLimit
 * Like Promise.all(items.map(fn)) but bounded; results keep input order.
 */
async function mapLimit(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker);
  await Promise.all(workers);
  return results;
}

module.exports = { mapLimit };
