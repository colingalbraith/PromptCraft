const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker, streamResponse, sse, jsonResponse, fakeLanguageModel, SENDERS } = require('./harness');

// Objects built inside the sandbox have another realm's prototypes; flatten them before comparing
const plain = (value) => JSON.parse(JSON.stringify(value));

// ── Canned provider streams ─────────────────────────────────────────────────

const openaiStream = (text, extra = []) => sse([
  ...text.match(/[\s\S]{1,12}/g).map(delta => ({ type: 'response.output_text.delta', delta })),
  ...extra,
  { type: 'response.completed', response: { usage: { input_tokens: 321, output_tokens: 45 } } }
]);

const OPENAI = { sync: { apiProvider: 'openai' }, local: { openaiApiKey: 'sk-test' } };
const openaiWorker = (text, options = {}) => loadWorker({
  ...OPENAI,
  ...options,
  sync: { ...OPENAI.sync, ...options.sync },
  fetch: (call) => streamResponse(openaiStream(text), { signal: call.signal })
});

// ── The core path ───────────────────────────────────────────────────────────

test('one enhancement makes exactly one API call, and the streamed text is the result', async () => {
  const worker = openaiWorker('Write a cover letter for a [role] position at [company].');
  const port = worker.connect();
  const done = await port.enhance({ prompt: 'help me write a cover letter' });

  assert.equal(done.type, 'done');
  assert.equal(worker.calls.length, 1);
  assert.equal(done.text, 'Write a cover letter for a [role] position at [company].');
  assert.equal(port.streamed(), done.text);
  assert.equal(typeof done.preScore.overall, 'number');
  assert.equal(typeof done.postScore.overall, 'number');
});

test('"$" sequences in the prompt reach the model untouched', async () => {
  const worker = openaiWorker('ok then');
  const prompt = "Explain $$E=mc^2$$ and what `echo $'a'` and $& do in bash";
  await worker.connect().enhance({ prompt });
  assert.ok(worker.calls[0].body.input.includes(`<draft_prompt>\n${prompt}\n</draft_prompt>`));
});

test('placeholder text inside the prompt or page context is not substituted', async () => {
  const worker = openaiWorker('ok then');
  await worker.connect().enhance({
    prompt: 'what does {{context}} mean in a template?',
    context: { platform: 'ChatGPT', conversation: '[User]: my template uses {{input}} twice', messageCount: 1 }
  });
  const sent = worker.calls[0].body.input;
  assert.ok(sent.includes('what does {{context}} mean in a template?'));
  assert.ok(sent.includes('my template uses {{input}} twice'));
  assert.equal(sent.match(/<draft_prompt>/g).length, 1);
});

test('conversation context and platform hints are included, delimited', async () => {
  const worker = openaiWorker('ok then');
  await worker.connect().enhance({
    prompt: 'now make it faster',
    context: { platform: 'Claude', conversation: '[User]: write a sort function', messageCount: 1 }
  });
  const sent = worker.calls[0].body.input;
  assert.match(sent, /Target AI: Claude/);
  assert.match(sent, /<conversation_context>\n\[User\]: write a sort function\n<\/conversation_context>/);
});

test('history keeps the full text so Reuse and Copy return the whole prompt', async () => {
  const longOutput = 'Detailed prompt. '.repeat(200).trim();
  const worker = openaiWorker(longOutput);
  const prompt = 'x'.repeat(3000);
  await worker.connect().enhance({ prompt });
  const [entry] = worker.storage.local.data.promptHistory;
  assert.equal(entry.input.length, 3000);
  assert.equal(entry.output, longOutput);
});

test('usage is recorded from the token counts the API reports', async () => {
  const worker = openaiWorker('ok then');
  await worker.connect().enhance({ prompt: 'hello there' });
  const stats = worker.storage.local.data.usageStats;
  assert.equal(stats.totalEnhancements, 1);
  assert.equal(stats.totalInputTokens, 321);
  assert.equal(stats.totalOutputTokens, 45);
  assert.equal(stats.byModel['gpt-6-luna'].enhancements, 1);
  assert.ok(stats.totalCostUSD > 0);
});

test('models without a known price are still counted', async () => {
  const worker = openaiWorker('ok then', { sync: { openaiModel: 'gpt-some-future-model' } });
  await worker.connect().enhance({ prompt: 'hello there' });
  const stats = worker.storage.local.data.usageStats;
  assert.equal(stats.byModel['gpt-some-future-model'].inputTokens, 321);
  assert.equal(stats.totalCostUSD, 0);
});

// ── Output cleanup ──────────────────────────────────────────────────────────

