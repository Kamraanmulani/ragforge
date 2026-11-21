// Copies the ragforge repo's README.md, CHANGELOG.md and package.json into website/content/,
// so a deploy that only ships the website folder (Vercel) still serves the current docs.
// Outside the repo it does nothing, and the server falls back to the installed package.
const fs = require("fs");
const path = require("path");

const repo = path.resolve(__dirname, "..", "..");
const out = path.resolve(__dirname, "..", "content");
const files = ["README.md", "CHANGELOG.md", "package.json"];

let pkg = null;
try {
  pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
} catch {
  // Not inside the repo
}

if (pkg?.name !== "ragforge" || !files.every((f) => fs.existsSync(path.join(repo, f)))) {
  console.log("[sync-content] ragforge repo not found next to the website; keeping the existing content/");
} else {
  fs.mkdirSync(out, { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(repo, f), path.join(out, f));
  console.log(`[sync-content] copied ${files.join(", ")} (ragforge ${pkg.version}) into content/`);
}
