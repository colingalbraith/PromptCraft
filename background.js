// PromptCraft v2.0 — Background Service Worker (Unified API Gateway)
importScripts('constants.js');
importScripts('input-parser.js');

// ── Enhancement Session Memory (per-tab, in-memory) ────────────────────────
// Tracks the last enhancement per tab so follow-up enhancements have continuity
const enhancementSessions = new Map();

// Clean up sessions older than 30 minutes periodically
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [tabId, session] of enhancementSessions) {
    if (session.timestamp < cutoff) enhancementSessions.delete(tabId);
  }
}, 5 * 60 * 1000);

// Clean up session when tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  enhancementSessions.delete(tabId);
});

// ── Settings ────────────────────────────────────────────────────────────────

async function getSettings() {
  const syncKeys = Object.values(STORAGE_KEYS).filter(k => !LOCAL_ONLY_KEYS.includes(k));
  const localKeys = LOCAL_ONLY_KEYS.filter(k =>
    k === STORAGE_KEYS.OPENAI_API_KEY || k === STORAGE_KEYS.GEMINI_API_KEY ||
    k === STORAGE_KEYS.CLAUDE_API_KEY || k === STORAGE_KEYS.CUSTOM_API_KEY ||
    k === STORAGE_KEYS.DEEP_ANALYSIS || k === STORAGE_KEYS.MULTI_STEP
  );

  const [syncResult, localResult] = await Promise.all([
    new Promise(resolve => chrome.storage.sync.get(syncKeys, r => resolve(chrome.runtime.lastError ? {} : r))),
    new Promise(resolve => chrome.storage.local.get(localKeys, r => resolve(chrome.runtime.lastError ? {} : r)))
  ]);

  return { ...DEFAULT_SETTINGS, ...syncResult, ...localResult };
}

async function saveSettings(settings) {
  const syncData = {};
  const localData = {};

  for (const key of Object.values(STORAGE_KEYS)) {
    if (settings[key] === undefined) continue;
    if (LOCAL_ONLY_KEYS.includes(key)) {
      localData[key] = settings[key];
    } else {
      syncData[key] = settings[key];
    }
  }

  await Promise.all([
    Object.keys(syncData).length > 0
      ? new Promise((resolve, reject) => chrome.storage.sync.set(syncData, () => chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve()))
      : Promise.resolve(),
    Object.keys(localData).length > 0
      ? new Promise((resolve, reject) => chrome.storage.local.set(localData, () => chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve()))
      : Promise.resolve()
  ]);
}

// ── Timeout Helper ──────────────────────────────────────────────────────────

const API_TIMEOUT_MS = 15000;
const RETRYABLE_STATUSES = [429, 500, 502, 503];

function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .catch(err => {
      if (err.name === 'AbortError') throw new Error('Request timed out. Check your network connection and try again.');
      throw err;
    })
    .finally(() => clearTimeout(timer));
}

function friendlyApiError(status, detail) {
  switch (status) {
    case 401: return 'Invalid API key. Check your key in Settings.';
    case 403: return 'Access denied. Your API key may lack permissions.';
    case 429: return 'Rate limit hit. Wait a moment and try again.';
    case 500: case 502: case 503:
      return 'The AI service is temporarily down. Try again shortly.';
    case 404: return 'Model not found. Check your model selection in Settings.';
    default: return `API error (${status}): ${(detail || '').substring(0, 150)}`;
  }
}

async function fetchWithRetry(url, options) {
  try {
    const response = await fetchWithTimeout(url, options);
    if (!response.ok && RETRYABLE_STATUSES.includes(response.status)) {
      await new Promise(r => setTimeout(r, 2000));
      return await fetchWithTimeout(url, options);
    }
    return response;
  } catch (err) {
    if (err.message.includes('timed out')) {
      await new Promise(r => setTimeout(r, 2000));
      return await fetchWithTimeout(url, options);
    }
    throw err;
  }
}

// ── Providers ───────────────────────────────────────────────────────────────

async function callGemini(prompt, settings, config) {
  const apiKey = settings[STORAGE_KEYS.GEMINI_API_KEY];
  if (!apiKey) {
    throw new Error('Gemini API key not set. Please configure it in Settings.');
  }

  const model = settings[STORAGE_KEYS.GEMINI_MODEL] || DEFAULT_SETTINGS[STORAGE_KEYS.GEMINI_MODEL];
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetchWithRetry(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: config.temperature,
        topK: 32,
        topP: 1,
        maxOutputTokens: config.maxTokens
      }
    })
  });

  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json())?.error?.message || ''; } catch { detail = await response.text(); }
    throw new Error(friendlyApiError(response.status, detail));
  }

  const data = await response.json();

  if (data.promptFeedback?.blockReason) {
    throw new Error(`Prompt blocked: ${data.promptFeedback.blockReason}. Please revise your prompt.`);
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) {
    throw new Error('Empty response from Gemini API.');
  }
  return text;
}

