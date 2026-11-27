// Framework adapters (roadmap 7.5), tested against the real packages: @langchain/core,
// ai (Vercel AI SDK), @llamaindex/core and @mastra/core. No network: models are the
// frameworks' own mocks and ragforge uses a keyword embedder. A framework that can't load
// on this Node version (ai and @mastra/core need Node 22) has its tests skipped.

const path = require('path');
const { spawnSync } = require('child_process');
const { createRagforge, formatTable } = require('../../index');
const { createKeywordProvider } = require('./helpers');
const { requirePeer } = require('../../src/integrations/shared');

// Node.js is new enough for the framework, by its own package.json "engines" (">=22.13.0")
const fs = require('fs');
// `entry` is a path the package exports (some, like @llamaindex/core, export no root entry)
function supportedNode(pkg, entry = pkg) {
  let dir = path.dirname(require.resolve(entry, { paths: [path.join(__dirname, '..', '..')] }));
  while (!fs.existsSync(path.join(dir, 'package.json')) || JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name !== pkg) {
    const up = path.dirname(dir);
    if (up === dir) return true;
    dir = up;
  }
  const min = /^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).engines?.node ?? '');
  if (!min) return true;
  const [want, have] = [min.slice(1, 4).map((n) => Number(n ?? 0)), process.versions.node.split('.').map(Number)];
  for (let i = 0; i < 3; i++) if (have[i] !== want[i]) return have[i] > want[i];
  return true;
}
// Loads, and this Node.js is one the framework supports (CI also runs Node 18 and 20)
const loads = (name, pkg = name.split('/').slice(0, name.startsWith('@') ? 2 : 1).join('/')) => {
  try {
    require(name);
    return supportedNode(pkg, name);
  } catch {
    return false;
  }
};
const describeIf = (ok) => (ok ? describe : describe.skip);

const DOCS = [
  { id: 'billing.md', content: 'Refunds take five business days to reach the card.\n\nInvoices arrive on the first day of the month.' },
  { id: 'support.md', content: 'Support answers within four hours on weekdays.\n\nUrgent tickets page the on-call engineer.' },
  { id: 'deploy.md', content: 'Rollbacks restore the previous release in one minute.\n\nEnvironment variables are encrypted at rest.' },
];
const SIZE = 60; // one paragraph per chunk

async function instance(reply = () => 'An answer [1].') {
  const llm = createKeywordProvider(reply);
  const rf = createRagforge({ llm });
  await rf.index(DOCS, { chunkSize: SIZE });
  return { rf, llm };
}

describe('rf.retrieve', () => {
  test('routes and retrieves like auto(), without writing an answer', async () => {
    const { rf, llm } = await instance();
    const result = await rf.retrieve('Refunds business days card', { technique: 'hybrid', topK: 2 });
    expect(result.sources.map((s) => s.id)).toEqual(['billing.md#1', expect.any(String)]);
    expect(result).not.toHaveProperty('answer');
    expect(result.route).toMatchObject({ technique: 'hybrid', decidedBy: 'option', classifier: 'option' });
    expect(llm.calls.chat).toHaveLength(0);
    expect(result.stats).toMatchObject({ llmCalls: 0, embeddingCalls: 1 });
  });

  test('without `technique` it routes; a bad technique is rejected; it is traced', async () => {
    const traces = [];
    const llm = createKeywordProvider(() => 'general topic');
    const rf = createRagforge({ llm, onTrace: (t) => traces.push(t) });
    await rf.index(DOCS, { chunkSize: SIZE });
    const routed = await rf.retrieve('Rollbacks');
    expect(routed.route.decidedBy).toBe('rules');
    await expect(rf.retrieve('x', { technique: 'magic' })).rejects.toThrow(/Unknown eval technique "magic"/);
    expect(traces.at(-1)).toMatchObject({ type: 'retrieve', query: 'Rollbacks', answer: null });
  });
});

