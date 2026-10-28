// Example demonstrating Hypothetical Document Embedding

const { hyde } = require("../index");

(async () => {
  try {
    const result = await hyde("Explain quantum computing in simple terms.");
    console.log("HyDE Output:", result);
  } catch (err) {
    console.error(err);
  }
})();
