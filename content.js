// PromptCraft v2.0 — Content Script
// Injects floating enhance button on AI chat sites + extracts conversation context

(function () {
  const BUTTON_ID = 'promptcraft-button';
  const PANEL_ID = 'promptcraft-hover-panel';
  let observer = null;
  let isProcessing = false;
  let cachedSettings = null;

  // Typewriter cancellation
  let typewriterAbort = null;

  // Undo state — stores original text per element
  let undoState = null;

  // ── Fetch Settings ──────────────────────────────────────────────────────

  function fetchSettings() {
    try {
      chrome.runtime.sendMessage({ action: 'getSettings' }, (resp) => {
        if (chrome.runtime.lastError) return;
        if (resp && resp.success) {
          cachedSettings = resp.settings;
          updatePanelInfo();
        }
      });
    } catch {}
  }

  function getProviderLabel() {
    if (!cachedSettings) return { provider: '...', model: '...' };
    const isOllama = cachedSettings.provider === 'ollama';
    if (isOllama) {
      return {
        provider: 'Ollama',
        model: cachedSettings.ollamaModel || 'llama3'
      };
    }
    const ap = cachedSettings.apiProvider || 'gemini';
    const names = { openai: 'OpenAI', gemini: 'Gemini', claude: 'Claude' };
    const modelKeys = {
      openai: 'openaiModel',
      gemini: 'geminiModel',
      claude: 'claudeModel'
    };
    return {
      provider: names[ap] || ap,
      model: cachedSettings[modelKeys[ap]] || ''
    };
  }

  function getModifierLabel() {
    if (!cachedSettings) return 'Concise';
    const mod = cachedSettings.lastModifier || 'short';
    const labels = {
      short: 'Concise',
      detailed: 'Detailed',
      creative: 'Creative',
      technical: 'Technical',
      cot: 'Reasoning'
    };
    return labels[mod] || mod;
  }

  // ── Conversation Extraction ───────────────────────────────────────────────

  function detectPlatform() {
    const host = window.location.hostname;
    if (host.includes('chatgpt.com')) return 'ChatGPT';
    if (host.includes('claude.ai')) return 'Claude';
    if (host.includes('gemini.google.com')) return 'Gemini';
    if (host.includes('deepseek.com')) return 'DeepSeek';
    if (host.includes('perplexity.ai')) return 'Perplexity';
    if (host.includes('grok.com') || host.includes('x.com')) return 'Grok';
    if (host.includes('huggingface.co')) return 'HuggingFace';
    if (host.includes('openrouter.ai')) return 'OpenRouter';
    return null;
  }

  function extractChatGPTMessages() {
    const messages = [];
    const els = document.querySelectorAll('[data-message-author-role]');
    els.forEach(el => {
      const role = el.getAttribute('data-message-author-role');
      if (role !== 'user' && role !== 'assistant') return;
      const contentEl = el.querySelector('.whitespace-pre-wrap') || el.querySelector('.markdown') || el;
      const text = (contentEl.innerText || '').trim();
      if (text) messages.push({ role, text });
    });
    return messages;
  }

  function extractClaudeMessages() {
    const messages = [];
    const turns = document.querySelectorAll('[data-testid$="-turn"]');
    if (turns.length > 0) {
      turns.forEach(turn => {
        const testId = (turn.getAttribute('data-testid') || '').toLowerCase();
        const role = testId.includes('human') || testId.includes('user') ? 'user' : 'assistant';
        const text = (turn.innerText || '').trim();
        if (text) messages.push({ role, text });
      });
      return messages;
    }
    document.querySelectorAll('.font-claude-message, .font-user-message, [class*="UserMessage"], [class*="AssistantMessage"]').forEach(el => {
      const cls = (el.className || '').toLowerCase();
      const role = cls.includes('user') || cls.includes('human') ? 'user' : 'assistant';
      const text = (el.innerText || '').trim();
      if (text) messages.push({ role, text });
    });
    return messages;
  }

  function extractGeminiMessages() {
    const messages = [];
    const els = document.querySelectorAll('user-query, model-response');
    if (els.length > 0) {
      els.forEach(el => {
        const role = el.tagName.toLowerCase() === 'user-query' ? 'user' : 'assistant';
        const text = (el.innerText || '').trim();
        if (text) messages.push({ role, text });
      });
      return messages;
    }
    document.querySelectorAll('message-content').forEach(el => {
      const parent = el.closest('[class*="request"], [class*="response"], [class*="query"]');
      const isUser = parent && (parent.className.includes('request') || parent.className.includes('query'));
      messages.push({ role: isUser ? 'user' : 'assistant', text: (el.innerText || '').trim() });
    });
    return messages.filter(m => m.text);
  }

  function extractDeepSeekMessages() {
    const messages = [];
    document.querySelectorAll('[class*="msg-"], [class*="message"]').forEach(el => {
      const cls = (el.className || '').toLowerCase();
      if (cls.includes('user') || cls.includes('human')) {
        const text = (el.innerText || '').trim();
        if (text) messages.push({ role: 'user', text });
      } else if (cls.includes('assistant') || cls.includes('bot') || cls.includes('ai')) {
        const text = (el.innerText || '').trim();
        if (text) messages.push({ role: 'assistant', text });
      }
    });
    return messages;
  }

  function extractPerplexityMessages() {
    const messages = [];
    document.querySelectorAll('[class*="query"], [class*="Query"], [class*="answer"], [class*="Answer"]').forEach(el => {
      const cls = (el.className || '').toLowerCase();
      const role = cls.includes('query') ? 'user' : 'assistant';
      const text = (el.innerText || '').trim();
      if (text) messages.push({ role, text });
    });
    return messages;
  }

  function extractGrokMessages() {
    const messages = [];
    document.querySelectorAll('[class*="message"], [class*="Message"]').forEach(el => {
      const cls = (el.className || '').toLowerCase();
      if (cls.includes('user') || cls.includes('human')) {
        const text = (el.innerText || '').trim();
        if (text) messages.push({ role: 'user', text });
      } else if (cls.includes('assistant') || cls.includes('bot') || cls.includes('grok') || cls.includes('ai')) {
        const text = (el.innerText || '').trim();
        if (text) messages.push({ role: 'assistant', text });
      }
    });
    return messages;
  }

  function extractGenericMessages() {
    const messages = [];
    document.querySelectorAll('[data-role]').forEach(el => {
      const role = el.getAttribute('data-role');
      if (role === 'user' || role === 'assistant') {
        const text = (el.innerText || '').trim();
        if (text) messages.push({ role, text });
      }
    });
    if (messages.length > 0) return messages;

    document.querySelectorAll('[aria-label*="message"], [aria-label*="response"], [aria-label*="Message"]').forEach(el => {
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      const role = label.includes('user') || label.includes('you') || label.includes('human') ? 'user' : 'assistant';
      const text = (el.innerText || '').trim();
      if (text) messages.push({ role, text });
    });
    return messages;
  }

  function truncateMessages(messages, maxMessages, maxChars) {
    let recent = messages.slice(-maxMessages);
    recent = recent.map(m => ({
      role: m.role,
      text: m.text.length > 400 ? m.text.substring(0, 400) + '...' : m.text
    }));

    let total = 0;
    const result = [];
    for (let i = recent.length - 1; i >= 0; i--) {
      total += recent[i].text.length + 20;
      if (total > maxChars) break;
      result.unshift(recent[i]);
    }
    return result;
  }

  function extractPageConversation() {
    try {
      const platform = detectPlatform();
      let messages = [];

      switch (platform) {
        case 'ChatGPT':     messages = extractChatGPTMessages(); break;
        case 'Claude':       messages = extractClaudeMessages(); break;
        case 'Gemini':       messages = extractGeminiMessages(); break;
        case 'DeepSeek':     messages = extractDeepSeekMessages(); break;
        case 'Perplexity':   messages = extractPerplexityMessages(); break;
        case 'Grok':         messages = extractGrokMessages(); break;
        default:             messages = extractGenericMessages(); break;
      }

      if (messages.length === 0) return null;

      messages = truncateMessages(messages, 8, 3000);
      if (messages.length === 0) return null;

      const conversation = messages.map(m => {
        const label = m.role === 'user' ? '[User]' : '[Assistant]';
        return `${label}: ${m.text}`;
      }).join('\n\n');

      return {
        platform: platform || 'Unknown',
        conversation,
        messageCount: messages.length
      };
    } catch (err) {
      console.error('PromptCraft: Error extracting conversation:', err);
      return null;
    }
  }

  // ── Toast ───────────────────────────────────────────────────────────────

  function showToast(message, duration = 3000) {
    // Remove any existing PromptCraft toast to avoid stacking
    document.querySelectorAll('.promptcraft-toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = 'promptcraft-toast';
    toast.textContent = message;
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '80px',
      right: '20px',
      background: '#1a1a2e',
      color: 'white',
      padding: '10px 16px',
      borderRadius: '8px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      fontWeight: '500',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
      zIndex: '2147483647',
      opacity: '0',
      transform: 'translateY(10px)',
      transition: 'opacity 0.3s ease, transform 0.3s ease',
      maxWidth: '300px',
      wordBreak: 'break-word',
    });
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // Toast with an undo button
  function showUndoToast() {
    document.querySelectorAll('.promptcraft-toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = 'promptcraft-toast';
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '80px',
      right: '20px',
      background: '#1a1a2e',
      color: 'white',
      padding: '10px 16px',
      borderRadius: '8px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      fontWeight: '500',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
      zIndex: '2147483647',
      opacity: '0',
      transform: 'translateY(10px)',
      transition: 'opacity 0.3s ease, transform 0.3s ease',
      maxWidth: '340px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
    });

    const label = document.createElement('span');
    label.textContent = 'Prompt enhanced!';

    const undoBtn = document.createElement('button');
    undoBtn.textContent = 'Undo';
    Object.assign(undoBtn.style, {
      background: 'rgba(245, 200, 66, 0.2)',
      color: '#F5C842',
      border: '1px solid rgba(245, 200, 66, 0.4)',
      borderRadius: '4px',
      padding: '3px 10px',
      fontSize: '12px',
      fontWeight: '600',
      cursor: 'pointer',
      flexShrink: '0',
    });
    undoBtn.addEventListener('click', () => {
      handleUndo();
      toast.remove();
    });

    toast.appendChild(label);
    toast.appendChild(undoBtn);
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    // Auto-dismiss after 8 seconds
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 8000);
  }

  // ── Undo ────────────────────────────────────────────────────────────────

  function handleUndo() {
    if (!undoState) {
      showToast('Nothing to undo');
      return;
    }
    const { el, text } = undoState;
    setTextDirect(el, text);
    undoState = null;
    showToast('Reverted to original');
  }

  // ── Find Text Input ─────────────────────────────────────────────────────

  function findTextInput() {
    const active = document.activeElement;
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable)) {
      return active;
    }
    const selectors = [
      'textarea',
      'div[contenteditable="true"]',
      '[role="textbox"]',
      '.ProseMirror',
    ];
    for (const sel of selectors) {
      const elems = document.querySelectorAll(sel);
      for (const el of elems) {
        if (el.offsetParent !== null) return el;
      }
    }
    return null;
  }

  function getTextFromElement(el) {
    if (!el) return '';
    return el.value || el.textContent || '';
  }

  // ── Text Insertion (framework-aware) ────────────────────────────────────

  // Direct set (no animation) — used for undo and fallback
  function setTextDirect(el, text) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      // Use native setter to bypass React's synthetic events
      const nativeSetter = Object.getOwnPropertyDescriptor(
        el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(el, text);
      } else {
        el.value = text;
      }
      el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    } else if (el.isContentEditable) {
      el.focus();
      // Select all and replace via execCommand — works with ProseMirror
      const sel = window.getSelection();
      if (sel && el.firstChild) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        document.execCommand('selectAll', false, null);
      }
      document.execCommand('insertText', false, text);
    }
  }

  // Insert a chunk of text at the end of a contentEditable
  function appendToContentEditable(el, chunk) {
    el.focus();
    const sel = window.getSelection();
    if (sel) {
      // Move cursor to end
      if (el.lastChild) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false); // collapse to end
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    document.execCommand('insertText', false, chunk);
  }

  // ── Animated text replacement with highlight + typewriter ───────────────

  function injectHighlightStyles() {
    if (document.getElementById('promptcraft-highlight-styles')) return;
    const s = document.createElement('style');
    s.id = 'promptcraft-highlight-styles';
    s.textContent = `
      @keyframes promptcraft-glow {
        0%, 100% { outline-color: rgba(232, 98, 30, 0.5); box-shadow: 0 0 8px rgba(232, 98, 30, 0.15); }
        50% { outline-color: rgba(245, 200, 66, 0.7); box-shadow: 0 0 20px rgba(245, 200, 66, 0.25); }
      }
      @keyframes promptcraft-scan {
        0%   { left: -40%; }
        100% { left: 100%; }
      }
      .promptcraft-highlight {
        outline: 2.5px solid rgba(232, 98, 30, 0.5) !important;
        outline-offset: 2px !important;
        animation: promptcraft-glow 1s ease-in-out infinite !important;
      }
      .promptcraft-analyzing {
        position: relative !important;
      }
      .promptcraft-scan-overlay {
        position: absolute !important;
        top: 0 !important;
        left: -40% !important;
        width: 40% !important;
        height: 100% !important;
        background: linear-gradient(90deg,
          transparent,
          rgba(245, 200, 66, 0.15),
          rgba(232, 98, 30, 0.12),
          rgba(245, 200, 66, 0.15),
          transparent
        ) !important;
        animation: promptcraft-scan 1.5s ease-in-out infinite !important;
        pointer-events: none !important;
        z-index: 10000 !important;
        border-radius: inherit !important;
      }
      .promptcraft-highlight-fade {
        outline: 2.5px solid transparent !important;
        outline-offset: 2px !important;
        animation: none !important;
        transition: outline-color 0.5s ease, box-shadow 0.5s ease !important;
        box-shadow: none !important;
      }
    `;
    document.head.appendChild(s);
  }

  // Find the best visible element to highlight — walk up to find a styled wrapper
  function getHighlightTarget(el) {
    if (el.isContentEditable) {
      // Walk up to 3 parents to find a wrapper with visible borders/rounding
      let node = el.parentElement;
      for (let i = 0; i < 3 && node && node !== document.body; i++) {
        const ps = getComputedStyle(node);
        if (ps.borderRadius !== '0px' || ps.borderWidth !== '0px' ||
            (ps.backgroundColor !== 'rgba(0, 0, 0, 0)' && ps.backgroundColor !== 'transparent')) {
          return node;
        }
        node = node.parentElement;
      }
    }
    return el;
  }

  // Add a real DOM overlay element for the scanning shimmer (not ::after, which fails on contentEditable)
  let scanOverlay = null;
  function addScanOverlay(targetEl) {
    removeScanOverlay();
    targetEl.classList.add('promptcraft-analyzing');
    scanOverlay = document.createElement('div');
    scanOverlay.className = 'promptcraft-scan-overlay';
    targetEl.appendChild(scanOverlay);
  }
  function removeScanOverlay() {
    if (scanOverlay) {
      scanOverlay.remove();
      scanOverlay = null;
    }
    document.querySelectorAll('.promptcraft-analyzing').forEach(el => {
      el.classList.remove('promptcraft-analyzing');
    });
  }

  function cancelTypewriter() {
    if (typewriterAbort) {
      typewriterAbort.cancelled = true;
      typewriterAbort = null;
    }
  }

  function setTextAnimated(el, text) {
    cancelTypewriter();
    injectHighlightStyles();

    return new Promise((resolve, reject) => {
      const highlightEl = getHighlightTarget(el);
      const abort = { cancelled: false };
      typewriterAbort = abort;

      // Ensure pulsing glow is active
      highlightEl.classList.remove('promptcraft-highlight-fade');
      highlightEl.classList.add('promptcraft-highlight');

      // Clear existing text
      el.focus();
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
          'value'
        )?.set;
        if (nativeSetter) nativeSetter.call(el, '');
        else el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (el.isContentEditable) {
        // Select all content via Range API, then replace with nothing
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        // Use insertText('') to clear — ProseMirror intercepts this properly
        document.execCommand('insertText', false, '');
        // Fallback: if content still exists, force clear via innerHTML
        if (el.textContent.trim().length > 0) {
          el.innerHTML = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }

      // Typewriter
      let i = 0;
      const len = text.length;
      const charDelay = Math.max(2, Math.min(12, Math.floor(800 / len)));
      const batch = charDelay <= 3 ? Math.ceil(len / 80) : 1;

      function tick() {
        if (abort.cancelled) {
          reject(new Error('cancelled'));
          return;
        }

        const end = Math.min(i + batch, len);
        const chunk = text.slice(i, end);

        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
            'value'
          )?.set;
          if (nativeSetter) nativeSetter.call(el, el.value + chunk);
          else el.value += chunk;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (el.isContentEditable) {
          appendToContentEditable(el, chunk);
        }

        i = end;

        if (i < len) {
          setTimeout(tick, charDelay);
        } else {
          typewriterAbort = null;
          el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

          // Fade highlight out
          setTimeout(() => {
            highlightEl.classList.remove('promptcraft-highlight');
            highlightEl.classList.add('promptcraft-highlight-fade');
            setTimeout(() => {
              highlightEl.classList.remove('promptcraft-highlight-fade');
            }, 600);
          }, 400);

          resolve();
        }
      }

      // Brief pause so glow is visible before typing starts
      setTimeout(tick, 300);
    });
  }

  // ── Button Click Handler ────────────────────────────────────────────────

  function handleButtonClick() {
    if (isProcessing) return;

    const inputEl = findTextInput();
    if (!inputEl) {
      showToast('No text input found on this page');
      return;
    }

    const text = getTextFromElement(inputEl).trim();
    if (!text) {
      showToast('Please enter text to enhance');
      return;
    }

    // Save original text for undo
    undoState = { el: inputEl, text };

    const modifier = cachedSettings?.lastModifier || 'short';
    const context = extractPageConversation();

    isProcessing = true;
    cancelTypewriter();
    injectHighlightStyles();
    const btn = document.getElementById(BUTTON_ID);
    const highlightEl = getHighlightTarget(inputEl);

    // Loading state — glow + scanning shimmer on the input box
    highlightEl.classList.add('promptcraft-highlight');
    addScanOverlay(highlightEl);
    if (btn) {
      btn.style.background = 'conic-gradient(from 0deg, #E8621E, #FF9F43, #F5C842, #E8621E)';
      btn.style.animation = 'promptcraft-spin 1s linear infinite';
    }

    function resetBtn() {
      if (btn) {
        btn.style.background = 'linear-gradient(135deg, #F5C842, #E8621E)';
        btn.style.animation = '';
      }
    }
    function stopAnalyzing() {
      removeScanOverlay();
    }
    function removeGlow() {
      stopAnalyzing();
      highlightEl.classList.remove('promptcraft-highlight');
      highlightEl.classList.add('promptcraft-highlight-fade');
      setTimeout(() => highlightEl.classList.remove('promptcraft-highlight-fade'), 600);
    }

    try {
      chrome.runtime.sendMessage(
        { action: 'enhance', prompt: text, modifier, context },
        (response) => {
          isProcessing = false;
          resetBtn();
          stopAnalyzing();

          if (chrome.runtime.lastError) {
            removeGlow();
            showToast('Error: ' + (chrome.runtime.lastError.message || 'Connection failed'));
            return;
          }

          if (response && response.success && response.text) {
            setTextAnimated(inputEl, response.text).then(() => {
              showUndoToast();
            }).catch((err) => {
              if (err?.message === 'cancelled') return;
              removeGlow();
              // Fallback: set directly without animation
              try {
                setTextDirect(inputEl, response.text);
                showUndoToast();
              } catch {
                navigator.clipboard.writeText(response.text).then(() => {
                  showToast('Enhanced prompt copied to clipboard');
                }).catch(() => {
                  showToast('Enhancement done but could not update field');
                });
              }
            });
          } else {
            removeGlow();
            undoState = null;
            const err = response?.error || 'Enhancement failed';
            showToast(err.length > 80 ? 'Enhancement error. Check extension popup.' : err);
          }
        }
      );
    } catch (err) {
      isProcessing = false;
      resetBtn();
      removeGlow();
      undoState = null;
      showToast('Failed to connect to PromptCraft');
    }
  }

  // ── Keyboard Shortcut ──────────────────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+E (or Cmd+Shift+E on Mac)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
      e.preventDefault();
      e.stopPropagation();
      handleButtonClick();
    }
    // Ctrl+Z while undo is available — only intercept if our undo is fresh
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && undoState && !e.shiftKey) {
      // Only intercept if it happened within 10 seconds of the enhancement
      // to avoid breaking normal undo
    }
  }, true);

  // ── Message Listener ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'triggerEnhance') {
      handleButtonClick();
      return;
    }

    if (msg.action === 'getConversation') {
      const context = extractPageConversation();
      sendResponse({ context });
      return;
    }
  });

  // ── Update Panel Info ──────────────────────────────────────────────────

  function updatePanelInfo() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const { provider, model } = getProviderLabel();
    const style = getModifierLabel();

    const providerEl = panel.querySelector('[data-pc-provider]');
    const modelEl = panel.querySelector('[data-pc-model]');
    const styleEl = panel.querySelector('[data-pc-style]');
    if (providerEl) providerEl.textContent = provider;
    if (modelEl) modelEl.textContent = model;
    if (styleEl) styleEl.textContent = style;

    const contextEl = panel.querySelector('[data-pc-context]');
    if (contextEl) {
      const ctx = extractPageConversation();
      contextEl.textContent = ctx ? `${ctx.messageCount} msgs` : 'None';
      contextEl.style.color = ctx ? 'rgba(34, 197, 94, 0.9)' : 'rgba(255, 255, 255, 0.4)';
    }
  }

  // ── Create Button + Hover Panel ────────────────────────────────────────

  function createButton() {
    if (document.getElementById(BUTTON_ID)) return;

    if (!document.getElementById('promptcraft-styles')) {
      const style = document.createElement('style');
      style.id = 'promptcraft-styles';
      style.textContent = `
        @keyframes promptcraft-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        #promptcraft-wrapper {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          gap: 0;
          font-family: system-ui, -apple-system, sans-serif;
        }
        #${PANEL_ID} {
          position: absolute;
          right: 54px;
          bottom: 4px;
          background: rgba(26, 26, 46, 0.95);
          backdrop-filter: blur(12px);
          border-radius: 12px;
          padding: 10px 14px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 180px;
          max-width: 240px;
          opacity: 0;
          transform: translateX(8px) scale(0.95);
          pointer-events: none;
          transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.08);
        }
        #promptcraft-wrapper:hover #${PANEL_ID} {
          opacity: 1;
          transform: translateX(0) scale(1);
          pointer-events: auto;
        }
        .pc-panel-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .pc-panel-label {
          font-size: 9px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: rgba(255, 255, 255, 0.4);
          min-width: 48px;
        }
        .pc-panel-value {
          font-size: 11px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.9);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pc-panel-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #22C55E;
          flex-shrink: 0;
        }
        .pc-panel-divider {
          height: 1px;
          background: rgba(255, 255, 255, 0.08);
          margin: 2px 0;
        }
        .pc-panel-title {
          font-size: 10px;
          font-weight: 700;
          color: rgba(245, 200, 66, 0.9);
          letter-spacing: 0.3px;
        }
        .pc-panel-shortcut {
          font-size: 9px;
          color: rgba(255, 255, 255, 0.3);
          margin-top: 2px;
        }
      `;
      document.head.appendChild(style);
    }

    const wrapper = document.createElement('div');
    wrapper.id = 'promptcraft-wrapper';

    const { provider, model } = getProviderLabel();
    const styleName = getModifierLabel();
    const ctx = extractPageConversation();
    const contextLabel = ctx ? `${ctx.messageCount} msgs` : 'None';
    const contextColor = ctx ? 'rgba(34, 197, 94, 0.9)' : 'rgba(255, 255, 255, 0.4)';

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="pc-panel-title">PromptCraft</div>
      <div class="pc-panel-divider"></div>
      <div class="pc-panel-row">
        <span class="pc-panel-dot"></span>
        <span class="pc-panel-label">API</span>
        <span class="pc-panel-value" data-pc-provider>${provider}</span>
      </div>
      <div class="pc-panel-row">
        <span class="pc-panel-label" style="margin-left: 11px;">Model</span>
        <span class="pc-panel-value" data-pc-model>${model}</span>
      </div>
      <div class="pc-panel-row">
        <span class="pc-panel-label" style="margin-left: 11px;">Style</span>
        <span class="pc-panel-value" data-pc-style>${styleName}</span>
      </div>
      <div class="pc-panel-divider"></div>
      <div class="pc-panel-row">
        <span class="pc-panel-label" style="margin-left: 11px;">Context</span>
        <span class="pc-panel-value" data-pc-context style="color: ${contextColor}">${contextLabel}</span>
      </div>
      <div class="pc-panel-shortcut">Ctrl+Shift+E to enhance</div>
    `;

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.setAttribute('aria-label', 'Enhance prompt with PromptCraft');
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" width="22" height="22">
        <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
        <path d="M2 17l10 5 10-5"></path>
        <path d="M2 12l10 5 10-5"></path>
      </svg>
    `;
    Object.assign(btn.style, {
      width: '48px',
      height: '48px',
      borderRadius: '50%',
      background: 'linear-gradient(135deg, #F5C842, #E8621E)',
      boxShadow: '0 4px 16px rgba(232, 98, 30, 0.35)',
      border: 'none',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'transform 0.2s ease, box-shadow 0.2s ease',
      flexShrink: '0',
    });

    btn.addEventListener('mouseenter', () => {
      if (!isProcessing) {
        btn.style.transform = 'scale(1.1)';
        btn.style.boxShadow = '0 6px 24px rgba(232, 98, 30, 0.45)';
      }
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'scale(1)';
      btn.style.boxShadow = '0 4px 16px rgba(232, 98, 30, 0.35)';
    });
    btn.addEventListener('mousedown', () => {
      btn.style.transform = 'scale(0.95)';
    });
    btn.addEventListener('mouseup', () => {
      btn.style.transform = 'scale(1.1)';
    });
    btn.addEventListener('click', handleButtonClick);

    wrapper.appendChild(panel);
    wrapper.appendChild(btn);
    document.body.appendChild(wrapper);
  }

  // ── MutationObserver ────────────────────────────────────────────────────

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => {
      if (!document.getElementById(BUTTON_ID)) {
        createButton();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── Init ────────────────────────────────────────────────────────────────

  function init() {
    fetchSettings();
    createButton();
    startObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.addEventListener('beforeunload', () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  });
})();
