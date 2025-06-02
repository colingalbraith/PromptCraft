// Simple background script for PromptCraft
// Avoids using declarativeContent API which was causing errors

// Supported AI site patterns
const AI_SITES = [
  '*://*.chatgpt.com/*',  // ChatGPT
  '*://*.grok.com/*',     // Grok
  '*://*.gemini.google.com/*', // Gemini
  '*://*.deepseek.com/*',  // DeepSeek
  '*://*.claude.ai/*',      // Claude
  "*://*.huggingface.co/*",
"*://*.openrouter.ai/*"

];

// Set up context menu on install
chrome.runtime.onInstalled.addListener(() => {
  console.log('PromptCraft extension installed');
  
  try {
    // Create the context menu item
    chrome.contextMenus.create({
      id: 'rewrite-with-promptcraft',
      title: 'Rewrite with PromptCraft',
      contexts: ['editable'],
      documentUrlPatterns: AI_SITES
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('Context menu creation error:', chrome.runtime.lastError);
      } else {
        console.log('Context menu created successfully');
      }
    });
  } catch (error) {
    console.error('Error during extension initialization:', error);
  }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'rewrite-with-promptcraft') {
    console.log('Context menu clicked, sending message to tab:', tab.id);
    chrome.tabs.sendMessage(
      tab.id, 
      { action: 'getEditableContent' },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error sending message to tab:', chrome.runtime.lastError);
        }
      }
    );
  }
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message.action);
  
  if (message.action === 'rewritePrompt' && message.prompt) {
    console.log('Background received rewritePrompt action for:', message.prompt.substring(0,30) + '...');
    (async () => {
      try {
        const enhancedPromptText = await enhancePrompt(message.prompt);
        sendResponse({
          status: 'success',
          enhancedPrompt: enhancedPromptText
        });
      } catch (e) {
        console.error('Error in rewritePrompt message handler:', e.message);
        sendResponse({
          status: 'error',
          message: e.message || 'An unexpected error occurred during prompt enhancement.'
        });
      }
    })();
    return true; // Crucial: Indicate that sendResponse will be called asynchronously
  }
  // Add other message handlers if needed, e.g., for options page communication
});

// Get API key from storage
async function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['apiKey'], (result) => {
      console.log('[DEBUG] getApiKey: Attempting to retrieve apiKey.'); 
      if (chrome.runtime.lastError) {
        console.error('[DEBUG] getApiKey: chrome.runtime.lastError during storage.sync.get:', chrome.runtime.lastError.message);
        resolve(''); 
        return;
      }
      if (result && typeof result.apiKey !== 'undefined') {
        console.log('[DEBUG] getApiKey: Successfully retrieved apiKey. Length:', result.apiKey ? result.apiKey.length : 'N/A');
        resolve(result.apiKey);
      } else {
        console.warn('[DEBUG] getApiKey: apiKey not found in storage result or result is unexpected. Result:', result);
        resolve(''); 
      }
    });
  });
}

// Set API key in storage
function setApiKey(apiKey) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ apiKey }, () => {
      resolve();
    });
  });
}

// Actual prompt enhancement logic using Gemini API
async function enhancePrompt(promptText) {
  const apiKey = await getApiKey();
  console.log('[DEBUG] enhancePrompt: API Key received by enhancePrompt (first 5 chars):', apiKey ? apiKey.substring(0, 5) : 'NONE');
  if (!apiKey) {
    console.error('Gemini API Key not found after getApiKey(). Please set it in options.');
    throw new Error('API Key not set. Please configure it in the extension options.');
  }

  console.log('Enhancing prompt with Gemini API (first 50 chars):', promptText.substring(0, 50) + '...');
  
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are a prompt engineering expert. Your task is to refine and enhance the following user-provided AI prompt to ensure it elicits the best possible response from a large language model. Focus on clarity, specificity, and actionable instructions for the AI. Return only the enhanced prompt text, without any of your own conversational introduction, explanation, or markdown formatting like "Enhanced Prompt:".

User Prompt: "${promptText}"`
            }]
          }],
          // Optional: Add safetySettings or generationConfig if needed
          // generationConfig: {
          //   temperature: 0.7,
          //   maxOutputTokens: 2048,
          // }
        })
      }
    );

    if (!response.ok) {
      let errorBody = 'Could not parse error response.';
      try {
        // Try to get more detailed error from Gemini API response
        const errorJson = await response.json();
        errorBody = errorJson?.error?.message || JSON.stringify(errorJson);
      } catch (e) {
        // Fallback to text if JSON parsing fails
        errorBody = await response.text();
      }
      console.error('Gemini API request failed:', response.status, errorBody);
      throw new Error(`API request failed (${response.status}): ${errorBody}`);
    }

    const data = await response.json();

    if (data.promptFeedback && data.promptFeedback.blockReason) {
        console.warn('Prompt blocked by API:', data.promptFeedback.blockReason, data.promptFeedback.safetyRatings);
        throw new Error(`Your prompt was blocked by the API due to: ${data.promptFeedback.blockReason}. Please revise it.`);
    }
    
    const enhancedText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!enhancedText) {
      console.error('Invalid API response structure from Gemini:', data);
      throw new Error('Could not extract enhanced prompt from API response. The response format might have changed or an unexpected error occurred.');
    }
    
    console.log('Successfully enhanced prompt via Gemini.');
    return enhancedText;

  } catch (error) {
    console.error('Error during enhancePrompt with Gemini:', error.message);
    // Re-throw a more user-friendly or specific error if needed
    if (error instanceof Error && error.message.startsWith('API Key not set')) {
        throw error; // Preserve specific API key error
    }
    throw new Error(`Enhancement failed: ${error.message}`);
  }
}
