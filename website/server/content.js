// Turns the package's README and CHANGELOG into docs sections, changelog releases
// and a keyword index. The index is ragforge's own BM25, the same one the MCP
// server uses when no API key is set.
const fs = require("fs");
const path = require("path");
const { chunkText, createBM25Index } = require("ragforge");

const GITHUB = "https://github.com/Kamraanmulani/ragforge";

/**
 * findContentDir
 * Inside the ragforge repo the docs come from the repo root, so the site follows
 * the README as it is edited. Deployed on its own, they come from the installed package.
 */
function findContentDir() {
  const repo = path.resolve(__dirname, "..", "..");
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
    if (pkg.name === "ragforge" && fs.existsSync(path.join(repo, "README.md"))) return repo;
  } catch {
    // Not inside the repo
  }
  return path.dirname(require.resolve("ragforge/package.json"));
}

// GitHub's heading anchors: lowercase, punctuation dropped, spaces to hyphens
function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function stripInlineHtml(text) {
  return text
    .replace(/<code>([\s\S]*?)<\/code>/g, "`$1`")
    .replace(/<\/?(b|strong|sub|sup|summary|span)>/g, "")
    .replace(/<em>([\s\S]*?)<\/em>/g, "*$1*")
    .replace(/<br\s*\/?>/g, " ")
    .trim();
}

/**
 * cleanReadme
 * The README is written for GitHub: a centred header, <details> blocks and <sub> notes.
 * This drops the header and footer and turns each <details> into a normal heading.
 */
function cleanReadme(markdown) {
  let text = markdown.replace(/\r\n/g, "\n");
  const first = text.search(/^## /m);
  if (first > 0) text = text.slice(first);
  text = text.replace(/<div align="center">[\s\S]*?<\/div>\s*$/, "");

  const out = [];
  let inFence = false;
  let level = 2;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (/^```/.test(line)) inFence = !inFence;
    if (inFence) {
      out.push(line);
      continue;
    }
    const heading = line.match(/^(#{2,4}) /);
    if (heading) level = heading[1].length;
    if (/^<details>/.test(line)) continue;
    if (/^<\/details>/.test(line)) continue;
    const summary = line.match(/^<summary>([\s\S]*?)<\/summary>/);
    if (summary) {
      // A collapsed block becomes a heading one level under the section it sits in
      out.push(`${"#".repeat(Math.min(level + 1, 4))} ${stripInlineHtml(summary[1])}`);
      continue;
    }
    if (/^<sub>\*/.test(line)) line = line.replace(/^<sub>\*\s*/, "\\* ");
    out.push(/<\/?(sub|b|em|code|br)\b/.test(line) ? stripInlineHtml(line) : line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Splits markdown at headings of the given level, ignoring "#" lines inside code fences
function splitAtHeadings(markdown, marker) {
  const parts = [];
  let current = { title: null, lines: [] };
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^```/.test(line)) inFence = !inFence;
    if (!inFence && line.startsWith(`${marker} `)) {
      if (current.title !== null || current.lines.join("").trim()) parts.push(current);
      current = { title: line.slice(marker.length + 1).trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.title !== null || current.lines.join("").trim()) parts.push(current);
  return parts.map((p) => ({ title: p.title, markdown: p.lines.join("\n").trim() }));
}

// Markdown to plain text for the keyword index. Code stays in: people search for option names.
function toPlainText(markdown) {
  return markdown
    .replace(/^```.*$/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\|?\s*:?-{3,}.*$/gm, "")
    .replace(/\\\|/g, "/")
    .replace(/\|/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\\\*\s?/g, "")
    // Only asterisk emphasis: underscores belong to names such as search_docs
    .replace(/\*{1,2}([^*\n]+)\*{1,2}/g, "$1")
    .replace(/`/g, "");
}

function plainTitle(title) {
  return title.replace(/`/g, "").replace(/\*\*/g, "");
}

/**
 * loadContent
 * @returns {{ version, sections, releases, search(query, topK), chunkCount }}
 */
function loadContent(dir = findContentDir()) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const readme = cleanReadme(fs.readFileSync(path.join(dir, "README.md"), "utf8"));
  const changelog = fs.readFileSync(path.join(dir, "CHANGELOG.md"), "utf8").replace(/\r\n/g, "\n");

  const sections = splitAtHeadings(readme, "##")
    .filter((s) => s.title)
    .map((s) => ({ id: slugify(s.title), title: plainTitle(s.title), markdown: s.markdown }));

  // One search unit per heading, so a result links to the nearest anchor
  const entries = [];
  for (const section of sections) {
    const units = [];
    for (const h3 of splitAtHeadings(section.markdown, "###")) {
      const inner = splitAtHeadings(h3.markdown, "####");
      for (const h4 of inner) {
        const title = h4.title ?? h3.title;
        units.push({ anchor: title ? slugify(title) : section.id, title: title ? plainTitle(title) : null, markdown: h4.markdown });
      }
    }
    for (const unit of units) {
      chunkText(toPlainText(unit.markdown), { size: 420 }).forEach((content, i) => {
        entries.push({
          id: `${section.id}/${unit.anchor}#${i + 1}`,
          content,
          metadata: { sectionId: section.id, sectionTitle: section.title, anchor: unit.anchor, heading: unit.title },
        });
      });
    }
  }
  const index = createBM25Index();
  index.add(entries);

  // "## [2.2.0] - 2026-11-13" then the release notes; link definitions at the end are dropped
  const releases = splitAtHeadings(changelog.replace(/^\[[^\]]+\]:\s+\S+\s*$/gm, ""), "##")
    .filter((r) => r.title)
    .map((r) => {
      const m = r.title.match(/^\[?([^\]\s]+)\]?(?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/);
      return { version: m ? m[1] : r.title, date: m?.[2] ?? null, markdown: r.markdown };
    });

  return {
    version: pkg.version,
    description: pkg.description,
    license: pkg.license,
    node: pkg.engines?.node ?? null,
    links: { github: GITHUB, npm: "https://www.npmjs.com/package/ragforge", issues: `${GITHUB}/issues` },
    sections,
    releases,
    chunkCount: entries.length,
    search(query, topK = 6) {
      return index.search(query, topK).map((hit) => ({
        id: hit.id,
        score: Number(hit.score.toFixed(3)),
        snippet: hit.content,
        ...hit.metadata,
      }));
    },
  };
}

module.exports = { loadContent, cleanReadme, slugify, splitAtHeadings, findContentDir };
