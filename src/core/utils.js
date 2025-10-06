// helper functions (logging, error handling, text cleaning)

/**
 * logInfo
 * Simple console logging
 */
function logInfo(message) {
  console.log("[ragify INFO]", message);
}

/**
 * sanitizeText
 * Cleans text by removing extra spaces and newlines
 */
function sanitizeText(text) {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim();
}

/**
 * handleError
 * Standardized error logging
 */
function handleError(err) {
  console.error("[ragify ERROR]", err.message || err);
}

module.exports = { logInfo, sanitizeText, handleError };
