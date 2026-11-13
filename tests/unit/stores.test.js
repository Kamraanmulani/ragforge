// Unit tests for the vector store adapters (mock clients, no databases)

const { spawnSync } = require('child_process');
const path = require('path');
const { createPgvectorStore } = require('../../src/stores/pgvector');
const { createQdrantStore } = require('../../src/stores/qdrant');
const { createChromaStore } = require('../../src/stores/chroma');
const { createPineconeStore } = require('../../src/stores/pinecone');
const { createLanceDBStore } = require('../../src/stores/lancedb');
const { createSupabaseStore } = require('../../src/stores/supabase');
const { createRagforge } = require('../../index');
const { createKeywordProvider, keywordVector } = require('./helpers');

describe('pgvector adapter', () => {
  function fakePg(rows = []) {
    const calls = [];
    return { calls, query: async (text, params) => (calls.push({ text, params }), { rows }) };
  }

  test('query orders by cosine distance and maps rows to matches', async () => {
    const client = fakePg([{ id: 7, content: 'refund rules', metadata: { doc: 'a.md' }, score: 0.9 }]);
    const store = createPgvectorStore({ client, table: 'public.chunks' });

    const [hit] = await store.query([0.1, 0.2], 3);

    expect(client.calls[0].text).toMatch(/FROM public\.chunks ORDER BY embedding <=> \$1::vector LIMIT \$2/);
    expect(client.calls[0].params).toEqual(['[0.1,0.2]', 3]);
    expect(hit).toEqual({ id: '7', content: 'refund rules', score: 0.9, metadata: { doc: 'a.md' } });
  });

  test('column names come from options', async () => {
    const client = fakePg([]);
    await createPgvectorStore({ client, table: 'docs', vectorColumn: 'vec', contentColumn: 'body' }).query([1], 1);
    expect(client.calls[0].text).toMatch(/body AS content/);
    expect(client.calls[0].text).toMatch(/vec <=> \$1::vector/);
  });

  test('searchText uses Postgres full-text search with the same row shape', async () => {
    const client = fakePg([{ id: 1, content: 'error ERR_42', metadata: null, score: 0.5 }]);
    const [hit] = await createPgvectorStore({ client, table: 'docs', language: 'simple' }).searchText('ERR_42', 2);
    expect(client.calls[0].text).toMatch(/plainto_tsquery\('simple', \$1\)/);
    expect(client.calls[0].params).toEqual(['ERR_42', 2]);
    expect(hit.id).toBe('1');
  });

  test('rejects identifiers that could inject SQL', () => {
    const client = fakePg();
    expect(() => createPgvectorStore({ client, table: 'docs; DROP TABLE docs' })).toThrow(/plain SQL identifier/);
    expect(() => createPgvectorStore({ client, table: 'docs', vectorColumn: 'emb"x' })).toThrow(/plain SQL identifier/);
  });

  test('rejects a client without query and a bad topK', async () => {
    expect(() => createPgvectorStore({ client: {}, table: 'docs' })).toThrow(/needs a client with query/);
    await expect(createPgvectorStore({ client: fakePg(), table: 'docs' }).query([1], 0)).rejects.toThrow(/positive whole number/);
  });
});

describe('Qdrant adapter', () => {
  test('uses the query API and splits the text payload from the metadata', async () => {
    const calls = [];
    const client = {
      query: async (collection, params) => {
        calls.push({ collection, params });
        return { points: [{ id: 'p1', score: 0.8, payload: { text: 'passage', source: 'guide.md' } }] };
      },
    };
    const [hit] = await createQdrantStore({ client, collection: 'docs' }).query([0.3], 4);

    expect(calls[0]).toEqual({ collection: 'docs', params: { query: [0.3], limit: 4, with_payload: true } });
    expect(hit).toEqual({ id: 'p1', content: 'passage', score: 0.8, metadata: { source: 'guide.md' } });
  });

  test('needs a collection name', () => {
    expect(() => createQdrantStore({ client: { query() {} }, collection: '' })).toThrow(/collection name/);
  });
});

describe('Chroma adapter', () => {
  test('turns distances into similarity scores and reads the first query result', async () => {
    const collection = {
      query: async (params) => {
        expect(params).toEqual({ queryEmbeddings: [[1, 0]], nResults: 2 });
        return { ids: [['a', 'b']], documents: [['alpha', 'beta']], distances: [[0.1, 0.4]], metadatas: [[{ n: 1 }, null]] };
      },
    };
    const hits = await createChromaStore({ collection }).query([1, 0], 2);
    expect(hits[0]).toEqual({ id: 'a', content: 'alpha', score: 0.9, metadata: { n: 1 } });
    expect(hits[1].score).toBeCloseTo(0.6);
    expect(hits[1].metadata).toBeNull();
  });
});

