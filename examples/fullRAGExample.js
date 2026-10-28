// Example demonstrating full RAG pipeline with ml_knowledge collection

const { ragPipeline, setVectorClient } = require("../index");
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
    const query = "What are the advantages of using machine learning?";
    
    console.log('\n🚀 Running Full RAG Pipeline');
    console.log('='.repeat(60));
    console.log(`Query: "${query}"`);
    console.log('='.repeat(60) + '\n');
    
    const res = await ragPipeline(query, { 
      techniques: ["hyde"], 
      topK: 3 
    });
    
    console.log('\n📄 Final Answer:');
    console.log('='.repeat(60));
    console.log(res.answer);
    console.log('='.repeat(60));
    
    console.log('\n📚 Retrieved Documents:');
    console.log('='.repeat(60));
    res.retrieved.forEach((doc, i) => {
      console.log(`\n[${i + 1}] ${doc.substring(0, 200)}...`);
    });
    console.log('='.repeat(60) + '\n');
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }
})();
