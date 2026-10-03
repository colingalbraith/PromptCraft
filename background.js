// PromptCraft — Background Service Worker (provider gateway, streaming, storage)
importScripts('constants.js');
importScripts('input-parser.js');

const EXTENSION_ORIGIN = chrome.runtime.getURL('');

// API keys and history live in chrome.storage.local. Restrict that area to
// extension pages and this worker so content scripts can never read it.
try {
  chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })?.catch(() => {});
} catch {}

const own = (obj, key) => (obj && typeof key === 'string' && Object.hasOwn(obj, key) ? obj[key] : undefined);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const trimSlash = (url) => String(url || '').trim().replace(/\/+$/, '');

// ── Settings ────────────────────────────────────────────────────────────────

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);
const SYNC_SETTINGS_KEYS = SETTINGS_KEYS.filter(k => !LOCAL_ONLY_KEYS.includes(k));
const LOCAL_SETTINGS_KEYS = SETTINGS_KEYS.filter(k => LOCAL_ONLY_KEYS.includes(k));

async function getSettings() {
  const [syncResult, localResult] = await Promise.all([
    chrome.storage.sync.get(SYNC_SETTINGS_KEYS).catch(() => ({})),
    chrome.storage.local.get(LOCAL_SETTINGS_KEYS).catch(() => ({}))
  ]);
  const settings = { ...DEFAULT_SETTINGS, ...syncResult, ...localResult };

  // Swap out saved models the provider has since shut down
  for (const { model: modelKey } of Object.values(API_STORAGE_MAP)) {
    const replacement = own(RETIRED_MODELS, settings[modelKey]);
    if (replacement) settings[modelKey] = replacement;
  }
  return settings;
}

async function saveSettings(settings) {
  const syncData = {};
  const localData = {};
  for (const key of SETTINGS_KEYS) {
    if (settings?.[key] === undefined) continue;
    (LOCAL_ONLY_KEYS.includes(key) ? localData : syncData)[key] = settings[key];
  }
  await Promise.all([
    Object.keys(syncData).length > 0 ? chrome.storage.sync.set(syncData) : null,
    Object.keys(localData).length > 0 ? chrome.storage.local.set(localData) : null
  ]);
}

async function getLocal(key, fallback) {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? fallback;
}

// The provider, model and credentials an enhancement will use
function resolveTarget(settings) {
  if (settings[STORAGE_KEYS.PROVIDER] === PROVIDERS.BUILTIN) {
    return { kind: 'builtin', label: BUILTIN_LABEL, model: BUILTIN_MODEL };
  }
  if (settings[STORAGE_KEYS.PROVIDER] === PROVIDERS.OLLAMA) {
    return {
      kind: 'ollama',
      label: 'Ollama',
      endpoint: trimSlash(settings[STORAGE_KEYS.OLLAMA_ENDPOINT]) || DEFAULT_SETTINGS[STORAGE_KEYS.OLLAMA_ENDPOINT],
      model: settings[STORAGE_KEYS.OLLAMA_MODEL] || DEFAULT_SETTINGS[STORAGE_KEYS.OLLAMA_MODEL]
    };
  }
  const kind = own(API_STORAGE_MAP, settings[STORAGE_KEYS.API_PROVIDER]) ? settings[STORAGE_KEYS.API_PROVIDER] : API_PROVIDERS.GEMINI;
  const keys = API_STORAGE_MAP[kind];
  return {
    kind,
    label: API_PROVIDER_LABELS[kind],
    apiKey: settings[keys.key] || '',
    model: settings[keys.model] || DEFAULT_SETTINGS[keys.model] || '',
    endpoint: kind === API_PROVIDERS.CUSTOM ? trimSlash(settings[STORAGE_KEYS.CUSTOM_ENDPOINT]) : ''
  };
}

// What the browser says about its built-in model: 'available', 'downloadable',
// 'downloading' or 'unavailable', or 'unsupported' when it has no such model at all
async function builtInState() {
  if (typeof LanguageModel === 'undefined') return 'unsupported';
  try {
    return await LanguageModel.availability(BUILTIN_SESSION_OPTIONS);
  } catch {
    return 'unavailable';
  }
}

const BUILTIN_PROBLEMS = {
  unsupported: 'This browser has no built-in model. Pick another provider in Settings.',
  unavailable: 'The built-in model can\'t run on this computer right now (it needs about 22 GB of free disk space). Pick another provider in Settings.',
  downloadable: 'The built-in model has not been downloaded yet. Open Settings in the PromptCraft panel to download it.',
  downloading: 'The built-in model is still downloading. Try again in a few minutes.'
};

// Why the target can't be used yet, or null when it is ready
async function targetProblem(target) {
  if (target.kind === 'builtin') return own(BUILTIN_PROBLEMS, await builtInState()) || null;
  if (target.kind === 'ollama') return null;
  if (target.kind === API_PROVIDERS.CUSTOM) {
    if (!target.endpoint) return 'Custom endpoint not set. Add it in Settings (e.g., https://api.groq.com/openai/v1).';
    if (!/^https?:\/\/.+/.test(target.endpoint)) return 'Custom endpoint must start with http:// or https://';
    if (!target.model) return 'Custom model not set. Enter a model name in Settings.';
    return null;
  }
  return target.apiKey ? null : `${target.label} API key not set. Add it in Settings.`;
}

// What a content script may know: labels and the tone list, never keys
async function getPublicSettings() {
  const settings = await getSettings();
  const target = resolveTarget(settings);
  const presets = await getCustomPresets();
  return {
    providerLabel: target.label,
    model: target.model,
    ready: !(await targetProblem(target)),
    modifier: settings[STORAGE_KEYS.LAST_MODIFIER],
    useContext: settings[STORAGE_KEYS.USE_CONTEXT] !== false,
    styles: [
      ...Object.entries(STYLE_LABELS).map(([id, label]) => ({ id, label })),
      ...presets.map(p => ({ id: p.id, label: p.name }))
    ]
  };
}

// ── HTTP Helpers ────────────────────────────────────────────────────────────

// Time allowed until the first response byte. Local models may need to load first.
const CONNECT_TIMEOUT_MS = { ollama: 120000, builtin: 120000, custom: 60000, default: 30000 };
// Time allowed between chunks once a response is streaming
const IDLE_TIMEOUT_MS = 60000;
const RETRYABLE_STATUSES = [500, 502, 503, 529];

class CancelledError extends Error {
  constructor() { super('Cancelled'); this.name = 'CancelledError'; }
}

