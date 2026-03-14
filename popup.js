// PromptCraft v2.0 — Popup UI Layer
// All API calls go through background.js via chrome.runtime.sendMessage

// Detect iframe context (injected panel mode) for CSS adjustments
if (window !== window.top) {
  document.documentElement.classList.add('in-iframe');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sendMsg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(resp || { success: false, error: 'No response' });
      }
    });
  });
}

// ── Toast Notifications ─────────────────────────────────────────────────────

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── DOM Refs ────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

let els = {};

let selectedModifier = 'short';
let customPresets = [];
let presetOverrides = {};
let editingPresetId = null;
let editingPresetType = null; // 'builtin' or 'custom'

// API provider state — stores key/model per provider so switching doesn't lose values
let selectedApiProvider = 'gemini';
let apiKeys = { openai: '', gemini: '', claude: '' };
let apiModels = {
  openai: DEFAULT_SETTINGS[STORAGE_KEYS.OPENAI_MODEL],
  gemini: DEFAULT_SETTINGS[STORAGE_KEYS.GEMINI_MODEL],
  claude: DEFAULT_SETTINGS[STORAGE_KEYS.CLAUDE_MODEL]
};
let selectedOllamaModel = '';

function initDomRefs() {
  els = {
    mainPage: $('main-page'),
    settingsPage: $('settings-page'),
    historyPage: $('history-page'),
    settingsBtn: $('settings-btn'),
    historyBtn: $('history-btn'),
    backFromSettings: $('back-from-settings'),
    backFromHistory: $('back-from-history'),
    styleChips: $('style-chips'),
    input: $('input'),
    charCount: $('char-count'),
    clearBtn: $('clear-btn'),
    rewriteBtn: $('rewrite'),
    outputContainer: $('output-container'),
    output: $('output'),
    copyBtn: $('copy-btn'),
    // Settings — Provider
    providerApiTab: $('provider-api-tab'),
    providerOllamaTab: $('provider-ollama-tab'),
    apiSettings: $('api-settings'),
    ollamaSettings: $('ollama-settings'),
    providerApiRadio: $('provider-api'),
    providerOllamaRadio: $('provider-ollama'),
    // Settings — API
    apiKey: $('api-key'),
    showKeyBtn: $('show-key'),
    apiModelSelect: $('api-model-select'),
    apiModelTrigger: document.querySelector('#api-model-select .custom-select-trigger'),
    apiModelValue: document.querySelector('#api-model-select .custom-select-value'),
    apiModelDropdown: document.querySelector('#api-model-select .custom-select-dropdown'),
    apiHint: $('api-hint'),
    apiHintLink: $('api-hint-link'),
    // Settings — Ollama
    ollamaEndpoint: $('ollama-endpoint'),
    ollamaModelSelect: $('ollama-model-select'),
    ollamaModelTrigger: document.querySelector('#ollama-model-select .custom-select-trigger'),
    ollamaModelValue: document.querySelector('#ollama-model-select .custom-select-value'),
    ollamaModelDropdown: document.querySelector('#ollama-model-select .custom-select-dropdown'),
    refreshOllamaModels: $('refresh-ollama-models'),
    ollamaStatus: $('ollama-status'),
    saveSettingsBtn: $('save-settings'),
    // Presets
    addPresetBtn: $('add-preset-btn'),
    presetForm: $('preset-form'),
    presetName: $('preset-name'),
    presetTemplate: $('preset-template'),
    presetSave: $('preset-save'),
    presetCancel: $('preset-cancel'),
    presetList: $('preset-list'),
    // History
    historyList: $('history-list'),
    historySearch: $('history-search'),
    historyCount: $('history-count'),
    clearHistoryBtn: $('clear-history'),
    // Provider status
    providerStatus: $('provider-status'),
    providerStatusText: $('provider-status-text'),
    // Context toggle
    includeContext: $('include-context'),
    contextIndicator: $('context-indicator'),
  };
}

// ── Provider Status ─────────────────────────────────────────────────────────