test('model chatter is stripped from both the stream and the result', async () => {
  const worker = openaiWorker("Sure! Here's your improved prompt:\n\nWrite a haiku about autumn rain.");
  const port = worker.connect();
  const done = await port.enhance({ prompt: 'haiku pls' });
  assert.equal(done.text, 'Write a haiku about autumn rain.');
  assert.equal(port.streamed(), 'Write a haiku about autumn rain.');
});

test('rewrites that merely start like chatter are left intact', () => {
  const { cleanEnhancedText } = loadWorker().sandbox;
  for (const text of [
    'Below is a function that crashes on empty input. Find the bug and explain the fix.',
    "I've created a REST API in Express that returns 500s under load. Help me find the bottleneck.",
    'Sure-fire ways to speed up a slow Postgres query? List five with examples.',
    'Below is my code:\n```js\nconsole.log(1)\n```\nReview it.',
    'Compare "tabs" and "spaces" for a style guide'
  ]) {
    assert.equal(cleanEnhancedText(text), text);
  }
});

test('wrapping quotes, fences and labels are removed', () => {
  const { cleanEnhancedText } = loadWorker().sandbox;
  assert.equal(cleanEnhancedText('"Write a limerick about tea."'), 'Write a limerick about tea.');
  assert.equal(cleanEnhancedText('```\nWrite a limerick about tea.\n```'), 'Write a limerick about tea.');
  assert.equal(cleanEnhancedText('**Enhanced Prompt:**\nWrite a limerick about tea.'), 'Write a limerick about tea.');
  assert.equal(cleanEnhancedText('<think>hmm, tea</think>\n\nWrite a limerick about tea.'), 'Write a limerick about tea.');
});

test('a leading <think> block never reaches the page, even split across chunks', async () => {
  const worker = loadWorker({
    sync: { provider: 'ollama', ollamaModel: 'qwen3:8b' },
    fetch: () => streamResponse([
      '{"response":"<thi"}\n{"response":"nk>the user wants"}\n',
      '{"response":" a poem</th"}\n{"response":"ink>\\n\\nWrite a poem "}\n',
      '{"response":"about the sea."}\n{"done":true,"prompt_eval_count":50,"eval_count":9}\n'
    ])
  });
  const port = worker.connect();
  const done = await port.enhance({ prompt: 'poem about sea' });
  assert.equal(done.text, 'Write a poem about the sea.');
  assert.equal(port.streamed(), 'Write a poem about the sea.');
});

// ── Providers ───────────────────────────────────────────────────────────────

test('OpenAI: Responses API request shape', async () => {
  const worker = openaiWorker('ok then');
  await worker.connect().enhance({ prompt: 'hi there' });
  const [call] = worker.calls;
  assert.equal(call.url, 'https://api.openai.com/v1/responses');
  assert.equal(call.headers.Authorization, 'Bearer sk-test');
  assert.equal(call.body.model, 'gpt-6-luna');
  assert.equal(call.body.stream, true);
  assert.equal(call.body.store, false);
  assert.ok(call.body.instructions.includes('PromptCraft'));
  assert.equal(call.body.temperature, undefined);
});