describe('Pinecone adapter', () => {
  test('queries the namespace when one is set and reads the text from metadata', async () => {
    const seen = [];
    const target = { query: async (params) => (seen.push(params), { matches: [{ id: 'v1', score: 0.7, metadata: { text: 'hello', lang: 'en' } }] }) };
    const index = { query: async () => ({ matches: [] }), namespace: (ns) => (seen.push(ns), target) };

    const [hit] = await createPineconeStore({ index, namespace: 'prod' }).query([0.5, 0.5], 3);

    expect(seen[0]).toBe('prod');
    expect(seen[1]).toEqual({ vector: [0.5, 0.5], topK: 3, includeMetadata: true });
    expect(hit).toEqual({ id: 'v1', content: 'hello', score: 0.7, metadata: { lang: 'en' } });
  });
});

describe('LanceDB adapter', () => {
  test('chains search, limit and toArray, and converts distance to a score', async () => {
    const table = {
      search: (vector) => ({
        limit: (n) => ({ toArray: async () => [{ id: 'x', text: 'lance passage', _distance: 1, vector, page: 2 }] }),
      }),
    };
    const [hit] = await createLanceDBStore({ table }).query([2, 3], 5);
    expect(hit).toEqual({ id: 'x', content: 'lance passage', score: 0.5, metadata: { page: 2 } });
  });
});

describe('Supabase adapter', () => {
  test('calls the RPC function with the embedding and count', async () => {
    const calls = [];
    const client = {
      rpc: async (fn, args) => (calls.push({ fn, args }), { data: [{ id: 9, content: 'supabase text', similarity: 0.91, source: 'faq' }], error: null }),
    };
    const [hit] = await createSupabaseStore({ client }).query([0.1], 2);
    expect(calls[0]).toEqual({ fn: 'match_documents', args: { query_embedding: [0.1], match_count: 2 } });
    expect(hit).toEqual({ id: '9', content: 'supabase text', score: 0.91, metadata: { source: 'faq' } });
  });

  test('throws when the RPC reports an error', async () => {
    const client = { rpc: async () => ({ data: null, error: { message: 'function not found' } }) };
    await expect(createSupabaseStore({ client, fn: 'my_match' }).query([1], 1)).rejects.toThrow(/my_match failed: function not found/);
  });
});

describe('adapters with createRagforge and evaluate()', () => {
  test('a Chroma-shaped store serves the eval: the right passage is found and the run completes', async () => {
    const passages = [
      { id: 'refunds.md#1', text: 'Refunds are issued to the original card within five business days.' },
      { id: 'shipping.md#1', text: 'Orders ship from the Berlin warehouse on weekdays.' },
      { id: 'login.md#1', text: 'Reset your password from the login page using email.' },
    ];
    let queries = 0;
    // A fake collection that ranks by cosine similarity over a keyword embedding
    const collection = {
      query: async ({ queryEmbeddings, nResults }) => {
        queries++;
        const q = queryEmbeddings[0];
        const norm = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
        const scored = passages
          .map((p) => {
            const v = keywordVector(p.text);
            const dot = q.reduce((s, x, i) => s + x * v[i], 0);
            return { ...p, similarity: dot / (norm(q) * norm(v)) };
          })
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, nResults);
        return {
          ids: [scored.map((p) => p.id)],
          documents: [scored.map((p) => p.text)],
          distances: [scored.map((p) => 1 - p.similarity)],
          metadatas: [scored.map(() => null)],
        };
      },
    };
    const llm = createKeywordProvider(() => 'unused');
    const rf = createRagforge({ llm, embeddings: llm, vectorStore: createChromaStore({ collection }) });

    const result = await rf.evaluate({
      questions: [{ question: 'How long do refunds take to reach my card?', expectedId: 'refunds.md#1' }],
      techniques: ['baseline'],
      topK: 1,
    });

    expect(queries).toBeGreaterThan(0);
    expect(result.questionCount).toBe(1);
  });
});

describe('subpath exports', () => {
  test('each adapter resolves as a package subpath', () => {
    const script = [
      'for (const n of ["pgvector","qdrant","chroma","pinecone","lancedb","supabase"]) {',
      '  const m = require("ragforge/" + n);',
      '  const fn = Object.keys(m)[0];',
      '  if (typeof m[fn] !== "function") throw new Error(n);',
      '}',
      'console.log("ok");',
    ].join('\n');
    const run = spawnSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe('ok');
  });
});
