// File extensions shared by the loaders and the chunkers

// Source code the `code` chunking strategy splits by declaration
const CODE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx", ".vue", ".svelte",
  ".py", ".rb", ".php", ".go", ".rs", ".java", ".kt", ".kts", ".scala", ".swift", ".dart",
  ".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".cs", ".m",
  ".lua", ".ex", ".exs", ".jl", ".r", ".sql",
  ".sh", ".bash", ".zsh", ".ps1",
]);

// Folders of generated or third-party code, skipped when a folder is scanned for code
const CODE_SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage", "vendor", "target", "__pycache__"]);

function extensionOf(name) {
  const base = String(name).split(/[?#]/)[0];
  const dot = base.lastIndexOf(".");
  return dot > base.lastIndexOf("/") ? base.slice(dot).toLowerCase() : "";
}

function isCodeFile(name) {
  return CODE_EXTENSIONS.has(extensionOf(name));
}

module.exports = { CODE_EXTENSIONS, CODE_SKIP_DIRS, extensionOf, isCodeFile };
