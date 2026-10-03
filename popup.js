// PromptCraft — Side Panel UI
// All API calls go through background.js via chrome.runtime.sendMessage

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
let apiKeys = { openai: '', gemini: '', claude: '', custom: '' };
let apiModels = {
  openai: DEFAULT_SETTINGS[STORAGE_KEYS.OPENAI_MODEL],
  gemini: DEFAULT_SETTINGS[STORAGE_KEYS.GEMINI_MODEL],
  claude: DEFAULT_SETTINGS[STORAGE_KEYS.CLAUDE_MODEL],
  custom: ''
};
let customEndpoint = '';
// Model picker contents per provider: the built-in list until the user refreshes from the provider
let modelLists = { ...API_MODELS };
let selectedOllamaModel = '';

function initDomRefs() {
  els = {
    mainPage: $('main-page'),
    settingsPage: $('settings-page'),
    historyPage: $('history-page'),
    settingsBtn: $('settings-btn'),
    historyBtn: $('history-btn'),
    frame: document.querySelector('.popup-frame'),
    navWrite: $('nav-write'),
    reviewRing: $('review-ring'),
    reviewSummary: $('review-summary'),
    reviewIssues: $('review-issues'),
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
    // Settings — Built-in model
    providerBuiltinTab: $('provider-builtin-tab'),
    providerBuiltinRadio: $('provider-builtin'),
    builtinSettings: $('builtin-settings'),
    builtinStatus: $('builtin-status'),
    builtinDownload: $('builtin-download'),
    builtinUnavailableHint: $('builtin-unavailable-hint'),
    // Settings — API
    apiKey: $('api-key'),
    showKeyBtn: $('show-key'),
    testApiKeyBtn: $('test-api-key'),
    apiKeyStatus: $('api-key-status'),
    apiModelSelect: $('api-model-select'),
    apiModelTrigger: document.querySelector('#api-model-select .custom-select-trigger'),
    apiModelValue: document.querySelector('#api-model-select .custom-select-value'),
    apiModelDropdown: document.querySelector('#api-model-select .custom-select-dropdown'),
    apiHint: $('api-hint'),
    apiHintLink: $('api-hint-link'),
    apiKeyLabel: $('api-key-label'),
    refreshApiModels: $('refresh-api-models'),
    // Settings — Custom (OpenAI-compatible) endpoint
    customEndpointGroup: $('custom-endpoint-group'),
    customEndpoint: $('custom-endpoint'),
    customModel: $('custom-model'),
    customModelList: $('custom-model-list'),
    customHint: $('custom-hint'),
    // Settings — Ollama
    ollamaEndpoint: $('ollama-endpoint'),
    ollamaModelSelect: $('ollama-model-select'),
    ollamaModelTrigger: document.querySelector('#ollama-model-select .custom-select-trigger'),
    ollamaModelValue: document.querySelector('#ollama-model-select .custom-select-value'),
    ollamaModelDropdown: document.querySelector('#ollama-model-select .custom-select-dropdown'),
    refreshOllamaModels: $('refresh-ollama-models'),
    ollamaStatus: $('ollama-status'),
    saveSettingsBtn: $('save-settings'),
    deepAnalysisToggle: $('deep-analysis-toggle'),
    multiStepToggle: $('multi-step-toggle'),
    scoreBadge: $('score-badge'),
    insertBtn: $('insert-btn'),
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
    exportHistoryBtn: $('export-history'),
    clearHistoryBtn: $('clear-history'),
    // Provider status
    providerStatus: $('provider-status'),
    providerStatusText: $('provider-status-text'),
    // Context toggle
    includeContext: $('include-context'),
    contextIndicator: $('context-indicator'),
    viewContextBtn: $('view-context'),
    contextModal: $('context-modal'),
    contextModalContent: $('context-modal-content'),
    closeContextModal: $('close-context-modal'),
    // Theme
    themeToggleBtn: $('theme-toggle-btn'),
    themeIconSun: $('theme-icon-sun'),
    themeIconMoon: $('theme-icon-moon'),
    // Onboarding
    onboardingPage: $('onboarding-page'),
    onboardingApiKey: $('onboarding-api-key'),
    onboardingKeySection: $('onboarding-key-section'),
    onboardingBuiltinOption: document.querySelector('.onboarding-provider-btn[data-provider="builtin"]'),
    onboardingBuiltinSection: $('onboarding-builtin-section'),
    onboardingBuiltinNote: $('onboarding-builtin-note'),
    onboardingBuiltinStatus: $('onboarding-builtin-status'),
    onboardingHint: $('onboarding-hint'),
    onboardingStartBtn: $('onboarding-start'),
    onboardingSkipBtn: $('onboarding-skip'),
    onboardingTestBtn: $('onboarding-test-btn'),
    onboardingTestStatus: $('onboarding-test-status'),
    // Templates
    templatesPage: $('templates-page'),
    templatesBtn: $('templates-btn'),
    templateCategoryTabs: $('template-category-tabs'),
    templateGrid: $('template-grid'),
    templateDetail: $('template-detail'),
    backFromTemplateDetail: $('back-from-template-detail'),
    templateDetailIcon: $('template-detail-icon'),
    templateDetailName: $('template-detail-name'),
    templateDetailDesc: $('template-detail-desc'),
    templateVariables: $('template-variables'),
    templateInputGroup: $('template-input-group'),
    templateInputArea: $('template-input-area'),
    templatePreview: $('template-preview'),
    templatePreviewText: $('template-preview-text'),
    useTemplateBtn: $('use-template-btn'),
    templateToneChips: $('template-tone-chips'),
    // Usage
    usagePage: $('usage-page'),
    usageBtn: $('usage-btn'),
    usageIndicatorText: $('usage-indicator-text'),
    backFromUsage: $('back-from-usage'),
    usagePeriod: $('usage-period'),
    usageTotalEnhancements: $('usage-total-enhancements'),
    usageTotalCost: $('usage-total-cost'),
    usageTotalTokens: $('usage-total-tokens'),
    usageAvgPre: $('usage-avg-pre'),
    usageAvgPost: $('usage-avg-post'),
    usageAvgImprovement: $('usage-avg-improvement'),
    usageModelList: $('usage-model-list'),
    resetUsageBtn: $('reset-usage-btn'),
  };
}

// ── Provider Status ─────────────────────────────────────────────────────────

// Friendly name for a model ID: from the refreshed lists first, then the built-in ones
function modelLabel(id) {
  for (const lists of [modelLists, API_MODELS]) {
    for (const models of Object.values(lists)) {
      const match = (models || []).find(m => m.id === id);
      if (match) return match.label;
    }
  }
  return id;
}

function updateProviderStatus(settings) {
  if (settings[STORAGE_KEYS.PROVIDER] === PROVIDERS.BUILTIN) {
    els.providerStatusText.textContent = `${BUILTIN_LABEL} \u00B7 ${BUILTIN_MODEL}`;
    els.providerStatus.classList.toggle('error', builtInState !== 'available');
    return;
  }
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
    // A custom endpoint may not need a key (local servers), but it does need a URL and a model
    hasKey = ap === API_PROVIDERS.CUSTOM
      ? !!(settings[STORAGE_KEYS.CUSTOM_ENDPOINT] && model)
      : !!(settings[keyKey]);
    label = model ? `${providerName} \u00B7 ${modelLabel(model)}` : providerName;
  }

  els.providerStatusText.textContent = label;
  els.providerStatus.classList.toggle('error', !hasKey);
  if (!hasKey) {
    els.providerStatusText.textContent = label + (settings[STORAGE_KEYS.API_PROVIDER] === API_PROVIDERS.CUSTOM && !isOllama ? ' (not set up)' : ' (no key)');
  }
}