async function callOpenAI(prompt, settings, config) {
  const apiKey = settings[STORAGE_KEYS.OPENAI_API_KEY];
  if (!apiKey) {
    throw new Error('OpenAI API key not set. Please configure it in Settings.');
  }

  const model = settings[STORAGE_KEYS.OPENAI_MODEL] || DEFAULT_SETTINGS[STORAGE_KEYS.OPENAI_MODEL];

  const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature: config.temperature,
      max_tokens: config.maxTokens
    })
  });

  if (!response.ok) {
    let detail = '';
    try {
      const errJson = await response.json();
      detail = errJson?.error?.message || JSON.stringify(errJson);
    } catch {
      detail = await response.text();
    }
    throw new Error(`OpenAI API error (${response.status}): ${detail.substring(0, 200)}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error('Empty response from OpenAI API.');
  }
  return text;
}

async function callClaude(prompt, settings, config) {
  const apiKey = settings[STORAGE_KEYS.CLAUDE_API_KEY];
  if (!apiKey) {
    throw new Error('Claude API key not set. Please configure it in Settings.');
  }

  const model = settings[STORAGE_KEYS.CLAUDE_MODEL] || DEFAULT_SETTINGS[STORAGE_KEYS.CLAUDE_MODEL];

  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: config.maxTokens,
      temperature: config.temperature
    })
  });

  if (!response.ok) {
    let detail = '';
    try {
      const errJson = await response.json();
      detail = errJson?.error?.message || JSON.stringify(errJson);
    } catch {
      detail = await response.text();
    }
    throw new Error(`Claude API error (${response.status}): ${detail.substring(0, 200)}`);
  }

  const data = await response.json();
  const text = data?.content?.[0]?.text?.trim();
  if (!text) {
    throw new Error('Empty response from Claude API.');
  }
  return text;
}

async function callCustom(prompt, settings, config) {
  const apiKey = settings[STORAGE_KEYS.CUSTOM_API_KEY];
  const endpoint = settings[STORAGE_KEYS.CUSTOM_ENDPOINT];
  const model = settings[STORAGE_KEYS.CUSTOM_MODEL];

  if (!endpoint) {
    throw new Error('Custom endpoint not set. Please configure it in Settings (e.g., https://api.groq.com/openai/v1).');
  }
  if (!/^https?:\/\/.+/.test(endpoint)) {
    throw new Error('Custom endpoint must start with http:// or https://');
  }
  if (!model) {
    throw new Error('Custom model not set. Please enter a model name in Settings.');
  }

  // Uses OpenAI-compatible /chat/completions format (works with Groq, Together, OpenRouter, vLLM, LiteLLM, etc.)
  const url = endpoint.replace(/\/+$/, '') + '/chat/completions';

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature: config.temperature,
      max_tokens: config.maxTokens
    })
  });

  if (!response.ok) {
    let detail = '';
    try {
      const errJson = await response.json();
      detail = errJson?.error?.message || JSON.stringify(errJson);
    } catch {
      detail = await response.text();
    }
    throw new Error(`Custom API error (${response.status}): ${detail.substring(0, 200)}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error('Empty response from custom API endpoint.');
  }
  return text;
}

async function callOllama(prompt, settings, config) {
  const endpoint = settings[STORAGE_KEYS.OLLAMA_ENDPOINT] || DEFAULT_SETTINGS[STORAGE_KEYS.OLLAMA_ENDPOINT];
  const model = settings[STORAGE_KEYS.OLLAMA_MODEL] || DEFAULT_SETTINGS[STORAGE_KEYS.OLLAMA_MODEL];

  let response;
  try {
    response = await fetchWithTimeout(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        system: SYSTEM_PROMPT,
        prompt,
        stream: false,
        options: {
          temperature: config.temperature,
          num_predict: config.maxTokens
        }
      })
    });
  } catch (err) {
    throw new Error(`Cannot connect to Ollama at ${endpoint}. Is it running? (${err.message})`);
  }

  if (!response.ok) {
    let detail = '';
    try { detail = await response.text(); } catch {}
    if (response.status === 404) {
      throw new Error(`Ollama model "${model}" not found. Pull it with: ollama pull ${model}`);
    }
    throw new Error(`Ollama error (${response.status}): ${detail.substring(0, 200)}`);
  }

  const data = await response.json();
  const text = (data.response || '').trim();
  if (!text) {
    throw new Error('Empty response from Ollama.');
  }
  return text;
}

// ── Streaming Provider Calls ────────────────────────────────────────────────
// Stream chunks back to content.js via chrome.tabs.sendMessage

async function streamOpenAI(prompt, settings, config, tabId) {
  const apiKey = settings[STORAGE_KEYS.OPENAI_API_KEY];
  if (!apiKey) throw new Error('OpenAI API key not set.');
  const model = settings[STORAGE_KEYS.OPENAI_MODEL] || DEFAULT_SETTINGS[STORAGE_KEYS.OPENAI_MODEL];

  const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }],
      temperature: config.temperature, max_tokens: config.maxTokens, stream: true
    })
  });
  if (!response.ok) throw new Error(`OpenAI error (${response.status})`);

  return await processSSEStream(response.body, tabId, (chunk) => {
    try {
      const data = JSON.parse(chunk);
      return data.choices?.[0]?.delta?.content || '';
    } catch { return ''; }
  });
}

async function streamGemini(prompt, settings, config, tabId) {
  const apiKey = settings[STORAGE_KEYS.GEMINI_API_KEY];
  if (!apiKey) throw new Error('Gemini API key not set.');
  const model = settings[STORAGE_KEYS.GEMINI_MODEL] || DEFAULT_SETTINGS[STORAGE_KEYS.GEMINI_MODEL];
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: config.temperature, topK: 32, topP: 1, maxOutputTokens: config.maxTokens }
    })
  });
  if (!response.ok) throw new Error(`Gemini error (${response.status})`);

  return await processSSEStream(response.body, tabId, (chunk) => {
    try {
      const data = JSON.parse(chunk);
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch { return ''; }
  });
}

