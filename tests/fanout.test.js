// Tests for Fan-Out Retrieval logic

const { fanout, setVectorClient } = require('../index');
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

describe('Fan-Out Technique', () => {
  test('should generate multiple query variations', async () => {
    const query = "What is deep learning?";
    const result = await fanout(query);
    
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    console.log('\n[Fanout Test] Result:', result.substring(0, 200) + '...');
  }, 30000);

  test('should handle broad topics', async () => {
    const query = "Explain machine learning algorithms";
    const result = await fanout(query);
    
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(50);
  }, 30000);
});