// ── Page Navigation ─────────────────────────────────────────────────────────

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.inert = true;
  });
  page.classList.add('active');
  page.inert = false;

  // The tab bar shows where we are (Usage lives under Settings) and hides during setup
  const owner = page === els.usagePage ? els.settingsPage.id : page.id;
  document.querySelectorAll('.tab').forEach((tab) => {
    const current = tab.dataset.page === owner;
    tab.classList.toggle('active', current);
    if (current) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  els.frame.classList.toggle('no-nav', page === els.onboardingPage);

  // Move focus into the new page so keyboard and screen reader users land there:
  // the prompt box on the main page, the heading everywhere else
  const target = page === els.mainPage ? els.input : page.querySelector('h1, h2');
  if (!target) return;
  if (!target.matches('textarea')) target.tabIndex = -1;
  target.focus({ preventScroll: true });
}

// Makes a non-button element behave like one for keyboard users
function makeButtonLike(el, onActivate) {
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  el.addEventListener('click', onActivate);
  el.addEventListener('keydown', (e) => {
    if (e.target !== el || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    onActivate(e);
  });
}

// ── Settings ────────────────────────────────────────────────────────────────

async function loadSettings() {
  const resp = await sendMsg({ action: 'getSettings' });
  if (!resp.success) return;
  const s = resp.settings;

  themePreference = s[STORAGE_KEYS.DARK_MODE] || 'auto';
  applyTheme(themePreference);

  // Model lists the user refreshed from a provider replace the built-in ones
  for (const [provider, models] of Object.entries(resp.modelCache || {})) {
    if (Array.isArray(models) && models.length > 0) modelLists[provider] = models;
  }

  // Provider radios
  if (s.provider === PROVIDERS.BUILTIN) els.providerBuiltinRadio.checked = true;
  else if (s.provider === PROVIDERS.OLLAMA) els.providerOllamaRadio.checked = true;
  else els.providerApiRadio.checked = true;
  updateProviderTabs();
  await refreshBuiltInState();

  // API provider
  selectedApiProvider = s[STORAGE_KEYS.API_PROVIDER] || API_PROVIDERS.GEMINI;

  // Load all API keys/models into local state
  apiKeys.openai = s[STORAGE_KEYS.OPENAI_API_KEY] || '';
  apiKeys.gemini = s[STORAGE_KEYS.GEMINI_API_KEY] || '';
  apiKeys.claude = s[STORAGE_KEYS.CLAUDE_API_KEY] || '';
  apiKeys.custom = s[STORAGE_KEYS.CUSTOM_API_KEY] || '';
  apiModels.openai = s[STORAGE_KEYS.OPENAI_MODEL] || DEFAULT_SETTINGS[STORAGE_KEYS.OPENAI_MODEL];
  apiModels.gemini = s[STORAGE_KEYS.GEMINI_MODEL] || DEFAULT_SETTINGS[STORAGE_KEYS.GEMINI_MODEL];
  apiModels.claude = s[STORAGE_KEYS.CLAUDE_MODEL] || DEFAULT_SETTINGS[STORAGE_KEYS.CLAUDE_MODEL];
  apiModels.custom = s[STORAGE_KEYS.CUSTOM_MODEL] || '';
  customEndpoint = s[STORAGE_KEYS.CUSTOM_ENDPOINT] || '';

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

  // Deep analysis toggle
  if (els.deepAnalysisToggle) {
    els.deepAnalysisToggle.checked = !!s[STORAGE_KEYS.DEEP_ANALYSIS];
  }
  els.multiStepToggle.checked = !!s[STORAGE_KEYS.MULTI_STEP];

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

  // Detect conversation context on active tab (non-blocking)
  detectConversationContext();

  // Check if onboarding is needed
  if (needsOnboarding(s)) {
    navigateTo(els.onboardingPage);
    // Where the browser can run its own model, starting takes one click
    if (builtInUsable()) selectOnboardingProvider(PROVIDERS.BUILTIN);
  }
}

// The provider chosen with the tabs at the top of Settings
function selectedProvider() {
  if (els.providerBuiltinRadio.checked) return PROVIDERS.BUILTIN;
  return els.providerOllamaRadio.checked ? PROVIDERS.OLLAMA : PROVIDERS.API;
}

function updateProviderTabs() {
  const provider = selectedProvider();
  els.providerApiTab.classList.toggle('active', provider === PROVIDERS.API);
  els.providerOllamaTab.classList.toggle('active', provider === PROVIDERS.OLLAMA);
  els.providerBuiltinTab.classList.toggle('active', provider === PROVIDERS.BUILTIN);
  els.apiSettings.classList.toggle('hidden', provider !== PROVIDERS.API);
  els.ollamaSettings.classList.toggle('hidden', provider !== PROVIDERS.OLLAMA);
  els.builtinSettings.classList.toggle('hidden', provider !== PROVIDERS.BUILTIN);
}

// ── Built-in Model ──────────────────────────────────────────────────────────
// The browser's own on-device model. It is offered only where the browser says
// it can run. Its first use downloads it, which the browser starts only from a click.

// 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported'
let builtInState = 'unsupported';

// Shortly after start-up Chrome answers "downloadable" before it has checked disk
// space and hardware, then corrects itself. So "downloadable" only counts once it
// has held for a few seconds; until then the model is not offered.
const BUILTIN_CONFIRM_MS = 2500;
let builtInConfirmed = false;
let builtInConfirmTimer = null;

const builtInUsable = () => builtInState === 'available' || builtInState === 'downloading'
  || (builtInState === 'downloadable' && builtInConfirmed);

async function confirmBuiltIn() {
  builtInConfirmTimer = null;
  const resp = await sendMsg({ action: 'getBuiltInState' });
  builtInConfirmed = resp.success && resp.state === 'downloadable';
  await refreshBuiltInState();
  // Where it can run, starting takes one click, unless the user has already picked something
  if (builtInUsable() && els.onboardingPage.classList.contains('active') && !onboardingSelectedProvider) {
    selectOnboardingProvider(PROVIDERS.BUILTIN);
  }
}

const BUILTIN_STATUS = {
  available: ['Ready to use.', 'success'],
  downloadable: ['Your browser downloads the model once (a few GB). You can keep browsing while it does.', ''],
  downloading: ['Your browser is downloading the model.', 'testing']
};

async function refreshBuiltInState() {
  const resp = await sendMsg({ action: 'getBuiltInState' });
  builtInState = resp.success ? resp.state : 'unsupported';
  if (builtInState !== 'downloadable') builtInConfirmed = false;
  else if (!builtInConfirmed && !builtInConfirmTimer) builtInConfirmTimer = setTimeout(confirmBuiltIn, BUILTIN_CONFIRM_MS);

  // Settings: the tab exists where the model can run, or while it is the saved choice
  els.providerBuiltinTab.classList.toggle('hidden', !builtInUsable() && !els.providerBuiltinRadio.checked);
  els.builtinUnavailableHint.classList.toggle('hidden', builtInState !== 'unavailable');
  const [text, kind] = BUILTIN_STATUS[builtInState] || ['This computer can\'t run the built-in model right now. Pick another provider.', 'error'];
  els.builtinStatus.textContent = text;
  els.builtinStatus.className = `connection-status ${kind}`;
  els.builtinDownload.classList.toggle('hidden', builtInState !== 'downloadable' && builtInState !== 'downloading');

  // Onboarding: it becomes the recommended choice in place of Gemini
  els.onboardingBuiltinOption.classList.toggle('hidden', !builtInUsable());
  const gemini = document.querySelector('.onboarding-provider-btn[data-provider="gemini"]');
  gemini.classList.toggle('recommended', !builtInUsable());
  gemini.querySelector('.onboarding-provider-tag').textContent = builtInUsable() ? 'Free API key' : 'Recommended \u2014 Free';
  els.onboardingBuiltinNote.textContent = builtInState === 'available'
    ? 'The model is already on this computer. Your prompts never leave it.'
    : 'Your browser downloads the model once (a few GB). After that it works offline, and your prompts never leave this computer.';
  return builtInState;
}

// Downloads the model, reporting progress as text. Must be called from a click.
async function downloadBuiltInModel(statusEl) {
  const report = (text) => {
    statusEl.textContent = text;
    statusEl.className = 'connection-status testing';
  };
  report('Starting the download...');
  const session = await LanguageModel.create({
    ...BUILTIN_SESSION_OPTIONS,
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => report(`Downloading the model... ${Math.round(e.loaded * 100)}%`));
    }
  });
  session.destroy();
}

