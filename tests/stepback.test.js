// Tests for Step-Back Prompting technique

const { stepback } = require('../index');

describe('Step-Back Prompting Technique', () => {
  test('should generate abstract version of specific query', async () => {
    const query = "How do I fix a memory leak in my Python application?";
    const result = await stepback(query);
    
    expect(result).toBeDefined();
    expect(result).toHaveProperty('abstractQuery');
    expect(result).toHaveProperty('originalQuery');
    expect(result).toHaveProperty('reasoning');
    expect(result.originalQuery).toBe(query);
    
    console.log('\n[Step-Back Test] Original:', result.originalQuery);
    console.log('[Step-Back Test] Abstract:', result.abstractQuery);
    console.log('[Step-Back Test] Reasoning:', result.reasoning);
  }, 30000);

  test('should create broader question from technical query', async () => {
    const query = "What hyperparameters should I tune for my CNN model?";
    const result = await stepback(query);
    
    expect(result.abstractQuery).toBeDefined();
    expect(result.abstractQuery).not.toBe(result.originalQuery);
    expect(result.abstractQuery.length).toBeGreaterThan(10);
    
    console.log('\n[Step-Back Test] Specific:', result.originalQuery);
    console.log('[Step-Back Test] General:', result.abstractQuery);
  }, 30000);

  test('should provide reasoning for abstraction', async () => {
    const query = "Why does my gradient descent converge slowly?";
    const result = await stepback(query);
    
    expect(result.reasoning).toBeDefined();
    expect(typeof result.reasoning).toBe('string');
    expect(result.reasoning.length).toBeGreaterThan(15);
  }, 30000);
});