function updateProviderStatus(settings) {
  const isOllama = settings[STORAGE_KEYS.PROVIDER] === PROVIDERS.OLLAMA;
  let label, model, hasKey;

  if (isOllama) {
    model = settings[STORAGE_KEYS.OLLAMA_MODEL] || 'llama3';
    label = `Ollama \u00B7 ${model}`;
    hasKey = true; // Ollama doesn't need a key
  } else {
    const ap = settings[STORAGE_KEYS.API_PROVIDER] || API_PROVIDERS.GEMINI;
    const providerName = API_PROVIDER_LABELS[ap] || ap;
    const modelKey = API_STORAGE_MAP[ap]?.model;
    const keyKey = API_STORAGE_MAP[ap]?.key;
    model = settings[modelKey] || '';
    hasKey = !!(settings[keyKey]);
    // Find friendly model label
    const modelEntry = (API_MODELS[ap] || []).find(m => m.id === model);
    const modelLabel = modelEntry ? modelEntry.label : model;
    label = `${providerName} \u00B7 ${modelLabel}`;
  }

  els.providerStatusText.textContent = label;
  els.providerStatus.classList.toggle('error', !hasKey);
  if (!hasKey) {
    els.providerStatusText.textContent = label + ' (no key)';
  }
}

// ── Page Navigation ─────────────────────────────────────────────────────────

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
  });
  page.classList.add('active');
}

// ── Settings ────────────────────────────────────────────────────────────────

async function loadSettings() {
  const resp = await sendMsg({ action: 'getSettings' });
  if (!resp.success) return;
  const s = resp.settings;

  // Provider radios
  if (s.provider === PROVIDERS.OLLAMA) {
    els.providerOllamaRadio.checked = true;
  } else {
    els.providerApiRadio.checked = true;
  }
  updateProviderTabs();

  // API provider
  selectedApiProvider = s[STORAGE_KEYS.API_PROVIDER] || API_PROVIDERS.GEMINI;

  // Load all API keys/models into local state
  apiKeys.openai = s[STORAGE_KEYS.OPENAI_API_KEY] || '';
  apiKeys.gemini = s[STORAGE_KEYS.GEMINI_API_KEY] || '';
  apiKeys.claude = s[STORAGE_KEYS.CLAUDE_API_KEY] || '';
  apiModels.openai = s[STORAGE_KEYS.OPENAI_MODEL] || DEFAULT_SETTINGS[STORAGE_KEYS.OPENAI_MODEL];
  apiModels.gemini = s[STORAGE_KEYS.GEMINI_MODEL] || DEFAULT_SETTINGS[STORAGE_KEYS.GEMINI_MODEL];
  apiModels.claude = s[STORAGE_KEYS.CLAUDE_MODEL] || DEFAULT_SETTINGS[STORAGE_KEYS.CLAUDE_MODEL];

  updateApiProviderUI();

  // Ollama
  if (s.ollamaEndpoint) els.ollamaEndpoint.value = s.ollamaEndpoint;
  if (s.ollamaModel) {
    selectedOllamaModel = s.ollamaModel;
    els.ollamaModelValue.textContent = s.ollamaModel;
    els.ollamaModelSelect.dataset.value = s.ollamaModel;
  }

  // Load custom presets and preset overrides
  const presetsResp = await sendMsg({ action: 'getCustomPresets' });
  if (presetsResp.success) customPresets = presetsResp.presets;
  const overridesResp = await sendMsg({ action: 'getPresetOverrides' });
  if (overridesResp.success) presetOverrides = overridesResp.overrides;

  // Modifier
  if (s.lastModifier) selectedModifier = s.lastModifier;
  renderStyleChips();
  renderPresetList();

  // Update provider status bar
  updateProviderStatus(s);

  // Auto-fetch Ollama models (non-blocking)
  if (s.provider === PROVIDERS.OLLAMA) {
    loadOllamaModels();
  }
}

function updateProviderTabs() {
  const isOllama = els.providerOllamaRadio.checked;
  els.providerApiTab.classList.toggle('active', !isOllama);
  els.providerOllamaTab.classList.toggle('active', isOllama);
  els.apiSettings.classList.toggle('hidden', isOllama);
  els.ollamaSettings.classList.toggle('hidden', !isOllama);
}

// ── API Provider Switching ──────────────────────────────────────────────────

function saveCurrentApiFieldsToState() {
  apiKeys[selectedApiProvider] = els.apiKey.value;
  const modelVal = els.apiModelSelect.dataset.value;
  if (modelVal) apiModels[selectedApiProvider] = modelVal;
}

function switchApiProvider(provider) {
  saveCurrentApiFieldsToState();
  selectedApiProvider = provider;
  updateApiProviderUI();
}

