// examples/compareHydeVsNormal.js
// Compares regular vector search vs HyDE-enhanced search on ml_knowledge collection

const { QdrantClient } = require('@qdrant/js-client-rest');
const { getEmbedding, callLLM } = require('../index');

const COLLECTION_NAME = 'ml_knowledge';
const TOP_K = 3;

/**
 * Regular vector search without HyDE
 */
async function regularSearch(query) {
  const client = new QdrantClient({ url: 'http://localhost:6333' });
  
  console.log('[Regular Search] Generating embedding for query...');
  const queryEmbedding = await getEmbedding(query);
  
  console.log('[Regular Search] Searching in Qdrant...');
  const results = await client.search(COLLECTION_NAME, {
    vector: queryEmbedding,
    limit: TOP_K,
    with_payload: true
  });
  
  return results;
}

/**
 * HyDE-enhanced vector search
 */
async function hydeSearch(query) {
  const client = new QdrantClient({ url: 'http://localhost:6333' });
  
  console.log('[HyDE Search] Generating hypothetical document...');
  const hydePrompt = `Given the question: "${query}"
Generate a detailed, well-written answer as if you were writing documentation. 
Write in a clear, informative style without mentioning that this is hypothetical.

Answer:`;
  
  const hypotheticalDoc = await callLLM(hydePrompt, { 
    model: 'gpt-3.5-turbo',
    temperature: 0.7 
  });
  
  console.log('[HyDE Search] Hypothetical document generated:');
  console.log('---');
  console.log(hypotheticalDoc.substring(0, 200) + '...');
  console.log('---\n');
  
  console.log('[HyDE Search] Generating embedding for hypothetical document...');
  const hydeEmbedding = await getEmbedding(hypotheticalDoc);
  
  console.log('[HyDE Search] Searching in Qdrant...');
  const results = await client.search(COLLECTION_NAME, {
    vector: hydeEmbedding,
    limit: TOP_K,
    with_payload: true
  });
  
  return results;
}

/**
 * Generate final answer using retrieved context
 */
async function generateAnswer(query, results, method) {
  const context = results
    .map((r, i) => `[Document ${i + 1}] (Score: ${r.score.toFixed(4)})\n${r.payload.content}`)
    .join('\n\n');
  
  const prompt = `You are a helpful AI assistant. Answer the following question using ONLY the provided context.

Context:
${context}

Question: ${query}

Provide a clear, comprehensive answer based on the context above:`;
  
  const answer = await callLLM(prompt, { 
    model: 'gpt-3.5-turbo',
    temperature: 0.3 
  });
  
  return answer;
}

/**
 * Display results comparison
 */
function displayResults(query, regularResults, hydeResults, regularAnswer, hydeAnswer) {
  console.log('\n' + '='.repeat(80));
  console.log('COMPARISON RESULTS');
  console.log('='.repeat(80));
  console.log(`\nQuery: "${query}"\n`);
  
  console.log('-'.repeat(80));
  console.log('REGULAR SEARCH - Retrieved Documents:');
  console.log('-'.repeat(80));
  regularResults.forEach((r, i) => {
    console.log(`\n[${i + 1}] Score: ${r.score.toFixed(4)} | Topic: ${r.payload.topic}`);
    console.log(`Content preview: ${r.payload.content.substring(0, 150)}...`);
  });
  
  console.log('\n' + '-'.repeat(80));
  console.log('REGULAR SEARCH - Generated Answer:');
  console.log('-'.repeat(80));
  console.log(regularAnswer);
  
  console.log('\n\n' + '-'.repeat(80));
  console.log('HYDE SEARCH - Retrieved Documents:');
  console.log('-'.repeat(80));
  hydeResults.forEach((r, i) => {
    console.log(`\n[${i + 1}] Score: ${r.score.toFixed(4)} | Topic: ${r.payload.topic}`);
    console.log(`Content preview: ${r.payload.content.substring(0, 150)}...`);
  });
  
  console.log('\n' + '-'.repeat(80));
  console.log('HYDE SEARCH - Generated Answer:');
  console.log('-'.repeat(80));
  console.log(hydeAnswer);
  
  console.log('\n' + '='.repeat(80));
  console.log('KEY DIFFERENCES:');
  console.log('='.repeat(80));
  
  // Compare retrieved topics
  const regularTopics = regularResults.map(r => r.payload.topic);
  const hydeTopics = hydeResults.map(r => r.payload.topic);
  
  console.log('\nRegular Search Topics:', regularTopics.join(', '));
  console.log('HyDE Search Topics:', hydeTopics.join(', '));
  
  // Compare scores
  const regularAvgScore = regularResults.reduce((sum, r) => sum + r.score, 0) / regularResults.length;
  const hydeAvgScore = hydeResults.reduce((sum, r) => sum + r.score, 0) / hydeResults.length;
  
  console.log('\nAverage Similarity Score:');
  console.log(`  Regular: ${regularAvgScore.toFixed(4)}`);
  console.log(`  HyDE:    ${hydeAvgScore.toFixed(4)}`);
  console.log(`  Difference: ${(hydeAvgScore - regularAvgScore).toFixed(4)}`);
  
  console.log('\n' + '='.repeat(80) + '\n');
}

/**
 * Main comparison function
 */
async function compareSearchMethods(query) {
  try {
    console.log('\n🚀 Starting Comparison: Regular Search vs HyDE Search\n');
    console.log('='.repeat(80));
    console.log(`Query: "${query}"`);
    console.log('='.repeat(80) + '\n');
    
    // Run regular search
    console.log('📊 Running REGULAR SEARCH...\n');
    const regularResults = await regularSearch(query);
    const regularAnswer = await generateAnswer(query, regularResults, 'Regular');
    
    console.log('\n✅ Regular search completed\n');
    
    // Run HyDE search
    console.log('🔮 Running HYDE SEARCH...\n');
    const hydeResults = await hydeSearch(query);
    const hydeAnswer = await generateAnswer(query, hydeResults, 'HyDE');
    
    console.log('\n✅ HyDE search completed\n');
    
    // Display comparison
    displayResults(query, regularResults, hydeResults, regularAnswer, hydeAnswer);
    
  } catch (error) {
    console.error('[Error]', error.message);
    throw error;
  }
}

// Test queries
const testQueries = [
  "What are the main benefits of using machine learning?",
  "Explain different types of neural networks",
  "What problems does machine learning face?",
  "How does reinforcement learning work?"
];

// Run comparison
(async () => {
  try {
    // You can test with one query or multiple
    const selectedQuery = testQueries[0]; // Change index to test different queries
    
    await compareSearchMethods(selectedQuery);
    
    // Uncomment below to test all queries sequentially
    /*
    for (const query of testQueries) {
      await compareSearchMethods(query);
      console.log('\n\n' + '█'.repeat(80) + '\n\n');
    }
    */
    
  } catch (error) {
    console.error('Fatal error:', error);
  }
})();
