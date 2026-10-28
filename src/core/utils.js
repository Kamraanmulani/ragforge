// helper functions (logging, text cleaning, result extraction)

/**
 * sanitizeText
 * Cleans text by removing extra spaces and newlines
 */
function sanitizeText(text) {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim();
}

/**
 * extractText
 * Pulls the text out of a vector DB result, whatever shape the user's client returns
 */
function extractText(item) {
  if (typeof item === "string") return item;
  if (item.content) return item.content;
  if (item.answer) return item.answer;
  if (item.payload && item.payload.text) return item.payload.text;
  if (item.payload && item.payload.content) return item.payload.content;
  if (item.payload) return JSON.stringify(item.payload);
  return item.id ? String(item.id) : JSON.stringify(item);
}

const silentLogger = { info() {}, error() {} };

const consoleLogger = {
  info: (msg) => console.log("[ragforge]", msg),
  error: (msg) => console.error(msg),
};

/**
 * resolveLogger
 * Silent by default; `debug: true` logs to console; a custom { info, error } wins
 */
function resolveLogger(logger, debug) {
  if (logger) return { ...silentLogger, ...logger };
  return debug ? consoleLogger : silentLogger;
}

module.exports = { sanitizeText, extractText, resolveLogger };