async function streamCustom(prompt, settings, config, tabId) {
  const endpoint = (settings[STORAGE_KEYS.CUSTOM_ENDPOINT] || '').replace(/\/+$/, '') + '/chat/completions';
  const model = settings[STORAGE_KEYS.CUSTOM_MODEL];
  if (!endpoint || !model) throw new Error('Custom endpoint/model not set.');

  const headers = { 'Content-Type': 'application/json' };
  if (settings[STORAGE_KEYS.CUSTOM_API_KEY]) headers['Authorization'] = `Bearer ${settings[STORAGE_KEYS.CUSTOM_API_KEY]}`;

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST', headers,
    body: JSON.stringify({
      model, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }],
      temperature: config.temperature, max_tokens: config.maxTokens, stream: true
    })
  });
  if (!response.ok) throw new Error(`Custom API error (${response.status})`);

  return await processSSEStream(response.body, tabId, (chunk) => {
    try {
      const data = JSON.parse(chunk);
      return data.choices?.[0]?.delta?.content || '';
    } catch { return ''; }
  });
}

// Process Server-Sent Events stream and send chunks to content.js
async function processSSEStream(body, tabId, parseChunk) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        const text = parseChunk(data);
        if (text) {
          fullText += text;
          // Send chunk to content.js for real-time display
          if (tabId) {
            chrome.tabs.sendMessage(tabId, { action: 'streamChunk', text }).catch(() => {});
          }
        }
      }
    }
  }

  // Signal stream complete
  if (tabId) {
    chrome.tabs.sendMessage(tabId, { action: 'streamDone' }).catch(() => {});
  }

  return fullText.trim();
}

// Route to streaming provider
async function callProviderStreaming(prompt, settings, config, tabId) {
  const provider = settings[STORAGE_KEYS.API_PROVIDER] || API_PROVIDERS.GEMINI;
  switch (provider) {
    case API_PROVIDERS.OPENAI: return await streamOpenAI(prompt, settings, config, tabId);
    case API_PROVIDERS.GEMINI: return await streamGemini(prompt, settings, config, tabId);
    case API_PROVIDERS.CUSTOM: return await streamCustom(prompt, settings, config, tabId);
    // Claude and Ollama don't easily support streaming from extension context — fall back to non-streaming
    default: return null;
  }
}

// ── Build Context Block ─────────────────────────────────────────────────────

function buildContextBlock(context, tabId) {
  let block = '';

  // Platform-specific optimization hints
  if (context && context.platform) {
    const platformKey = context.platform.toLowerCase().replace(/[^a-z]/g, '');
    const hint = PLATFORM_HINTS[platformKey];
    if (hint) {
      block += `\n${hint}\nOptimize the enhanced prompt for this specific AI's strengths.\n`;
    }
  }

  // Conversation context from the AI chat page (capped at 6000 chars / ~1500 tokens)
  if (context && context.conversation) {
    const convo = context.conversation.length > 6000 ? context.conversation.substring(0, 6000) + '\n[...truncated]' : context.conversation;
    block += `\nConversation context (the user is chatting on ${context.platform || 'an AI assistant'}, ${context.messageCount || '?'} messages):\n---\n${convo}\n---\nUse this conversation to understand what has already been discussed. Make the enhanced prompt aware of and build on this context.\n`;
  }

  // Previous enhancement session memory
  if (tabId && enhancementSessions.has(tabId)) {
    const session = enhancementSessions.get(tabId);
    if (Date.now() - session.timestamp < 30 * 60 * 1000) {
      block += `\nPrevious enhancement in this session (${session.modifier} style):\nOriginal: "${session.input}"\nYour enhancement: "${session.output}"\nConsider this trajectory when enhancing the new prompt.\n`;
    }
  }

  return block;
}

// ── Score Hints Builder ──────────────────────────────────────────────────────
// Converts a prompt score into hints the AI can use to gauge how much work is needed.

