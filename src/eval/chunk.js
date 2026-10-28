// Splits documents into retrieval chunks

/**
 * chunkText
 * Packs paragraphs into chunks of up to `size` characters. Paragraphs longer
 * than `size` are split on sentence boundaries, then hard-split if needed.
 * No overlap, so each fact lives in exactly one chunk (keeps eval scoring fair).
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.size=800]
 * @returns {string[]}
 */
function chunkText(text, { size = 800 } = {}) {
  const pieces = [];
  for (const para of text.split(/\n\s*\n/)) {
    const clean = para.replace(/\s+/g, " ").trim();
    if (!clean) continue;
    if (clean.length <= size) {
      pieces.push(clean);
      continue;
    }
    for (const sentence of clean.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [clean]) {
      const s = sentence.trim();
      for (let i = 0; i < s.length; i += size) pieces.push(s.slice(i, i + size));
    }
  }

  const chunks = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + 1 + piece.length > size) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current} ${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * chunkDocuments
 * @param {Array<string | {id?: string, content: string}>} documents
 * @returns {Array<{id: string, docId: string, content: string}>}
 */
function chunkDocuments(documents, options = {}) {
  // Repeated ids (e.g. two README.md files) would make chunk ids ambiguous
  // and let eval count a hit on the wrong document, so suffix them
  const seen = new Map();
  return documents.flatMap((doc, d) => {
    const baseId = typeof doc === "string" ? `doc${d + 1}` : doc.id ?? `doc${d + 1}`;
    const count = (seen.get(baseId) ?? 0) + 1;
    seen.set(baseId, count);
    const docId = count === 1 ? baseId : `${baseId}~${count}`;
    const content = typeof doc === "string" ? doc : doc.content;
    return chunkText(content ?? "", options).map((text, i) => ({ id: `${docId}#${i + 1}`, docId, content: text }));
  });
}

module.exports = { chunkText, chunkDocuments };