// fetch() and stream reads reject with a TypeError when the network fails
const isNetworkError = (err) => err?.name === 'TypeError' && /fetch|network/i.test(err.message || '');

function friendlyApiError(target, status, detail) {
  const short = (detail || '').replace(/\s+/g, ' ').trim().substring(0, 200);
  if (target.kind === 'ollama') {
    if (status === 403) return 'Ollama refused the request. Allow browser extensions by setting OLLAMA_ORIGINS=chrome-extension://* and restarting Ollama.';
    if (status === 404) return `Ollama model "${target.model}" not found. Pull it with: ollama pull ${target.model}`;
    return `Ollama error (${status}): ${short}`;
  }
  if (status === 401 || (status === 400 && /api key/i.test(short))) return `Invalid ${target.label} API key. Check your key in Settings.`;
  switch (status) {
    case 403: return `${target.label} denied access. Your API key may lack permission for this model.`;
    case 404: return `${target.label} could not find the model "${target.model}". Pick another in Settings.`;
    case 429: return `${target.label} rate limit or quota reached. Wait a moment and try again.${short ? ` (${short})` : ''}`;
    case 500: case 502: case 503: case 529:
      return `${target.label} is temporarily unavailable. Try again shortly.`;
    default: return `${target.label} error (${status}): ${short}`;
  }
}

async function readErrorDetail(response) {
  const raw = await response.text().catch(() => '');
  try {
    const json = JSON.parse(raw);
    const err = Array.isArray(json) ? json[0]?.error : json.error;
    return (typeof err === 'string' ? err : err?.message) || json.message || raw;
  } catch {
    return raw;
  }
}

// Aborts a request when the caller cancels, the server never answers, or the stream stalls
function createWatchdog(parentSignal) {
  const controller = new AbortController();
  const state = { signal: controller.signal, timedOut: false };
  let timer = null;
  const onParentAbort = () => controller.abort();

  if (parentSignal?.aborted) controller.abort();
  else parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  state.arm = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.timedOut = true; controller.abort(); }, ms);
  };
  state.stop = () => {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  };
  return state;
}

// ── Stream Readers ──────────────────────────────────────────────────────────

async function* readLines(body, onChunk) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk?.();
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        yield buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer) yield buffer.replace(/\r$/, '');
  } finally {
    reader.cancel().catch(() => {});
  }
}