// After a failed download: if the browser now says the model can't run here,
// drop it as the onboarding choice and say why.
async function recheckBuiltIn() {
  await refreshBuiltInState();
  if (builtInUsable() || onboardingSelectedProvider !== PROVIDERS.BUILTIN) return;
  onboardingSelectedProvider = null;
  els.onboardingBuiltinOption.classList.remove('active');
  els.onboardingBuiltinSection.classList.add('hidden');
  els.onboardingStartBtn.disabled = true;
  showToast('This computer can\'t run the built-in model. Pick another option.', 'info');
}

async function handleBuiltInDownload() {
  els.builtinDownload.disabled = true;
  try {
    await downloadBuiltInModel(els.builtinStatus);
  } catch (err) {
    showToast(`The download did not finish: ${err?.message || 'unknown error'}`, 'error');
  }
  els.builtinDownload.disabled = false;
  await refreshBuiltInState();
}

// ── Onboarding ──────────────────────────────────────────────────────────────

let onboardingSelectedProvider = null;

function needsOnboarding(settings) {
  if (settings[STORAGE_KEYS.ONBOARDING_COMPLETE]) return false;
  // Check if a provider is already configured
  const hasProvider = !!(
    settings[STORAGE_KEYS.OPENAI_API_KEY] ||
    settings[STORAGE_KEYS.GEMINI_API_KEY] ||
    settings[STORAGE_KEYS.CLAUDE_API_KEY] ||
    settings[STORAGE_KEYS.CUSTOM_ENDPOINT] ||
    settings[STORAGE_KEYS.PROVIDER] === PROVIDERS.OLLAMA ||
    settings[STORAGE_KEYS.PROVIDER] === PROVIDERS.BUILTIN
  );
  if (hasProvider) {
    // Already configured — mark complete and skip
    completeOnboarding();
    return false;
  }
  return true;
}

function completeOnboarding() {
  return sendMsg({ action: 'saveSettings', settings: { [STORAGE_KEYS.ONBOARDING_COMPLETE]: true } });
}

async function handleOnboardingStart() {
  if (!onboardingSelectedProvider) return;

  if (onboardingSelectedProvider === PROVIDERS.BUILTIN) {
    if (builtInState !== 'available') {
      els.onboardingStartBtn.disabled = true;
      try {
        await downloadBuiltInModel(els.onboardingBuiltinStatus);
      } catch {
        await recheckBuiltIn();
        if (builtInUsable()) {
          els.onboardingBuiltinStatus.textContent = 'The download did not finish. Try again, or pick another option.';
          els.onboardingBuiltinStatus.className = 'connection-status error';
          els.onboardingStartBtn.disabled = false;
        }
        return;
      }
    }
    await sendMsg({ action: 'saveSettings', settings: { [STORAGE_KEYS.PROVIDER]: PROVIDERS.BUILTIN } });
  } else if (onboardingSelectedProvider === 'ollama') {
    const settings = {
      [STORAGE_KEYS.PROVIDER]: PROVIDERS.OLLAMA,
    };
    await sendMsg({ action: 'saveSettings', settings });
  } else {
    const key = els.onboardingApiKey.value.trim();
    if (!key) {
      showToast('Please enter an API key.', 'error');
      return;
    }
    const keyMap = { openai: STORAGE_KEYS.OPENAI_API_KEY, gemini: STORAGE_KEYS.GEMINI_API_KEY, claude: STORAGE_KEYS.CLAUDE_API_KEY };
    const settings = {
      [STORAGE_KEYS.PROVIDER]: PROVIDERS.API,
      [STORAGE_KEYS.API_PROVIDER]: onboardingSelectedProvider,
      [keyMap[onboardingSelectedProvider]]: key,
    };
    await sendMsg({ action: 'saveSettings', settings });
  }

  await completeOnboarding();
  await loadSettings();
  navigateTo(els.mainPage);
  showToast('Welcome to PromptCraft!', 'success');
}

const ONBOARDING_INSTRUCTIONS = {
  gemini: {
    steps: [
      'Go to <a href="https://aistudio.google.com/app/apikey" target="_blank">Google AI Studio</a>',
      'Sign in with your Google account',
      'Click "Create API Key"',
      'Copy the key and paste it below'
    ],
    note: 'Gemini offers a generous free tier — no credit card needed.'
  },
  openai: {
    steps: [
      'Go to <a href="https://platform.openai.com/api-keys" target="_blank">OpenAI Platform</a>',
      'Sign in or create an account',
      'Click "Create new secret key"',
      'Copy the key and paste it below'
    ],
    note: 'OpenAI requires a paid account with credits.'
  },
  claude: {
    steps: [
      'Go to <a href="https://console.anthropic.com/settings/keys" target="_blank">Anthropic Console</a>',
      'Sign in or create an account',
      'Click "Create Key"',
      'Copy the key and paste it below'
    ],
    note: 'Claude requires a paid API account.'
  }
};

function selectOnboardingProvider(provider) {
  onboardingSelectedProvider = provider;

  document.querySelectorAll('.onboarding-provider-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.provider === provider);
  });

  const ollamaSection = document.getElementById('onboarding-ollama-section');
  const testStatus = document.getElementById('onboarding-test-status');
  if (testStatus) testStatus.textContent = '';

  els.onboardingBuiltinSection.classList.toggle('hidden', provider !== PROVIDERS.BUILTIN);
  els.onboardingBuiltinStatus.textContent = '';
  if (provider === PROVIDERS.BUILTIN) {
    els.onboardingKeySection.classList.add('hidden');
    if (ollamaSection) ollamaSection.classList.add('hidden');
    els.onboardingStartBtn.disabled = false;
  } else if (provider === 'ollama') {
    els.onboardingKeySection.classList.add('hidden');
    if (ollamaSection) ollamaSection.classList.remove('hidden');
    els.onboardingStartBtn.disabled = false;
  } else {
    els.onboardingKeySection.classList.remove('hidden');
    if (ollamaSection) ollamaSection.classList.add('hidden');

    const info = ONBOARDING_INSTRUCTIONS[provider];
    const instructionsEl = document.getElementById('onboarding-instructions');
    if (info && instructionsEl) {
      instructionsEl.innerHTML = `
        <p><strong>Get your ${API_PROVIDER_LABELS[provider]} key:</strong></p>
        <ol>${info.steps.map(s => `<li>${s}</li>`).join('')}</ol>
        <p class="hint">${info.note}</p>
      `;
    }

    els.onboardingStartBtn.disabled = !els.onboardingApiKey.value.trim();
  }
}

// ── Context Detection ────────────────────────────────────────────────────────

let cachedContext = null;

// The tab the side panel is sitting next to
function getPageTab(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => callback(tabs?.[0] || null));
}

// The panel stays open while the user switches tabs or navigates, so keep the
// context indicator and Insert button in step with the page beside it
function watchPageTab() {
  let timer = null;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(detectConversationContext, 250);
  };
  chrome.tabs.onActivated.addListener(refresh);
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.active) refresh();
  });
}

function detectConversationContext() {
  try {
    getPageTab((tab) => {
      if (!tab?.id) return;
      chrome.tabs.sendMessage(tab.id, { action: 'getConversation' }, (resp) => {
        const failed = !!chrome.runtime.lastError;
        // Offer "Insert" only when the page has a text box our content script can fill
        els.insertBtn.classList.toggle('hidden', failed || !resp?.hasInput);
        if (failed || !resp?.context) {
          cachedContext = null;
          if (els.contextIndicator) els.contextIndicator.textContent = '';
          if (els.viewContextBtn) els.viewContextBtn.style.display = 'none';
          return;
        }
        cachedContext = resp.context;
        if (els.contextIndicator) {
          els.contextIndicator.textContent = `${cachedContext.messageCount} messages`;
        }
        if (els.viewContextBtn) {
          els.viewContextBtn.style.display = '';
        }
      });
    });
  } catch {
    cachedContext = null;
  }
}

function showContextPreview() {
  if (!cachedContext || !cachedContext.conversation) {
    showToast('No conversation context available.', 'info');
    return;
  }
  els.contextModalContent.textContent = cachedContext.conversation;
  els.contextModal.classList.remove('hidden');
}

// ── API Provider Switching ──────────────────────────────────────────────────

const isCustomProvider = () => selectedApiProvider === API_PROVIDERS.CUSTOM;