describe('evaluate({ retrievers })', () => {
  const QUESTIONS = [
    { question: 'Refunds business days card', expectedText: 'Refunds take five business days' },
    { question: 'Support answers four hours weekdays', expectedText: 'Support answers within four hours' },
  ];

  test('scores your own retriever next to the techniques, by text, and never recommends it', async () => {
    const { rf } = await instance();
    // A "perfect" retriever of its own, with differently cut passages
    const mine = async (query) => (/refund/i.test(query) ? [{ pageContent: 'Billing: Refunds take five business days to reach the card.' }] : ['Support answers within four hours on weekdays.']);
    const result = await rf.evaluate({ documents: DOCS, questions: QUESTIONS, techniques: ['baseline'], chunkSize: SIZE, topK: 1, retrievers: { mine } });
    const row = result.results.find((r) => r.technique === 'mine');
    expect(row).toMatchObject({ hitRate: 1, external: true, avgCostUSD: null });
    expect(result.retrievers).toEqual(['mine']);
    expect(result.techniques).toEqual(['baseline']);
    expect(result.recommendation.technique).toBe('baseline');
    expect(result.questions[0].runs.mine).toMatchObject({ rank: 1, retrieved: ['#1'] });
    const table = formatTable(result);
    // Cost and LLM calls of your own retriever aren't visible to ragforge: n/a, not 0
    expect(table).toMatch(/mine \(yours\)\s+100%\s+1\.000\s+\d+ms\s+n\/a\s+n\/a/);
    expect(table).toMatch(/\(yours\): your own retriever, matched on passage text/);
  });

  test('a failing retriever is an error row; names and questions are checked first', async () => {
    const { rf, llm } = await instance();
    const broken = async () => {
      throw new Error('store offline');
    };
    const result = await rf.evaluate({ documents: DOCS, questions: QUESTIONS, techniques: ['baseline'], chunkSize: SIZE, retrievers: { broken } });
    expect(result.results.find((r) => r.technique === 'broken')).toMatchObject({ errors: 2, hitRate: 0 });
    expect(result.questions[0].runs.broken.error).toBe('store offline');

    const before = llm.calls.embed.length;
    await expect(rf.evaluate({ documents: DOCS, questions: QUESTIONS, retrievers: { hybrid: broken } })).rejects.toThrow(/name "hybrid" is taken by a technique/);
    await expect(rf.evaluate({ documents: DOCS, questions: QUESTIONS, retrievers: { x: 'nope' } })).rejects.toThrow(/must be a function/);
    await expect(rf.evaluate({ documents: DOCS, questions: [{ question: 'q', expectedId: 'billing.md#1' }], retrievers: { mine: broken } })).rejects.toThrow(/needs `expectedText`/);
    expect(llm.calls.embed.length).toBe(before);
  });
});

describe('requirePeer', () => {
  test('a missing framework gets an install hint', () => {
    expect(() => requirePeer('@not-installed/framework-xyz', 'ragforge/test')).toThrow('[ragforge] ragforge/test needs the "@not-installed/framework-xyz" package: npm install @not-installed/framework-xyz');
  });
});

describeIf(loads('@langchain/core/retrievers'))('ragforge/langchain', () => {
  const { createRagforgeRetriever, fromLangChainRetriever } = require('../../src/integrations/langchain');

  test('is a real BaseRetriever that returns LangChain Documents', async () => {
    const { BaseRetriever } = require('@langchain/core/retrievers');
    const { Document } = require('@langchain/core/documents');
    const { rf } = await instance();
    const retriever = createRagforgeRetriever(rf, { topK: 2, technique: 'hybrid' });
    expect(retriever).toBeInstanceOf(BaseRetriever);
    const docs = await retriever.invoke('Urgent tickets on-call engineer');
    expect(docs).toHaveLength(2);
    expect(docs[0]).toBeInstanceOf(Document);
    expect(docs[0]).toMatchObject({ id: 'support.md#2', pageContent: 'Urgent tickets page the on-call engineer.', metadata: { id: 'support.md#2', ref: 1, technique: 'hybrid' } });
  });

  test('composes with LangChain runnables', async () => {
    const { RunnableLambda } = require('@langchain/core/runnables');
    const { rf } = await instance();
    const chain = createRagforgeRetriever(rf, { topK: 1, technique: 'baseline' }).pipe(RunnableLambda.from((docs) => docs.map((d) => d.pageContent).join('\n')));
    expect(await chain.invoke('Rollbacks previous release minute')).toBe('Rollbacks restore the previous release in one minute.');
    const batch = await createRagforgeRetriever(rf, { topK: 1, technique: 'baseline' }).batch(['Refunds card', 'Environment variables encrypted']);
    expect(batch.map((d) => d[0].metadata.id)).toEqual(['billing.md#1', 'deploy.md#2']);
  });

  test('fromLangChainRetriever lets evaluate() score a LangChain retriever', async () => {
    const { rf } = await instance();
    const other = await instance();
    const result = await rf.evaluate({
      documents: DOCS,
      questions: [{ question: 'Refunds business days card', expectedText: 'Refunds take five business days' }],
      techniques: ['baseline'],
      chunkSize: SIZE,
      topK: 1,
      retrievers: { langchain: fromLangChainRetriever(createRagforgeRetriever(other.rf, { topK: 3 })) },
    });
    expect(result.results.find((r) => r.technique === 'langchain')).toMatchObject({ hitRate: 1, external: true });
    expect(() => fromLangChainRetriever({})).toThrow(/needs a LangChain retriever/);
  });

  test('needs a ragforge instance', () => {
    expect(() => createRagforgeRetriever({})).toThrow(/needs a ragforge instance from createRagforge/);
  });
});

