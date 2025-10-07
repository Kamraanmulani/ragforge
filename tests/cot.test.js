// Tests for Chain of Thought prompting

const { cot } = require('../index');

describe('Chain of Thought (CoT) Technique', () => {
  test('should break down query into reasoning steps', async () => {
    const query = "How does gradient descent work in neural networks?";
    const result = await cot(query);
    
    expect(result).toBeDefined();
    expect(result).toHaveProperty('reasoning');
    expect(result).toHaveProperty('refinedQuery');
    console.log('\n[CoT Test] Reasoning:', result.reasoning?.substring(0, 150) + '...');
    console.log('[CoT Test] Refined Query:', result.refinedQuery);
  }, 30000);

  test('should provide step-by-step reasoning', async () => {
    const query = "Why is overfitting a problem in machine learning?";
    const result = await cot(query);
    
    expect(result.reasoning).toBeDefined();
    expect(result.reasoning.length).toBeGreaterThan(50);
  }, 30000);
});
