// Watches document folders and files, and calls back (debounced, one run at a time)
// when something changes. Used by `ragforge index --watch` and `ragforge mcp --watch`.
const fs = require("fs");
const path = require("path");

const isURL = (source) => /^https?:\/\//i.test(source);

// Hidden entries (.git, .ragforge/index) and node_modules never trigger a run: the index
// writes its own files, and a watcher that saw them would rebuild in a loop
function ignored(relative) {
  return String(relative)
    .split(/[\\/]/)
    .some((part) => part.startsWith(".") || part === "node_modules");
}

function subfolders(dir) {
  const out = [dir];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !ignored(e.name)) out.push(...subfolders(path.join(dir, e.name)));
  }
  return out;
}

/**
 * watchSources
 * @param {string[]} sources - Files and folders (URLs are skipped: they can't be watched)
 * @param {object} options
 * @param {string} [options.cwd=process.cwd()]
 * @param {(changed: string[]) => Promise<void>|void} options.onChange - Gets the changed paths
 * @param {number} [options.debounceMs=300] - Waits for a burst of saves to settle
 * @param {(err: Error) => void} [options.onError] - A failed run; watching continues
 * @returns {{ close(): void, watching: string[], skipped: string[] }}
 */
function watchSources(sources, { cwd = process.cwd(), onChange, debounceMs = 300, onError = () => {} } = {}) {
  const watchers = [];
  const watching = [];
  const skipped = [];
  let timer = null;
  let running = false;
  let again = false;
  let closed = false;
  const pending = new Set();

  async function run() {
    if (running) {
      again = true;
      return;
    }
    running = true;
    const changed = [...pending];
    pending.clear();
    try {
      await onChange(changed);
    } catch (err) {
      onError(err);
    } finally {
      running = false;
      // Changes that came in during the run get their own run
      if (again && !closed) {
        again = false;
        schedule();
      }
    }
  }

  function schedule() {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(run, debounceMs);
  }

  function track(target, filter, recursive = true) {
    const handler = (event, name) => {
      if (closed) return;
      const relative = name ? String(name) : "";
      if (relative && (ignored(relative) || !filter(relative))) return;
      pending.add(path.join(target, relative));
      schedule();
    };
    let watcher;
    try {
      watcher = fs.watch(target, { recursive }, handler);
    } catch (err) {
      // Node 18 on Linux has no recursive watching: watch every folder instead
      // (folders created later are picked up on the next change in their parent)
      if (err.code !== "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM") throw err;
      for (const dir of subfolders(target)) {
        const w = fs.watch(dir, (event, name) => handler(event, name ? path.relative(target, path.join(dir, String(name))) : ""));
        w.on("error", onError);
        watchers.push(w);
      }
      return;
    }
    watcher.on("error", onError);
    watchers.push(watcher);
  }

  for (const source of sources) {
    if (isURL(source)) {
      skipped.push(source);
      continue;
    }
    const target = path.resolve(cwd, source);
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      track(target, () => true);
    } else {
      // Editors often save by replacing the file, which ends a watch on the file itself:
      // watch its folder (not its subfolders) and keep only events for this file
      const base = path.basename(target);
      track(path.dirname(target), (name) => name === base, false);
    }
    watching.push(target);
  }

  return {
    watching,
    skipped,
    close() {
      closed = true;
      clearTimeout(timer);
      for (const w of watchers) w.close();
    },
  };
}

module.exports = { watchSources, ignored };