// Yields the data payload of each server-sent event
async function* readSSE(body, onChunk) {
  let data = [];
  for await (const line of readLines(body, onChunk)) {
    if (line === '') {
      if (data.length > 0) yield data.join('\n');
      data = [];
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (data.length > 0) yield data.join('\n');
}

// ── Provider Adapters ───────────────────────────────────────────────────────
// Each adapter builds a streaming request and reads its events. `tunables` are
// optional request params some models reject: when a 400 names one, it is
// dropped and the request retried (see openStream). The built-in model is the
// exception: it is a function call, so its adapter runs the completion itself.

// Output-token room for models that reason before they answer
const REASONING_HEADROOM = 4000;
const CLAUDE_MAX_TOKENS = 16000;
const CLAUDE_EFFORT_MODELS = /^claude-(fable|mythos|opus-(5|4-[5-8])|sonnet-(5|4-6))/;
const CLAUDE_FALLBACK_MODELS = /^claude-(fable-5-1|opus-5|sonnet-5-5)/;

const PROVIDER_ADAPTERS = {
  openai: {
    tunables: { reasoning: ['reasoning'] },
    request(target, job, skip) {
      const body = {
        model: target.model,
        instructions: job.system,
        input: job.user,
        stream: true,
        store: false,
        max_output_tokens: job.maxTokens + REASONING_HEADROOM
      };
      if (!skip.has('reasoning')) body.reasoning = { effort: 'low' };
      return { url: 'https://api.openai.com/v1/responses', headers: { Authorization: `Bearer ${target.apiKey}` }, body };
    },
    onEvent(event, out) {
      switch (event.type) {
        case 'response.output_text.delta': out.emit(event.delta); break;
        case 'response.refusal.delta': out.refusal = (out.refusal || '') + (event.delta || ''); break;
        case 'response.incomplete': out.truncated = true; // falls through
        case 'response.completed':
          out.setUsage(event.response?.usage?.input_tokens, event.response?.usage?.output_tokens);
          break;
        case 'response.failed': throw new Error(event.response?.error?.message || 'OpenAI could not complete the request.');
        case 'error': throw new Error(event.message || event.error?.message || 'OpenAI returned an error.');
      }
    }
  },

  gemini: {
    tunables: { thinking: ['thinking'] },
    request(target, job, skip) {
      const generationConfig = { maxOutputTokens: job.maxTokens + REASONING_HEADROOM };
      if (!skip.has('thinking')) generationConfig.thinkingConfig = { thinkingLevel: 'low' };
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(target.model)}:streamGenerateContent?alt=sse`,
        headers: { 'x-goog-api-key': target.apiKey },
        body: {
          systemInstruction: { parts: [{ text: job.system }] },
          contents: [{ role: 'user', parts: [{ text: job.user }] }],
          generationConfig
        }
      };
    },
    onEvent(event, out) {
      if (event.error) throw new Error(event.error.message || 'Gemini returned an error.');
      if (event.promptFeedback?.blockReason) {
        throw new Error(`Gemini blocked this prompt (${event.promptFeedback.blockReason}). Try rewording it.`);
      }
      const candidate = event.candidates?.[0];
      for (const part of candidate?.content?.parts || []) {
        if (!part.thought) out.emit(part.text);
      }
      const reason = candidate?.finishReason;
      if (reason === 'MAX_TOKENS') out.truncated = true;
      else if (reason && reason !== 'STOP') out.stopNote = reason;
      const usage = event.usageMetadata;
      if (usage) out.setUsage(usage.promptTokenCount, (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0));
    }
  },

  claude: {
    tunables: { effort: ['effort', 'output_config'], fallbacks: ['fallback'], max_tokens: ['max_tokens'] },
    request(target, job, skip) {
      const headers = {
        'x-api-key': target.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      };
      const body = {
        model: target.model,
        max_tokens: skip.has('max_tokens') ? 4096 : CLAUDE_MAX_TOKENS,
        stream: true,
        system: job.system,
        messages: [{ role: 'user', content: job.user }]
      };
      // A rewrite is a light task: low effort keeps it fast on models that always think
      if (CLAUDE_EFFORT_MODELS.test(target.model) && !skip.has('effort')) body.output_config = { effort: 'low' };
      // Let Anthropic re-run a request its safety classifiers decline instead of failing it
      if (CLAUDE_FALLBACK_MODELS.test(target.model) && !skip.has('fallbacks')) {
        body.fallbacks = 'default';
        headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      }
      return { url: 'https://api.anthropic.com/v1/messages', headers, body };
    },
    onEvent(event, out) {
      switch (event.type) {
        case 'message_start':
          out.setUsage(event.message?.usage?.input_tokens, event.message?.usage?.output_tokens);
          break;
        case 'content_block_delta':
          if (event.delta?.type === 'text_delta') out.emit(event.delta.text);
          break;
        case 'message_delta':
          out.setUsage(undefined, event.usage?.output_tokens);
          if (event.delta?.stop_reason === 'max_tokens') out.truncated = true;
          if (event.delta?.stop_reason === 'refusal') out.refused = true;
          break;
        case 'error': throw new Error(event.error?.message || 'Claude returned an error.');
      }
    }
  },

  // Any OpenAI-compatible /chat/completions API (Groq, Together, OpenRouter, LM Studio, vLLM, ...)
  custom: {
    tunables: { stream_options: ['stream_options'], temperature: ['temperature'], max_tokens: ['max_tokens'] },
    request(target, job, skip) {
      const body = {
        model: target.model,
        messages: [{ role: 'system', content: job.system }, { role: 'user', content: job.user }],
        stream: true
      };
      if (!skip.has('temperature')) body.temperature = job.temperature;
      if (skip.has('max_tokens')) body.max_completion_tokens = job.maxTokens + REASONING_HEADROOM;
      else body.max_tokens = job.maxTokens;
      if (!skip.has('stream_options')) body.stream_options = { include_usage: true };
      return {
        url: `${target.endpoint}/chat/completions`,
        headers: target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {},
        body
      };
    },
    onEvent(event, out) {
      if (event.error) throw new Error((typeof event.error === 'string' ? event.error : event.error.message) || 'The endpoint returned an error.');
      const choice = event.choices?.[0];
      out.emit(choice?.delta?.content);
      if (choice?.finish_reason === 'length') out.truncated = true;
      if (event.usage) out.setUsage(event.usage.prompt_tokens, event.usage.completion_tokens);
    }
  },

  ollama: {
    format: 'ndjson',
    tunables: { think: ['think'] },
    request(target, job, skip) {
      const body = {
        model: target.model,
        system: job.system,
        prompt: job.user,
        stream: true,
        options: { temperature: job.temperature, num_predict: job.maxTokens }
      };
      if (!skip.has('think')) body.think = false;
      return { url: `${target.endpoint}/api/generate`, headers: {}, body };
    },
    onEvent(event, out) {
      if (event.error) throw new Error(`Ollama: ${event.error}`);
      out.emit(event.response);
      if (event.done) {
        out.setUsage(event.prompt_eval_count, event.eval_count);
        if (event.done_reason === 'length') out.truncated = true;
      }
    }
  },

  // The browser's own on-device model. A fresh session per call keeps rewrites independent.
  builtin: {
    async complete(target, job, watchdog, onDelta) {
      let session = null;
      try {
        watchdog.arm(CONNECT_TIMEOUT_MS.builtin);
        session = await LanguageModel.create({
          ...BUILTIN_SESSION_OPTIONS,
          initialPrompts: [{ role: 'system', content: job.system }],
          signal: watchdog.signal
        });
        let text = '';
        for await (const chunk of session.promptStreaming(job.user, { signal: watchdog.signal })) {
          watchdog.arm(IDLE_TIMEOUT_MS);
          text += chunk;
          onDelta?.(chunk);
        }
        if (!text.trim()) throw new Error('The built-in model returned nothing. Try again.');
        // The API reports no per-call token counts
        return { text, truncated: false, usage: { input: estimateTokens(job.system + job.user), output: estimateTokens(text) } };
      } catch (err) {
        // Its context window is small: a long draft plus conversation context can overflow it
        if (err?.name === 'QuotaExceededError') {
          throw new Error('That is too long for the built-in model. Shorten the prompt, turn off conversation context, or pick another provider in Settings.');
        }
        // Before the model is downloaded, a session can only be created from a click in the panel
        if (err?.name === 'NotAllowedError') throw new Error(BUILTIN_PROBLEMS.downloadable);
        if (err?.name === 'AbortError' || err?.name === 'Error') throw err;
        throw new Error(`The built-in model failed: ${err?.message || err?.name || 'unknown error'}`);
      } finally {
        session?.destroy();
      }
    }
  }
};

// ── Completion Runner ───────────────────────────────────────────────────────

// Params each model has rejected, so later calls skip the failed attempt
const rejectedParams = new Map();

function findRejectedParam(tunables, detail, skip) {
  const text = (detail || '').toLowerCase();
  return Object.keys(tunables).find(name => !skip.has(name) && tunables[name].some(word => text.includes(word)));
}

async function openStream(adapter, target, job, skip, watchdog) {
  let retriedServerError = false;
  for (;;) {
    watchdog.arm(CONNECT_TIMEOUT_MS[target.kind] || CONNECT_TIMEOUT_MS.default);
    const req = adapter.request(target, job, skip);
    const response = await fetch(req.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...req.headers },
      body: JSON.stringify(req.body),
      signal: watchdog.signal
    });
    if (response.ok) return response;

    const detail = await readErrorDetail(response);
    const rejected = response.status === 400 && findRejectedParam(adapter.tunables, detail, skip);
    if (rejected) {
      skip.add(rejected);
      continue;
    }
    if (RETRYABLE_STATUSES.includes(response.status) && !retriedServerError) {
      retriedServerError = true;
      await sleep(1500);
      continue;
    }
    throw new Error(friendlyApiError(target, response.status, detail));
  }
}

function estimateTokens(text) {
  // ~4 chars per token is a reasonable estimate for English text
  return Math.ceil((text || '').length / 4);
}

async function consumeStream(adapter, target, job, response, watchdog, onDelta) {
  let text = '';
  const usage = { input: null, output: null };
  const out = {
    truncated: false,
    refused: false,
    refusal: null,
    stopNote: null,
    emit(chunk) {
      if (!chunk) return;
      text += chunk;
      onDelta?.(chunk);
    },
    setUsage(input, output) {
      if (typeof input === 'number') usage.input = input;
      if (typeof output === 'number') usage.output = output;
    }
  };

  const touch = () => watchdog.arm(IDLE_TIMEOUT_MS);
  touch();
  const payloads = adapter.format === 'ndjson' ? readLines(response.body, touch) : readSSE(response.body, touch);
  for await (const payload of payloads) {
    if (!payload || payload === '[DONE]') continue;
    let event;
    try { event = JSON.parse(payload); } catch { continue; }
    adapter.onEvent(event, out);
  }

  if (out.refused) throw new Error(`${target.label} declined to rewrite this prompt.`);
  if (!text.trim()) {
    if (out.refusal) throw new Error(`${target.label} declined: ${out.refusal.substring(0, 160)}`);
    if (out.truncated) throw new Error(`${target.label} ran out of output tokens before writing anything. Try another model.`);
    throw new Error(`Empty response from ${target.label}${out.stopNote ? ` (${out.stopNote})` : ''}.`);
  }
  return {
    text,
    truncated: out.truncated,
    usage: {
      input: usage.input ?? estimateTokens(job.system + job.user),
      output: usage.output ?? estimateTokens(text)
    }
  };
}

// Streams one completion. job: { system, user, maxTokens, temperature }.
// Calls onDelta(text) as text arrives; resolves { text, truncated, usage }.
async function runCompletion(target, job, { signal, onDelta } = {}) {
  const adapter = PROVIDER_ADAPTERS[target.kind];
  const watchdog = createWatchdog(signal);
  try {
    if (adapter.complete) return await adapter.complete(target, job, watchdog, onDelta);
    const skipKey = `${target.kind}:${target.model}`;
    const skip = rejectedParams.get(skipKey) || new Set();
    const response = await openStream(adapter, target, job, skip, watchdog);
    rejectedParams.set(skipKey, skip);
    return await consumeStream(adapter, target, job, response, watchdog, onDelta);
  } catch (err) {
    if (signal?.aborted) throw new CancelledError();
    if (watchdog.timedOut) {
      throw new Error(target.kind === 'builtin'
        ? 'The built-in model took too long to respond. Try again, or pick another provider in Settings.'
        : `${target.label} took too long to respond. Check your connection and try again.`);
    }
    if (isNetworkError(err)) {
      throw new Error(target.kind === 'ollama'
        ? `Cannot reach Ollama at ${target.endpoint}. Is it running?`
        : `Could not reach ${target.label}. Check your connection${target.kind === API_PROVIDERS.CUSTOM ? ' and endpoint URL' : ''}.`);
    }
    throw err;
  } finally {
    watchdog.stop();
  }
}

// ── Output Cleanup ──────────────────────────────────────────────────────────
// Models sometimes wrap the rewrite in chatter ("Here's your improved prompt:").
// Only a short first line that is unmistakably a lead-in is removed — the
// rewrite itself may legitimately begin with "Below is..." or "I've created...".

const LEAD_IN_LINE = new RegExp(
  "^(?:(?:sure|okay|ok|certainly|absolutely|of course|great)\\b[!,.]?\\s*)?" +
  "(?:here(?:'s| is| are)|below is)\\b[^\\n]{0,40}\\b(?:enhanced|improved|refined|rewritten|optimized|revised|updated|polished)\\b[^\\n]{0,40}:\\s*$" +
  "|^i(?:'ve| have) (?:enhanced|improved|refined|rewritten|optimized|revised) (?:your|the) prompt\\b[^\\n]{0,60}:\\s*$" +
  "|^(?:sure|okay|ok|certainly|absolutely|of course)[!.]?$", 'i');
const LABEL_PREFIX = /^(?:\*\*|#{1,3}\s*)?(?:(?:enhanced|improved|refined|rewritten|optimized|revised) )?prompt(?:\*\*)?\s*:(?:\*\*)?\s*/i;

// First words that chatter or a label can begin with
const LEAD_IN_OPENER = /^(?:sure|okay|ok|certainly|absolutely|of|great|here|here's|below|i|i've|enhanced|improved|refined|rewritten|optimized|revised|prompt)$/i;

function isLeadInLine(line) {
  const trimmed = line.trim();
  return trimmed.length <= 140 && LEAD_IN_LINE.test(trimmed);
}

function stripLeadIn(text) {
  let result = text.trim();
  for (let pass = 0; pass < 2; pass++) {
    const newline = result.indexOf('\n');
    if (newline === -1) break;
    const rest = result.slice(newline + 1).trim();
    if (!rest || !isLeadInLine(result.slice(0, newline))) break;
    result = rest;
  }
  const unlabeled = result.replace(LABEL_PREFIX, '');
  return unlabeled.trim() ? unlabeled : result;
}

function stripThinkBlock(text) {
  return text.replace(/^\s*<think>[\s\S]*?(<\/think>|$)\s*/i, '');
}

function cleanEnhancedText(raw) {
  let text = stripLeadIn(stripThinkBlock(raw || ''));

  // Unwrap a response that is one code fence or one quoted string
  const fence = text.match(/^```[\w-]*\n([\s\S]*?)\n?```$/);
  if (fence && !fence[1].includes('```')) text = fence[1].trim();

  const closer = { '"': '"', '“': '”' }[text[0]];
  if (closer && text.length > 2 && text.endsWith(closer)) {
    const inner = text.slice(1, -1);
    if (!inner.includes(text[0]) && !inner.includes(closer)) text = inner.trim();
  }
  return text;
}

// Hides a leading <think>...</think> block while text is streaming
function createThinkFilter() {
  const OPEN = '<think>';
  const CLOSE = '</think>';
  let state = 'start';
  let held = '';
  return {
    push(chunk) {
      if (state === 'pass') return chunk;
      held += chunk;
      if (state === 'start') {
        const head = held.replace(/^\s+/, '');
        if (head.startsWith(OPEN)) {
          state = 'inside';
          held = head.slice(OPEN.length);
        } else if (OPEN.startsWith(head)) {
          return '';
        } else {
          state = 'pass';
          return held;
        }
      }
      const end = held.indexOf(CLOSE);
      if (end === -1) {
        held = held.slice(-(CLOSE.length - 1));
        return '';
      }
      state = 'pass';
      return held.slice(end + CLOSE.length).replace(/^\s+/, '');
    },
    flush() {
      return state === 'start' ? held : '';
    }
  };
}

// Forwards streamed text to `emit`, holding back the first line until it is
// clear whether it is model chatter
function createStreamCleaner(emit) {
  const DECIDE_AFTER = 100;
  const think = createThinkFilter();
  let head = '';
  let decided = false;
  let dropped = 0;

  function decide(final) {
    head = head.replace(/^\s+/, '');
    const newline = head.indexOf('\n');
    if (newline !== -1 && dropped < 2 && isLeadInLine(head.slice(0, newline))) {
      dropped++;
      head = head.slice(newline + 1);
      return decide(final);
    }
    if (newline === -1 && head.length < DECIDE_AFTER && !final) {
      // Start streaming right away once the first word rules out chatter ("Write a...", "Explain...")
      const firstWord = head.match(/^[A-Za-z']+(?=[^A-Za-z'])/);
      if (!firstWord || LEAD_IN_OPENER.test(firstWord[0])) return;
    }
    decided = true;
    const text = final ? stripLeadIn(head) : head.replace(LABEL_PREFIX, '');
    if (text) emit(text);
  }

  return {
    push(chunk) {
      const text = think.push(chunk);
      if (!text) return;
      if (decided) return emit(text);
      head += text;
      decide(false);
    },
    flush() {
      head += think.flush();
      if (!decided) decide(true);
    }
  };
}

// ── Prompt Assembly ─────────────────────────────────────────────────────────

// Substitutes {{input}} and {{context}} in one pass, so text the user typed
// (or the page contained) is never re-scanned as a placeholder or a "$&" pattern
function fillTemplate(template, input, context) {
  const draft = `<draft_prompt>\n${input}\n</draft_prompt>`;
  let filled = template
    .split(/(\{\{input\}\}|\{\{context\}\})/)
    .map(part => (part === '{{input}}' ? draft : part === '{{context}}' ? context : part))
    .join('');
  if (!template.includes('{{input}}')) filled += `\n\n${draft}`;
  if (!template.includes('{{context}}')) filled = context + filled;
  return filled;
}

function buildContextBlock(context, session) {
  let block = '';

  // Platform-specific optimization hints
  const platform = typeof context?.platform === 'string' ? context.platform : '';
  const hint = own(PLATFORM_HINTS, platform.toLowerCase().replace(/[^a-z]/g, ''));
  if (hint) block += `\n${hint}\nOptimize the enhanced prompt for this specific AI's strengths.\n`;

  // Conversation context from the AI chat page (capped at 6000 chars / ~1500 tokens)
  if (typeof context?.conversation === 'string' && context.conversation) {
    const convo = context.conversation.length > 6000
      ? context.conversation.substring(0, 6000) + '\n[...truncated]'
      : context.conversation;
    block += `\nThe user is mid-conversation on ${platform || 'an AI assistant'} (${Number(context.messageCount) || '?'} recent messages shown):\n` +
      `<conversation_context>\n${convo}\n</conversation_context>\n` +
      'Use this to understand what has already been discussed, and make the enhanced prompt build on it.\n';
  }

  // Previous enhancement in this tab
  if (session) {
    block += `\nPrevious enhancement in this session (${session.modifier} style):\nOriginal: "${session.input}"\nYour enhancement: "${session.output}"\nConsider this trajectory when enhancing the new prompt.\n`;
  }
  return block;
}

// Converts a prompt score into hints the AI can use to gauge how much work is needed
function buildScoreHints(score) {
  if (!score || typeof score.overall !== 'number') return '';

  let effort;
  if (score.overall >= 80) effort = 'minor polish only';
  else if (score.overall >= 60) effort = 'moderate enhancement needed';
  else if (score.overall >= 40) effort = 'significant improvement needed';
  else effort = 'major rewrite needed';

  const parts = [`Prompt Quality Score: ${score.overall}/100 (${effort}).`];

  // Call out the weakest dimensions so the AI focuses there
  const dims = Object.entries(score.breakdown).sort((a, b) => a[1] - b[1]);
  const weak = dims.filter(([, v]) => v < 50);
  const strong = dims.filter(([, v]) => v >= 70);
  if (weak.length > 0) {
    parts.push(`Weakest areas: ${weak.map(([k, v]) => `${k} (${v}/100)`).join(', ')} — focus enhancement here.`);
  }
  if (strong.length > 0) {
    parts.push(`Strong areas: ${strong.map(([k, v]) => `${k} (${v}/100)`).join(', ')} — preserve these qualities.`);
  }
  if (score.suggestions && score.suggestions.length > 0) {
    parts.push('Suggested improvements: ' + score.suggestions.join(' | '));
  }

  return '\n\nPrompt Score Analysis (use to calibrate enhancement depth):\n' + parts.map(p => `• ${p}`).join('\n') + '\n';
}

function buildRefineBlock(refine) {
  const instruction = own(REFINE_INSTRUCTIONS, refine?.kind);
  if (!instruction || typeof refine.previous !== 'string' || !refine.previous.trim()) return '';
  return '\nYou already produced this rewrite of the draft:\n' +
    `<previous_rewrite>\n${refine.previous.substring(0, HISTORY_FIELD_LIMIT)}\n</previous_rewrite>\n` +
    `The user asked for another pass. ${instruction}\n`;
}

// A one-issue fix from the draft review: repair that weakness and leave the rest alone
function buildFocusBlock(focus) {
  const instruction = own(FOCUS_INSTRUCTIONS, focus);
  if (!instruction) return '';
  return `\nThe user asked for one targeted fix, not a full rewrite. ${instruction} Leave everything else as close to the draft as you can.\n`;
}

async function resolveTemplate(modifier) {
  const overrides = await getPresetOverrides();
  const builtIn = own(overrides, modifier) || own(TEMPLATES, modifier);
  if (builtIn) return builtIn;
  const custom = (await getCustomPresets()).find(p => p.id === modifier);
  return custom ? custom.template : TEMPLATES.short;
}

function needsDeepAnalysis(settings, prompt, analysis) {
  // Skip for short/clear prompts to save an API call
  const wordCount = prompt.split(/\s+/).length;
  return !!settings[STORAGE_KEYS.DEEP_ANALYSIS]
    && (wordCount > 30 || analysis.signals.quality.issues.length > 1 || analysis.signals.complexity.level !== 'simple');
}

// Builds the full user message for an enhancement. `usages` collects token
// usage from any extra API calls made along the way.
async function buildEnhanceJob({ prompt, modifier, refine, focus, context, session }, settings, target, signal, usages) {
  const template = await resolveTemplate(modifier);
  const analysis = InputParser.analyze(prompt);
  const preScore = InputParser.scorePrompt(prompt);

  let deepHints = '';
  if (needsDeepAnalysis(settings, prompt, analysis)) {
    deepHints = await InputParser.analyzeDeep(prompt, async (text, systemPrompt) => {
      const result = await runCompletion(target, { system: systemPrompt, user: text, maxTokens: 500, temperature: 0.2 }, { signal });
      usages.push(result.usage);
      return result.text;
    });
  }

  const refineBlock = buildRefineBlock(refine);
  const undoHints = buildUndoHints(await getUndoStats(), modifier);
  const today = `\nToday's date: ${new Date().toISOString().slice(0, 10)}\n`;
  const fullContext = today + buildContextBlock(context, refineBlock ? null : session)
    + analysis.hints + buildScoreHints(preScore) + deepHints + undoHints + refineBlock + buildFocusBlock(focus);

  const config = own(STYLE_CONFIG, modifier) || DEFAULT_STYLE_CONFIG;
  return {
    job: { system: SYSTEM_PROMPT, user: fillTemplate(template, prompt, fullContext), ...config },
    preScore
  };
}

// Runs the model: one streamed pass, or tone → structure → polish with the last pass streamed
async function generateEnhancement(target, settings, job, { signal, onDelta, onStage, usages }) {
  const call = async (user, onChunk) => {
    const result = await runCompletion(target, { ...job, user }, { signal, onDelta: onChunk });
    usages.push(result.usage);
    return result;
  };

  if (!settings[STORAGE_KEYS.MULTI_STEP]) return call(job.user, onDelta);

  const expanded = await call(job.user);
  onStage('structuring');
  const structured = await call(fillTemplate(MULTI_STEP_TEMPLATES.structure, cleanEnhancedText(expanded.text), ''));
  onStage('polishing');
  return call(fillTemplate(MULTI_STEP_TEMPLATES.polish, cleanEnhancedText(structured.text), ''), onDelta);
}

// ── Enhancement Session Memory (per-tab) ────────────────────────────────────
// Tracks the last enhancement per tab so follow-up enhancements have continuity.
// Kept in chrome.storage.session: it survives service worker restarts and is
// cleared when the browser closes.

const SESSION_TTL_MS = 30 * 60 * 1000;
const sessionKey = (tabId) => `enhanceSession:${tabId}`;

async function getTabSession(tabId) {
  if (!tabId) return null;
  const key = sessionKey(tabId);
  const session = (await chrome.storage.session.get(key).catch(() => ({})))[key];
  return session && Date.now() - session.timestamp < SESSION_TTL_MS ? session : null;
}

function setTabSession(tabId, session) {
  if (!tabId) return null;
  return chrome.storage.session.set({ [sessionKey(tabId)]: session }).catch(() => {});
}

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(sessionKey(tabId)).catch(() => {});
});

