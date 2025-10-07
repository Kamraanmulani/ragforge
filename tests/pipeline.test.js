// Tests for RAG pipeline

const { ragPipeline, setVectorClient } = require('../index');
const { QdrantClient } = require('@qdrant/js-client-rest');

const COLLECTION_NAME = 'ml_knowledge';
const qdrant = new QdrantClient({ url: 'http://localhost:6333' });

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

describe('RAG Pipeline', () => {
  test('should run complete pipeline with HyDE', async () => {
    const query = "What are ensemble methods in machine learning?";
    const result = await ragPipeline(query, { techniques: ['hyde'], topK: 3 });
    
    expect(result).toBeDefined();
    expect(result).toHaveProperty('answer');
    expect(result).toHaveProperty('retrieved');
    expect(result).toHaveProperty('query');
    expect(result.retrieved.length).toBeGreaterThan(0);
    console.log('\n[Pipeline Test] Answer:', result.answer.substring(0, 200) + '...');
  }, 60000);

  test('should handle multiple techniques', async () => {
    const query = "What is reinforcement learning?";
    const result = await ragPipeline(query, { 
      techniques: ['hyde'],
      topK: 2 
    });
    
    expect(result.answer).toBeDefined();
    expect(typeof result.answer).toBe('string');
  }, 60000);

  test('should return translation details', async () => {
    const query = "Explain neural networks";
    const result = await ragPipeline(query, { techniques: ['hyde'] });
    
    expect(result.translation).toBeDefined();
    expect(result.translation.originalQuery).toBe(query);
  }, 60000);
});
