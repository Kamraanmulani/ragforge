// `ragforge init`: scaffolds a working RAG app with sample docs, golden questions and a CI eval
const fs = require("fs");
const path = require("path");
const { TEMPLATES } = require("./templates");
const { version } = require("../../package.json");

/**
 * mergePackageJson
 * Adds the template's scripts and dependencies to a package.json without
 * changing anything that is already there.
 * @returns {{ pkg: object, added: string[], kept: string[] }}
 */
function mergePackageJson(existing, additions) {
  const pkg = { ...existing };
  const added = [];
  const kept = [];
  for (const section of Object.keys(additions)) {
    pkg[section] = { ...(existing[section] ?? {}) };
    for (const [key, value] of Object.entries(additions[section])) {
      // A dependency already listed under devDependencies counts as present
      const present = key in pkg[section] || (section === "dependencies" && key in (existing.devDependencies ?? {}));
      if (present) kept.push(`${section}.${key}`);
      else {
        pkg[section][key] = value;
        added.push(`${section}.${key}`);
      }
    }
  }
  return { pkg, added, kept };
}

/**
 * init
 * Writes a template's files into `dir`. Existing files are left alone unless `force` is set,
 * and an existing package.json only gains the scripts and dependencies it lacks.
 *
 * @param {object} options
 * @param {string} options.dir - Target folder, created when missing
 * @param {string} [options.template="express"] - "express" or "next"
 * @param {boolean} [options.force=false] - Overwrite files that already exist
 * @returns {{ template, created: string[], skipped: string[], packageJson: { created: boolean, added: string[], kept: string[] } }}
 */
function init({ dir, template = "express", force = false }) {
  const spec = TEMPLATES[template];
  if (!spec) throw new Error(`Unknown template "${template}". Use one of: ${Object.keys(TEMPLATES).join(", ")}`);

  fs.mkdirSync(dir, { recursive: true });
  // Next.js projects keep app/ at the root or under src/
  const srcDir = fs.existsSync(path.join(dir, "src", "app")) ? "src/" : "";
  const files = spec.files({ srcDir });

  // The sample doc and the golden questions written for it go together. In a project that
  // already has docs, neither is written: the sample questions would test for text that isn't there
  const sampleDoc = Object.keys(files).find((name) => name.startsWith("docs/"));
  const hasDocs = fs.existsSync(path.join(dir, "docs")) && fs.readdirSync(path.join(dir, "docs")).length > 0 && !fs.existsSync(path.join(dir, sampleDoc));
  const created = [];
  const skipped = [];
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    const sample = name.startsWith("docs/") || name === "golden.json";
    if ((fs.existsSync(file) && !force) || (sample && hasDocs)) {
      skipped.push(name);
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    created.push(name);
  }

  const pkgFile = path.join(dir, "package.json");
  const exists = fs.existsSync(pkgFile);
  let existing = {};
  if (exists) {
    try {
      existing = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
    } catch (err) {
      throw new Error(`package.json is not valid JSON (${err.message})`);
    }
  } else {
    existing = { name: path.basename(path.resolve(dir)).toLowerCase().replace(/[^a-z0-9-_.]+/g, "-") || "rag-app", version: "0.1.0", private: true };
  }
  const { pkg, added, kept } = mergePackageJson(existing, spec.packageJson({ version }));
  if (!exists || added.length) fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);

  return { template, created, skipped, hasDocs, packageJson: { created: !exists, added, kept } };
}

module.exports = { init, mergePackageJson, TEMPLATES };
