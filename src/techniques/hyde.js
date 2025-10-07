// Hypothetical Document Embedding
const { callLLM, getEmbedding } = require("../core/openaiClient");
const { queryVector } = require("../core/vectorClient");

async function hyde(query) {
  console.log('[HyDE] Step 1: Generating hypothetical document...');
  const prompt = `Answer this question in detail: "${query}"`;
  const hypotheticalDoc = await callLLM(prompt);
  console.log(`[HyDE] Generated: ${hypotheticalDoc.substring(0, 100)}...`);
  
  console.log('[HyDE] Step 2: Creating embedding...');
  const embedding = await getEmbedding(hypotheticalDoc);
  console.log(`[HyDE] Embedding created (${embedding.length} dimensions)`);
  
  console.log('[HyDE] Step 3: Searching vector DB...');
  const results = await queryVector(embedding, 3);
  console.log(`[HyDE] Found ${results.length} results`);
  
  // If no vector DB configured, return the hypothetical doc
  if (!results || results.length === 0) {
    console.log('[HyDE] No DB results, returning hypothetical document');
    return hypotheticalDoc;
  }
  
  console.log('[HyDE] Step 4: Generating final answer...');
  const context = results
    .map(r => {
      if (typeof r === 'string') return r;
      if (r.content) return r.content;
      if (r.answer) return r.answer;
      return JSON.stringify(r);
    })
    .map(text => text.substring(0, 500))
    .join('\n\n');
    
  const finalPrompt = `Using this context, answer: "${query}"\n\nContext:\n${context}\n\nAnswer:`;
  const answer = await callLLM(finalPrompt, { temperature: 0.3, max_tokens: 300 });
  console.log('[HyDE] Complete!');
  
  return answer;
}

module.exports = { hyde };
