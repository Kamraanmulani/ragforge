// Tests for Reciprocal Rank Fusion

const { rrf } = require('../index');

describe('Reciprocal Rank Fusion (RRF)', () => {
  test('should merge multiple ranked lists', () => {
    const list1 = ['doc1', 'doc2', 'doc3'];
    const list2 = ['doc2', 'doc4', 'doc1'];
    const list3 = ['doc3', 'doc1', 'doc5'];
    
    const merged = rrf([list1, list2, list3]);
    
    expect(merged).toBeDefined();
    expect(Array.isArray(merged)).toBe(true);
    expect(merged.length).toBeGreaterThan(0);
    console.log('\n[RRF Test] Merged results:', merged);
  });

  test('should handle single list', () => {
    const list1 = ['doc1', 'doc2', 'doc3'];
    const merged = rrf([list1]);
    
    expect(merged).toEqual(list1);
  });

  test('should handle empty lists', () => {
    const merged = rrf([[], []]);
    expect(merged).toEqual([]);
  });

  test('should prioritize items appearing in multiple lists', () => {
    const list1 = ['common', 'unique1'];
    const list2 = ['common', 'unique2'];
    const merged = rrf([list1, list2]);
    
    expect(merged[0]).toBe('common');
  });
});
