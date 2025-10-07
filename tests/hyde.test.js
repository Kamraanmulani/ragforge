// Tests for Hypothetical Document Embedding

const { hyde, setVectorClient } = require('../index');
const { QdrantClient } = require('@qdrant/js-client-rest');
const { getEmbedding } = require('../src/core/openaiClient');

const COLLECTION_NAME = 'ml_knowledge';
const qdrant = new QdrantClient({ url: 'http://localhost:6333' });

// Setup Qdrant
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

describe('HyDE Technique', () => {
  test('should generate answer using hypothetical document', async () => {
    const query = "What are the main types of machine learning?";
    const result = await hyde(query);
    
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(50);
    console.log('\n[HyDE Test] Answer:', result.substring(0, 200) + '...');
  }, 30000);

  test('should handle complex queries', async () => {
    const query = "Explain the differences between supervised and unsupervised learning";
    const result = await hyde(query);
    
    expect(result).toBeDefined();
    expect(result.toLowerCase()).toMatch(/supervised|unsupervised/);
  }, 60000); // Increased timeout to 60 seconds for complex queries
});