test('Gemini: key goes in a header, stream is parsed, thoughts are skipped', async () => {
  const worker = loadWorker({
    local: { geminiApiKey: 'g-key' },
    fetch: () => streamResponse(sse([
      { candidates: [{ content: { parts: [{ text: 'pondering', thought: true }] } }] },
      { candidates: [{ content: { parts: [{ text: 'Summarize the ' }] } }] },
      { candidates: [{ content: { parts: [{ text: 'article in 3 bullets.' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 8, thoughtsTokenCount: 30 } }
    ]))
  });
  const done = await worker.connect().enhance({ prompt: 'summarize this' });
  const [call] = worker.calls;
  assert.equal(done.text, 'Summarize the article in 3 bullets.');
  assert.equal(call.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse');
  assert.ok(!call.url.includes('g-key'));
  assert.equal(call.headers['x-goog-api-key'], 'g-key');
  assert.equal(worker.storage.local.data.usageStats.totalOutputTokens, 38);
});

test('Gemini: a saved model that has been shut down is replaced', async () => {
  const worker = loadWorker({
    sync: { geminiModel: 'gemini-2.0-flash' },
    local: { geminiApiKey: 'g-key' },
    fetch: () => streamResponse(sse([{ candidates: [{ content: { parts: [{ text: 'ok then' }] } }] }]))
  });
  await worker.connect().enhance({ prompt: 'hi there' });
  assert.match(worker.calls[0].url, /models\/gemini-3\.5-flash-lite:/);
});

test('Claude: no sampling params, low effort, refusal fallback, text deltas only', async () => {
  const worker = loadWorker({
    sync: { apiProvider: 'claude' },
    local: { claudeApiKey: 'sk-ant-test' },
    fetch: () => streamResponse(sse([
      { type: 'message_start', message: { usage: { input_tokens: 150, output_tokens: 1 } } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Draft a polite ' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'follow-up email.' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 22 } },
      { type: 'message_stop' }
    ]))
  });
  const done = await worker.connect().enhance({ prompt: 'email followup' });
  const [call] = worker.calls;
  assert.equal(done.text, 'Draft a polite follow-up email.');
  assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(call.body.model, 'claude-opus-5-5');
  assert.equal(call.body.temperature, undefined);
  assert.equal(call.body.thinking, undefined);
  assert.deepEqual(call.body.output_config, { effort: 'low' });
  assert.equal(call.body.fallbacks, 'default');
  assert.equal(call.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(call.headers['x-api-key'], 'sk-ant-test');
  const stats = worker.storage.local.data.usageStats;
  assert.deepEqual([stats.totalInputTokens, stats.totalOutputTokens], [150, 22]);
});

test('Claude Haiku 4.5 gets neither effort nor fallbacks', async () => {
  const worker = loadWorker({
    sync: { apiProvider: 'claude', claudeModel: 'claude-haiku-4-5' },
    local: { claudeApiKey: 'sk-ant-test' },
    fetch: () => streamResponse(sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok then' } }]))
  });
  await worker.connect().enhance({ prompt: 'hi there' });
  const [call] = worker.calls;
  assert.equal(call.body.output_config, undefined);
  assert.equal(call.body.fallbacks, undefined);
  assert.equal(call.headers['anthropic-beta'], undefined);
});

test('Claude: a refusal is reported instead of inserted as the prompt', async () => {
  const worker = loadWorker({
    sync: { apiProvider: 'claude' },
    local: { claudeApiKey: 'sk-ant-test' },
    fetch: () => streamResponse(sse([
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'I can' } },
      { type: 'message_delta', delta: { stop_reason: 'refusal' }, usage: { output_tokens: 2 } }
    ]))
  });
  const result = await worker.connect().enhance({ prompt: 'hi there' });
  assert.equal(result.type, 'error');
  assert.match(result.error, /declined/);
  assert.equal(worker.storage.local.data.promptHistory, undefined);
});

test('Custom endpoint: OpenAI-compatible chat completions with temperature', async () => {
  const worker = loadWorker({
    sync: { apiProvider: 'custom', customEndpoint: 'https://api.groq.com/openai/v1/', customModel: 'llama-3.3-70b' },
    local: { customApiKey: 'gsk-test' },
    fetch: () => streamResponse([
      // no space after "data:", and a final event with no trailing blank line
      'data:{"choices":[{"delta":{"content":"List five "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"ideas."},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":90,"completion_tokens":4}}\n\ndata: [DONE]'
    ])
  });
  const done = await worker.connect().enhance({ prompt: 'ideas pls', modifier: 'creative' });
  const [call] = worker.calls;
  assert.equal(done.text, 'List five ideas.');
  assert.equal(call.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(call.body.temperature, 0.8);
  assert.equal(call.body.messages[0].role, 'system');
  assert.equal(worker.storage.local.data.usageStats.totalInputTokens, 90);
});

test('Custom endpoint: missing configuration is explained, with no request sent', async () => {
  const worker = loadWorker({ sync: { apiProvider: 'custom' }, fetch: () => { throw new Error('should not fetch'); } });
  const result = await worker.connect().enhance({ prompt: 'hi there' });
  assert.match(result.error, /Custom endpoint not set/);
  assert.equal(worker.calls.length, 0);
});

test('events split across network chunks are reassembled', async () => {
  const raw = openaiStream('Plan a three day trip to Lisbon.').join('');
  const pieces = raw.match(/[\s\S]{1,7}/g);
  const worker = loadWorker({ ...OPENAI, fetch: () => streamResponse(pieces) });
  const done = await worker.connect().enhance({ prompt: 'lisbon trip' });
  assert.equal(done.text, 'Plan a three day trip to Lisbon.');
});

// ── Failure handling ────────────────────────────────────────────────────────

test('a parameter the model rejects is dropped, retried, and remembered', async () => {
  let attempt = 0;
  const worker = loadWorker({
    ...OPENAI,
    fetch: (call) => {
      attempt++;
      if (call.body.reasoning) {
        return jsonResponse({ error: { message: "Unsupported parameter: 'reasoning.effort' is not supported with this model." } }, 400);
      }
      return streamResponse(openaiStream('ok then'));
    }
  });
  const first = await worker.connect().enhance({ prompt: 'hi there' });
  assert.equal(first.type, 'done');
  assert.equal(attempt, 2);

  await worker.connect().enhance({ prompt: 'hi again' });
  assert.equal(attempt, 3, 'second enhancement should not repeat the rejected attempt');
});

test('API errors become actionable messages', async () => {
  const cases = [
    [401, { error: { message: 'Incorrect API key provided' } }, /Invalid OpenAI API key/],
    [404, { error: { message: 'The model does not exist' } }, /could not find the model "gpt-6-luna"/],
    [429, { error: { message: 'You exceeded your current quota' } }, /rate limit or quota.*exceeded your current quota/]
  ];
  for (const [status, payload, expected] of cases) {
    const worker = loadWorker({ ...OPENAI, fetch: () => jsonResponse(payload, status) });
    const result = await worker.connect().enhance({ prompt: 'hi there' });
    assert.equal(result.type, 'error');
    assert.match(result.error, expected);
  }
});

test('Ollama 403 explains the OLLAMA_ORIGINS fix', async () => {
  const worker = loadWorker({ sync: { provider: 'ollama' }, fetch: () => new Response('', { status: 403 }) });
  const result = await worker.connect().enhance({ prompt: 'hi there' });
  assert.match(result.error, /OLLAMA_ORIGINS=chrome-extension:\/\/\*/);
});

test('a server error is retried once', async () => {
  let attempt = 0;
  const worker = loadWorker({
    ...OPENAI,
    fetch: () => (++attempt === 1 ? jsonResponse({ error: { message: 'overloaded' } }, 503) : streamResponse(openaiStream('ok then')))
  });
  const result = await worker.connect().enhance({ prompt: 'hi there' });
  assert.equal(result.type, 'done');
  assert.equal(attempt, 2);
});

test('an empty prompt and a missing key are rejected before any request', async () => {
  const worker = loadWorker({ fetch: () => { throw new Error('should not fetch'); } });
  assert.match((await worker.connect().enhance({ prompt: '   ' })).error, /No text to enhance/);
  assert.match((await worker.connect().enhance({ prompt: 'hello' })).error, /Gemini API key not set/);
});

test('disconnecting the port cancels the request and records nothing', async () => {
  let signal;
  const worker = loadWorker({
    ...OPENAI,
    fetch: (call) => {
      signal = call.signal;
      return streamResponse(openaiStream('This response is long enough to arrive in several chunks.'), { gapMs: 30, signal });
    }
  });
  const port = worker.connect();
  port.send({ type: 'start', prompt: 'hi there', modifier: 'short' });
  await port.waitFor('stage');
  await new Promise(r => setTimeout(r, 50));
  port.disconnect();
  await new Promise(r => setTimeout(r, 150));

  assert.equal(signal.aborted, true);
  assert.equal(port.received.some(m => m.type === 'done' || m.type === 'error'), false);
  assert.equal(worker.storage.local.data.promptHistory, undefined);
});

// ── Options ─────────────────────────────────────────────────────────────────

test('deep analysis is off by default; when on it adds one call and its tokens', async () => {
  const longPrompt = 'please help me figure out something about my project that is kind of broken and stuff '.repeat(3);
  const off = openaiWorker('ok then');
  await off.connect().enhance({ prompt: longPrompt });
  assert.equal(off.calls.length, 1);

  const on = loadWorker({
    ...OPENAI,
    sync: { ...OPENAI.sync, deepAnalysis: true },
    fetch: (call) => streamResponse(openaiStream(call.body.instructions.includes('input analyzer')
      ? 'INTENT: fix a broken project\nMISSING: the tech stack'
      : 'ok then'))
  });
  await on.connect().enhance({ prompt: longPrompt });
  assert.equal(on.calls.length, 2);
  assert.match(on.calls[1].body.input, /Missing from input: the tech stack/);
  assert.equal(on.storage.local.data.usageStats.totalInputTokens, 642);
});

test('multi-step runs three passes and streams only the last', async () => {
  const worker = loadWorker({
    ...OPENAI,
    sync: { ...OPENAI.sync, multiStep: true },
    fetch: (call) => {
      const n = worker.calls.length;
      return streamResponse(openaiStream(['expanded draft', 'structured draft', 'Polished final prompt.'][n - 1]));
    }
  });
  const port = worker.connect();
  const done = await port.enhance({ prompt: 'make a plan' });
  assert.equal(worker.calls.length, 3);
  assert.match(worker.calls[1].body.input, /<draft_prompt>\nexpanded draft\n<\/draft_prompt>/);
  assert.match(worker.calls[2].body.input, /<draft_prompt>\nstructured draft\n<\/draft_prompt>/);
  assert.equal(done.text, 'Polished final prompt.');
  assert.equal(port.streamed(), 'Polished final prompt.');
  assert.deepEqual(port.received.filter(m => m.type === 'stage').map(m => m.stage),
    ['analyzing', 'generating', 'structuring', 'polishing']);
});

test('a refine request sends the previous rewrite and the instruction', async () => {
  const worker = openaiWorker('Shorter prompt.');
  await worker.connect().enhance({
    prompt: 'help with my essay',
    refine: { kind: 'shorter', previous: 'A very long previous rewrite of the essay prompt.' }
  });
  const sent = worker.calls[0].body.input;
  assert.match(sent, /<previous_rewrite>\nA very long previous rewrite of the essay prompt\.\n<\/previous_rewrite>/);
  assert.match(sent, /substantially shorter/);
  assert.match(sent, /<draft_prompt>\nhelp with my essay\n<\/draft_prompt>/);
});

test('a one-issue fix asks for that fix only, and unknown issues are ignored', async () => {
  const worker = openaiWorker('Write 300 words about [dog breed].');
  await worker.connect().enhance({ prompt: 'write something about dogs', focus: 'specificity' });
  assert.match(worker.calls[0].body.input, /one targeted fix, not a full rewrite\. Replace vague wording/);

  await worker.connect().enhance({ prompt: 'write something about dogs', focus: 'constructor' });
  assert.doesNotMatch(worker.calls[1].body.input, /one targeted fix/);
});

test('every issue the review can raise has a one-click fix', () => {
  const { sandbox } = loadWorker();
  const fixes = require('vm').runInContext('Object.keys(FOCUS_INSTRUCTIONS)', sandbox);
  const dimensions = require('vm').runInContext('Object.keys(InputParser.scorePrompt("write something about dogs").breakdown)', sandbox);
  assert.deepEqual(plain(fixes).sort(), plain(dimensions).sort());
});

test('custom presets and built-in overrides are used as the template', async () => {
  const worker = openaiWorker('ok then', {
    local: {
      ...OPENAI.local,
      customPresets: [{ id: 'custom_1', name: 'Pirate', template: 'Rewrite as a pirate would ask it: {{input}}' }],
      presetOverrides: { short: 'MY OVERRIDE {{context}} {{input}}' }
    }
  });
  await worker.connect().enhance({ prompt: 'where is the treasure', modifier: 'custom_1' });
  assert.match(worker.calls[0].body.input, /Rewrite as a pirate would ask it: <draft_prompt>/);
  await worker.connect().enhance({ prompt: 'where is the treasure', modifier: 'short' });
  assert.match(worker.calls[1].body.input, /^MY OVERRIDE /);
});

test('follow-up enhancements in a tab see the previous one', async () => {
  const worker = openaiWorker('First rewrite.');
  await worker.connect().enhance({ prompt: 'first draft' });
  await worker.connect().enhance({ prompt: 'second draft' });
  assert.doesNotMatch(worker.calls[0].body.input, /Previous enhancement in this session/);
  assert.match(worker.calls[1].body.input, /Previous enhancement in this session[\s\S]*Original: "first draft"/);
});

// ── Message router ──────────────────────────────────────────────────────────

test('content scripts cannot read settings, keys, or history', async () => {
  const worker = loadWorker({ local: { openaiApiKey: 'sk-secret', promptHistory: [{ input: 'private' }] } });
  for (const action of ['getSettings', 'getHistory', 'saveSettings', 'getUsageStats', 'listModels']) {
    const resp = await worker.send({ action, settings: { openaiApiKey: 'stolen' } }, SENDERS.page);
    assert.equal(resp.success, false, action);
    assert.ok(!JSON.stringify(resp).includes('sk-secret'));
  }
  assert.equal(worker.storage.local.data.openaiApiKey, 'sk-secret');
});

test('content scripts get a public view with no credentials', async () => {
  const worker = loadWorker({
    sync: { apiProvider: 'openai', lastModifier: 'technical' },
    local: { openaiApiKey: 'sk-secret', customPresets: [{ id: 'custom_1', name: 'Pirate', template: '{{input}}' }] }
  });
  const resp = await worker.send({ action: 'getPublicSettings' }, SENDERS.page);
  assert.equal(resp.success, true);
  assert.ok(!JSON.stringify(resp).includes('sk-secret'));
  assert.deepEqual(
    plain({ ...resp.settings, styles: resp.settings.styles.map(s => s.id) }),
    { providerLabel: 'OpenAI', model: 'gpt-6-luna', ready: true, modifier: 'technical', useContext: true,
      styles: ['short', 'detailed', 'creative', 'technical', 'cot', 'custom_1'] }
  );
});

test('the popup can read and save settings; unknown keys are ignored', async () => {
  const worker = loadWorker();
  const saved = await worker.send({ action: 'saveSettings', settings: { openaiApiKey: 'sk-new', apiProvider: 'openai', promptHistory: 'clobbered' } });
  assert.equal(saved.success, true);
  assert.equal(worker.storage.local.data.openaiApiKey, 'sk-new');
  assert.equal(worker.storage.sync.data.apiProvider, 'openai');
  assert.equal(worker.storage.sync.data.openaiApiKey, undefined, 'keys must not be synced');
  assert.equal(worker.storage.local.data.promptHistory, undefined);
  const resp = await worker.send({ action: 'getSettings' });
  assert.equal(resp.settings.openaiApiKey, 'sk-new');
});

test('the conversation on the page can be kept out of rewrites', async () => {
  const context = { platform: 'ChatGPT', conversation: '[User]: my cat is called Biscuit', messageCount: 1 };
  const worker = openaiWorker('ok then');
  await worker.connect().enhance({ prompt: 'write about my pet', context });
  assert.match(worker.calls[0].body.input, /Biscuit/);
  assert.equal(worker.storage.local.data.promptHistory[0].platform, 'ChatGPT');

  assert.equal((await worker.send({ action: 'setUseContext', value: 'no' }, SENDERS.page)).success, false);
  assert.equal((await worker.send({ action: 'setUseContext', value: false }, SENDERS.page)).success, true);
  assert.equal((await worker.send({ action: 'getPublicSettings' }, SENDERS.page)).settings.useContext, false);

  // Switched off: dropped even if a page still sends it, and the panel's request to fetch it is ignored
  await worker.connect().enhance({ prompt: 'write about my pet', context });
  assert.doesNotMatch(worker.calls[1].body.input, /Biscuit/);
  assert.equal(worker.storage.local.data.promptHistory[0].platform, null);
  await worker.connect(SENDERS.popup).enhance({ prompt: 'write about my pet', includeContext: true, tabId: 7 });
  assert.equal(worker.tabMessages.filter(m => m.message.action === 'getConversation').length, 0);
});

test('a page can switch tone only to one that exists', async () => {
  const worker = loadWorker();
  assert.equal((await worker.send({ action: 'setModifier', modifier: 'creative' }, SENDERS.page)).success, true);
  assert.equal(worker.storage.sync.data.lastModifier, 'creative');
  assert.equal((await worker.send({ action: 'setModifier', modifier: '__proto__' }, SENDERS.page)).success, false);
  assert.equal(worker.storage.sync.data.lastModifier, 'creative');
});

test('undo is recorded and feeds back into later prompts', async () => {
  const worker = openaiWorker('ok then');
  for (let i = 0; i < 10; i++) {
    await worker.connect().enhance({ prompt: `draft number ${i}`, context: { platform: 'ChatGPT' } });
    if (i < 6) await worker.send({ action: 'recordUndo', modifier: 'short', platform: 'ChatGPT' }, SENDERS.page);
  }
  assert.equal(worker.storage.local.data.undoStats.byStyle.short.undone, 6);
  await worker.connect().enhance({ prompt: 'one more draft' });
  assert.match(worker.calls.at(-1).body.input, /frequently undoes "short" style enhancements \(60% undo rate\)/);
});

test('model lists come from the provider and are cached', async () => {
  const worker = loadWorker({
    fetch: (call) => {
      assert.equal(call.url, 'https://api.openai.com/v1/models');
      return jsonResponse({ data: [
        { id: 'gpt-6-luna', created: 2 }, { id: 'gpt-7', created: 3 },
        { id: 'text-embedding-3-large', created: 1 }, { id: 'gpt-realtime-2', created: 1 }, { id: 'gpt-image-2', created: 1 }
      ] });
    }
  });
  const resp = await worker.send({ action: 'listModels', provider: 'api', apiProvider: 'openai', apiKey: 'sk-test' });
  assert.deepEqual(plain(resp.models.map(m => m.id)), ['gpt-7', 'gpt-6-luna']);
  assert.deepEqual(worker.storage.local.data.modelCache.openai.map(m => m.id), ['gpt-7', 'gpt-6-luna']);

  const bad = await loadWorker({ fetch: () => jsonResponse({ error: { message: 'bad key' } }, 401) })
    .send({ action: 'testConnection', provider: 'api', apiProvider: 'openai', apiKey: 'nope' });
  assert.deepEqual(plain(bad), { success: false, error: 'Invalid OpenAI API key. Check your key in Settings.' });
});

test('streaming starts on the first word when it cannot be chatter', () => {
  const { createStreamCleaner } = loadWorker().sandbox;
  const emitted = [];
  const cleaner = createStreamCleaner(text => emitted.push(text));

  cleaner.push('Wri');
  assert.deepEqual(emitted, [], 'first word still incomplete');
  cleaner.push('te a ');
  assert.deepEqual(emitted, ['Write a '], 'released as soon as the first word is known');
  cleaner.push('haiku.');
  cleaner.flush();
  assert.equal(emitted.join(''), 'Write a haiku.');

  // "Here..." might be chatter, so it is held until the line ends
  const held = [];
  const cautious = createStreamCleaner(text => held.push(text));
  cautious.push('Here is the ');
  assert.deepEqual(held, []);
  cautious.push('improved prompt:\n\nExplain DNS.');
  cautious.flush();
  assert.equal(held.join(''), 'Explain DNS.');

  // ...and released untouched when it turns out to be the rewrite itself
  const kept = [];
  const genuine = createStreamCleaner(text => kept.push(text));
  genuine.push('Here is my resume. ');
  genuine.push('Review it for clarity and impact,\nthen list three fixes.');
  genuine.flush();
  assert.equal(kept.join(''), 'Here is my resume. Review it for clarity and impact,\nthen list three fixes.');
});

test('a bare "Prompt:" label is removed', () => {
  const { cleanEnhancedText } = loadWorker().sandbox;
  assert.equal(cleanEnhancedText('**Prompt:** Write a short story about a dog.'), 'Write a short story about a dog.');
  assert.equal(cleanEnhancedText('Prompt engineering is hard. Explain why.'), 'Prompt engineering is hard. Explain why.');
});

// ── Side panel ──────────────────────────────────────────────────────────────

test('the toolbar icon is wired to open the side panel', () => {
  assert.deepEqual(plain(loadWorker().sidePanelBehavior()), { openPanelOnActionClick: true });
});

test('the side panel can name the tab it is working on; a page cannot', async () => {
  const worker = openaiWorker('First rewrite.');
  // Panel: enhancement is tied to tab 42, so the follow-up sees it
  await worker.connect(SENDERS.popup).enhance({ prompt: 'first draft', tabId: 42 });
  await worker.connect(SENDERS.popup).enhance({ prompt: 'second draft', tabId: 42 });
  assert.match(worker.calls[1].body.input, /Previous enhancement in this session[\s\S]*Original: "first draft"/);

  // A content script claiming tab 42 is still treated as its own tab (7)
  await worker.connect(SENDERS.page).enhance({ prompt: 'third draft', tabId: 42 });
  assert.doesNotMatch(worker.calls[2].body.input, /Previous enhancement in this session/);
});

test('a draft is reviewed locally, with no network request', async () => {
  const worker = loadWorker({ fetch: () => { throw new Error('should not fetch'); } });
  const weak = await worker.send({ action: 'analyzeDraft', text: 'write something about dogs' }, SENDERS.page);
  assert.equal(weak.success, true);
  assert.equal(typeof weak.score, 'number');
  assert.ok(weak.issues.length >= 2 && weak.issues.length <= 3);
  for (const issue of weak.issues) {
    assert.ok(issue.id && issue.title && issue.detail, JSON.stringify(issue));
  }
  assert.ok(!weak.issues.some(i => i.id === 'structure'), 'a one-line draft is not told to add structure');

  const strong = await worker.send({ action: 'analyzeDraft', text: [
    'You are reviewing a pull request for our team. Our project is a React 18 application currently using Redux.',
    'Review the code below for performance problems and explain each finding in 2 sentences.',
    '1. List the issues as a numbered list.',
    '2. For example, flag unnecessary re-renders.',
    '3. Do not suggest rewriting it in another framework; focus on at most 5 findings.'
  ].join('\n') }, SENDERS.page);
  assert.ok(strong.score > weak.score);
  assert.ok(strong.issues.length < weak.issues.length);

  assert.deepEqual(plain(await worker.send({ action: 'analyzeDraft', text: '   ' }, SENDERS.page)), { success: true, score: null, issues: [] });
  assert.equal(worker.calls.length, 0);
});

test('a page can ask for the side panel to be opened beside its own tab', async () => {
  const worker = loadWorker();
  assert.equal((await worker.send({ action: 'openPanel' }, SENDERS.page)).success, true);
  assert.deepEqual(plain(worker.sidePanelOpened), [{ tabId: 7 }]);
});

// ── The browser's built-in model ────────────────────────────────────────────

const noNetwork = () => { throw new Error('the built-in model must not make a network request'); };
const builtinWorker = (model) => loadWorker({ sync: { provider: 'builtin' }, fetch: noNetwork, languageModel: model });

test('built-in model: a rewrite streams with no key and no network request', async () => {
  const model = fakeLanguageModel({ chunks: ['Write a 200-word ', 'overview of dogs ', 'for new owners.'] });
  const worker = builtinWorker(model);
  const port = worker.connect();
  const done = await port.enhance({ prompt: 'write me somthing about dogs' });

  assert.equal(done.type, 'done', done.error);
  assert.equal(done.text, 'Write a 200-word overview of dogs for new owners.');
  assert.equal(port.streamed(), done.text);
  assert.equal(worker.calls.length, 0);

  // The system prompt opens the session; the draft is the one user turn
  const [session] = plain(model.log.created);
  assert.equal(session.initialPrompts.length, 1);
  assert.equal(session.initialPrompts[0].role, 'system');
  assert.match(session.initialPrompts[0].content, /^You are PromptCraft/);
  assert.deepEqual(session.expectedOutputs, [{ type: 'text', languages: ['en'] }]);
  assert.match(model.log.prompts[0], /<draft_prompt>\nwrite me somthing about dogs\n<\/draft_prompt>/);
  assert.equal(model.log.destroyed, 1, 'the session is released afterwards');

  // Counted as a free, local model
  const stats = worker.storage.local.data.usageStats.byModel['On-device model'];
  assert.equal(stats.provider, 'builtin');
  assert.equal(stats.costUSD, 0);
  assert.ok(stats.inputTokens > 100);

  const view = await worker.send({ action: 'getPublicSettings' }, SENDERS.page);
  assert.equal(view.settings.providerLabel, 'Built-in');
  assert.equal(view.settings.ready, true);
});

test('built-in model: when it is not ready the reason is given and nothing is run', async () => {
  const cases = [
    [fakeLanguageModel({ availability: 'downloadable' }), /has not been downloaded yet/],
    [fakeLanguageModel({ availability: 'downloading' }), /still downloading/],
    [fakeLanguageModel({ availability: 'unavailable' }), /can't run on this computer/],
    [undefined, /This browser has no built-in model/]
  ];
  for (const [model, message] of cases) {
    const worker = builtinWorker(model);
    const result = await worker.connect().enhance({ prompt: 'write me somthing about dogs' });
    assert.equal(result.type, 'error');
    assert.match(result.error, message);
    assert.equal((await worker.send({ action: 'getPublicSettings' }, SENDERS.page)).settings.ready, false);
    if (model) assert.equal(model.log.created.length, 0);
  }
});

test('built-in model: an over-long prompt gets a plain explanation', async () => {
  const model = fakeLanguageModel({ chunks: [], error: Object.assign(new Error('The input is too large.'), { name: 'QuotaExceededError' }) });
  const result = await builtinWorker(model).connect().enhance({ prompt: 'a very long draft' });
  assert.equal(result.type, 'error');
  assert.match(result.error, /too long for the built-in model/);
  assert.equal(model.log.destroyed, 1);
});

test('built-in model: cancelling stops the session without reporting an error', async () => {
  const model = fakeLanguageModel({ chunks: ['one ', 'two ', 'three ', 'four ', 'five'], gapMs: 30 });
  const worker = builtinWorker(model);
  const port = worker.connect();
  port.send({ type: 'start', modifier: 'short', prompt: 'write me somthing about dogs' });
  await port.waitFor('delta');
  port.disconnect();
  await new Promise(r => setTimeout(r, 200));

  assert.equal(port.received.some(m => m.type === 'done' || m.type === 'error'), false);
  assert.equal(model.log.destroyed, 1);
  assert.equal(worker.storage.local.data.promptHistory, undefined, 'a cancelled rewrite is not recorded');
});

test('built-in model: only extension pages can ask whether it is available', async () => {
  const worker = builtinWorker(fakeLanguageModel({ availability: 'downloadable' }));
  assert.equal((await worker.send({ action: 'getBuiltInState' }, SENDERS.page)).success, false);
  assert.equal((await worker.send({ action: 'getBuiltInState' }, SENDERS.popup)).state, 'downloadable');
  assert.equal((await loadWorker().send({ action: 'getBuiltInState' }, SENDERS.popup)).state, 'unsupported');
});