describeIf(loads('@llamaindex/core/retriever'))('ragforge/llamaindex', () => {
  const { createRagforgeRetriever, fromLlamaIndexRetriever, queryText } = require('../../src/integrations/llamaindex');

  test('is a real BaseRetriever that returns TextNodes with scores', async () => {
    const { BaseRetriever } = require('@llamaindex/core/retriever');
    const { TextNode, MetadataMode } = require('@llamaindex/core/schema');
    const { rf } = await instance();
    const retriever = createRagforgeRetriever(rf, { topK: 1, technique: 'baseline' });
    expect(retriever).toBeInstanceOf(BaseRetriever);
    const [hit] = await retriever.retrieve({ query: 'Invoices first day month' });
    expect(hit.node).toBeInstanceOf(TextNode);
    expect(hit.node.id_).toBe('billing.md#2');
    expect(hit.node.getContent(MetadataMode.NONE)).toBe('Invoices arrive on the first day of the month.');
    expect(hit.node.metadata).toMatchObject({ ref: 1, technique: 'baseline', docId: 'billing.md' });
    expect(hit.score).toBeGreaterThan(0);
    // A plain string query and multimodal content parts work too
    expect((await retriever.retrieve('Invoices first day month'))[0].node.id_).toBe('billing.md#2');
    expect((await retriever.retrieve({ query: [{ type: 'text', text: 'Invoices first day month' }] }))[0].node.id_).toBe('billing.md#2');
  });

  test('fromLlamaIndexRetriever lets evaluate() score a LlamaIndex retriever', async () => {
    const { rf } = await instance();
    const other = await instance();
    const result = await rf.evaluate({
      documents: DOCS,
      questions: [{ question: 'Invoices first day month', expectedText: 'Invoices arrive on the first day' }],
      techniques: ['baseline'],
      chunkSize: SIZE,
      topK: 1,
      retrievers: { llamaindex: fromLlamaIndexRetriever(createRagforgeRetriever(other.rf, { topK: 2 })) },
    });
    expect(result.results.find((r) => r.technique === 'llamaindex')).toMatchObject({ hitRate: 1, external: true });
    expect(queryText([{ type: 'image_url', image_url: {} }, { type: 'text', text: 'hi' }])).toBe('hi');
  });
});

// ai 7 and parts of @mastra/core are ES modules. Node.js loads them through require() (20.19+,
// 22.12+), but Jest's module loader can't: run them in plain Node, the way users do
const nodeLoads = (names) =>
  spawnSync(process.execPath, ['-e', names.map((n) => `require(${JSON.stringify(n)})`).join(';')], { cwd: path.join(__dirname, '..', '..') }).status === 0;
const esmFrameworks = nodeLoads(['ai', 'ai/test', '@mastra/core/tools', '@mastra/core/agent']) && supportedNode('ai') && supportedNode('@mastra/core', '@mastra/core/tools');

describeIf(esmFrameworks)('ragforge/ai-sdk and ragforge/mastra (in plain Node.js)', () => {
  let out;
  beforeAll(() => {
    const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'fixtures', 'esm-frameworks.js')], { encoding: 'utf8', timeout: 60000 });
    out = JSON.parse(run.stdout || '{}');
    if (out.error || run.status !== 0) throw new Error(`fixture failed: ${out.error ?? run.stderr}`);
  }, 90000);

  test('the AI SDK tool is called by generateText and returns numbered passages', () => {
    expect(out.aiTool).toEqual({
      text: 'Five business days [1].',
      output: { passages: [{ ref: 1, id: 'billing.md#1', content: 'Refunds take five business days to reach the card.', score: expect.any(Number) }], technique: 'baseline' },
      // The model saw the tool's result on its next step
      sawResult: true,
    });
  });

  test('the AI SDK middleware adds the passages to the one system prompt', () => {
    const { withSystem, systemCount, withoutSystem, seen } = out.aiMiddleware;
    expect(withSystem.content).toMatch(/^You are the Acme support bot\.\n\nAnswer using the numbered passages below[\s\S]*\[1\] \(support\.md#1\) Support answers within four hours on weekdays\.$/);
    expect(systemCount).toBe(1);
    expect(withoutSystem).toMatchObject({ role: 'system', content: expect.stringMatching(/\[1\] \(deploy\.md#1\) Rollbacks restore/) });
    expect(seen).toEqual([
      { query: 'Support hours weekdays', technique: 'baseline', ids: ['support.md#1'] },
      { query: 'Rollbacks previous release', technique: 'baseline', ids: ['deploy.md#1'] },
    ]);
    expect(out.lastUserText).toBe('second');
  });

  test('the Mastra tool runs on its own and inside a Mastra Agent', () => {
    expect(out.mastra).toEqual({
      id: 'search-docs',
      direct: { passages: [{ ref: 1, id: 'support.md#2', content: 'Urgent tickets page the on-call engineer.', score: expect.any(Number) }], technique: 'baseline' },
      agentText: 'One minute [1].',
      sawResult: true,
    });
  });
});

