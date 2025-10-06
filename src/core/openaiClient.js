// src/core/openaiClient.js
const OpenAI = require("openai");
const { OPENAI_API_KEY } = require("../config/env");
const defaults = require("../config/defaults");

// Initialize OpenAI client (v4+ syntax)
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/**
 * callLLM
 * Makes a request to OpenAI's Chat API
 * @param {string} prompt - User query or prompt
 * @param {object} options - Optional parameters to override defaults
 * @returns {string} - LLM response text
 */
async function callLLM(prompt, options = {}) {
  try {
    const response = await openai.chat.completions.create({
      model: options.model || defaults.model,
      messages: [{ role: "user", content: prompt }],
      temperature: options.temperature || defaults.temperature,
      max_tokens: options.max_tokens || defaults.maxTokens,
      top_p: options.top_p || defaults.topP,
      frequency_penalty: options.frequency_penalty || defaults.frequencyPenalty,
      presence_penalty: options.presence_penalty || defaults.presencePenalty
    });

    // v4 returns an array in response.choices, each with a message object
    return response.choices[0].message.content;
  } catch (err) {
    console.error("[ragify] ❌ LLM call failed:", err.message || err);
    throw err;
  }
}

/**
 * Generate embeddings using OpenAI's embedding model
 */
async function getEmbedding(text, model = "text-embedding-ada-002") {
  try {
    const response = await openai.embeddings.create({
      model,
      input: text,
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error("[ragify] Error generating embedding:", error.message);
    throw error;
  }
}

module.exports = { callLLM, getEmbedding };