function updateApiProviderUI() {
  // Update button active states
  document.querySelectorAll('.api-provider-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.provider === selectedApiProvider);
  });

  // Populate model custom dropdown
  const models = API_MODELS[selectedApiProvider] || [];
  const currentModel = apiModels[selectedApiProvider] || (models[0] && models[0].id) || '';
  populateApiModelDropdown(models, currentModel);

  // Set values
  els.apiKey.value = apiKeys[selectedApiProvider] || '';

  // Update hint
  const hint = API_HINTS[selectedApiProvider];
  if (hint) {
    els.apiHintLink.href = hint.url;
    els.apiHintLink.textContent = hint.label;
  }

  // Reset show/hide key button
  els.apiKey.type = 'password';
  els.showKeyBtn.textContent = 'Show';
}

function populateApiModelDropdown(models, selectedValue) {
  els.apiModelDropdown.innerHTML = '';
  models.forEach((m) => {
    const option = document.createElement('div');
    option.className = 'custom-select-option' + (m.id === selectedValue ? ' selected' : '');
    option.dataset.value = m.id;
    option.textContent = m.label;
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      setApiModel(m.id, m.label);
      closeApiModelDropdown();
    });
    els.apiModelDropdown.appendChild(option);
  });
  // Set trigger display
  const match = models.find(m => m.id === selectedValue);
  els.apiModelValue.textContent = match ? match.label : (models[0] ? models[0].label : 'Select...');
  els.apiModelSelect.dataset.value = selectedValue || (models[0] ? models[0].id : '');
}

function setApiModel(id, label) {
  apiModels[selectedApiProvider] = id;
  els.apiModelValue.textContent = label;
  els.apiModelSelect.dataset.value = id;
  els.apiModelDropdown.querySelectorAll('.custom-select-option').forEach((opt) => {
    opt.classList.toggle('selected', opt.dataset.value === id);
  });
}

function toggleApiModelDropdown() {
  const isOpen = els.apiModelSelect.classList.contains('open');
  if (isOpen) {
    closeApiModelDropdown();
  } else {
    // Close Ollama dropdown if open
    closeOllamaDropdown();
    els.apiModelSelect.classList.add('open');
  }
}

function closeApiModelDropdown() {
  els.apiModelSelect.classList.remove('open');
}

// ── Ollama Model Dropdown ───────────────────────────────────────────────────

async function loadOllamaModels() {
  const btn = els.refreshOllamaModels;
  btn.disabled = true;
  btn.textContent = '...';
  els.ollamaStatus.textContent = '';
  els.ollamaStatus.className = 'connection-status';

  const resp = await sendMsg({
    action: 'getOllamaModels',
    settings: {
      [STORAGE_KEYS.OLLAMA_ENDPOINT]: els.ollamaEndpoint.value.trim() || DEFAULT_SETTINGS[STORAGE_KEYS.OLLAMA_ENDPOINT]
    }
  });

  btn.disabled = false;
  btn.textContent = '↻';

  if (resp.success) {
    const models = resp.models || [];
    populateOllamaDropdown(models);

    // Restore saved selection
    if (selectedOllamaModel && models.includes(selectedOllamaModel)) {
      setOllamaModel(selectedOllamaModel);
    } else if (models.length > 0) {
      setOllamaModel(models[0]);
    }

    els.ollamaStatus.className = 'connection-status success';
    els.ollamaStatus.textContent = `Connected! ${models.length} model${models.length !== 1 ? 's' : ''} found.`;
  } else {
    els.ollamaModelDropdown.innerHTML = '';
    els.ollamaModelValue.textContent = 'Connection failed';
    els.ollamaStatus.className = 'connection-status error';
    els.ollamaStatus.textContent = resp.error || 'Connection failed';
  }
}

function populateOllamaDropdown(models) {
  els.ollamaModelDropdown.innerHTML = '';
  if (models.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'custom-select-empty';
    empty.textContent = 'No models found';
    els.ollamaModelDropdown.appendChild(empty);
    return;
  }

  models.forEach((name) => {
    const option = document.createElement('div');
    option.className = 'custom-select-option' + (name === selectedOllamaModel ? ' selected' : '');
    option.dataset.value = name;
    option.textContent = name;
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      setOllamaModel(name);
      closeOllamaDropdown();
    });
    els.ollamaModelDropdown.appendChild(option);
  });
}