function _buildScoreHints(score) {
  if (!score || typeof score.overall !== 'number') return '';

  const parts = [];
  const b = score.breakdown;

  let effort;
  if (score.overall >= 80) effort = 'minor polish only';
  else if (score.overall >= 60) effort = 'moderate enhancement needed';
  else if (score.overall >= 40) effort = 'significant improvement needed';
  else effort = 'major rewrite needed';

  parts.push(`Prompt Quality Score: ${score.overall}/100 (${effort}).`);

  // Call out the weakest dimensions so the AI focuses there
  const dims = Object.entries(b).sort((a, b) => a[1] - b[1]);
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

// ── Call Provider (unified routing) ─────────────────────────────────────────

async function callProvider(prompt, modifier, settings, context, tabId) {
  // Resolve template: preset overrides > built-in > custom presets > fallback
  const overrides = await getPresetOverrides();
  let template = overrides[modifier] || TEMPLATES[modifier];
  if (!template) {
    const presets = await getCustomPresets();
    const custom = presets.find(p => p.id === modifier);
    template = custom ? custom.template : TEMPLATES.short;
  }

  // Analyze the user's input before enhancement
  const analysis = InputParser.analyze(prompt);

  // Score the prompt before enhancement
  const preScore = InputParser.scorePrompt(prompt);

  // Build score hints for the AI so it knows how much work is needed
  const scoreHints = _buildScoreHints(preScore);

  // Deep analysis (LLM-powered) — skip for short/clear prompts to save API calls
  let deepHints = '';
  const wordCount = prompt.split(/\s+/).length;
  const needsDeepAnalysis = settings[STORAGE_KEYS.DEEP_ANALYSIS]
    && (wordCount > 30 || analysis.signals.quality.issues.length > 1 || analysis.signals.complexity.level !== 'simple');

  if (needsDeepAnalysis) {
    const analysisConfig = { temperature: 0.2, maxTokens: 2000 };
    const callerFn = async (text, systemPrompt) => {
      // Use the same provider but with the analysis system prompt
      if (settings[STORAGE_KEYS.PROVIDER] === PROVIDERS.OLLAMA) {
        const endpoint = settings[STORAGE_KEYS.OLLAMA_ENDPOINT] || DEFAULT_SETTINGS[STORAGE_KEYS.OLLAMA_ENDPOINT];
        const model = settings[STORAGE_KEYS.OLLAMA_MODEL] || DEFAULT_SETTINGS[STORAGE_KEYS.OLLAMA_MODEL];
        const resp = await fetchWithTimeout(`${endpoint}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, system: systemPrompt, prompt: text, stream: false, options: { temperature: 0.2, num_predict: 2000 } })
        });
        const data = await resp.json();
        return data.response || '';
      }
      const apiProvider = settings[STORAGE_KEYS.API_PROVIDER] || API_PROVIDERS.GEMINI;
      switch (apiProvider) {
        case API_PROVIDERS.OPENAI: {
          const resp = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings[STORAGE_KEYS.OPENAI_API_KEY]}` },
            body: JSON.stringify({ model: settings[STORAGE_KEYS.OPENAI_MODEL] || 'gpt-4o-mini', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }], temperature: 0.2, max_tokens: 2000 })
          });
          const data = await resp.json();
          return data.choices?.[0]?.message?.content || '';
        }
        case API_PROVIDERS.CLAUDE: {
          const resp = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': settings[STORAGE_KEYS.CLAUDE_API_KEY], 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
            body: JSON.stringify({ model: settings[STORAGE_KEYS.CLAUDE_MODEL] || 'claude-haiku-4-5-20251001', system: systemPrompt, messages: [{ role: 'user', content: text }], max_tokens: 2000, temperature: 0.2 })
          });
          const data = await resp.json();
          return data.content?.[0]?.text || '';
        }
        case API_PROVIDERS.CUSTOM: {
          const endpoint = (settings[STORAGE_KEYS.CUSTOM_ENDPOINT] || '').replace(/\/+$/, '') + '/chat/completions';
          const headers = { 'Content-Type': 'application/json' };
          if (settings[STORAGE_KEYS.CUSTOM_API_KEY]) headers['Authorization'] = `Bearer ${settings[STORAGE_KEYS.CUSTOM_API_KEY]}`;
          const resp = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({ model: settings[STORAGE_KEYS.CUSTOM_MODEL] || 'default', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }], temperature: 0.2, max_tokens: 2000 })
          });
          const data = await resp.json();
          return data.choices?.[0]?.message?.content || '';
        }
        default: {
          const model = settings[STORAGE_KEYS.GEMINI_MODEL] || 'gemini-2.0-flash';
          const resp = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings[STORAGE_KEYS.GEMINI_API_KEY]}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents: [{ parts: [{ text }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 2000 } })
          });
          const data = await resp.json();
          return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        }
      }
    };
    deepHints = await InputParser.analyzeDeep(prompt, callerFn);
  }

  // Build context block from conversation + session memory
  const contextBlock = buildContextBlock(context, tabId);

  // Combine context block with input analysis hints and prompt score
  // Undo learning hints
  const undoStats = await getUndoStats();
  const undoHints = buildUndoHints(undoStats, modifier);

  const fullContext = contextBlock + analysis.hints + scoreHints + deepHints + undoHints;

  // Build full prompt from template
  let fullPrompt;
  if (template.includes('{{context}}')) {
    fullPrompt = template.replace('{{context}}', fullContext).replace('{{input}}', prompt);
  } else {
    // Custom/old templates without {{context}} — prepend context if available
    fullPrompt = fullContext + template.replace('{{input}}', prompt);
  }

  // Get per-style configuration (temperature + maxTokens)
  const config = STYLE_CONFIG[modifier] || STYLE_CONFIG.short;

  // Route to provider
  let enhancedText;
  if (settings[STORAGE_KEYS.PROVIDER] === PROVIDERS.OLLAMA) {
    enhancedText = await callOllama(fullPrompt, settings, config);
  } else {
    const apiProvider = settings[STORAGE_KEYS.API_PROVIDER] || API_PROVIDERS.GEMINI;
    switch (apiProvider) {
      case API_PROVIDERS.OPENAI:
        enhancedText = await callOpenAI(fullPrompt, settings, config);
        break;
      case API_PROVIDERS.CLAUDE:
        enhancedText = await callClaude(fullPrompt, settings, config);
        break;
      case API_PROVIDERS.CUSTOM:
        enhancedText = await callCustom(fullPrompt, settings, config);
        break;
      default:
        enhancedText = await callGemini(fullPrompt, settings, config);
        break;
    }
  }

  return { text: enhancedText, preScore };
}

// ── Multi-Step Enhancement Pipeline ──────────────────────────────────────────

async function callProviderMultiStep(prompt, modifier, settings, context, tabId) {
  const config = STYLE_CONFIG[modifier] || STYLE_CONFIG.short;
  const steps = ['expand', 'structure', 'polish'];
  let currentPrompt = prompt;

  for (const step of steps) {
    const template = MULTI_STEP_TEMPLATES[step];
    const fullPrompt = template.replace('{{input}}', currentPrompt);

    if (settings[STORAGE_KEYS.PROVIDER] === PROVIDERS.OLLAMA) {
      currentPrompt = await callOllama(fullPrompt, settings, config);
    } else {
      const apiProvider = settings[STORAGE_KEYS.API_PROVIDER] || API_PROVIDERS.GEMINI;
      switch (apiProvider) {
        case API_PROVIDERS.OPENAI:
          currentPrompt = await callOpenAI(fullPrompt, settings, config);
          break;
        case API_PROVIDERS.CLAUDE:
          currentPrompt = await callClaude(fullPrompt, settings, config);
          break;
        case API_PROVIDERS.CUSTOM:
          currentPrompt = await callCustom(fullPrompt, settings, config);
          break;
        default:
          currentPrompt = await callGemini(fullPrompt, settings, config);
      }
    }
  }

  return currentPrompt;
}

