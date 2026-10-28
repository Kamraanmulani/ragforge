// examples/testWithDB.js
const { hyde, setVectorClient } = require("../index");
const { QdrantClient } = require('@qdrant/js-client-rest');
const { getEmbedding } = require('../src/core/openaiClient');

const COLLECTION_NAME = 'ml_knowledge';
const qdrant = new QdrantClient({ url: 'http://localhost:6333' });

// Setup Qdrant as vector DB
setVectorClient({
  query: async (vector, topK) => {
    const results = await qdrant.search(COLLECTION_NAME, {
      vector,
      limit: topK,
      with_payload: true
    });
    return results.map(r => ({
      content: r.payload.content,
      score: r.score,
      metadata: r.payload
    }));
  }
});

(async () => {
  try {
    const query = "What are the disadvantages of machine learning?";
    
    console.log(`\n🔮 Testing HyDE on ml_knowledge collection`);
    console.log(`Query: "${query}"\n`);
    
    const result = await hyde(query);
    
    console.log('\n📄 Final Answer:');
    console.log('='.repeat(60));
    console.log(result);
    console.log('='.repeat(60) + '\n');
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }
})();