function setOllamaModel(value) {
  selectedOllamaModel = value;
  els.ollamaModelValue.textContent = value || 'Select a model...';
  els.ollamaModelSelect.dataset.value = value;
  // Update selected state in dropdown
  els.ollamaModelDropdown.querySelectorAll('.custom-select-option').forEach((opt) => {
    opt.classList.toggle('selected', opt.dataset.value === value);
  });
}

function toggleOllamaDropdown() {
  const isOpen = els.ollamaModelSelect.classList.contains('open');
  if (isOpen) {
    closeOllamaDropdown();
  } else {
    closeApiModelDropdown();
    els.ollamaModelSelect.classList.add('open');
  }
}

function closeOllamaDropdown() {
  els.ollamaModelSelect.classList.remove('open');
}

// ── Save Settings ───────────────────────────────────────────────────────────

async function handleSaveSettings() {
  // Save current API field values to state before building settings object
  saveCurrentApiFieldsToState();

  const settings = {
    [STORAGE_KEYS.PROVIDER]: els.providerOllamaRadio.checked ? PROVIDERS.OLLAMA : PROVIDERS.API,
    [STORAGE_KEYS.API_PROVIDER]: selectedApiProvider,
    [STORAGE_KEYS.OPENAI_API_KEY]: apiKeys.openai.trim(),
    [STORAGE_KEYS.OPENAI_MODEL]: apiModels.openai,
    [STORAGE_KEYS.GEMINI_API_KEY]: apiKeys.gemini.trim(),
    [STORAGE_KEYS.GEMINI_MODEL]: apiModels.gemini,
    [STORAGE_KEYS.CLAUDE_API_KEY]: apiKeys.claude.trim(),
    [STORAGE_KEYS.CLAUDE_MODEL]: apiModels.claude,
    [STORAGE_KEYS.OLLAMA_ENDPOINT]: els.ollamaEndpoint.value.trim() || DEFAULT_SETTINGS[STORAGE_KEYS.OLLAMA_ENDPOINT],
    [STORAGE_KEYS.OLLAMA_MODEL]: selectedOllamaModel || DEFAULT_SETTINGS[STORAGE_KEYS.OLLAMA_MODEL],
  };

  const resp = await sendMsg({ action: 'saveSettings', settings });
  if (resp.success) {
    updateProviderStatus(settings);
    showToast('Settings saved!', 'success');
    els.saveSettingsBtn.textContent = 'Saved!';
    els.saveSettingsBtn.style.pointerEvents = 'none';
    setTimeout(() => {
      els.saveSettingsBtn.textContent = 'Save Settings';
      els.saveSettingsBtn.style.pointerEvents = '';
      navigateTo(els.mainPage);
    }, 800);
  } else {
    showToast('Failed to save: ' + (resp.error || 'Unknown error'), 'error');
    els.saveSettingsBtn.textContent = 'Save Settings';
    els.saveSettingsBtn.style.pointerEvents = '';
  }
}

// ── Enhance ─────────────────────────────────────────────────────────────────

let isEnhancing = false;

async function handleEnhance() {
  if (isEnhancing) return;

  const input = els.input.value.trim();
  const modifier = selectedModifier;

  if (!input) {
    showToast('Please enter a prompt first.', 'error');
    return;
  }

  isEnhancing = true;
  const btnText = els.rewriteBtn.querySelector('.btn-text');
  if (btnText) btnText.textContent = 'Enhancing...';
  els.rewriteBtn.classList.add('loading');
  els.rewriteBtn.disabled = true;

  // Show output container with pulsing glow while waiting
  els.output.textContent = '';
  els.outputContainer.classList.remove('visible');
  els.outputContainer.classList.add('waiting');

  try {
    const includeContext = els.includeContext ? els.includeContext.checked : false;
    const resp = await sendMsg({ action: 'enhance', prompt: input, modifier, includeContext });

    els.outputContainer.classList.remove('waiting');

    if (resp.success) {
      els.outputContainer.classList.add('visible');
      await typewriterReveal(els.output, resp.text);
      showToast('Prompt enhanced!', 'success');
    } else {
      showToast(resp.error || 'Enhancement failed.', 'error');
    }
  } catch (err) {
    els.outputContainer.classList.remove('waiting');
    showToast('Unexpected error: ' + err.message, 'error');
  } finally {
    isEnhancing = false;
    els.outputContainer.classList.remove('waiting');
    const btnTextEl = els.rewriteBtn.querySelector('.btn-text');
    if (btnTextEl) btnTextEl.textContent = 'Enhance Prompt';
    els.rewriteBtn.classList.remove('loading');
    els.rewriteBtn.disabled = false;
  }
}

