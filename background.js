// PromptCraft v2.0 — Background Service Worker (Unified API Gateway)
importScripts('constants.js');

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

// ── Settings ────────────────────────────────────────────────────────────────

async function getSettings() {
  return new Promise((resolve) => {
    const keys = Object.values(STORAGE_KEYS).filter(k => !LOCAL_ONLY_KEYS.includes(k));
    chrome.storage.sync.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        console.error('Error loading settings:', chrome.runtime.lastError);
        resolve({ ...DEFAULT_SETTINGS });
        return;
      }
      resolve({ ...DEFAULT_SETTINGS, ...result });
    });
  });
}

async function saveSettings(settings) {
  return new Promise((resolve, reject) => {
    const toSave = {};
    for (const key of Object.values(STORAGE_KEYS)) {
      if (LOCAL_ONLY_KEYS.includes(key)) continue;
      if (settings[key] !== undefined) {
        toSave[key] = settings[key];
      }
    }
    chrome.storage.sync.set(toSave, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

// ── Timeout Helper ──────────────────────────────────────────────────────────

const API_TIMEOUT_MS = 15000;

function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .catch(err => {
      if (err.name === 'AbortError') throw new Error('Request timed out (15s). Check your API key and network.');
      throw err;
    })
    .finally(() => clearTimeout(timer));
}

// ── Providers ───────────────────────────────────────────────────────────────

async function callGemini(prompt, settings, config) {
  const apiKey = settings[STORAGE_KEYS.GEMINI_API_KEY];
  if (!apiKey) {
    throw new Error('Gemini API key not set. Please configure it in Settings.');
  }

  const model = settings[STORAGE_KEYS.GEMINI_MODEL] || DEFAULT_SETTINGS[STORAGE_KEYS.GEMINI_MODEL];
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetchWithTimeout(endpoint, {
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
    try {
      const errJson = await response.json();
      detail = errJson?.error?.message || JSON.stringify(errJson);
    } catch {
      detail = await response.text();
    }
    throw new Error(`Gemini API error (${response.status}): ${detail.substring(0, 200)}`);
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

// ── Build Context Block ─────────────────────────────────────────────────────

function buildContextBlock(context, tabId) {
  let block = '';

  // Conversation context from the AI chat page
  if (context && context.conversation) {
    block += `\nConversation context (the user is chatting on ${context.platform || 'an AI assistant'}, ${context.messageCount || '?'} messages):\n---\n${context.conversation}\n---\nUse this conversation to understand what has already been discussed. Make the enhanced prompt aware of and build on this context.\n`;
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

  // Build context block from conversation + session memory
  const contextBlock = buildContextBlock(context, tabId);

  // Build full prompt from template
  let fullPrompt;
  if (template.includes('{{context}}')) {
    fullPrompt = template.replace('{{context}}', contextBlock).replace('{{input}}', prompt);
  } else {
    // Custom/old templates without {{context}} — prepend context if available
    fullPrompt = contextBlock + template.replace('{{input}}', prompt);
  }

  // Get per-style configuration (temperature + maxTokens)
  const config = STYLE_CONFIG[modifier] || STYLE_CONFIG.short;

  // Route to provider
  if (settings[STORAGE_KEYS.PROVIDER] === PROVIDERS.OLLAMA) {
    return await callOllama(fullPrompt, settings, config);
  }

  const apiProvider = settings[STORAGE_KEYS.API_PROVIDER] || API_PROVIDERS.GEMINI;
  switch (apiProvider) {
    case API_PROVIDERS.OPENAI:
      return await callOpenAI(fullPrompt, settings, config);
    case API_PROVIDERS.CLAUDE:
      return await callClaude(fullPrompt, settings, config);
    default:
      return await callGemini(fullPrompt, settings, config);
  }
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
      console.error('Context menu error:', chrome.runtime.lastError);
    }
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'rewrite-with-promptcraft' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'triggerEnhance' }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error sending triggerEnhance:', chrome.runtime.lastError);
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
        const settings = await getSettings();

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

        const text = await callProvider(
          message.prompt,
          message.modifier || 'short',
          settings,
          context,
          tabId
        );

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
          platform: context?.platform || null
        });

        sendResponse({ success: true, text });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
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
