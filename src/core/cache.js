// LLM / embedding response cache

/**
 * createMemoryCache
 * In-process LRU cache. Any object with async get(key) / set(key, value)
 * (e.g. a Redis wrapper) can be passed as `cache` instead.
 */
function createMemoryCache({ maxEntries = 1000 } = {}) {
  const store = new Map();

  return {
    async get(key) {
      if (!store.has(key)) return undefined;
      // Re-insert to mark as most recently used
      const value = store.get(key);
      store.delete(key);
      store.set(key, value);
      return value;
    },

    async set(key, value) {
      store.delete(key);
      store.set(key, value);
      if (store.size > maxEntries) store.delete(store.keys().next().value);
    },

    clear() {
      store.clear();
    },

    get size() {
      return store.size;
    },
  };
}

/**
 * resolveCache
 * false/undefined -> no cache, true -> memory cache, object -> used as-is
 */
function resolveCache(cache) {
  if (!cache) return null;
  if (cache === true) return createMemoryCache();
  if (typeof cache.get === "function" && typeof cache.set === "function") return cache;
  throw new Error("[ragforge] cache must be true or an object with get(key) and set(key, value)");
}

module.exports = { createMemoryCache, resolveCache };