// ── Typewriter reveal ────────────────────────────────────────────────────────

function typewriterReveal(el, text) {
  return new Promise(resolve => {
    el.textContent = '';
    let i = 0;
    const len = text.length;
    // Aim for ~600ms total, but clamp per-char speed between 1-12ms
    const charDelay = Math.max(1, Math.min(12, Math.floor(600 / len)));
    // Batch size: render multiple chars per frame for long text
    const batch = charDelay <= 2 ? Math.ceil(len / 120) : 1;

    function tick() {
      const end = Math.min(i + batch, len);
      el.textContent += text.slice(i, end);
      i = end;
      if (i < len) {
        setTimeout(tick, charDelay);
      } else {
        resolve();
      }
    }
    tick();
  });
}

// ── Copy ────────────────────────────────────────────────────────────────────

function handleCopy() {
  const text = els.output.textContent;
  navigator.clipboard.writeText(text).then(() => {
    els.copyBtn.classList.add('copied');
    els.copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    showToast('Copied to clipboard!', 'success');
    setTimeout(() => {
      els.copyBtn.classList.remove('copied');
      els.copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    }, 2000);
  }).catch(() => {
    showToast('Failed to copy.', 'error');
  });
}

// ── History ─────────────────────────────────────────────────────────────────

const HISTORY_PAGE_SIZE = 10;
let historyData = [];
let historyVisibleCount = HISTORY_PAGE_SIZE;

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function getDateGroup(ts) {
  const now = new Date();
  const d = new Date(ts);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfWeek = startOfToday - (now.getDay() * 86400000);

  if (ts >= startOfToday) return 'Today';
  if (ts >= startOfYesterday) return 'Yesterday';
  if (ts >= startOfWeek) return 'This Week';
  return 'Older';
}

async function loadHistory() {
  const resp = await sendMsg({ action: 'getHistory' });
  historyData = resp.success ? resp.history : [];
  historyVisibleCount = HISTORY_PAGE_SIZE;
  renderHistory(historyData);
}

function renderHistory(history) {
  els.historyList.innerHTML = '';
  if (els.historyCount) els.historyCount.textContent = history.length > 0 ? `(${history.length})` : '';

  if (history.length === 0) {
    const searchVal = (els.historySearch?.value || '').trim();
    els.historyList.innerHTML = `<div class="history-empty">${searchVal ? 'No matching entries.' : 'No history yet. Enhance a prompt to get started!'}</div>`;
    return;
  }

  const visible = history.slice(0, historyVisibleCount);
  let lastGroup = '';
  let animIdx = 0;

  visible.forEach((entry) => {
    // Date group header
    const group = getDateGroup(entry.timestamp);
    if (group !== lastGroup) {
      lastGroup = group;
      const header = document.createElement('div');
      header.className = 'history-group-header';
      header.textContent = group;
      els.historyList.appendChild(header);
    }

    const card = createHistoryCard(entry, animIdx);
    els.historyList.appendChild(card);
    animIdx++;
  });

  // "Show more" button
  if (history.length > historyVisibleCount) {
    const remaining = history.length - historyVisibleCount;
    const moreBtn = document.createElement('button');
    moreBtn.className = 'history-load-more';
    moreBtn.textContent = `Show ${Math.min(remaining, HISTORY_PAGE_SIZE)} more (${remaining} remaining)`;
    moreBtn.addEventListener('click', () => {
      historyVisibleCount += HISTORY_PAGE_SIZE;
      renderHistory(history);
    });
    els.historyList.appendChild(moreBtn);
  }
}