// ── Connection Testing ──────────────────────────────────────────────────────

async function testOllamaConnection(settings) {
  const endpoint = settings[STORAGE_KEYS.OLLAMA_ENDPOINT] || DEFAULT_SETTINGS[STORAGE_KEYS.OLLAMA_ENDPOINT];
  try {
    const response = await fetch(`${endpoint}/api/tags`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const models = (data.models || []).map(m => m.name);
    return { success: true, models };
  } catch (err) {
    return { success: false, error: `Cannot connect to Ollama at ${endpoint}: ${err.message}` };
  }
}

async function testApiKeyConnection(provider, apiKey) {
  if (!apiKey || !apiKey.trim()) {
    return { success: false, error: 'No API key provided.' };
  }
  try {
    if (provider === API_PROVIDERS.OPENAI) {
      const resp = await fetchWithTimeout('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (!resp.ok) {
        const detail = await resp.text().catch(() => '');
        return { success: false, error: `Invalid key (${resp.status}): ${detail.substring(0, 120)}` };
      }
      return { success: true };
    }
    if (provider === API_PROVIDERS.GEMINI) {
      const resp = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
        method: 'GET'
      });
      if (!resp.ok) {
        const detail = await resp.text().catch(() => '');
        return { success: false, error: `Invalid key (${resp.status}): ${detail.substring(0, 120)}` };
      }
      return { success: true };
    }
    if (provider === API_PROVIDERS.CLAUDE) {
      const resp = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1
        })
      });
      if (!resp.ok) {
        if (resp.status === 401) return { success: false, error: 'Invalid API key.' };
        const detail = await resp.text().catch(() => '');
        return { success: false, error: `API error (${resp.status}): ${detail.substring(0, 120)}` };
      }
      return { success: true };
    }
    return { success: false, error: 'Unknown provider.' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── History ─────────────────────────────────────────────────────────────────

async function addToHistory(entry) {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.HISTORY], (result) => {
      const history = result[STORAGE_KEYS.HISTORY] || [];
      history.unshift(entry);
      if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
      chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: history }, resolve);
    });
  });
}

async function getHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.HISTORY], (result) => {
      resolve(result[STORAGE_KEYS.HISTORY] || []);
    });
  });
}

async function clearHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(STORAGE_KEYS.HISTORY, resolve);
  });
}

// ── Custom Presets ─────────────────────────────────────────────────────────

async function getCustomPresets() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.CUSTOM_PRESETS], (result) => {
      resolve(result[STORAGE_KEYS.CUSTOM_PRESETS] || []);
    });
  });
}

async function saveCustomPresets(presets) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEYS.CUSTOM_PRESETS]: presets }, resolve);
  });
}

// ── Preset Overrides ─────────────────────────────────────────────────────

async function getPresetOverrides() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.PRESET_OVERRIDES], (result) => {
      resolve(result[STORAGE_KEYS.PRESET_OVERRIDES] || {});
    });
  });
}

async function savePresetOverrides(overrides) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEYS.PRESET_OVERRIDES]: overrides }, resolve);
  });
}

// ── Fetch Conversation from Active Tab ──────────────────────────────────────

async function getConversationFromTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) return null;

    return await Promise.race([
      new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { action: 'getConversation' }, (resp) => {
          if (chrome.runtime.lastError || !resp?.context) {
            resolve(null);
          } else {
            resolve(resp.context);
          }
        });
      }),
      new Promise((resolve) => setTimeout(() => resolve(null), 2000))
    ]);
  } catch {
    return null;
  }
}

// ── Token/Cost Tracking ─────────────────────────────────────────────────────

async function getUsageStats() {
  return new Promise(resolve => {
    chrome.storage.local.get([STORAGE_KEYS.USAGE_STATS], result => {
      resolve(result[STORAGE_KEYS.USAGE_STATS] || {
        totalEnhancements: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUSD: 0,
        byModel: {},
        since: Date.now()
      });
    });
  });
}

function estimateTokens(text) {
  // ~4 chars per token is a reasonable estimate for English text
  return Math.ceil((text || '').length / 4);
}

async function trackUsage(model, inputText, outputText, deepAnalysisUsed) {
  const stats = await getUsageStats();
  const inputTokens = estimateTokens(inputText);
  const outputTokens = estimateTokens(outputText);

  // If deep analysis was used, roughly double the input tokens (two API calls)
  const adjustedInput = deepAnalysisUsed ? inputTokens * 2 : inputTokens;

  stats.totalEnhancements++;
  stats.totalInputTokens += adjustedInput;
  stats.totalOutputTokens += outputTokens;

  // Calculate cost
  const costs = TOKEN_COSTS[model];
  if (costs) {
    const cost = (adjustedInput / 1000000) * costs.input + (outputTokens / 1000000) * costs.output;
    stats.totalCostUSD += cost;

    if (!stats.byModel[model]) stats.byModel[model] = { enhancements: 0, inputTokens: 0, outputTokens: 0, costUSD: 0 };
    stats.byModel[model].enhancements++;
    stats.byModel[model].inputTokens += adjustedInput;
    stats.byModel[model].outputTokens += outputTokens;
    stats.byModel[model].costUSD += cost;
  }

  chrome.storage.local.set({ [STORAGE_KEYS.USAGE_STATS]: stats });
}

