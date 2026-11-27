// A saved, incremental index: chunks, vectors and a content-hash manifest on disk.
//
// syncIndex() compares the documents with the manifest and only does the work that
// changed: new and edited documents are chunked (and given context lines) again,
// deleted ones are dropped, and unchanged ones keep their chunks and vectors. Inside an
// edited document, a chunk whose text didn't change keeps its vector too, so editing
// one paragraph usually re-embeds one chunk. Changing the chunking, embedding model or
// contextual settings rebuilds everything, reusing any vector whose text still matches.
//
// Files in the index folder:
//   manifest.json  settings, and per document: content hash and chunk ids
//   chunks.json    every chunk: text, search text, context line, vector (base64 Float32)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { chunkDocuments, normalizeDocuments, checkChunking } = require("../eval/chunk");
const { createMemoryVectorStore } = require("../eval/memoryVectorStore");
const { mapLimit } = require("../core/limit");
const pkg = require("../../package.json");

const INDEX_VERSION = 1;
const DEFAULT_INDEX_DIR = ".ragforge/index";
const MANIFEST = "manifest.json";
const CHUNKS = "chunks.json";

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

// Vectors are stored as base64 Float32: about 4x smaller than JSON numbers, and
// precise enough for cosine similarity
function encodeVector(vector) {
  if (!vector || !vector.length) return "";
  return Buffer.from(new Float32Array(vector).buffer).toString("base64");
}

function decodeVector(text) {
  if (!text) return [];
  const bytes = Buffer.from(text, "base64");
  // Copy out of Node's shared buffer pool: a Float32Array needs a 4-byte-aligned offset
  return Array.from(new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)));
}

/**
 * describeSettings
 * What a saved index was built with. A different value means its chunks or vectors
 * no longer fit, and they are rebuilt.
 * @param {object} options
 * @param {object} options.chunking - { strategy, size, overlap }
 * @param {string|null} options.embeddings - Embedding provider and model, e.g. "openai:text-embedding-3-small"; null for keyword search only
 * @param {string|null} options.contextual - Model writing context lines, or null for none
 */
function describeSettings({ chunking, embeddings = null, contextual = null }) {
  return { chunking: checkChunking(chunking), embeddings, contextual };
}