function createHistoryCard(entry, animIdx) {
  const card = document.createElement('div');
  card.className = 'history-card compact';
  if (animIdx < 6) card.style.animationDelay = `${animIdx * 0.05}s`;

  const label = STYLE_LABELS[entry.modifier] || entry.modifier || 'Unknown';
  const time = relativeTime(entry.timestamp);
  const fullTime = new Date(entry.timestamp).toLocaleString();
  const platformTag = entry.platform ? `<span class="platform-badge">${escapeHtml(entry.platform)}</span>` : '';
  const inputPreview = (entry.input || '').length > 80 ? entry.input.substring(0, 80) + '...' : entry.input;

  const hasOutput = entry.output && entry.output.trim().length > 0;
  const outputSection = hasOutput ? `
      <div class="history-section">
        <span class="history-section-label">Output</span>
        <div class="history-output">${escapeHtml(entry.output)}</div>
      </div>` : '';

  card.innerHTML = `
    <div class="history-card-row">
      <div class="history-badges">
        <span class="modifier-badge">${escapeHtml(label)}</span>
        ${platformTag}
      </div>
      <span class="history-input-preview" title="${escapeHtml(entry.input)}">${escapeHtml(inputPreview)}</span>
      <span class="timestamp" title="${fullTime}">${time}</span>
    </div>
    <div class="history-card-detail">
      <div class="history-card-detail-inner">
        <div class="history-section">
          <span class="history-section-label">Input</span>
          <div class="history-input">${escapeHtml(entry.input)}</div>
        </div>
        ${outputSection}
        <div class="history-card-actions">
          <button class="history-copy-btn" title="Copy ${hasOutput ? 'output' : 'input'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span>Copy</span>
          </button>
          <button class="history-reuse-btn" title="Load input into editor">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
            <span>Reuse</span>
          </button>
        </div>
      </div>
    </div>
  `;

  // Click card row to expand/collapse detail
  const row = card.querySelector('.history-card-row');
  row.addEventListener('click', () => {
    card.classList.toggle('expanded');
  });

  // Copy output
  card.querySelector('.history-copy-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const text = entry.output || entry.input;
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied!', 'success');
    }).catch(() => showToast('Failed to copy.', 'error'));
  });

  // Reuse input
  card.querySelector('.history-reuse-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    els.input.value = entry.input;
    updateCharCount();
    navigateTo(els.mainPage);
    showToast('Prompt loaded', 'info');
  });

  return card;
}

function filterHistory(query) {
  historyVisibleCount = HISTORY_PAGE_SIZE;
  if (!query) {
    renderHistory(historyData);
    return;
  }
  const q = query.toLowerCase();
  const filtered = historyData.filter(e =>
    (e.input || '').toLowerCase().includes(q) ||
    (e.output || '').toLowerCase().includes(q) ||
    (e.modifier || '').toLowerCase().includes(q) ||
    (e.platform || '').toLowerCase().includes(q)
  );
  renderHistory(filtered);
}

async function handleClearHistory() {
  await sendMsg({ action: 'clearHistory' });
  historyData = [];
  historyVisibleCount = HISTORY_PAGE_SIZE;
  showToast('History cleared', 'info');
  renderHistory([]);
  if (els.historySearch) els.historySearch.value = '';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Style Chips ────────────────────────────────────────────────────────────

function renderStyleChips() {
  els.styleChips.innerHTML = '';

  // Built-in styles
  Object.keys(STYLE_LABELS).forEach((key) => {
    const chip = document.createElement('button');
    chip.className = 'style-chip' + (selectedModifier === key ? ' active' : '');
    chip.textContent = STYLE_LABELS[key];
    chip.dataset.value = key;
    chip.addEventListener('click', () => selectModifier(key));
    els.styleChips.appendChild(chip);
  });

  // Custom presets
  customPresets.forEach((preset) => {
    const chip = document.createElement('button');
    chip.className = 'style-chip custom' + (selectedModifier === preset.id ? ' active' : '');
    chip.textContent = preset.name;
    chip.dataset.value = preset.id;
    chip.addEventListener('click', () => selectModifier(preset.id));
    els.styleChips.appendChild(chip);
  });
}

function selectModifier(value) {
  selectedModifier = value;
  els.styleChips.querySelectorAll('.style-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.value === value);
  });
  sendMsg({ action: 'saveSettings', settings: { [STORAGE_KEYS.LAST_MODIFIER]: value } });
}

// ── Preset Management ─────────────────────────────────────────────────────