// ── History ─────────────────────────────────────────────────────────────────

async function addToHistory(entry) {
  const history = await getHistory();
  history.unshift(entry);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: history });
}

function getHistory() {
  return getLocal(STORAGE_KEYS.HISTORY, []);
}

function clearHistory() {
  return chrome.storage.local.remove(STORAGE_KEYS.HISTORY);
}

// ── Custom Presets & Preset Overrides ───────────────────────────────────────

function getCustomPresets() {
  return getLocal(STORAGE_KEYS.CUSTOM_PRESETS, []);
}

function saveCustomPresets(presets) {
  return chrome.storage.local.set({ [STORAGE_KEYS.CUSTOM_PRESETS]: Array.isArray(presets) ? presets : [] });
}

function getPresetOverrides() {
  return getLocal(STORAGE_KEYS.PRESET_OVERRIDES, {});
}

function savePresetOverrides(overrides) {
  return chrome.storage.local.set({ [STORAGE_KEYS.PRESET_OVERRIDES]: overrides || {} });
}

// ── Token/Cost Tracking ─────────────────────────────────────────────────────

function getUsageStats() {
  return getLocal(STORAGE_KEYS.USAGE_STATS, {
    totalEnhancements: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUSD: 0,
    byModel: {},
    since: Date.now()
  });
}