// "chunk size 800 → 400, embeddings a → b": why a saved index is rebuilt
function settingsChanges(before, after) {
  const changes = [];
  const b = before.chunking ?? {};
  const a = after.chunking;
  if (b.strategy !== a.strategy) changes.push(`chunking ${b.strategy} → ${a.strategy}`);
  if (b.size !== a.size) changes.push(`chunk size ${b.size} → ${a.size}`);
  if ((b.overlap ?? 0) !== a.overlap) changes.push(`chunk overlap ${b.overlap ?? 0} → ${a.overlap}`);
  if ((before.embeddings ?? null) !== after.embeddings) changes.push(`embeddings ${before.embeddings ?? "none"} → ${after.embeddings ?? "none"}`);
  if ((before.contextual ?? null) !== after.contextual) changes.push(`context lines ${before.contextual ?? "off"} → ${after.contextual ?? "off"}`);
  return changes;
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/**
 * readIndex
 * The saved index in `dir`, or null when there is none. A damaged or half-written
 * index (the two files from different saves) is reported in `problem` and treated as empty.
 * @returns {{ manifest, entries, problem }|null}
 */
function readIndex(dir) {
  const manifestFile = path.join(dir, MANIFEST);
  if (!fs.existsSync(manifestFile)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    if (manifest.version !== INDEX_VERSION) {
      return { manifest: null, entries: [], problem: `it was saved by another version of ragforge (index version ${manifest.version}), so it is rebuilt` };
    }
    const data = JSON.parse(fs.readFileSync(path.join(dir, CHUNKS), "utf8"));
    if (data.generation !== manifest.generation) {
      return { manifest: null, entries: [], problem: "its files are from different saves (an earlier save was interrupted), so it is rebuilt" };
    }
    const entries = data.chunks.map((c) => ({ ...c, vector: decodeVector(c.vector) }));
    return { manifest, entries, problem: null };
  } catch (err) {
    return { manifest: null, entries: [], problem: `it could not be read (${err.message}), so it is rebuilt` };
  }
}

/**
 * saveIndex
 * Writes chunks first and the manifest last, both with a shared generation id and
 * through a temporary file, so an interrupted save is detected on the next read.
 */
function saveIndex(dir, { settings, documents, entries }) {
  fs.mkdirSync(dir, { recursive: true });
  const generation = crypto.randomUUID();
  const chunks = entries.map(({ vector, ...c }) => ({ ...c, vector: encodeVector(vector) }));
  writeAtomic(path.join(dir, CHUNKS), JSON.stringify({ version: INDEX_VERSION, generation, chunks }));
  const manifest = {
    version: INDEX_VERSION,
    generation,
    ragforge: pkg.version,
    savedAt: new Date().toISOString(),
    settings,
    chunkCount: entries.length,
    documents,
  };
  writeAtomic(path.join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function storeFrom(entries) {
  const store = createMemoryVectorStore();
  store.add(entries.map((e) => ({ id: e.id, content: e.content, indexText: e.indexText, vector: e.vector, metadata: { docId: e.docId } })));
  return store;
}

/**
 * syncIndex
 * Brings the saved index in `dir` up to date with `documents` and returns it in memory.
 * @param {object} options
 * @param {Array} options.documents - From loadDocuments(), or { id, content } / strings
 * @param {string} options.dir - Index folder (created when missing)
 * @param {object} [options.chunking] - { strategy, size, overlap }
 * @param {(text: string) => Promise<number[]>} [options.embed] - Embeds one text; omit for keyword search only
 * @param {string|null} [options.embeddings] - Embedding provider and model, e.g. "openai:text-embedding-3-small"
 * @param {function} [options.contextualize] - (chunks, documents) => Promise<{ chunks, ... }>, e.g. rf.contextualize
 * @param {string|null} [options.contextual] - Model writing context lines (part of the settings); null for none
 * @param {number} [options.concurrency=4]
 * @param {function} [options.onProgress] - ({ phase: "context" | "embed", done, total }) => void
 * @returns {Promise<object>} { store, entries, changes, embedded, reused, rebuilt, problem, context, manifest, dir }
 */
async function syncIndex(options) {
  const { documents, dir, embed = null, contextualize = null, concurrency = 4, onProgress = () => {} } = options;
  if (!dir) throw new Error("[ragforge] index: `dir` is required, e.g. .ragforge/index");
  if (contextualize && !options.contextual) throw new Error("[ragforge] index: name the `contextual` model when passing `contextualize`, so the settings record it");
  if (options.embeddings && !embed) throw new Error("[ragforge] index: `embeddings` is set but no `embed` function was given");
  const settings = describeSettings({ chunking: options.chunking ?? {}, embeddings: embed ? options.embeddings ?? "custom" : null, contextual: contextualize ? options.contextual : null });

  const saved = readIndex(dir);
  const previous = saved?.manifest ?? null;
  const changed = previous ? settingsChanges(previous.settings, settings) : [];
  const rebuilt = changed.length ? changed.join(", ") : null;

  // Vectors from the saved index, by the text they embed, for the same embedding model
  const vectors = new Map();
  if (saved && previous && previous.settings.embeddings === settings.embeddings && settings.embeddings) {
    for (const e of saved.entries) if (e.vector.length) vectors.set(sha256(e.indexText ?? e.content), e.vector);
  }
  const oldByDoc = new Map();
  if (saved && previous && !rebuilt) {
    for (const e of saved.entries) {
      if (!oldByDoc.has(e.docId)) oldByDoc.set(e.docId, []);
      oldByDoc.get(e.docId).push(e);
    }
  }

  // 1. Which documents changed. normalizeDocuments keeps the input order, so index i is documents[i]
  const docs = normalizeDocuments(documents).map((d, i) => ({ ...d, hash: sha256(d.content), source: documents[i]?.metadata?.source ?? null }));
  const known = previous ? previous.documents : {};
  const changes = { added: [], updated: [], removed: [], unchanged: 0 };
  const todo = [];
  for (const d of docs) {
    const before = known[d.docId];
    // A document with no text has no chunks: it is unchanged when its hash is, so it isn't redone every run
    const intact = before && (before.chunks.length === 0 || oldByDoc.has(d.docId));
    if (!rebuilt && intact && before.hash === d.hash) {
      changes.unchanged++;
    } else {
      (before ? changes.updated : changes.added).push(d.docId);
      todo.push(d);
    }
  }
  const current = new Set(docs.map((d) => d.docId));
  changes.removed = Object.keys(known).filter((id) => !current.has(id));

  // 2. Chunk the changed documents. Their ids are already unique, so chunk ids stay "<docId>#<n>"
  const changedDocs = todo.map((d) => ({ id: d.docId, content: d.content }));
  let fresh = todo.length ? await chunkDocuments(changedDocs, { ...settings.chunking, embed: embed ?? undefined, concurrency }) : [];
  let context = null;
  if (contextualize && fresh.length) {
    context = await contextualize(fresh, changedDocs);
    fresh = context.chunks;
  }

  // 3. Embed what is new; a chunk whose text is unchanged keeps its vector
  let embedded = 0;
  let reused = 0;
  let done = 0;
  const freshVectors = await mapLimit(fresh, concurrency, async (c) => {
    if (!embed) return [];
    const text = c.indexText ?? c.content;
    const hit = vectors.get(sha256(text));
    let vector = hit;
    if (hit) reused++;
    else {
      vector = await embed(text);
      embedded++;
    }
    onProgress({ phase: "embed", done: ++done, total: fresh.length });
    return vector;
  });
  const freshByDoc = new Map();
  fresh.forEach((c, i) => {
    const entry = { id: c.id, docId: c.docId, content: c.content, vector: freshVectors[i] };
    if (c.indexText && c.indexText !== c.content) entry.indexText = c.indexText;
    if (c.context) entry.context = c.context;
    if (c.heading) entry.heading = c.heading;
    if (!freshByDoc.has(c.docId)) freshByDoc.set(c.docId, []);
    freshByDoc.get(c.docId).push(entry);
  });

  // 4. In document order, so a chunk's neighbours are its neighbours in the text
  const redone = new Set(todo.map((d) => d.docId));
  const chunksOf = (d) => (redone.has(d.docId) ? freshByDoc.get(d.docId) ?? [] : oldByDoc.get(d.docId) ?? []);
  const entries = docs.flatMap(chunksOf);
  const manifestDocs = Object.fromEntries(
    docs.map((d) => [d.docId, { hash: d.hash, chunks: chunksOf(d).map((e) => e.id), ...(d.source && { source: d.source }) }])
  );

  const nothingChanged = saved && previous && !rebuilt && !todo.length && !changes.removed.length;
  const manifest = nothingChanged ? previous : saveIndex(dir, { settings, documents: manifestDocs, entries });
  return {
    dir,
    store: storeFrom(entries),
    entries,
    changes,
    embedded,
    reused,
    rebuilt,
    problem: saved?.problem ?? null,
    saved: !nothingChanged,
    context,
    manifest,
  };
}

/**
 * loadIndex
 * Reads a saved index without the documents, e.g. to serve it at startup.
 * @param {string} dir
 * @param {object} [options]
 * @param {string|null} [options.embeddings] - Expected embedding provider and model; a mismatch throws,
 *   because query vectors from another model can't be compared with the saved ones
 * @returns {{ store, entries, manifest }}
 */
function loadIndex(dir, options = {}) {
  const saved = readIndex(dir);
  if (!saved) throw new Error(`[ragforge] No saved index in ${dir}. Build one with: npx ragforge index --docs <path> --index ${dir}`);
  if (saved.problem) throw new Error(`[ragforge] The index in ${dir} can't be used: ${saved.problem.replace(/, so it is rebuilt$/, "")}. Run ragforge index again.`);
  const built = saved.manifest.settings.embeddings;
  if (options.embeddings !== undefined && built !== options.embeddings) {
    throw new Error(`[ragforge] The index in ${dir} was built with embeddings ${built ?? "none (keyword search only)"}, but this instance uses ${options.embeddings ?? "none"}. Use the same model, or run ragforge index again.`);
  }
  return { store: storeFrom(saved.entries), entries: saved.entries, manifest: saved.manifest };
}

// "openai:text-embedding-3-small"
function embeddingsId(embedder) {
  return embedder ? `${embedder.name}:${embedder.embeddingModel}` : null;
}

/**
 * summary
 * One line on what a sync did, for logs
 */
function summary(result) {
  const { changes } = result;
  const parts = [];
  if (result.rebuilt) parts.push(`rebuilt (${result.rebuilt})`);
  if (result.problem) parts.push(`rebuilt: ${result.problem.replace(/, so it is rebuilt$/, "")}`);
  parts.push(`${changes.added.length} added, ${changes.updated.length} updated, ${changes.removed.length} removed, ${changes.unchanged} unchanged`);
  const work = [];
  if (result.embedded || result.reused) work.push(`embedded ${result.embedded} chunk${result.embedded === 1 ? "" : "s"}, reused ${result.reused}`);
  if (result.context) work.push(`${result.context.chunks.length - result.context.cached} context line${result.context.chunks.length - result.context.cached === 1 ? "" : "s"} written`);
  return `${parts.join(" · ")}${work.length ? ` · ${work.join(", ")}` : ""} · ${result.entries.length} chunks${result.saved ? "" : " · nothing to save"}`;
}

module.exports = { syncIndex, loadIndex, readIndex, describeSettings, settingsChanges, embeddingsId, summary, encodeVector, decodeVector, INDEX_VERSION, DEFAULT_INDEX_DIR };
