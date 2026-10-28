// Default parameters for LLM calls.
// The model comes from the provider (OpenAI: gpt-4o-mini) unless set here
// via createRagforge({ defaults: { model } }) or per call.
module.exports = {
  temperature: 0.7,
  maxTokens: 500,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0
};
