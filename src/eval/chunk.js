// Splits documents into retrieval chunks, with a choice of strategies:
//   paragraph         packs whole paragraphs (the default, and the only strategy before 2.4)
//   fixed             fixed-size windows of characters, cut at a word, with optional overlap
//   sentence          packs whole sentences, never cutting one, with optional overlap
//   markdown-heading  one section per chunk, each starting with its heading trail ("Setup > Windows")
//   semantic          sentences, split where the topic shifts (needs embeddings)
//   code              source files split by top-level declaration (other documents: paragraph)
// Every chunk is at most `size` characters.
const { mapLimit } = require("../core/limit");
const { isCodeFile } = require("../core/fileTypes");

const CHUNK_STRATEGIES = ["paragraph", "fixed", "sentence", "markdown-heading", "semantic", "code"];
const DEFAULT_STRATEGY = "paragraph";
// Strategies that can repeat the end of one chunk at the start of the next
const OVERLAP_STRATEGIES = new Set(["fixed", "sentence"]);

/**
 * checkChunking
 * Validates chunking options before any work (or API call) happens.
 * @returns {{ strategy: string, size: number, overlap: number }}
 */
function checkChunking({ strategy = DEFAULT_STRATEGY, size = 800, overlap = 0 } = {}) {
  if (!CHUNK_STRATEGIES.includes(strategy)) {
    throw new Error(`[ragforge] Unknown chunking strategy "${strategy}". Use one of: ${CHUNK_STRATEGIES.join(", ")}.`);
  }
  if (!Number.isInteger(size) || size < 1) throw new Error("[ragforge] chunk size must be a positive whole number");
  if (!Number.isInteger(overlap) || overlap < 0) throw new Error("[ragforge] chunk overlap must be a whole number, 0 or more");
  if (overlap > 0 && !OVERLAP_STRATEGIES.has(strategy)) {
    throw new Error(`[ragforge] chunk overlap works with the ${[...OVERLAP_STRATEGIES].join(" and ")} strategies, not ${strategy}`);
  }
  if (overlap >= size) throw new Error(`[ragforge] chunk overlap (${overlap}) must be smaller than the chunk size (${size})`);
  return { strategy, size, overlap };
}

// Greedily joins pieces into chunks of up to `size` characters
function pack(pieces, size, separator = " ") {
  const chunks = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + separator.length + piece.length > size) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current}${separator}${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function paragraphsOf(text) {
  return String(text)
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * paragraphChunks
 * Packs paragraphs into chunks of up to `size` characters. Paragraphs longer
 * than `size` are split on sentence boundaries, then hard-split if needed.
 * No overlap, so each fact lives in exactly one chunk (keeps eval scoring fair).
 * Kept exactly as in 2.3, so existing chunk ids and CI baselines don't move.
 */
function paragraphChunks(text, size) {
  const pieces = [];
  for (const clean of paragraphsOf(text)) {
    if (clean.length <= size) {
      pieces.push(clean);
      continue;
    }
    for (const sentence of clean.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [clean]) {
      const s = sentence.trim();
      for (let i = 0; i < s.length; i += size) pieces.push(s.slice(i, i + size));
    }
  }
  return pack(pieces, size);
}

/**
 * fixedChunks
 * Windows of up to `size` characters over the whole text, ending at a word
 * boundary when one is in the second half of the window. With `overlap`, each
 * window starts up to that many characters before the previous one ended.
 */
function fixedChunks(text, size, overlap = 0) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const space = clean.lastIndexOf(" ", end);
      if (space > start + size / 2) end = space;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    let next = Math.max(end - overlap, start + 1);
    // Begin the overlap at a word, not in the middle of one
    if (next < end && clean[next - 1] !== " ") {
      const space = clean.indexOf(" ", next);
      next = space !== -1 && space < end ? space + 1 : end;
    }
    while (clean[next] === " ") next++;
    start = next;
  }
  return chunks.filter(Boolean);
}