// usages: one { input, output } per API call the enhancement made
async function trackUsage(target, usages) {
  const { model } = target;
  const stats = await getUsageStats();
  const inputTokens = usages.reduce((sum, u) => sum + u.input, 0);
  const outputTokens = usages.reduce((sum, u) => sum + u.output, 0);
  const costs = own(TOKEN_COSTS, model);
  const cost = costs ? (inputTokens / 1000000) * costs.input + (outputTokens / 1000000) * costs.output : 0;

  stats.totalEnhancements++;
  stats.totalInputTokens += inputTokens;
  stats.totalOutputTokens += outputTokens;
  stats.totalCostUSD += cost;

  if (!own(stats.byModel, model)) stats.byModel[model] = { enhancements: 0, inputTokens: 0, outputTokens: 0, costUSD: 0 };
  stats.byModel[model].provider = target.kind;
  stats.byModel[model].enhancements++;
  stats.byModel[model].inputTokens += inputTokens;
  stats.byModel[model].outputTokens += outputTokens;
  stats.byModel[model].costUSD += cost;

  await chrome.storage.local.set({ [STORAGE_KEYS.USAGE_STATS]: stats });
}

// ── Undo Learning ───────────────────────────────────────────────────────────

function getUndoStats() {
  return getLocal(STORAGE_KEYS.UNDO_STATS, { byStyle: {}, byPlatform: {}, total: 0, undone: 0 });
}

