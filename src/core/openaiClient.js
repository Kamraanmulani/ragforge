// src/core/openaiClient.js
const OpenAI = require("openai");
const { getOpenAIKey } = require("../config/env");
const defaults = require("../config/defaults");

// Created on first use so a missing key doesn't fail at require time
let openai = null;

function getClient() {
  if (!openai) openai = new OpenAI({ apiKey: getOpenAIKey() });
  return openai;
}

/**
 * setOpenAIClient
 * Inject your own configured OpenAI client (custom apiKey, baseURL, etc.)
 */
function setOpenAIClient(client) {
  openai = client;
}

/**
 * callLLM
 * Makes a request to OpenAI's Chat API
 * @param {string} prompt - User query or prompt
 * @param {object} options - Optional parameters to override defaults
 * @returns {string} - LLM response text
 */
async function callLLM(prompt, options = {}) {
  try {
    // ?? (not ||) so explicit falsy values like temperature: 0 are respected
    const response = await getClient().chat.completions.create({
      model: options.model ?? defaults.model,
      messages: [{ role: "user", content: prompt }],
      temperature: options.temperature ?? defaults.temperature,
      max_tokens: options.max_tokens ?? defaults.maxTokens,
      top_p: options.top_p ?? defaults.topP,
      frequency_penalty: options.frequency_penalty ?? defaults.frequencyPenalty,
      presence_penalty: options.presence_penalty ?? defaults.presencePenalty
    });

    // v4 returns an array in response.choices, each with a message object
    return response.choices[0].message.content;
  } catch (err) {
    console.error("[ragforge] ❌ LLM call failed:", err.message || err);
    throw err;
  }
}

/**
 * Generate embeddings using OpenAI's embedding model
 */
async function getEmbedding(text, model = "text-embedding-ada-002") {
  try {
    const response = await getClient().embeddings.create({
      model,
      input: text,
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error("[ragforge] Error generating embedding:", error.message);
    throw error;
  }
}

module.exports = { callLLM, getEmbedding, setOpenAIClient };