function saveCurrentApiFieldsToState() {
  apiKeys[selectedApiProvider] = els.apiKey.value;
  if (isCustomProvider()) {
    apiModels.custom = els.customModel.value.trim();
    customEndpoint = els.customEndpoint.value.trim();
    return;
  }
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

  // A custom endpoint has a URL field and a free-text model; the others pick from a list
  const custom = isCustomProvider();
  els.customEndpointGroup.classList.toggle('hidden', !custom);
  els.customModel.classList.toggle('hidden', !custom);
  els.apiModelSelect.classList.toggle('hidden', custom);
  els.customHint.classList.toggle('hidden', !custom);
  els.apiHint.classList.toggle('hidden', custom);
  els.apiKeyLabel.textContent = custom ? 'API Key (optional)' : 'API Key';

  const models = modelLists[selectedApiProvider] || [];
  if (custom) {
    els.customEndpoint.value = customEndpoint;
    els.customModel.value = apiModels.custom || '';
    populateCustomModelList(models);
  } else {
    const currentModel = apiModels[selectedApiProvider] || (models[0] && models[0].id) || '';
    populateApiModelDropdown(models, currentModel);
  }

  // Set values
  els.apiKey.value = apiKeys[selectedApiProvider] || '';

  // Update hint
  const hint = API_HINTS[selectedApiProvider];
  if (hint && hint.url) {
    els.apiHintLink.href = hint.url;
    els.apiHintLink.textContent = hint.label;
  }

  // Reset show/hide key button
  els.apiKey.type = 'password';
  els.showKeyBtn.textContent = 'Show';

  // Clear test status
  if (els.apiKeyStatus) {
    els.apiKeyStatus.textContent = '';
    els.apiKeyStatus.className = 'connection-status';
  }
}

function populateCustomModelList(models) {
  els.customModelList.innerHTML = '';
  models.forEach((m) => {
    const option = document.createElement('option');
    option.value = m.id;
    els.customModelList.appendChild(option);
  });
}

// Replaces the model picker's contents with the provider's current model list
async function refreshApiModels() {
  const btn = els.refreshApiModels;
  const accessRequest = requestEndpointAccess(typedEndpoint());
  saveCurrentApiFieldsToState();
  const provider = selectedApiProvider;

  btn.disabled = true;
  btn.textContent = '...';
  await accessRequest;
  const resp = await sendMsg({
    action: 'listModels',
    provider: PROVIDERS.API,
    apiProvider: provider,
    apiKey: apiKeys[provider].trim(),
    endpoint: customEndpoint
  });
  btn.disabled = false;
  btn.textContent = '↻';

  if (!resp.success) {
    els.apiKeyStatus.className = 'connection-status error';
    els.apiKeyStatus.textContent = resp.error || 'Could not load models.';
    return;
  }
  const models = resp.models || [];
  if (models.length > 0) modelLists[provider] = models;
  if (provider === selectedApiProvider) updateApiProviderUI();
  els.apiKeyStatus.className = 'connection-status success';
  els.apiKeyStatus.textContent = `Loaded ${models.length} model${models.length !== 1 ? 's' : ''}.`;
}

// ── Model Pickers (listbox behaviour) ───────────────────────────────────────

function setSelectOpen(select, open) {
  select.classList.toggle('open', open);
  select.querySelector('.custom-select-trigger').setAttribute('aria-expanded', String(open));
  if (!open) return;
  const options = [...select.querySelectorAll('.custom-select-option')];
  (options.find(o => o.classList.contains('selected')) || options[0])?.focus();
}

function makeSelectOption(label, value, selected, onChoose) {
  const option = document.createElement('div');
  option.className = 'custom-select-option' + (selected ? ' selected' : '');
  option.setAttribute('role', 'option');
  option.setAttribute('aria-selected', String(selected));
  option.tabIndex = -1;
  option.dataset.value = value;
  option.textContent = label;
  option.addEventListener('click', (e) => {
    e.stopPropagation();
    onChoose();
  });
  return option;
}

function markSelectedOption(dropdown, value) {
  dropdown.querySelectorAll('.custom-select-option').forEach((opt) => {
    const selected = opt.dataset.value === value;
    opt.classList.toggle('selected', selected);
    opt.setAttribute('aria-selected', String(selected));
  });
}

// Arrow keys move through the options, Enter or Space picks one, Escape closes
function handleSelectKeydown(select, e) {
  const trigger = select.querySelector('.custom-select-trigger');
  const options = [...select.querySelectorAll('.custom-select-option')];
  const index = options.indexOf(document.activeElement);
  const isOpen = select.classList.contains('open');

  if (e.key === 'Escape' && isOpen) {
    e.preventDefault();
    setSelectOpen(select, false);
    trigger.focus();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!isOpen) {
      trigger.click();
      return;
    }
    const step = e.key === 'ArrowDown' ? 1 : -1;
    const next = index === -1 ? 0 : (index + step + options.length) % options.length;
    options[next]?.focus();
  } else if ((e.key === 'Enter' || e.key === ' ') && index !== -1) {
    e.preventDefault();
    options[index].click();
    trigger.focus();
  } else if (e.key === 'Tab' && isOpen) {
    setSelectOpen(select, false);
  }
}

function populateApiModelDropdown(models, selectedValue) {
  els.apiModelDropdown.innerHTML = '';
  // Keep a saved model selectable even when it is not in the list
  if (selectedValue && !models.some(m => m.id === selectedValue)) {
    models = [{ id: selectedValue, label: selectedValue }, ...models];
  }
  models.forEach((m) => {
    els.apiModelDropdown.appendChild(makeSelectOption(m.label, m.id, m.id === selectedValue, () => {
      setApiModel(m.id, m.label);
      closeApiModelDropdown();
    }));
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
  markSelectedOption(els.apiModelDropdown, id);
}

function toggleApiModelDropdown() {
  const isOpen = els.apiModelSelect.classList.contains('open');
  if (isOpen) {
    closeApiModelDropdown();
  } else {
    // Close Ollama dropdown if open
    closeOllamaDropdown();
    setSelectOpen(els.apiModelSelect, true);
  }
}

function closeApiModelDropdown() {
  setSelectOpen(els.apiModelSelect, false);
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
    els.ollamaModelDropdown.appendChild(makeSelectOption(name, name, name === selectedOllamaModel, () => {
      setOllamaModel(name);
      closeOllamaDropdown();
    }));
  });
}

function setOllamaModel(value) {
  selectedOllamaModel = value;
  els.ollamaModelValue.textContent = value || 'Select a model...';
  els.ollamaModelSelect.dataset.value = value;
  markSelectedOption(els.ollamaModelDropdown, value);
}

function toggleOllamaDropdown() {
  const isOpen = els.ollamaModelSelect.classList.contains('open');
  if (isOpen) {
    closeOllamaDropdown();
  } else {
    closeApiModelDropdown();
    setSelectOpen(els.ollamaModelSelect, true);
  }
}

function closeOllamaDropdown() {
  setSelectOpen(els.ollamaModelSelect, false);
}

// ── Test API Key ────────────────────────────────────────────────────────────

async function testApiKey() {
  const btn = els.testApiKeyBtn;
  const accessRequest = requestEndpointAccess(typedEndpoint());
  btn.disabled = true;
  btn.textContent = '...';
  els.apiKeyStatus.textContent = '';
  els.apiKeyStatus.className = 'connection-status';

  saveCurrentApiFieldsToState();
  const key = apiKeys[selectedApiProvider].trim();
  if (!key && !isCustomProvider()) {
    els.apiKeyStatus.className = 'connection-status error';
    els.apiKeyStatus.textContent = 'Please enter an API key first.';
    btn.disabled = false;
    btn.textContent = 'Test';
    return;
  }

  await accessRequest;
  const resp = await sendMsg({
    action: 'testConnection',
    provider: PROVIDERS.API,
    apiProvider: selectedApiProvider,
    apiKey: key,
    endpoint: customEndpoint
  });

  btn.disabled = false;
  btn.textContent = 'Test';

  if (resp.success) {
    els.apiKeyStatus.className = 'connection-status success';
    els.apiKeyStatus.textContent = isCustomProvider() ? 'Connected! Endpoint is reachable.' : 'Valid! Connection successful.';
  } else {
    els.apiKeyStatus.className = 'connection-status error';
    els.apiKeyStatus.textContent = resp.error || 'Connection failed';
  }
}