async function recordEnhancement(modifier, platform) {
  const stats = await getUndoStats();
  stats.total++;
  if (!own(stats.byStyle, modifier)) stats.byStyle[modifier] = { total: 0, undone: 0 };
  stats.byStyle[modifier].total++;
  if (platform) {
    if (!own(stats.byPlatform, platform)) stats.byPlatform[platform] = { total: 0, undone: 0 };
    stats.byPlatform[platform].total++;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.UNDO_STATS]: stats });
}

async function recordUndo(modifier, platform) {
  const stats = await getUndoStats();
  stats.undone++;
  if (own(stats.byStyle, modifier)) stats.byStyle[modifier].undone++;
  if (own(stats.byPlatform, platform)) stats.byPlatform[platform].undone++;
  await chrome.storage.local.set({ [STORAGE_KEYS.UNDO_STATS]: stats });
}

function buildUndoHints(stats, modifier) {
  if (stats.total < 10) return '';
  const styleStats = own(stats.byStyle, modifier);
  if (!styleStats || styleStats.total < 5) return '';
  const undoRate = styleStats.undone / styleStats.total;
  if (undoRate > 0.4) {
    return `\nNote: The user frequently undoes "${modifier}" style enhancements (${Math.round(undoRate * 100)}% undo rate). Make more conservative, subtle improvements.\n`;
  }
  return '';
}

// ── Enhancement Runner ──────────────────────────────────────────────────────
// Content scripts and the popup open a port named "enhance" and send
// { type: 'start', prompt, modifier, context?, includeContext?, refine? }.
// The worker answers with { type: 'stage' | 'delta' | 'done' | 'error' }.
// Disconnecting the port cancels the request.

