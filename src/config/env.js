// environment loader for API keys
const dotenv = require("dotenv");
const path = require("path");

// Load .env from the consuming project's root (where the app is started),
// never from inside node_modules. Existing env vars are not overridden.
dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });

/**
 * getOpenAIKey
 * Read lazily so requiring ragforge never crashes the host app.
 * Throws only when an OpenAI call is actually made without a key.
 */
function getOpenAIKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "[ragforge] Missing OPENAI_API_KEY. Set it in your environment or in a .env file in your project root."
    );
  }
  return key;
}

module.exports = { getOpenAIKey };
