// Runs the AI SDK and Mastra adapters in plain Node.js and prints the results as JSON.
// `ai` 7 and parts of @mastra/core are ES modules: Node loads them through require(),
// but Jest's module loader can't, so tests/unit/integrations.test.js runs this file in a
// child process and checks what it prints. No network: the models are the AI SDK's mocks.
const { createRagforge } = require("../../index");
const { createKeywordProvider } = require("../unit/helpers");
const { createRagforgeTool, createRagforgeMiddleware, lastUserText } = require("../../src/integrations/ai-sdk");
const { createRagforgeTool: createMastraTool } = require("../../src/integrations/mastra");

const DOCS = [
  { id: "billing.md", content: "Refunds take five business days to reach the card.\n\nInvoices arrive on the first day of the month." },
  { id: "support.md", content: "Support answers within four hours on weekdays.\n\nUrgent tickets page the on-call engineer." },
  { id: "deploy.md", content: "Rollbacks restore the previous release in one minute.\n\nEnvironment variables are encrypted at rest." },
];
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const finish = (unified) => ({ unified, raw: undefined });

async function instance() {
  const rf = createRagforge({ llm: createKeywordProvider(() => "unused") });
  await rf.index(DOCS, { chunkSize: 60 });
  return rf;
}

// A mock model that calls `toolName` with `query` first, then answers `text`
function toolCallingModel(Mock, toolName, query, text, prompts) {
  let step = 0;
  return new Mock({
    doGenerate: async (params) => {
      prompts.push(params.prompt);
      if (step++ === 0) return { content: [{ type: "tool-call", toolCallId: "c1", toolName, input: JSON.stringify({ query }) }], finishReason: finish("tool-calls"), usage, warnings: [] };
      return { content: [{ type: "text", text }], finishReason: finish("stop"), usage, warnings: [] };
    },
  });
}

async function main() {
  const { generateText, wrapLanguageModel, stepCountIs } = require("ai");
  const { MockLanguageModelV4 } = require("ai/test");
  const out = {};

  // AI SDK tool, called by generateText
  {
    const rf = await instance();
    const prompts = [];
    const model = toolCallingModel(MockLanguageModelV4, "searchDocs", "Refunds business days card", "Five business days [1].", prompts);
    const result = await generateText({ model, tools: { searchDocs: createRagforgeTool(rf, { topK: 1, technique: "baseline" }) }, stopWhen: stepCountIs(3), prompt: "How long do refunds take?" });
    out.aiTool = { text: result.text, output: result.steps[0].toolResults[0].output, sawResult: JSON.stringify(prompts[1]).includes("Refunds take five business days") };
  }

  // AI SDK middleware, with and without a system prompt
  {
    const rf = await instance();
    const prompts = [];
    const seen = [];
    const model = new MockLanguageModelV4({ doGenerate: async (params) => (prompts.push(params.prompt), { content: [{ type: "text", text: "ok" }], finishReason: finish("stop"), usage, warnings: [] }) });
    const wrapped = wrapLanguageModel({ model, middleware: createRagforgeMiddleware(rf, { topK: 1, technique: "baseline", onSources: (s) => seen.push({ query: s.query, technique: s.route.technique, ids: s.sources.map((x) => x.id) }) }) });
    await generateText({ model: wrapped, system: "You are the Acme support bot.", prompt: "Support hours weekdays" });
    await generateText({ model: wrapped, messages: [{ role: "user", content: "Rollbacks previous release" }] });
    out.aiMiddleware = {
      withSystem: prompts[0][0],
      systemCount: prompts[0].filter((m) => m.role === "system").length,
      withoutSystem: prompts[1][0],
      seen,
    };
    out.lastUserText = lastUserText([{ role: "user", content: [{ type: "text", text: "first" }] }, { role: "user", content: [{ type: "text", text: "second" }] }]);
  }

  // Mastra tool on its own, then called by a Mastra Agent
  {
    const { Agent } = require("@mastra/core/agent");
    const rf = await instance();
    const tool = createMastraTool(rf, { topK: 1, technique: "baseline" });
    const direct = await tool.execute({ query: "Urgent tickets on-call engineer" }, {});
    const prompts = [];
    const model = toolCallingModel(MockLanguageModelV4, "searchDocs", "Rollbacks previous release minute", "One minute [1].", prompts);
    const agent = new Agent({ id: "docs", name: "docs", instructions: "Answer from the docs.", model, tools: { searchDocs: tool } });
    const result = await agent.generate("How fast are rollbacks?", { maxSteps: 3 });
    out.mastra = { id: tool.id, direct, agentText: result.text, sawResult: JSON.stringify(prompts[1]).includes("Rollbacks restore the previous release in one minute") };
  }

  process.stdout.write(JSON.stringify(out));
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ error: err.stack || String(err) }));
  process.exitCode = 1;
});
