// environment loader for API keys
const dotenv = require("dotenv");
const path = require("path");

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error("[ragify] ❌ Missing OPENAI_API_KEY in .env file");
  console.error("[ragify] Please create a .env file in the root directory with:");
  console.error("[ragify] OPENAI_API_KEY=your_api_key_here");
  process.exit(1);
} else {
  console.log("[ragify] ✓ OpenAI API Key loaded successfully");
}

module.exports = { OPENAI_API_KEY };