// A period after these is not the end of a sentence
const ABBREVIATION = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf|al|approx|incl|fig|eq|sec|mr|mrs|ms|dr|prof|inc|ltd|jr|sr|st|[A-Z])\.$/i;
// End punctuation, then whitespace, then something that can start a sentence
const BOUNDARY = /([.!?]+["'”’)\]]*)\s+(?=["'“‘(\[]?[\p{Lu}\p{N}])/gu;

/**
 * splitSentences
 * Sentences of one paragraph. Version numbers ("v2.1"), file names and
 * common abbreviations ("e.g.") don't end a sentence.
 */
function splitSentences(paragraph) {
  const clean = String(paragraph).replace(/\s+/g, " ").trim();
  const sentences = [];
  let start = 0;
  for (const m of clean.matchAll(BOUNDARY)) {
    const end = m.index + m[1].length;
    if (m[1] === "." && ABBREVIATION.test(clean.slice(start, end))) continue;
    sentences.push(clean.slice(start, end));
    start = m.index + m[0].length;
  }
  if (start < clean.length) sentences.push(clean.slice(start));
  return sentences.map((s) => s.trim()).filter(Boolean);
}

// Every sentence of the text, each at most `size` characters (longer ones are cut at words)
function sentencesOf(text, size) {
  return paragraphsOf(text)
    .flatMap(splitSentences)
    .flatMap((s) => (s.length <= size ? [s] : fixedChunks(s, size)));
}

/**
 * sentenceChunks
 * Packs whole sentences into chunks of up to `size` characters. With `overlap`,
 * a chunk starts with the previous chunk's last sentences, up to that many characters.
 */
function sentenceChunks(text, size, overlap = 0) {
  const sentences = sentencesOf(text, size);
  if (!overlap) return pack(sentences, size);

  const chunks = [];
  let current = [];
  let length = 0;
  for (const s of sentences) {
    if (current.length && length + 1 + s.length > size) {
      chunks.push(current.join(" "));
      // Carry trailing sentences that fit in the overlap and leave room for this one
      const carried = [];
      let carriedLength = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        const add = current[i].length + (carried.length ? 1 : 0);
        if (carriedLength + add > overlap || carriedLength + add + 1 + s.length > size) break;
        carried.unshift(current[i]);
        carriedLength += add;
      }
      current = carried;
      length = carriedLength;
    }
    length += (current.length ? 1 : 0) + s.length;
    current.push(s);
  }
  if (current.length) chunks.push(current.join(" "));
  return chunks;
}

/**
 * markdownSections
 * Splits Markdown at ATX headings (# to ######), ignoring # lines inside
 * fenced code blocks. Each section keeps the trail of headings above it.
 * @returns {Array<{ trail: string[], body: string }>}
 */
function markdownSections(text) {
  const sections = [];
  const trail = [];
  let current = { trail: [], lines: [] };
  let fence = null;
  for (const line of String(text).split(/\r?\n/)) {
    const fenceMark = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMark) {
      if (!fence) fence = fenceMark[1][0];
      else if (fenceMark[1][0] === fence) fence = null;
    }
    const heading = !fence && !fenceMark && line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      sections.push(current);
      const level = heading[1].length;
      trail.length = level - 1;
      trail[level - 1] = heading[2].trim();
      current = { trail: trail.filter(Boolean), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  sections.push(current);
  return sections.map(({ trail: t, lines }) => ({ trail: t, body: lines.join("\n") }));
}

/**
 * headingChunks
 * One chunk per Markdown section, starting with its heading trail on its own
 * line, so a passage found on its own still says where it came from. Sections
 * longer than `size` are split by paragraph and every part keeps the trail.
 * A heading with no text under it lives on in the trail of the sections below.
 */
function headingParts(text, size) {
  const parts = [];
  for (const { trail, body } of markdownSections(text)) {
    if (!body.trim()) continue;
    let heading = trail.join(" > ");
    // A trail that would leave less than half the chunk for text is dropped
    if (heading.length + 1 > size / 2) heading = "";
    const room = heading ? size - heading.length - 1 : size;
    for (const part of paragraphChunks(body, room)) parts.push(heading ? { heading, text: `${heading}\n${part}` } : { text: part });
  }
  return parts;
}

function headingChunks(text, size) {
  return headingParts(text, size).map((p) => p.text);
}

/**
 * passageText
 * A chunk's text without the heading trail markdown-heading puts in front of it.
 * Questions remember a passage by its opening words, and the trail isn't there
 * when the same passage is chunked with another strategy.
 */
function passageText(chunk) {
  return chunk.heading ? chunk.content.slice(chunk.heading.length + 1) : chunk.content;
}

// Lines that close the block above them: "}", "});", "]", "end"
const CLOSES_BLOCK = /^(?:[\]})]|end\b)/;
// Comments and decorators belong to the declaration below them
const LEADS_BLOCK = /^(?:\/\/|\/\*|\*|#|@|"""|'''|--)/;

/**
 * codeUnits
 * Top-level units of a source file: a declaration starts at a line with no
 * indentation, and takes the comments, decorators and blank lines just above it.
 * Language-agnostic, so it works for JS/TS, Python, Go, Rust, Java and similar.
 */
function codeUnits(text) {
  const units = [];
  let current = [];
  let pending = [];
  const flush = () => {
    const unit = current.join("\n").replace(/^\s*\n|\s+$/g, "");
    if (unit.trim()) units.push(unit);
  };
  // The closing mark of a block comment or docstring that is still open above a declaration
  let openComment = null;
  for (const raw of String(text).replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (openComment) {
      pending.push(line);
      if (line.includes(openComment)) openComment = null;
      continue;
    }
    const topLevel = line.length > 0 && !/^\s/.test(line);
    if (!line || (topLevel && LEADS_BLOCK.test(line))) {
      pending.push(line);
      if (line.startsWith("/*") && !line.includes("*/", 2)) openComment = "*/";
      for (const quote of ['"""', "'''"]) if (line.startsWith(quote) && !line.includes(quote, 3)) openComment = quote;
      continue;
    }
    if (topLevel && !CLOSES_BLOCK.test(line)) {
      flush();
      current = [...pending, line];
    } else {
      current.push(...pending, line);
    }
    pending = [];
  }
  current.push(...pending);
  flush();
  return units;
}

/**
 * codeChunks
 * Packs top-level declarations into chunks of up to `size` characters, keeping
 * line breaks and indentation. A declaration longer than `size` is split at lines.
 */
function codeChunks(text, size) {
  const pieces = codeUnits(text).flatMap((unit) => {
    if (unit.length <= size) return [unit];
    const lines = unit.split("\n").flatMap((line) => {
      const out = [];
      for (let i = 0; i < line.length; i += size) out.push(line.slice(i, i + size));
      return out.length ? out : [""];
    });
    return pack(lines, size, "\n").map((c) => c.replace(/^\n+|\n+$/g, "")).filter((c) => c.trim());
  });
  return pack(pieces, size, "\n\n");
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * (b[i] ?? 0);
    na += a[i] * a[i];
    nb += (b[i] ?? 0) * (b[i] ?? 0);
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * semanticChunks
 * Embeds each sentence, then starts a new chunk where the next sentence is
 * least like the one before: the largest
 * (1 - breakpoint) share of drops in similarity. Chunks still stay under
 * `size`, and a chunk under a quarter of `size` isn't split off on a topic shift.
 * Costs one embedding call per sentence.
 * @param {string} text
 * @param {object} options
 * @param {number} options.size
 * @param {(text: string) => Promise<number[]>} options.embed
 * @param {number} [options.breakpoint=0.9] - Percentile of drops in similarity that split (0 to 1)
 * @param {number} [options.concurrency=4]
 */
async function semanticChunks(text, { size, embed, breakpoint = 0.9, concurrency = 4 }) {
  const sentences = sentencesOf(text, size);
  if (sentences.length <= 2) return pack(sentences, size);

  // Sentences are embedded one by one: windows of neighbours would smear each
  // topic shift over several sentence pairs and blur where the split goes
  const vectors = await mapLimit(sentences, concurrency, (s) => embed(s));
  // distances[i]: how far sentence i+1 moved from sentence i
  const distances = vectors.slice(1).map((v, i) => 1 - cosine(vectors[i], v));

  const lowest = Math.min(...distances);
  const ranked = distances.map((d, i) => ({ d, i })).sort((a, b) => b.d - a.d);
  const count = Math.ceil((1 - breakpoint) * distances.length);
  // A "drop" equal to the smallest one is no topic shift (e.g. every vector the same)
  const breaks = new Set(ranked.slice(0, count).filter((x) => x.d > lowest).map((x) => x.i));

  const minSize = Math.floor(size / 4);
  const chunks = [];
  let current = sentences[0];
  for (let i = 1; i < sentences.length; i++) {
    const s = sentences[i];
    if (current.length + 1 + s.length > size || (breaks.has(i - 1) && current.length >= minSize)) {
      chunks.push(current);
      current = s;
    } else {
      current = `${current} ${s}`;
    }
  }
  chunks.push(current);
  return chunks;
}

const SYNC_CHUNKERS = {
  paragraph: (text, { size }) => paragraphChunks(text, size),
  fixed: (text, { size, overlap }) => fixedChunks(text, size, overlap),
  sentence: (text, { size, overlap }) => sentenceChunks(text, size, overlap),
  "markdown-heading": (text, { size }) => headingChunks(text, size),
  code: (text, { size }) => codeChunks(text, size),
};

/**
 * chunkText
 * Splits one text with any strategy but `semantic`, which needs embeddings:
 * use chunkDocuments() with `embed` for that.
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.size=800] - Max characters per chunk
 * @param {string} [options.strategy="paragraph"]
 * @param {number} [options.overlap=0] - Characters repeated between chunks (fixed and sentence)
 * @returns {string[]}
 */
function chunkText(text, options = {}) {
  const opts = checkChunking(options);
  if (opts.strategy === "semantic") {
    throw new Error("[ragforge] semantic chunking needs embeddings: use chunkDocuments(documents, { strategy: 'semantic', embed })");
  }
  return SYNC_CHUNKERS[opts.strategy](String(text ?? ""), opts);
}

/**
 * chunkDocuments
 * Chunk ids are "<document id>#<n>", counting from 1.
 * With the `code` strategy, documents whose id has a source code extension
 * (and plain strings) are split by declaration; other documents by paragraph.
 * @param {Array<string | {id?: string, content: string}>} documents
 * @param {object} [options]
 * @param {number} [options.size=800]
 * @param {string} [options.strategy="paragraph"] - See CHUNK_STRATEGIES
 * @param {number} [options.overlap=0] - fixed and sentence strategies only
 * @param {(text: string) => Promise<number[]>} [options.embed] - Needed for `semantic`
 * @param {number} [options.breakpoint=0.9] - semantic: percentile of similarity drops that split
 * @param {number} [options.concurrency=4] - semantic: parallel embedding calls
 * @returns {Promise<Array<{id: string, docId: string, content: string, heading?: string}>>}
 */
async function chunkDocuments(documents, options = {}) {
  const opts = checkChunking(options);
  if (opts.strategy === "semantic" && typeof options.embed !== "function") {
    throw new Error("[ragforge] semantic chunking needs embeddings: pass `embed: (text) => vector`");
  }
  // Repeated ids (e.g. two README.md files) would make chunk ids ambiguous
  // and let eval count a hit on the wrong document, so suffix them
  const seen = new Map();
  const docs = documents.map((doc, d) => {
    const named = typeof doc === "object" && doc !== null && doc.id != null;
    const baseId = named ? String(doc.id) : `doc${d + 1}`;
    const count = (seen.get(baseId) ?? 0) + 1;
    seen.set(baseId, count);
    const docId = count === 1 ? baseId : `${baseId}~${count}`;
    const content = String((typeof doc === "string" ? doc : doc?.content) ?? "");
    return { docId, content, isCode: !named || isCodeFile(baseId) };
  });

  const pieces = [];
  for (const doc of docs) {
    if (opts.strategy === "semantic") {
      pieces.push(await semanticChunks(doc.content, { ...opts, embed: options.embed, breakpoint: options.breakpoint, concurrency: options.concurrency }));
    } else if (opts.strategy === "markdown-heading") {
      pieces.push(headingParts(doc.content, opts.size));
    } else {
      const strategy = opts.strategy === "code" && !doc.isCode ? DEFAULT_STRATEGY : opts.strategy;
      pieces.push(SYNC_CHUNKERS[strategy](doc.content, opts));
    }
  }
  return docs.flatMap((doc, d) =>
    pieces[d].map((piece, i) => {
      const chunk = { id: `${doc.docId}#${i + 1}`, docId: doc.docId, content: typeof piece === "string" ? piece : piece.text };
      // markdown-heading: the trail at the start of `content`, see passageText()
      if (piece.heading) chunk.heading = piece.heading;
      return chunk;
    })
  );
}

module.exports = {
  chunkText,
  chunkDocuments,
  checkChunking,
  passageText,
  splitSentences,
  markdownSections,
  codeUnits,
  CHUNK_STRATEGIES,
  DEFAULT_STRATEGY,
};