// ── Save Settings ───────────────────────────────────────────────────────────

function clearValidationErrors() {
  document.querySelectorAll('.validation-error').forEach(el => el.remove());
}

function showValidationError(fieldId, message) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  const container = field.closest('.input-group') || field.parentElement;
  const err = document.createElement('div');
  err.className = 'validation-error';
  err.textContent = message;
  container.appendChild(err);
}

function validateSettings() {
  clearValidationErrors();
  const provider = selectedProvider();

  if (provider === PROVIDERS.BUILTIN) {
    if (builtInState !== 'available') {
      showToast('Download the built-in model first.', 'error');
      return false;
    }
  } else if (provider === PROVIDERS.OLLAMA) {
    const endpoint = els.ollamaEndpoint.value.trim();
    if (endpoint && !endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
      showValidationError('ollama-endpoint', 'Endpoint must start with http:// or https://');
      return false;
    }
  } else if (isCustomProvider()) {
    saveCurrentApiFieldsToState();
    if (!/^https?:\/\/.+/.test(customEndpoint)) {
      showValidationError('custom-endpoint', 'Enter the API base URL, starting with http:// or https://');
      return false;
    }
    if (!apiModels.custom) {
      showValidationError('custom-model', 'Enter the model name to use.');
      return false;
    }
  } else {
    saveCurrentApiFieldsToState();
    const key = apiKeys[selectedApiProvider].trim();
    if (!key) {
      showValidationError('api-key', `${API_PROVIDER_LABELS[selectedApiProvider]} API key is required.`);
      return false;
    }
  }
  return true;
}

// Custom and non-default Ollama endpoints aren't in the manifest's host list.
// Ask for access to just that origin so requests aren't blocked by CORS.
// Must run inside the click handler, before any await, to count as a user gesture.
function requestEndpointAccess(url) {
  try {
    const { origin, protocol, hostname, port } = new URL(url);
    // Ollama's default address is already granted in the manifest
    const builtIn = protocol === 'http:' && ['localhost', '127.0.0.1'].includes(hostname) && port === '11434';
    if (builtIn || !chrome.permissions) return Promise.resolve(true);
    // Never let an unanswered prompt hang the caller
    const answer = chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
    return Promise.race([answer, new Promise(resolve => setTimeout(() => resolve(false), 30000))]);
  } catch {
    return Promise.resolve(true);
  }
}

// The endpoint currently typed into Settings that needs its own host access, if any
function typedEndpoint() {
  const provider = selectedProvider();
  if (provider === PROVIDERS.OLLAMA) return els.ollamaEndpoint.value.trim();
  return provider === PROVIDERS.API && isCustomProvider() ? els.customEndpoint.value.trim() : '';
}

async function handleSaveSettings() {
  // Validate before saving
  if (!validateSettings()) return;

  // Saving doesn't depend on the answer, so the prompt is not awaited
  requestEndpointAccess(typedEndpoint());

  // Save current API field values to state before building settings object
  saveCurrentApiFieldsToState();

  const settings = {
    [STORAGE_KEYS.PROVIDER]: selectedProvider(),
    [STORAGE_KEYS.API_PROVIDER]: selectedApiProvider,
    [STORAGE_KEYS.OPENAI_API_KEY]: apiKeys.openai.trim(),
    [STORAGE_KEYS.OPENAI_MODEL]: apiModels.openai,
    [STORAGE_KEYS.GEMINI_API_KEY]: apiKeys.gemini.trim(),
    [STORAGE_KEYS.GEMINI_MODEL]: apiModels.gemini,
    [STORAGE_KEYS.CLAUDE_API_KEY]: apiKeys.claude.trim(),
    [STORAGE_KEYS.CLAUDE_MODEL]: apiModels.claude,
    [STORAGE_KEYS.CUSTOM_API_KEY]: apiKeys.custom.trim(),
    [STORAGE_KEYS.CUSTOM_MODEL]: apiModels.custom,
    [STORAGE_KEYS.CUSTOM_ENDPOINT]: customEndpoint,
    [STORAGE_KEYS.OLLAMA_ENDPOINT]: els.ollamaEndpoint.value.trim() || DEFAULT_SETTINGS[STORAGE_KEYS.OLLAMA_ENDPOINT],
    [STORAGE_KEYS.OLLAMA_MODEL]: selectedOllamaModel || DEFAULT_SETTINGS[STORAGE_KEYS.OLLAMA_MODEL],
    [STORAGE_KEYS.DEEP_ANALYSIS]: els.deepAnalysisToggle ? els.deepAnalysisToggle.checked : false,
    [STORAGE_KEYS.MULTI_STEP]: els.multiStepToggle.checked,
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

// The enhancement in flight: a port to the background worker that streams the
// rewrite back. Disconnecting it cancels the request.
let enhancePort = null;

const STAGE_LABELS = {
  analyzing: 'Reading your draft...',
  generating: 'Writing...',
  structuring: 'Structuring...',
  polishing: 'Polishing...'
};

function setEnhanceButton(label, busy) {
  const btnText = els.rewriteBtn.querySelector('.btn-text');
  if (btnText) btnText.textContent = label;
  els.rewriteBtn.classList.toggle('loading', busy);
  els.rewriteBtn.title = busy ? 'Click to stop' : '';
}

// The result box can sit below the fold in a short panel — bring it into view.
// It grows with a CSS transition, so scroll again once that has finished.
function revealOutput() {
  const scroll = () => els.outputContainer.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  scroll();
  setTimeout(scroll, 450);
}

function finishEnhance() {
  if (enhancePort) {
    try { enhancePort.disconnect(); } catch {}
    enhancePort = null;
  }
  els.outputContainer.classList.remove('waiting');
  els.output.setAttribute('aria-busy', 'false');
  setEnhanceButton('Improve prompt', false);
}

// options.focus: fix one issue from the review instead of rewriting the whole prompt
function handleEnhance(options = {}) {
  // A second click while a request is running stops it
  if (enhancePort) {
    if (options.focus) return;
    finishEnhance();
    showToast('Stopped.', 'info');
    return;
  }

  const input = els.input.value.trim();
  if (!input) {
    showToast('Please enter a prompt first.', 'error');
    return;
  }

  // Show output container with pulsing glow while waiting
  els.output.textContent = '';
  els.output.setAttribute('aria-busy', 'true');
  els.scoreBadge.classList.add('hidden');
  els.outputContainer.classList.remove('visible');
  els.outputContainer.classList.add('waiting');
  setEnhanceButton(STAGE_LABELS.analyzing, true);

  const port = chrome.runtime.connect({ name: 'enhance' });
  enhancePort = port;

  port.onMessage.addListener((msg) => {
    if (port !== enhancePort) return;
    if (msg.type === 'stage') {
      setEnhanceButton(STAGE_LABELS[msg.stage] || STAGE_LABELS.generating, true);
    } else if (msg.type === 'delta') {
      if (!els.output.textContent) {
        els.outputContainer.classList.remove('waiting');
        els.outputContainer.classList.add('visible');
        revealOutput();
      }
      els.output.textContent += msg.text;
      els.output.scrollTop = els.output.scrollHeight;
    } else if (msg.type === 'done') {
      finishEnhance();
      showEnhanceResult(msg);
    } else if (msg.type === 'error') {
      finishEnhance();
      if (!els.output.textContent) els.outputContainer.classList.remove('visible');
      showToast(msg.error || 'The rewrite failed.', 'error');
    }
  });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    if (port !== enhancePort) return;
    finishEnhance();
    showToast('Lost the connection to PromptCraft. Try again.', 'error');
  });

  const includeContext = els.includeContext ? els.includeContext.checked : false;
  getPageTab((tab) => {
    if (port !== enhancePort) return;
    port.postMessage({ type: 'start', prompt: input, modifier: selectedModifier, includeContext, focus: options.focus || null, tabId: tab?.id });
  });
}

