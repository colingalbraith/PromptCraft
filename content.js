// PromptCraft Content Script - Ultra-simple version that works everywhere

(function() {
  console.log('PromptCraft loaded on: ' + window.location.hostname + ' at ' + new Date().toISOString());
  console.log('%cPromptCraft ACTIVE', 'background: purple; color: white; padding: 4px; font-weight: bold');

  // Simple function to create a toast notification
  function showToast(message, duration = 3000) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 80px;
      right: 20px;
      background-color: #FA812F;
      color: white;
      padding: 10px 15px;
      border-radius: 4px;
      font-family: system-ui, sans-serif;
      font-size: 14px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      z-index: 2147483647;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
  }

  // Function to copy text to clipboard
  function copyToClipboard(text) {
    try {
      navigator.clipboard.writeText(text).then(() => {
        showToast('Enhanced prompt copied to clipboard!');
      }).catch(err => {
        console.error('Clipboard API failed:', err);
        // Fallback method
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('Enhanced prompt copied to clipboard!');
      });
    } catch (e) {
      console.error('Copy failed:', e);
      showToast('Failed to copy. Please try again.');
    }
  }

  // Platform detection and interface mapping
  const PLATFORMS = {
    DEEPSEEK: 'deepseek',
    GEMINI: 'gemini',
    CHATGPT: 'chatgpt',
    ANTHROPIC: 'claude',
    PERPLEXITY: 'perplexity',
    GROK: 'grok',
    UNKNOWN: 'unknown'
  };

  function detectPlatform() {
    const url = window.location.href;
    if (url.includes('deepseek.com')) return PLATFORMS.DEEPSEEK;
    if (url.includes('gemini.google.com')) return PLATFORMS.GEMINI;
    if (url.includes('chat.openai.com')) return PLATFORMS.CHATGPT;
    if (url.includes('claude.ai')) return PLATFORMS.ANTHROPIC;
    if (url.includes('perplexity.ai')) return PLATFORMS.PERPLEXITY;
    if (url.includes('grok.x.com') || url.includes('grok.x')) return PLATFORMS.GROK;
    return PLATFORMS.UNKNOWN;
  }

  // Platform-specific selectors
  const PLATFORM_SELECTORS = {
    [PLATFORMS.DEEPSEEK]: {
      textArea: 'textarea',
      sendButton: 'button[class*="send"]',
    },
    [PLATFORMS.GEMINI]: {
      textArea: 'textarea',
      sendButton: 'button[aria-label*="Send message"]',
    },
    [PLATFORMS.CHATGPT]: {
      textArea: '#prompt-textarea',
      sendButton: 'button[data-testid="send-button"]',
    },
    [PLATFORMS.ANTHROPIC]: {
      textArea: '[data-selectable="true"][role="textbox"]',
      sendButton: 'button[aria-label="Send message"]',
    },
    [PLATFORMS.PERPLEXITY]: {
      textArea: '[contenteditable="true"][role="textbox"]',
      sendButton: 'button[aria-label="Send"]',
    },
    [PLATFORMS.GROK]: {
      textArea: '[contenteditable="true"][role="textbox"]',
      sendButton: 'button[aria-label="Send message"]',
    },
  };

  // Find text input on the page
  function findTextInput() {
    // Check active element first
    if (document.activeElement && 
        (document.activeElement.tagName === 'TEXTAREA' || 
         document.activeElement.tagName === 'INPUT' || 
         document.activeElement.isContentEditable)) {
      return document.activeElement;
    }

    // Try common selectors for AI chat inputs
    const selectors = [
      'textarea',
      'div[contenteditable="true"]',
      '[role="textbox"]',
      '.ProseMirror',
      '.chat-input textarea',
      '.chat-input div[contenteditable]'
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        // Check if element is visible
        if (el.offsetParent !== null) {
          return el;
        }
      }
    }
    return null;
  }

  // Get text from an element
  function getTextFromElement(element) {
    if (!element) return '';
    return element.value || element.textContent || '';
  }

  // Handle button click
  function handleButtonClick() {
    console.log('PromptCraft button clicked');
    
    // Find input element
    const inputElement = findTextInput();
    if (!inputElement) {
      showToast('No text input found');
      return;
    }

    // Get text
    const text = getTextFromElement(inputElement);
    if (!text.trim()) {
      showToast('Please enter text to enhance');
      return;
    }

    // Highlight the input element
    const originalBg = inputElement.style.backgroundColor;
    inputElement.style.backgroundColor = 'rgba(250, 129, 47, 0.1)';  // --accent color with 10% opacity
    setTimeout(() => {
      inputElement.style.backgroundColor = originalBg;
    }, 500);

    showToast('Enhancing your prompt...');
    
    try {
      // Use the existing background script infrastructure
      chrome.runtime.sendMessage({
        action: 'rewritePrompt',
        prompt: text
      }, function(response) {
        if (chrome.runtime.lastError) {
          console.error('Message passing error:', chrome.runtime.lastError.message || 'Unknown runtime error');
          showToast(`Error: ${chrome.runtime.lastError.message || 'Could not connect to PromptCraft service.'}`);
          return;
        }

        if (response && response.status === 'success' && response.enhancedPrompt) {
          try {
            // Update the input field
            if (inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT') {
              inputElement.value = response.enhancedPrompt;
            } else if (inputElement.isContentEditable) {
              inputElement.textContent = response.enhancedPrompt;
            }
            
            // Trigger input events
            inputElement.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            inputElement.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            
            showToast('Prompt enhanced successfully!');
          } catch (e) {
            console.error('Failed to update input field:', e);
            copyToClipboard(response.enhancedPrompt);
            showToast('Enhanced prompt copied. Failed to update field.');
          }
        } else {
          const errorMessage = response?.message || 'Failed to enhance prompt due to an unknown error.';
          console.error('Enhancement failed:', errorMessage, 'Response:', response);
          showToast(errorMessage.length > 100 ? 'Enhancement error. See console.' : errorMessage);
        }
      });
    } catch (error) {
      console.error('Error sending message to background script:', error);
      showToast('Failed to send request to PromptCraft service.');
    }
  }

  // Create a simple button
  function createButton() {
    // Remove any existing button
    const existingButton = document.getElementById('promptcraft-button');
    if (existingButton) {
      existingButton.remove();
    }
    
    const button = document.createElement('button');
    button.id = 'promptcraft-button';
    button.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" width="24" height="24">
        <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
        <path d="M2 17l10 5 10-5"></path>
        <path d="M2 12l10 5 10-5"></path>
      </svg>
    `;
    button.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: linear-gradient(135deg, #F3C623, #FA812F);
      box-shadow: 0 4px 12px rgba(250, 129, 47, 0.25);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2147483647;
    `;
    button.addEventListener('click', handleButtonClick);
    document.body.appendChild(button);
    console.log('Button created and added to page');
    return button;
  }

  // Create button on page load
  function init() {
    createButton();
  }

  // Ensure button exists and is visible
  function ensureButtonExists() {
    if (!document.getElementById('promptcraft-button')) {
      createButton();
    }
  }

  // Initialize immediately
  init();

  // Also initialize when DOM is fully loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  }

  // Check periodically if button exists
  setInterval(ensureButtonExists, 2000);

  // Initialize after delays to handle slow-loading sites
  setTimeout(init, 1000);
  setTimeout(init, 3000);
})();
