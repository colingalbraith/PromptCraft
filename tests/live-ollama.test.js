// End-to-end check against a real local model. Skips itself when Ollama isn't running.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./harness');

const ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';

async function installedModels() {
  try {
    const resp = await fetch(`${ENDPOINT}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return (await resp.json()).models.sort((a, b) => a.size - b.size).map(m => m.name);
  } catch {
    return [];
  }
}

test('live Ollama: a real model streams a rewrite through the worker', { timeout: 300000 }, async (t) => {
  const models = await installedModels();
  if (models.length === 0) return t.skip(`Ollama not reachable at ${ENDPOINT}`);
  const model = process.env.OLLAMA_MODEL || models[0];

  const worker = loadWorker({
    sync: { provider: 'ollama', ollamaEndpoint: ENDPOINT, ollamaModel: model },
    // Send the Origin header Chrome attaches to extension requests
    fetch: (call) => fetch(call.url, { ...call.init, headers: { ...call.init.headers, Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' } })
  });

  const listed = await worker.send({ action: 'getOllamaModels', settings: { ollamaEndpoint: ENDPOINT } });
  assert.equal(listed.success, true);
  assert.ok(listed.models.includes(model));

  const port = worker.connect();
  const result = await port.enhance({ prompt: 'write me somthing about dogs' }, 280000);
  assert.equal(result.type, 'done', result.error);

  const deltas = port.received.filter(m => m.type === 'delta');
  t.diagnostic(`${model}: ${deltas.length} chunks, ${result.text.length} chars`);
  t.diagnostic(`rewrite: ${result.text.replace(/\s+/g, ' ').slice(0, 300)}`);
  assert.ok(deltas.length > 1, 'expected the rewrite to arrive in several chunks');
  assert.equal(port.streamed().trim(), result.text);
  assert.doesNotMatch(result.text, /<think>/);

  const stats = worker.storage.local.data.usageStats;
  assert.ok(stats.byModel[model].inputTokens > 100, 'expected real prompt token counts from Ollama');
  assert.equal(worker.storage.local.data.promptHistory[0].output, result.text);
});