function showEnhanceResult(result) {
  els.outputContainer.classList.add('visible');
  els.output.textContent = result.text;
  els.output.scrollTop = 0;
  revealOutput();

  const pre = result.preScore?.overall;
  const post = result.postScore?.overall;
  if (typeof pre === 'number' && typeof post === 'number') {
    els.scoreBadge.textContent = `${pre} → ${post}`;
    els.scoreBadge.classList.remove('hidden');
  }
  if (result.truncated) showToast('The model hit its length limit, so the end may be cut off.', 'info');
  loadUsageIndicator();
}

// ── Insert into page ─────────────────────────────────────────────────────────
// Puts the enhanced prompt into the text box of the page the popup was opened on.

function handleInsert() {
  const text = els.output.textContent;
  if (!text) return;
  getPageTab((tab) => {
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { action: 'insertText', text }, (resp) => {
      if (chrome.runtime.lastError || !resp?.ok) {
        showToast('Could not find a text box on the page. Use Copy instead.', 'error');
        return;
      }
      showToast('Inserted into the page.', 'success');
    });
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
    els.historyList.innerHTML = `<div class="history-empty">${searchVal ? 'No matching entries.' : 'No history yet. Improve a prompt and it shows up here.'}</div>`;
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
  row.setAttribute('aria-expanded', 'false');
  makeButtonLike(row, () => {
    row.setAttribute('aria-expanded', String(card.classList.toggle('expanded')));
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
    draftChanged();
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

function handleExportHistory() {
  if (historyData.length === 0) {
    showToast('No history to export.', 'info');
    return;
  }
  const json = JSON.stringify(historyData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `promptcraft-history-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('History exported!', 'success');
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
    chip.setAttribute('aria-pressed', String(selectedModifier === key));
    chip.textContent = STYLE_LABELS[key];
    chip.dataset.value = key;
    chip.addEventListener('click', () => selectModifier(key));
    els.styleChips.appendChild(chip);
  });

  // Custom presets
  customPresets.forEach((preset) => {
    const chip = document.createElement('button');
    chip.className = 'style-chip custom' + (selectedModifier === preset.id ? ' active' : '');
    chip.setAttribute('aria-pressed', String(selectedModifier === preset.id));
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
    chip.setAttribute('aria-pressed', String(chip.dataset.value === value));
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

// ── Prompt Review ───────────────────────────────────────────────────────────
// Scores the draft as it is typed and lists its weakest spots, each with a
// one-click fix. The scoring is local heuristics in the background worker;
// nothing is sent to a model until the user asks for a rewrite.

let reviewTimer = null;

function scheduleReview(delay = 300) {
  clearTimeout(reviewTimer);
  reviewTimer = setTimeout(async () => {
    const text = els.input.value.trim();
    const resp = text ? await sendMsg({ action: 'analyzeDraft', text }) : { success: true, score: null, issues: [] };
    // Ignore a reply the draft has already moved on from
    if (resp.success && els.input.value.trim() === text) renderReview(resp.score, resp.issues || [], !!text);
  }, delay);
}

function renderReview(score, issues, hasText) {
  const known = typeof score === 'number';
  els.reviewRing.classList.toggle('none', !known);
  els.reviewRing.classList.toggle('low', known && score < 50);
  els.reviewRing.querySelector('.score-ring-value').setAttribute('stroke-dasharray', `${known ? score : 0} 100`);
  els.reviewRing.querySelector('b').textContent = known ? String(score) : '\u2013';
  els.reviewSummary.textContent = !hasText ? 'Start typing and the weak spots show up here'
    : issues.length === 0 ? 'No obvious gaps'
    : issues.length === 1 ? '1 thing to improve'
    : `${issues.length} things to improve`;

  els.reviewIssues.replaceChildren(...issues.map((issue) => {
    const row = document.createElement('div');
    row.className = 'issue';
    const text = document.createElement('div');
    text.className = 'issue-text';
    const title = document.createElement('b');
    title.textContent = issue.title;
    const detail = document.createElement('span');
    detail.textContent = issue.detail;
    text.append(title, detail);
    const fix = document.createElement('button');
    fix.type = 'button';
    fix.className = 'fix-btn';
    fix.textContent = 'Fix';
    fix.setAttribute('aria-label', `Fix: ${issue.title}`);
    fix.addEventListener('click', () => handleEnhance({ focus: issue.id }));
    row.append(text, fix);
    return row;
  }));
}

// ── Draft ───────────────────────────────────────────────────────────────────

// Called whenever the prompt box changes: typing, Clear, or a template or history entry loaded into it
function draftChanged() {
  els.charCount.textContent = `${els.input.value.length} chars`;
  scheduleReview();
}

function handleClear() {
  els.input.value = '';
  draftChanged();
  els.outputContainer.classList.remove('visible');
  els.input.focus();
}

// ── Auto-resize textarea ────────────────────────────────────────────────────

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.max(80, Math.min(el.scrollHeight, 250)) + 'px';
}

// ── Dark Mode ────────────────────────────────────────────────────────────────

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(pref) {
  if (pref === 'dark' || pref === 'light') return pref;
  return getSystemTheme();
}

function applyTheme(theme) {
  const resolved = resolveTheme(theme);
  document.documentElement.setAttribute('data-theme', resolved);
  if (els.themeIconSun && els.themeIconMoon) {
    els.themeIconSun.style.display = resolved === 'dark' ? '' : 'none';
    els.themeIconMoon.style.display = resolved === 'dark' ? 'none' : '';
  }
}

// 'auto' | 'light' | 'dark' — loaded with the rest of the settings
let themePreference = 'auto';

function cycleTheme() {
  // Toggle: if currently showing light -> switch to dark, and vice-versa
  // If on auto, go to the opposite of what auto resolved to
  themePreference = resolveTheme(themePreference) === 'light' ? 'dark' : 'light';
  applyTheme(themePreference);
  sendMsg({ action: 'saveSettings', settings: { [STORAGE_KEYS.DARK_MODE]: themePreference } });
}

// ── Usage Analytics ──────────────────────────────────────────────────────────

let cachedProvider = null;

function formatTokenCount(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function formatTimePeriod(sinceTimestamp) {
  const diff = Date.now() - sinceTimestamp;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'since yesterday';
  if (days < 7) return `last ${days} days`;
  if (days < 30) return `last ${Math.floor(days / 7)} weeks`;
  if (days < 365) return `last ${Math.floor(days / 30)} months`;
  return `last ${Math.floor(days / 365)}+ years`;
}

async function loadUsageIndicator() {
  const resp = await sendMsg({ action: 'getUsageStats' });
  if (!resp.success) return;
  const stats = resp.stats;
  if (els.usageIndicatorText) {
    const count = stats.totalEnhancements || 0;
    els.usageIndicatorText.textContent = `${count} rewrite${count !== 1 ? 's' : ''}`;
  }
}

async function loadUsagePage() {
  // Fetch settings to know provider
  const settingsResp = await sendMsg({ action: 'getSettings' });
  if (settingsResp.success) {
    cachedProvider = settingsResp.settings[STORAGE_KEYS.PROVIDER];
  }
  const isLocal = cachedProvider === PROVIDERS.OLLAMA || cachedProvider === PROVIDERS.BUILTIN;

  // Fetch usage stats
  const usageResp = await sendMsg({ action: 'getUsageStats' });
  if (!usageResp.success) return;
  const stats = usageResp.stats;

  // Top stat cards
  els.usageTotalEnhancements.textContent = stats.totalEnhancements || 0;

  if (isLocal && stats.totalCostUSD === 0) {
    els.usageTotalCost.textContent = 'Free';
    els.usageTotalCost.title = 'The model runs on this computer';
  } else {
    els.usageTotalCost.textContent = '$' + (stats.totalCostUSD || 0).toFixed(4);
    els.usageTotalCost.title = 'Estimated cost based on token usage';
  }

  const totalTokens = (stats.totalInputTokens || 0) + (stats.totalOutputTokens || 0);
  els.usageTotalTokens.textContent = formatTokenCount(totalTokens);
  els.usageTotalTokens.title = `Input: ${formatTokenCount(stats.totalInputTokens || 0)} / Output: ${formatTokenCount(stats.totalOutputTokens || 0)}`;

  // Period
  if (els.usagePeriod && stats.since) {
    els.usagePeriod.textContent = formatTimePeriod(stats.since);
  }

  // Model breakdown
  renderModelBreakdown(stats.byModel || {});

  // Prompt scoring stats from history
  await loadScoringStats();
}

function renderModelBreakdown(byModel) {
  const list = els.usageModelList;
  const entries = Object.entries(byModel).sort((a, b) => b[1].enhancements - a[1].enhancements);

  if (entries.length === 0) {
    list.innerHTML = '<div class="usage-empty">No usage data yet.</div>';
    return;
  }

  list.innerHTML = '';
  entries.forEach(([model, data], idx) => {
    const row = document.createElement('div');
    row.className = 'usage-model-row';
    row.style.animationDelay = `${idx * 0.05}s`;

    const tokens = (data.inputTokens || 0) + (data.outputTokens || 0);
    // Local models are free; models with no price on file show a dash rather than a made-up $0
    let costText = '—';
    if (data.provider === PROVIDERS.OLLAMA || data.provider === PROVIDERS.BUILTIN) costText = 'Free';
    else if (TOKEN_COSTS[model] || data.costUSD > 0) costText = '$' + (data.costUSD || 0).toFixed(4);

    const friendlyName = modelLabel(model);

    row.innerHTML = `
      <span class="usage-model-name" title="${escapeHtml(model)}">${escapeHtml(friendlyName)}</span>
      <span class="usage-model-stat count">${data.enhancements}x</span>
      <span class="usage-model-stat tokens">${formatTokenCount(tokens)}</span>
      <span class="usage-model-stat cost">${costText}</span>
    `;
    list.appendChild(row);
  });
}

async function loadScoringStats() {
  const resp = await sendMsg({ action: 'getHistory' });
  if (!resp.success) return;
  const history = resp.history || [];

  let preTotal = 0, postTotal = 0, count = 0;
  history.forEach(entry => {
    if (entry.preScore && typeof entry.preScore.overall === 'number' &&
        entry.postScore && typeof entry.postScore.overall === 'number') {
      preTotal += entry.preScore.overall;
      postTotal += entry.postScore.overall;
      count++;
    }
  });

  if (count > 0) {
    const avgPre = Math.round(preTotal / count);
    const avgPost = Math.round(postTotal / count);
    const avgImprovement = avgPost - avgPre;
    els.usageAvgPre.textContent = avgPre;
    els.usageAvgPost.textContent = avgPost;
    els.usageAvgImprovement.textContent = (avgImprovement >= 0 ? '+' : '') + avgImprovement;
  } else {
    els.usageAvgPre.textContent = '--';
    els.usageAvgPost.textContent = '--';
    els.usageAvgImprovement.textContent = '--';
  }
}

let resetConfirmTimeout = null;

function handleResetUsage() {
  const btn = els.resetUsageBtn;
  if (btn.classList.contains('confirming')) {
    // Second click — do the reset
    clearTimeout(resetConfirmTimeout);
    btn.classList.remove('confirming');
    btn.textContent = 'Reset Stats';

    sendMsg({ action: 'resetUsageStats' }).then(() => {
      showToast('Usage stats reset.', 'info');
      loadUsagePage();
      loadUsageIndicator();
    });
  } else {
    // First click — ask for confirmation
    btn.classList.add('confirming');
    btn.textContent = 'Click again to confirm reset';
    resetConfirmTimeout = setTimeout(() => {
      btn.classList.remove('confirming');
      btn.textContent = 'Reset Stats';
    }, 3000);
  }
}

// ── Templates ───────────────────────────────────────────────────────────────

let activeTemplateCategory = 'all';
let activeTemplate = null;

function renderTemplateCategoryTabs() {
  if (!els.templateCategoryTabs) return;
  els.templateCategoryTabs.innerHTML = '';
  TEMPLATE_CATEGORIES.forEach((cat) => {
    const tab = document.createElement('button');
    tab.className = 'template-category-tab' + (activeTemplateCategory === cat.id ? ' active' : '');
    tab.textContent = cat.label;
    tab.dataset.category = cat.id;
    tab.addEventListener('click', () => {
      activeTemplateCategory = cat.id;
      renderTemplateCategoryTabs();
      renderTemplateGrid();
    });
    els.templateCategoryTabs.appendChild(tab);
  });
}

function renderTemplateGrid() {
  if (!els.templateGrid) return;
  els.templateGrid.innerHTML = '';

  const filtered = activeTemplateCategory === 'all'
    ? PROMPT_TEMPLATES
    : PROMPT_TEMPLATES.filter(t => t.category === activeTemplateCategory);

  if (filtered.length === 0) {
    els.templateGrid.innerHTML = '<div class="template-grid-empty">No templates in this category.</div>';
    return;
  }

  filtered.forEach((tpl, idx) => {
    const card = document.createElement('div');
    card.className = 'template-card';
    card.style.animationDelay = `${idx * 0.04}s`;
    card.innerHTML = `
      <span class="template-card-icon">${TEMPLATE_ICONS[tpl.icon] || tpl.icon}</span>
      <span class="template-card-name">${escapeHtml(tpl.name)}</span>
      <span class="template-card-desc">${escapeHtml(tpl.description)}</span>
    `;
    makeButtonLike(card, () => openTemplateDetail(tpl));
    els.templateGrid.appendChild(card);
  });
}

function openTemplateDetail(tpl) {
  activeTemplate = tpl;
  els.templateDetailIcon.innerHTML = TEMPLATE_ICONS[tpl.icon] || tpl.icon;
  els.templateDetailName.textContent = tpl.name;
  els.templateDetailDesc.textContent = tpl.description;

  // Build variable fields
  els.templateVariables.innerHTML = '';
  const namedVars = tpl.variables || [];
  namedVars.forEach((varName) => {
    const field = document.createElement('div');
    field.className = 'template-variable-field';
    const label = document.createElement('label');
    label.textContent = varName.replace(/([A-Z])/g, ' $1').trim();
    label.setAttribute('for', 'tpl-var-' + varName);
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'tpl-var-' + varName;
    input.dataset.variable = varName;
    input.placeholder = 'Enter ' + varName.replace(/([A-Z])/g, ' $1').toLowerCase().trim() + '...';
    input.addEventListener('input', updateTemplatePreview);
    field.appendChild(label);
    field.appendChild(input);
    els.templateVariables.appendChild(field);
  });

  // Show/hide the main input area based on whether template uses {{input}}
  const needsInput = tpl.template.includes('{{input}}');
  els.templateInputGroup.classList.toggle('hidden', !needsInput);
  els.templateInputArea.value = '';

  // Attach input listener for preview updates
  els.templateInputArea.removeEventListener('input', updateTemplatePreview);
  els.templateInputArea.addEventListener('input', updateTemplatePreview);

  updateTemplatePreview();

  // Render tone chips in template detail
  const defaultTones = { coding: 'technical', writing: 'detailed', research: 'cot', creative: 'creative' };
  const templateTone = defaultTones[tpl.category] || 'short';
  els.templateToneChips.innerHTML = '';
  Object.entries(STYLE_LABELS).forEach(([key, label]) => {
    const chip = document.createElement('button');
    chip.className = 'style-chip' + (key === templateTone ? ' active' : '');
    chip.textContent = label;
    chip.dataset.modifier = key;
    chip.addEventListener('click', () => {
      els.templateToneChips.querySelectorAll('.style-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
    els.templateToneChips.appendChild(chip);
  });

  // Show detail, hide grid
  els.templateDetail.classList.remove('hidden');
  els.templateGrid.style.display = 'none';
  els.templateCategoryTabs.style.display = 'none';
}

function closeTemplateDetail() {
  els.templateDetail.classList.add('hidden');
  els.templateGrid.style.display = '';
  els.templateCategoryTabs.style.display = '';
  activeTemplate = null;
}

function updateTemplatePreview() {
  if (!activeTemplate) return;
  let text = activeTemplate.template;

  // Replace named variables
  const varFields = els.templateVariables.querySelectorAll('input[data-variable]');
  varFields.forEach((field) => {
    const varName = field.dataset.variable;
    const value = field.value.trim();
    const pattern = new RegExp('\\{\\{' + varName + '\\}\\}', 'g');
    if (value) {
      text = text.replace(pattern, value);
    }
  });

  // Replace {{input}} with content area value
  const inputVal = els.templateInputArea.value.trim();
  if (inputVal) {
    text = text.replace(/\{\{input\}\}/g, inputVal);
  }

  // Build highlighted HTML for preview
  // Highlight filled variables and mark unfilled ones
  let html = escapeHtml(text);
  // Mark remaining unfilled {{...}} placeholders
  html = html.replace(/\{\{(\w+)\}\}/g, '<span class="tpl-unfilled">{{$1}}</span>');

  els.templatePreviewText.innerHTML = html;
}

function handleUseTemplate() {
  if (!activeTemplate) return;
  let text = activeTemplate.template;

  // Replace named variables
  const varFields = els.templateVariables.querySelectorAll('input[data-variable]');
  let allFilled = true;
  varFields.forEach((field) => {
    const varName = field.dataset.variable;
    const value = field.value.trim();
    const pattern = new RegExp('\\{\\{' + varName + '\\}\\}', 'g');
    if (value) {
      text = text.replace(pattern, value);
    } else {
      allFilled = false;
    }
  });

  // Replace {{input}}
  const inputVal = els.templateInputArea.value.trim();
  const needsInput = activeTemplate.template.includes('{{input}}');
  if (needsInput && inputVal) {
    text = text.replace(/\{\{input\}\}/g, inputVal);
  } else if (needsInput && !inputVal) {
    allFilled = false;
  }

  if (!allFilled) {
    // Check which fields still have unfilled placeholders
    const remaining = text.match(/\{\{(\w+)\}\}/g);
    if (remaining && remaining.length > 0) {
      showToast('Please fill in all fields before using the template.', 'error');
      return;
    }
  }

  // Set the selected tone from the template detail view
  const activeToneChip = els.templateToneChips.querySelector('.style-chip.active');
  if (activeToneChip) {
    selectedModifier = activeToneChip.dataset.modifier;
    renderStyleChips();
  }

  // Insert into main page textarea
  els.input.value = text;
  draftChanged();
  autoResize(els.input);

  // Navigate back to main page
  closeTemplateDetail();
  navigateTo(els.mainPage);
  showToast('Template loaded.', 'success');
}

function openTemplatesPage() {
  closeTemplateDetail();
  renderTemplateCategoryTabs();
  renderTemplateGrid();
  navigateTo(els.templatesPage);
}

// ── Init ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initDomRefs();
  watchPageTab();
  applyTheme(themePreference);
  loadSettings();
  loadUsageIndicator();

  // Dark mode toggle
  els.themeToggleBtn.addEventListener('click', cycleTheme);

  // Listen for system theme changes when preference is 'auto'
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (themePreference === 'auto') applyTheme('auto');
  });

  // Navigation
  els.navWrite.addEventListener('click', () => navigateTo(els.mainPage));
  els.templatesBtn.addEventListener('click', openTemplatesPage);
  els.historyBtn.addEventListener('click', () => { loadHistory(); navigateTo(els.historyPage); });
  els.settingsBtn.addEventListener('click', () => {
    navigateTo(els.settingsPage);
    refreshBuiltInState();
  });

  // Templates
  els.backFromTemplateDetail.addEventListener('click', closeTemplateDetail);
  els.useTemplateBtn.addEventListener('click', handleUseTemplate);

  // Usage page, reached from Settings
  els.usageBtn.addEventListener('click', () => { loadUsagePage(); navigateTo(els.usagePage); });
  els.backFromUsage.addEventListener('click', () => navigateTo(els.settingsPage));
  els.resetUsageBtn.addEventListener('click', handleResetUsage);

  // Provider status pill — click to go to settings
  els.providerStatus.addEventListener('click', () => navigateTo(els.settingsPage));
  els.providerStatus.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    navigateTo(els.settingsPage);
  });

  // Provider tabs
  els.providerApiTab.addEventListener('click', () => {
    els.providerApiRadio.checked = true;
    updateProviderTabs();
  });
  els.providerOllamaTab.addEventListener('click', () => {
    els.providerOllamaRadio.checked = true;
    updateProviderTabs();
  });
  els.providerBuiltinTab.addEventListener('click', () => {
    els.providerBuiltinRadio.checked = true;
    updateProviderTabs();
    refreshBuiltInState();
  });
  els.builtinDownload.addEventListener('click', handleBuiltInDownload);
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
  els.apiModelSelect.addEventListener('keydown', (e) => handleSelectKeydown(els.apiModelSelect, e));

  // Ollama model custom dropdown
  els.ollamaModelTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleOllamaDropdown();
  });
  els.ollamaModelSelect.addEventListener('click', (e) => e.stopPropagation());
  els.ollamaModelSelect.addEventListener('keydown', (e) => handleSelectKeydown(els.ollamaModelSelect, e));

  // Close all custom dropdowns on outside click
  document.addEventListener('click', () => {
    closeApiModelDropdown();
    closeOllamaDropdown();
  });

  // Test API key
  els.testApiKeyBtn.addEventListener('click', testApiKey);
  els.refreshApiModels.addEventListener('click', refreshApiModels);

  // Ollama model refresh
  els.refreshOllamaModels.addEventListener('click', loadOllamaModels);

  // Settings
  els.saveSettingsBtn.addEventListener('click', handleSaveSettings);

  // Presets
  els.addPresetBtn.addEventListener('click', handleAddPreset);
  els.presetSave.addEventListener('click', handleSavePreset);
  els.presetCancel.addEventListener('click', hidePresetForm);

  // Enhance
  els.rewriteBtn.addEventListener('click', () => handleEnhance());

  // Ctrl+Enter shortcut
  els.input.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleEnhance();
    }
  });

  // Copy / insert
  els.copyBtn.addEventListener('click', handleCopy);
  els.insertBtn.addEventListener('click', handleInsert);

  // Char count & auto-resize
  els.input.addEventListener('input', () => {
    draftChanged();
    autoResize(els.input);
  });

  // Clear
  els.clearBtn.addEventListener('click', handleClear);

  // History
  els.exportHistoryBtn.addEventListener('click', handleExportHistory);
  els.clearHistoryBtn.addEventListener('click', handleClearHistory);
  els.historySearch.addEventListener('input', (e) => filterHistory(e.target.value.trim()));

  // Context preview
  els.viewContextBtn.addEventListener('click', showContextPreview);
  els.closeContextModal.addEventListener('click', () => els.contextModal.classList.add('hidden'));

  // Onboarding
  document.querySelectorAll('.onboarding-provider-btn').forEach(btn => {
    btn.addEventListener('click', () => selectOnboardingProvider(btn.dataset.provider));
  });
  els.onboardingApiKey.addEventListener('input', () => {
    els.onboardingStartBtn.disabled = !els.onboardingApiKey.value.trim();
  });
  els.onboardingStartBtn.addEventListener('click', handleOnboardingStart);
  els.onboardingSkipBtn.addEventListener('click', () => {
    completeOnboarding();
    navigateTo(els.mainPage);
    showToast('You can set up a provider anytime in Settings.', 'info');
  });

  // Onboarding test button
  if (els.onboardingTestBtn) {
    els.onboardingTestBtn.addEventListener('click', async () => {
      if (!onboardingSelectedProvider || onboardingSelectedProvider === 'ollama') return;
      const key = els.onboardingApiKey.value.trim();
      if (!key) { showToast('Enter an API key first.', 'error'); return; }
      const statusEl = els.onboardingTestStatus;
      if (statusEl) { statusEl.textContent = 'Testing...'; statusEl.className = 'connection-status testing'; }
      const resp = await sendMsg({ action: 'testConnection', provider: PROVIDERS.API, apiProvider: onboardingSelectedProvider, apiKey: key });
      if (resp.success) {
        if (statusEl) { statusEl.textContent = 'Connected!'; statusEl.className = 'connection-status success'; }
        els.onboardingStartBtn.disabled = false;
      } else {
        if (statusEl) { statusEl.textContent = resp.error || 'Connection failed.'; statusEl.className = 'connection-status error'; }
      }
    });
  }

  // Init char count
  draftChanged();
});