function isExtensionPage(sender) {
  return sender?.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(EXTENSION_ORIGIN);
}

async function getConversationFromTab(tabId) {
  try {
    if (!tabId) {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      tabId = tab?.id;
    }
    if (!tabId) return null;
    const resp = await Promise.race([
      chrome.tabs.sendMessage(tabId, { action: 'getConversation' }, { frameId: 0 }).catch(() => null),
      sleep(2000)
    ]);
    return resp?.context || null;
  } catch {
    return null;
  }
}

function validatePrompt(prompt) {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) return 'No text to enhance. Type something first.';
  if (prompt.length > MAX_PROMPT_CHARS) return `Prompt too long (${MAX_PROMPT_CHARS.toLocaleString('en-US')} character limit). Try shortening it.`;
  return null;
}

// Saves the result everywhere it is remembered. Storage trouble must not fail the enhancement.
async function recordResult({ request, tabId, text, preScore, postScore, target, usages }) {
  const { prompt, modifier, context } = request;
  const platform = typeof context?.platform === 'string' ? context.platform : null;
  const tasks = [
    setTabSession(tabId, {
      input: prompt.substring(0, 300),
      output: text.substring(0, 400),
      modifier,
      timestamp: Date.now()
    }),
    addToHistory({
      input: prompt.substring(0, HISTORY_FIELD_LIMIT),
      output: text.substring(0, HISTORY_FIELD_LIMIT),
      modifier,
      timestamp: Date.now(),
      platform,
      preScore,
      postScore,
      model: target.model
    }),
    recordEnhancement(modifier, platform),
    trackUsage(target, usages)
  ];
  await Promise.allSettled(tasks);
}

async function runEnhancement(message, port, signal) {
  const post = (payload) => { try { port.postMessage(payload); } catch {} };
  try {
    const invalid = validatePrompt(message.prompt);
    if (invalid) throw new Error(invalid);

    const settings = await getSettings();
    const target = resolveTarget(settings);
    const problem = await targetProblem(target);
    if (problem) throw new Error(problem);

    // A content script's tab comes from the sender. The side panel isn't in a
    // tab, so it names the tab it is working on.
    const fromPanel = isExtensionPage(port.sender) && Number.isInteger(message.tabId);
    const tabId = port.sender?.tab?.id || (fromPanel ? message.tabId : null);
    // The user can keep the conversation on the page out of rewrites altogether
    const useContext = settings[STORAGE_KEYS.USE_CONTEXT] !== false;
    const request = {
      prompt: message.prompt,
      modifier: typeof message.modifier === 'string' ? message.modifier : settings[STORAGE_KEYS.LAST_MODIFIER],
      refine: message.refine || null,
      focus: message.focus || null,
      context: useContext ? message.context || null : null
    };
    // The side panel can't see the page, so it asks the worker to fetch the conversation
    if (useContext && message.includeContext && !request.context) request.context = await getConversationFromTab(tabId);
    request.session = await getTabSession(tabId);

    const usages = [];
    post({ type: 'stage', stage: 'analyzing' });
    const { job, preScore } = await buildEnhanceJob(request, settings, target, signal, usages);

    post({ type: 'stage', stage: 'generating' });
    const cleaner = createStreamCleaner(text => post({ type: 'delta', text }));
    const result = await generateEnhancement(target, settings, job, {
      signal,
      usages,
      onDelta: chunk => cleaner.push(chunk),
      onStage: stage => post({ type: 'stage', stage })
    });
    cleaner.flush();

    const text = cleanEnhancedText(result.text);
    if (!text) throw new Error(`${target.label} returned an empty rewrite. Try again or pick another model.`);
    const postScore = InputParser.scorePrompt(text);

    await recordResult({ request, tabId, text, preScore, postScore, target, usages });
    post({ type: 'done', text, preScore, postScore, truncated: result.truncated, model: target.model, modifier: request.modifier });
  } catch (err) {
    // A cancelled request has nobody listening
    if (!signal.aborted) post({ type: 'error', error: err?.message || 'Enhancement failed.' });
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'enhance') return;
  const controller = new AbortController();
  let started = false;
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener((message) => {
    if (started || message?.type !== 'start') return;
    started = true;
    runEnhancement(message, port, controller.signal);
  });
});

// ── Model Lists & Connection Testing ────────────────────────────────────────

const NON_CHAT_MODEL = /audio|realtime|tts|transcribe|whisper|image|dall-e|embedding|moderation|live|robotics|computer-use|aqa/i;

async function fetchJson(target, url, headers = {}) {
  const watchdog = createWatchdog(null);
  watchdog.arm(CONNECT_TIMEOUT_MS.default);
  try {
    const response = await fetch(url, { headers, signal: watchdog.signal });
    if (!response.ok) throw new Error(friendlyApiError(target, response.status, await readErrorDetail(response)));
    return await response.json();
  } catch (err) {
    if (watchdog.timedOut) throw new Error(`${target.label} took too long to respond.`);
    if (isNetworkError(err)) throw new Error(`Cannot reach ${target.label}${target.endpoint ? ` at ${target.endpoint}` : ''}.`);
    throw err;
  } finally {
    watchdog.stop();
  }
}

