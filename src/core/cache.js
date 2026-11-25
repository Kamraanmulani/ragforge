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

// One exit hook for every file cache, flushing what is still unsaved
const pendingFlushes = new Set();
let exitHooked = false;

/**
 * createFileCache
 * A cache kept in a JSON file, so results survive between runs (e.g. the
 * context lines of contextual retrieval, which cost one LLM call per chunk).
 * Writes are batched and also flushed when the process exits. A missing or
 * unreadable file starts an empty cache.
 * @param {string} file
 * @param {object} [options]
 * @param {number} [options.flushMs=500] - Delay before pending writes are saved
 */
function createFileCache(file, { flushMs = 500 } = {}) {
  const fs = require("fs");
  const path = require("path");
  let entries = {};
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (data && typeof data === "object" && !Array.isArray(data)) entries = data;
  } catch {
    // No cache yet, or a damaged one: start empty and overwrite it on the next write
  }
  let dirty = false;
  let timer = null;

  function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!dirty) return;
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    // Write a temporary file and rename it, so a crash never leaves half a file
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entries));
    fs.renameSync(tmp, file);
    dirty = false;
  }
  pendingFlushes.add(flush);
  if (!exitHooked) {
    exitHooked = true;
    // Saving at exit is best effort: an unwritable folder must not crash the exit
    process.once("exit", () =>
      pendingFlushes.forEach((f) => {
        try {
          f();
        } catch {}
      })
    );
  }

  return {
    file,
    async get(key) {
      return Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : undefined;
    },
    async set(key, value) {
      entries[key] = value;
      dirty = true;
      if (!timer) {
        timer = setTimeout(flush, flushMs);
        timer.unref?.();
      }
    },
    /** Saves pending writes now */
    async flush() {
      flush();
    },
    clear() {
      entries = {};
      dirty = true;
    },
    get size() {
      return Object.keys(entries).length;
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

module.exports = { createMemoryCache, createFileCache, resolveCache };
