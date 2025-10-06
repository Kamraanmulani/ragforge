const { callLLM } = require("../src/core/openaiClient");

(async () => {
  try {
    const result = await callLLM("Explain quantum computing in simple terms.");
    console.log("LLM Output:", result);
  } catch (err) {
    console.error(err);
  }
})();