// ── Tier System ─────────────────────────────────────────────────────────────

async function getUserTier() {
  return new Promise(resolve => {
    chrome.storage.local.get([STORAGE_KEYS.TIER, STORAGE_KEYS.LICENSE_KEY], result => {
      resolve(result[STORAGE_KEYS.TIER] || TIERS.FREE);
    });
  });
}

async function getDailyCount() {
  return new Promise(resolve => {
    chrome.storage.local.get([STORAGE_KEYS.DAILY_COUNT, STORAGE_KEYS.DAILY_RESET], result => {
      const today = new Date().toDateString();
      const resetDate = result[STORAGE_KEYS.DAILY_RESET];

      // Reset count if it's a new day
      if (resetDate !== today) {
        chrome.storage.local.set({
          [STORAGE_KEYS.DAILY_COUNT]: 0,
          [STORAGE_KEYS.DAILY_RESET]: today
        });
        resolve(0);
      } else {
        resolve(result[STORAGE_KEYS.DAILY_COUNT] || 0);
      }
    });
  });
}

async function incrementDailyCount() {
  const count = await getDailyCount();
  chrome.storage.local.set({ [STORAGE_KEYS.DAILY_COUNT]: count + 1 });
  return count + 1;
}

async function checkTierLimit(settings) {
  const tier = await getUserTier();
  const limits = TIER_LIMITS[tier];

  if (limits.dailyEnhancements === Infinity) {
    return { allowed: true };
  }

  const count = await getDailyCount();
  if (count >= limits.dailyEnhancements) {
    return {
      allowed: false,
      message: `Daily limit reached (${limits.dailyEnhancements} enhancements/day on Free tier). Upgrade to Pro for unlimited enhancements.`,
      remaining: 0
    };
  }

  return { allowed: true, remaining: limits.dailyEnhancements - count };
}

// ── Undo Learning ───────────────────────────────────────────────────────────

async function getUndoStats() {
  return new Promise(resolve => {
    chrome.storage.local.get([STORAGE_KEYS.UNDO_STATS], result => {
      resolve(result[STORAGE_KEYS.UNDO_STATS] || { byStyle: {}, byPlatform: {}, total: 0, undone: 0 });
    });
  });
}

async function recordEnhancement(modifier, platform) {
  const stats = await getUndoStats();
  stats.total++;
  if (!stats.byStyle[modifier]) stats.byStyle[modifier] = { total: 0, undone: 0 };
  stats.byStyle[modifier].total++;
  if (platform) {
    if (!stats.byPlatform[platform]) stats.byPlatform[platform] = { total: 0, undone: 0 };
    stats.byPlatform[platform].total++;
  }
  chrome.storage.local.set({ [STORAGE_KEYS.UNDO_STATS]: stats });
}

async function recordUndo(modifier, platform) {
  const stats = await getUndoStats();
  stats.undone++;
  if (stats.byStyle[modifier]) stats.byStyle[modifier].undone++;
  if (platform && stats.byPlatform[platform]) stats.byPlatform[platform].undone++;
  chrome.storage.local.set({ [STORAGE_KEYS.UNDO_STATS]: stats });
}

function buildUndoHints(stats, modifier) {
  if (stats.total < 10) return '';
  const styleStats = stats.byStyle[modifier];
  if (!styleStats || styleStats.total < 5) return '';
  const undoRate = styleStats.undone / styleStats.total;
  if (undoRate > 0.4) {
    return `\nNote: The user frequently undoes "${modifier}" style enhancements (${Math.round(undoRate * 100)}% undo rate). Make more conservative, subtle improvements.\n`;
  }
  return '';
}

// ── Preamble Stripping ──────────────────────────────────────────────────────
// Models sometimes add commentary before the actual enhanced prompt.
// This strips common preamble patterns.