const MODEL_LISTERS = {
  async openai(target) {
    const data = await fetchJson(target, 'https://api.openai.com/v1/models', { Authorization: `Bearer ${target.apiKey}` });
    return (data.data || [])
      .filter(m => /^(gpt-|o\d|chatgpt-)/.test(m.id) && !NON_CHAT_MODEL.test(m.id))
      .sort((a, b) => (b.created || 0) - (a.created || 0))
      .map(m => ({ id: m.id, label: m.id }));
  },
  async gemini(target) {
    const data = await fetchJson(target, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { 'x-goog-api-key': target.apiKey });
    return (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => ({ id: String(m.name || '').replace(/^models\//, ''), label: m.displayName || m.name }))
      .filter(m => m.id.startsWith('gemini') && !NON_CHAT_MODEL.test(m.id));
  },
  async claude(target) {
    const data = await fetchJson(target, 'https://api.anthropic.com/v1/models?limit=100', {
      'x-api-key': target.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    });
    return (data.data || []).map(m => ({ id: m.id, label: m.display_name || m.id }));
  },
  async custom(target) {
    const data = await fetchJson(target, `${target.endpoint}/models`, target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {});
    return (data.data || data.models || []).map(m => ({ id: m.id || m.name, label: m.id || m.name })).filter(m => m.id);
  },
  async ollama(target) {
    const data = await fetchJson(target, `${target.endpoint}/api/tags`);
    return (data.models || []).map(m => ({ id: m.name, label: m.name }));
  }
};

// The provider a settings-page request is about, using the values typed into
// the form (which may not be saved yet)
async function targetFromRequest(message) {
  const settings = await getSettings();
  if (message.provider === PROVIDERS.OLLAMA) {
    return {
      kind: 'ollama',
      label: 'Ollama',
      endpoint: trimSlash(message.settings?.[STORAGE_KEYS.OLLAMA_ENDPOINT]) || resolveTarget({ ...settings, [STORAGE_KEYS.PROVIDER]: PROVIDERS.OLLAMA }).endpoint
    };
  }
  const kind = message.apiProvider;
  if (!own(API_STORAGE_MAP, kind)) throw new Error('Unknown provider.');
  const target = {
    kind,
    label: API_PROVIDER_LABELS[kind],
    apiKey: String(message.apiKey ?? settings[API_STORAGE_MAP[kind].key] ?? '').trim(),
    endpoint: kind === API_PROVIDERS.CUSTOM ? trimSlash(message.endpoint ?? settings[STORAGE_KEYS.CUSTOM_ENDPOINT]) : ''
  };
  if (kind === API_PROVIDERS.CUSTOM) {
    if (!/^https?:\/\/.+/.test(target.endpoint)) throw new Error('Enter the endpoint URL first (it must start with http:// or https://).');
  } else if (!target.apiKey) {
    throw new Error('No API key provided.');
  }
  return target;
}

async function listModels(message) {
  const target = await targetFromRequest(message);
  const models = await MODEL_LISTERS[target.kind](target);
  if (target.kind !== 'ollama' && models.length > 0) {
    const cache = await getLocal(STORAGE_KEYS.MODEL_CACHE, {});
    cache[target.kind] = models;
    await chrome.storage.local.set({ [STORAGE_KEYS.MODEL_CACHE]: cache });
  }
  return { models };
}

// ── Enhance From Anywhere (context menu + keyboard shortcut) ────────────────
// Both grant activeTab, so the content script can be injected on demand into
// pages outside the built-in chat sites.

async function triggerEnhanceInTab(tabId, frameId = 0) {
  const send = () => chrome.tabs.sendMessage(tabId, { action: 'triggerEnhance' }, { frameId }).catch(() => null);
  if ((await send())?.ok) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ['content.js'] });
    await send();
  } catch {
    // Pages Chrome protects (chrome://, the Web Store) can't be scripted
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'rewrite-with-promptcraft',
      title: 'Enhance with PromptCraft',
      contexts: ['editable']
    }, () => void chrome.runtime.lastError);
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'rewrite-with-promptcraft' && tab?.id) {
    triggerEnhanceInTab(tab.id, info.frameId || 0);
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'enhance-prompt' && tab?.id) triggerEnhanceInTab(tab.id);
});

// ── Message Router ──────────────────────────────────────────────────────────
// Content scripts run inside web pages, so they only get the handlers that
// expose nothing sensitive. Everything else is limited to extension pages.

const PUBLIC_HANDLERS = {
  async getPublicSettings() {
    return { settings: await getPublicSettings() };
  },
  // Instant review of a draft as the user types: local heuristics only, no model call
  analyzeDraft(message) {
    const text = typeof message.text === 'string' ? message.text.slice(0, MAX_PROMPT_CHARS) : '';
    if (!text.trim()) return { score: null, issues: [] };
    return { score: InputParser.scorePrompt(text).overall, issues: InputParser.issues(text) };
  },
  // The in-page card's "open PromptCraft" link, e.g. when no provider is set up yet
  async openPanel(message, sender) {
    if (!sender.tab?.id) throw new Error('No tab to open the panel beside.');
    await chrome.sidePanel.open({ tabId: sender.tab.id });
  },
  async setModifier(message) {
    const { styles } = await getPublicSettings();
    if (!styles.some(s => s.id === message.modifier)) throw new Error('Unknown tone.');
    await saveSettings({ [STORAGE_KEYS.LAST_MODIFIER]: message.modifier });
  },
  // The "use this conversation" switch in the badge's card
  async setUseContext(message) {
    if (typeof message.value !== 'boolean') throw new Error('Expected true or false.');
    await saveSettings({ [STORAGE_KEYS.USE_CONTEXT]: message.value });
  },
  async recordUndo(message) {
    await recordUndo(String(message.modifier || 'short'), typeof message.platform === 'string' ? message.platform : null);
  }
};

const PRIVILEGED_HANDLERS = {
  async getSettings() {
    return { settings: await getSettings(), modelCache: await getLocal(STORAGE_KEYS.MODEL_CACHE, {}) };
  },
  async saveSettings(message) {
    await saveSettings(message.settings);
  },
  // Whether the browser's own model can be used, for the panel's setup screens
  async getBuiltInState() {
    return { state: await builtInState() };
  },
  listModels,
  testConnection: listModels,
  async getOllamaModels(message) {
    const { models } = await listModels({ ...message, provider: PROVIDERS.OLLAMA });
    return { models: models.map(m => m.id) };
  },
  async getHistory() {
    return { history: await getHistory() };
  },
  async clearHistory() {
    await clearHistory();
  },
  async getCustomPresets() {
    return { presets: await getCustomPresets() };
  },
  async saveCustomPresets(message) {
    await saveCustomPresets(message.presets);
  },
  async getPresetOverrides() {
    return { overrides: await getPresetOverrides() };
  },
  async savePresetOverrides(message) {
    await savePresetOverrides(message.overrides);
  },
  async getUsageStats() {
    return { stats: await getUsageStats() };
  },
  async resetUsageStats() {
    await chrome.storage.local.remove(STORAGE_KEYS.USAGE_STATS);
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const action = message?.action;
  const privileged = own(PRIVILEGED_HANDLERS, action);
  const handler = own(PUBLIC_HANDLERS, action) || (isExtensionPage(sender) ? privileged : null);
  if (!handler) {
    if (privileged) sendResponse({ success: false, error: 'Not available from this page.' });
    return false;
  }
  Promise.resolve()
    .then(() => handler(message, sender))
    .then(
      (result) => sendResponse({ success: true, ...result }),
      (err) => sendResponse({ success: false, error: err?.message || 'Something went wrong.' })
    );
  return true;
});

// ── Side Panel ──────────────────────────────────────────────────────────────
// The toolbar icon opens popup.html in Chrome's side panel. Nothing is injected
// into the page and no extension page is exposed to websites.

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