function renderPresetList() {
  els.presetList.innerHTML = '';

  const editSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
  const resetSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>';
  const deleteSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';

  // Built-in presets
  Object.keys(STYLE_LABELS).forEach((key) => {
    const isOverridden = presetOverrides[key] !== undefined;
    const currentTemplate = isOverridden ? presetOverrides[key] : TEMPLATES[key];
    const card = document.createElement('div');
    card.className = 'preset-card' + (isOverridden ? ' modified' : '');
    card.innerHTML = `
      <div class="preset-card-header">
        <div class="preset-card-name-row">
          <span class="preset-card-name">${escapeHtml(STYLE_LABELS[key])}</span>
          <span class="preset-badge built-in">${isOverridden ? 'Modified' : 'Built-in'}</span>
        </div>
        <div class="preset-card-actions">
          <button class="preset-edit-btn" title="Edit">${editSvg}</button>
          ${isOverridden ? `<button class="preset-reset-btn" title="Reset to default">${resetSvg}</button>` : ''}
        </div>
      </div>
      <div class="preset-card-template">${escapeHtml(currentTemplate.substring(0, 80))}${currentTemplate.length > 80 ? '...' : ''}</div>
    `;

    card.querySelector('.preset-edit-btn').addEventListener('click', () => editPreset(key, 'builtin'));
    if (isOverridden) {
      card.querySelector('.preset-reset-btn').addEventListener('click', () => resetPreset(key));
    }
    els.presetList.appendChild(card);
  });

  // Custom presets
  customPresets.forEach((preset) => {
    const card = document.createElement('div');
    card.className = 'preset-card custom';
    card.innerHTML = `
      <div class="preset-card-header">
        <div class="preset-card-name-row">
          <span class="preset-card-name">${escapeHtml(preset.name)}</span>
          <span class="preset-badge custom">Custom</span>
        </div>
        <div class="preset-card-actions">
          <button class="preset-edit-btn" title="Edit">${editSvg}</button>
          <button class="preset-delete-btn" title="Delete">${deleteSvg}</button>
        </div>
      </div>
      <div class="preset-card-template">${escapeHtml(preset.template.substring(0, 80))}${preset.template.length > 80 ? '...' : ''}</div>
    `;

    card.querySelector('.preset-edit-btn').addEventListener('click', () => editPreset(preset.id, 'custom'));
    card.querySelector('.preset-delete-btn').addEventListener('click', () => deletePreset(preset.id));
    els.presetList.appendChild(card);
  });
}

function showPresetForm(name, template) {
  els.presetForm.classList.remove('hidden');
  els.presetName.value = name || '';
  els.presetTemplate.value = template || '';
  els.presetName.focus();
}

function hidePresetForm() {
  els.presetForm.classList.add('hidden');
  els.presetName.value = '';
  els.presetTemplate.value = '';
  els.presetName.disabled = false;
  editingPresetId = null;
  editingPresetType = null;
}

function handleAddPreset() {
  editingPresetId = null;
  showPresetForm('', '');
}

function editPreset(id, type) {
  editingPresetId = id;
  editingPresetType = type;
  if (type === 'builtin') {
    const template = presetOverrides[id] || TEMPLATES[id];
    showPresetForm(STYLE_LABELS[id], template);
    els.presetName.disabled = true;
  } else {
    const preset = customPresets.find(p => p.id === id);
    if (!preset) return;
    showPresetForm(preset.name, preset.template);
    els.presetName.disabled = false;
  }
}

async function handleSavePreset() {
  const name = els.presetName.value.trim();
  const template = els.presetTemplate.value.trim();

  if (!name) { showToast('Please enter a preset name.', 'error'); return; }
  if (!template) { showToast('Please enter a template.', 'error'); return; }
  if (!template.includes('{{input}}')) { showToast('Template must include {{input}} placeholder.', 'error'); return; }

  if (editingPresetType === 'builtin') {
    // Save as preset override for built-in
    presetOverrides[editingPresetId] = template;
    await sendMsg({ action: 'savePresetOverrides', overrides: presetOverrides });
    hidePresetForm();
    renderPresetList();
    showToast('Preset updated!', 'success');
    return;
  }

  if (editingPresetId) {
    const idx = customPresets.findIndex(p => p.id === editingPresetId);
    if (idx !== -1) {
      customPresets[idx].name = name;
      customPresets[idx].template = template;
    }
  } else {
    const id = 'custom_' + Date.now();
    customPresets.push({ id, name, template });
  }

  await sendMsg({ action: 'saveCustomPresets', presets: customPresets });
  hidePresetForm();
  renderPresetList();
  renderStyleChips();
  showToast(editingPresetId ? 'Preset updated!' : 'Preset created!', 'success');
}

async function resetPreset(key) {
  delete presetOverrides[key];
  await sendMsg({ action: 'savePresetOverrides', overrides: presetOverrides });
  renderPresetList();
  showToast('Preset reset to default.', 'info');
}

async function deletePreset(id) {
  customPresets = customPresets.filter(p => p.id !== id);
  await sendMsg({ action: 'saveCustomPresets', presets: customPresets });

  if (selectedModifier === id) {
    selectModifier('short');
  }
  renderPresetList();
  renderStyleChips();
  showToast('Preset deleted.', 'info');
}