function stripPreamble(text) {
  if (!text) return text;

  // Patterns that indicate preamble before the real prompt
  const preamblePatterns = [
    /^(?:Here(?:'s| is) (?:your |the |an? )?(?:improved|enhanced|refined|rewritten|updated|optimized) (?:prompt|version)[:\s]*\n*)/i,
    /^(?:Sure[!,.]?\s*(?:Here(?:'s| is)[^:\n]*[:\s]*\n*)?)/i,
    /^(?:Okay[!,.]?\s*(?:Let'?s[^.\n]*[.\s]*\n*)?)/i,
    /^(?:Absolutely[!,.]?\s*(?:Here[^:\n]*[:\s]*\n*)?)/i,
    /^(?:Of course[!,.]?\s*(?:Here[^:\n]*[:\s]*\n*)?)/i,
    /^(?:I'?(?:ve|ll) (?:enhanced|improved|refined|rewritten|crafted|created)[^:\n]*[:\s]*\n*)/i,
    /^(?:(?:Enhanced|Improved|Refined|Rewritten|Updated|Optimized) (?:prompt|version)[:\s]*\n*)/i,
    /^(?:Below is[^:\n]*[:\s]*\n*)/i,
    /^(?:The enhanced prompt[:\s]*\n*)/i,
  ];

  let cleaned = text.trim();
  for (const pattern of preamblePatterns) {
    cleaned = cleaned.replace(pattern, '').trim();
  }

  // Strip wrapping quotes if the entire response is quoted
  if (/^[""][\s\S]+[""]$/.test(cleaned)) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Strip wrapping markdown code block
  if (/^```[\s\S]*```$/s.test(cleaned)) {
    cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim();
  }

  return cleaned;
}

// ── Context Menu ────────────────────────────────────────────────────────────

const AI_SITES = [
  '*://*.chatgpt.com/*',
  '*://*.grok.com/*',
  '*://*.gemini.google.com/*',
  '*://*.deepseek.com/*',
  '*://*.claude.ai/*',
  '*://*.huggingface.co/*',
  '*://*.openrouter.ai/*',
  '*://*.perplexity.ai/*'
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'rewrite-with-promptcraft',
    title: 'Rewrite with PromptCraft',
    contexts: ['editable'],
    documentUrlPatterns: AI_SITES
  }, () => {
    if (chrome.runtime.lastError) {
      void chrome.runtime.lastError;
    }
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'rewrite-with-promptcraft' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'triggerEnhance' }, () => {
      if (chrome.runtime.lastError) {
        void chrome.runtime.lastError;
      }
    });
  }
});

// ── Message Router ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;

  if (action === 'enhance') {
    (async () => {
      try {
        // Input validation
        if (!message.prompt || message.prompt.trim().length === 0) {
          sendResponse({ success: false, error: 'No text to enhance. Type something first.' });
          return;
        }
        if (message.prompt.length > 10000) {
          sendResponse({ success: false, error: 'Prompt too long (10,000 char limit). Try shortening it.' });
          return;
        }

        const settings = await getSettings();

        // Tier enforcement
        const tierCheck = await checkTierLimit(settings);
        if (!tierCheck.allowed) {
          sendResponse({ success: false, error: tierCheck.message, tierLimited: true });
          return;
        }

        let context = message.context || null;
        let tabId = sender?.tab?.id || null;

        // If includeContext requested and no direct context provided, fetch from active tab
        if (message.includeContext && !context) {
          context = await getConversationFromTab();
          if (!tabId) {
            try {
              const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
              if (tab?.id) tabId = tab.id;
            } catch {}
          }
        }

        // Enforce tier limits on premium features
        const currentTier = await getUserTier();
        const tierLimits = TIER_LIMITS[currentTier];
        if (!tierLimits.multiStep) settings[STORAGE_KEYS.MULTI_STEP] = false;
        if (!tierLimits.deepAnalysis) settings[STORAGE_KEYS.DEEP_ANALYSIS] = false;
        if (!tierLimits.customEndpoints && settings[STORAGE_KEYS.API_PROVIDER] === API_PROVIDERS.CUSTOM) {
          sendResponse({ success: false, error: 'Custom endpoints are a Pro feature. Upgrade to use custom API providers.', tierLimited: true });
          return;
        }

        // Try streaming for supported providers (non-multi-step, non-Ollama, non-Claude)
        let result;
        const canStream = !settings[STORAGE_KEYS.MULTI_STEP]
          && settings[STORAGE_KEYS.PROVIDER] !== PROVIDERS.OLLAMA
          && settings[STORAGE_KEYS.API_PROVIDER] !== API_PROVIDERS.CLAUDE;

        if (canStream && tabId) {
          // Build full prompt same as callProvider would
          const overrides = await getPresetOverrides();
          let tmpl = overrides[message.modifier || 'short'] || TEMPLATES[message.modifier || 'short'] || TEMPLATES.short;
          const analysis = InputParser.analyze(message.prompt);
          const preScore = InputParser.scorePrompt(message.prompt);
          const ctxBlock = buildContextBlock(context, tabId);
          const fullCtx = ctxBlock + analysis.hints;
          let streamPrompt = tmpl.includes('{{context}}')
            ? tmpl.replace('{{context}}', fullCtx).replace('{{input}}', message.prompt)
            : fullCtx + tmpl.replace('{{input}}', message.prompt);
          const cfg = STYLE_CONFIG[message.modifier || 'short'] || STYLE_CONFIG.short;

          // Notify content.js that streaming is starting
          chrome.tabs.sendMessage(tabId, { action: 'streamStart' }).catch(() => {});

          const streamedText = await callProviderStreaming(streamPrompt, settings, cfg, tabId);
          if (streamedText) {
            result = { text: stripPreamble(streamedText), preScore };
          }
        }

        if (!result && settings[STORAGE_KEYS.MULTI_STEP]) {
          // Multi-step pipeline: expand → structure → polish
          const multiText = await callProviderMultiStep(
            message.prompt, message.modifier || 'short', settings, context, tabId
          );
          const preScore = InputParser.scorePrompt(message.prompt);
          result = { text: multiText, preScore };
        } else {
          result = await callProvider(
            message.prompt,
            message.modifier || 'short',
            settings,
            context,
            tabId
          );
        }

        let text = result.text;
        const preScore = result.preScore;

        // Strip any preamble the model leaked (e.g., "Here's your improved prompt:", "Sure!", "Okay, let's...")
        text = stripPreamble(text);

        // Score the enhanced prompt (post-enhancement)
        const postScore = InputParser.scorePrompt(text);

        // Update session memory for this tab
        if (tabId) {
          enhancementSessions.set(tabId, {
            input: message.prompt.substring(0, 300),
            output: text.substring(0, 400),
            modifier: message.modifier || 'short',
            timestamp: Date.now()
          });
        }

        await addToHistory({
          input: message.prompt.substring(0, 500),
          output: text.substring(0, 800),
          modifier: message.modifier || 'short',
          timestamp: Date.now(),
          platform: context?.platform || null,
          preScore: preScore,
          postScore: postScore
        });

        // Record enhancement for undo learning
        await recordEnhancement(message.modifier || 'short', context?.platform || null);

        // Increment daily count for tier tracking
        const newCount = await incrementDailyCount();
        const tier = await getUserTier();
        const remaining = TIER_LIMITS[tier].dailyEnhancements === Infinity ? null : TIER_LIMITS[tier].dailyEnhancements - newCount;

        // Track token usage and cost
        const activeModel = settings[STORAGE_KEYS.PROVIDER] === PROVIDERS.OLLAMA
          ? settings[STORAGE_KEYS.OLLAMA_MODEL]
          : settings[`${settings[STORAGE_KEYS.API_PROVIDER]}Model`] || '';
        await trackUsage(activeModel, message.prompt, text, !!settings[STORAGE_KEYS.DEEP_ANALYSIS]);

        sendResponse({ success: true, text, preScore, postScore });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // Tier info
  if (action === 'getTierInfo') {
    (async () => {
      const tier = await getUserTier();
      const count = await getDailyCount();
      const limits = TIER_LIMITS[tier];
      sendResponse({
        success: true,
        tier,
        dailyCount: count,
        dailyLimit: limits.dailyEnhancements,
        remaining: limits.dailyEnhancements === Infinity ? null : limits.dailyEnhancements - count,
        features: limits
      });
    })();
    return true;
  }

  if (action === 'activatePro') {
    (async () => {
      // For now, validate license key format (will connect to backend later)
      const key = message.licenseKey;
      if (!key || key.trim().length < 8) {
        sendResponse({ success: false, error: 'Invalid license key.' });
        return;
      }
      chrome.storage.local.set({
        [STORAGE_KEYS.LICENSE_KEY]: key.trim(),
        [STORAGE_KEYS.TIER]: TIERS.PRO
      }, () => {
        sendResponse({ success: true, tier: TIERS.PRO });
      });
    })();
    return true;
  }

  // Usage stats
  if (action === 'getUsageStats') {
    (async () => {
      const stats = await getUsageStats();
      sendResponse({ success: true, stats });
    })();
    return true;
  }

  if (action === 'resetUsageStats') {
    chrome.storage.local.remove([STORAGE_KEYS.USAGE_STATS], () => {
      sendResponse({ success: true });
    });
    return true;
  }

  // Undo tracking
  if (action === 'recordUndo') {
    (async () => {
      await recordUndo(message.modifier || 'short', message.platform || null);
      sendResponse({ success: true });
    })();
    return true;
  }

  if (action === 'testConnection') {
    (async () => {
      try {
        const settings = await getSettings();
        const merged = { ...settings, ...(message.settings || {}) };
        if (message.provider === PROVIDERS.OLLAMA) {
          sendResponse(await testOllamaConnection(merged));
        } else if (message.provider === PROVIDERS.API && message.apiProvider && message.apiKey) {
          sendResponse(await testApiKeyConnection(message.apiProvider, message.apiKey));
        } else {
          sendResponse({ success: false, error: 'Missing provider or API key.' });
        }
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (action === 'getOllamaModels') {
    (async () => {
      try {
        const settings = await getSettings();
        const merged = { ...settings, ...(message.settings || {}) };
        const result = await testOllamaConnection(merged);
        sendResponse(result);
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (action === 'getSettings') {
    (async () => {
      try {
        const settings = await getSettings();
        sendResponse({ success: true, settings });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (action === 'saveSettings') {
    (async () => {
      try {
        await saveSettings(message.settings);
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (action === 'getHistory') {
    (async () => {
      const history = await getHistory();
      sendResponse({ success: true, history });
    })();
    return true;
  }

  if (action === 'clearHistory') {
    (async () => {
      await clearHistory();
      sendResponse({ success: true });
    })();
    return true;
  }

  if (action === 'getCustomPresets') {
    (async () => {
      const presets = await getCustomPresets();
      sendResponse({ success: true, presets });
    })();
    return true;
  }

  if (action === 'saveCustomPresets') {
    (async () => {
      await saveCustomPresets(message.presets);
      sendResponse({ success: true });
    })();
    return true;
  }

  if (action === 'getPresetOverrides') {
    (async () => {
      const overrides = await getPresetOverrides();
      sendResponse({ success: true, overrides });
    })();
    return true;
  }

  if (action === 'savePresetOverrides') {
    (async () => {
      await savePresetOverrides(message.overrides);
      sendResponse({ success: true });
    })();
    return true;
  }
});

// ── Action Click (send toggle message to content script) ─────────────────────

let popupWindowId = null;

function closePopupWindow() {
  if (popupWindowId) {
    chrome.windows.remove(popupWindowId, () => {
      if (chrome.runtime.lastError) { /* already closed */ }
    });
    popupWindowId = null;
  }
}

// Clean up tracked ID when popup window is closed manually
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === popupWindowId) popupWindowId = null;
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;

  const popupURL = chrome.runtime.getURL('popup.html');

  // Try sending message to existing content script first
  chrome.tabs.sendMessage(tab.id, { action: 'togglePanel', popupURL }, async (response) => {
    if (response?.ok) {
      closePopupWindow();
      return;
    }
    // Content script not loaded — try injecting it on-the-fly
    if (chrome.runtime.lastError) { /* consume error */ }
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['panel.js']
      });
      // Now send the message again
      chrome.tabs.sendMessage(tab.id, { action: 'togglePanel', popupURL }, (resp) => {
        if (resp?.ok) {
          closePopupWindow();
        } else {
          if (chrome.runtime.lastError) { /* consume */ }
          openPopupWindow(popupURL);
        }
      });
    } catch {
      // Can't inject (chrome:// pages, etc.) — fallback popup
      openPopupWindow(popupURL);
    }
  });
});

function openPopupWindow(url) {
  closePopupWindow();
  chrome.windows.create({
    url,
    type: 'popup',
    width: 452,
    height: 510
  }, (win) => {
    popupWindowId = win?.id || null;
  });
}