// ── Character Count & Clear ─────────────────────────────────────────────────

function updateCharCount() {
  els.charCount.textContent = `${els.input.value.length} chars`;
}

function handleClear() {
  els.input.value = '';
  updateCharCount();
  els.outputContainer.classList.remove('visible');
  els.input.focus();
}

// ── Auto-resize textarea ────────────────────────────────────────────────────

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.max(80, Math.min(el.scrollHeight, 250)) + 'px';
}

// ── Interactive Background ──────────────────────────────────────────────────

function initBackground() {
  document.addEventListener('mousemove', (e) => {
    const blobs = document.querySelectorAll('.gradient-blob');
    const rect = document.body.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;

    blobs.forEach((blob, i) => {
      const ox = (mx - 0.5) * (15 + i * 4) * (i % 2 === 0 ? 1 : -1);
      const oy = (my - 0.5) * (15 + i * 4) * (i % 2 === 0 ? -1 : 1);
      blob.style.transform = `translate(${ox}px, ${oy}px)`;
    });
  });
}

// ── Init ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initDomRefs();
  initBackground();
  loadSettings();

  // Navigation
  els.settingsBtn.addEventListener('click', () => navigateTo(els.settingsPage));
  els.historyBtn.addEventListener('click', () => { loadHistory(); navigateTo(els.historyPage); });
  els.backFromSettings.addEventListener('click', () => navigateTo(els.mainPage));
  els.backFromHistory.addEventListener('click', () => navigateTo(els.mainPage));

  // Provider status bar — click to go to settings
  els.providerStatus.addEventListener('click', () => navigateTo(els.settingsPage));

  // Provider tabs
  els.providerApiTab.addEventListener('click', () => {
    els.providerApiRadio.checked = true;
    updateProviderTabs();
  });
  els.providerOllamaTab.addEventListener('click', () => {
    els.providerOllamaRadio.checked = true;
    updateProviderTabs();
  });
  els.providerApiRadio.addEventListener('change', updateProviderTabs);
  els.providerOllamaRadio.addEventListener('change', updateProviderTabs);

  // API provider sub-tabs
  document.querySelectorAll('.api-provider-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchApiProvider(btn.dataset.provider));
  });

  // API key toggle
  els.showKeyBtn.addEventListener('click', () => {
    const isPassword = els.apiKey.type === 'password';
    els.apiKey.type = isPassword ? 'text' : 'password';
    els.showKeyBtn.textContent = isPassword ? 'Hide' : 'Show';
  });

  // API model custom dropdown
  els.apiModelTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleApiModelDropdown();
  });
  els.apiModelSelect.addEventListener('click', (e) => e.stopPropagation());

  // Ollama model custom dropdown
  els.ollamaModelTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleOllamaDropdown();
  });
  els.ollamaModelSelect.addEventListener('click', (e) => e.stopPropagation());

  // Close all custom dropdowns on outside click
  document.addEventListener('click', () => {
    closeApiModelDropdown();
    closeOllamaDropdown();
  });

  // Ollama model refresh
  els.refreshOllamaModels.addEventListener('click', loadOllamaModels);

  // Settings
  els.saveSettingsBtn.addEventListener('click', handleSaveSettings);

  // Presets
  els.addPresetBtn.addEventListener('click', handleAddPreset);
  els.presetSave.addEventListener('click', handleSavePreset);
  els.presetCancel.addEventListener('click', hidePresetForm);

  // Enhance
  els.rewriteBtn.addEventListener('click', handleEnhance);

  // Ctrl+Enter shortcut
  els.input.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleEnhance();
    }
  });

  // Copy
  els.copyBtn.addEventListener('click', handleCopy);

  // Char count & auto-resize
  els.input.addEventListener('input', () => {
    updateCharCount();
    autoResize(els.input);
  });

  // Clear
  els.clearBtn.addEventListener('click', handleClear);

  // History
  els.clearHistoryBtn.addEventListener('click', handleClearHistory);
  els.historySearch.addEventListener('input', (e) => filterHistory(e.target.value.trim()));

  // Init char count
  updateCharCount();
});

// Message listener for prompts from content script or context menu
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'promptReady' || request.action === 'rewritePrompt') {
    if (els.input) {
      els.input.value = request.prompt || '';
      updateCharCount();
      handleEnhance();
    }
  }
});
