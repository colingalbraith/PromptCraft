// Prompt templates - Updated for more direct instructions
const templates = {
  short: `Rewrite the following prompt to be more concise and direct, providing only the rewritten prompt as the result:\n{{input}}`,
  detailed: `Rewrite the following prompt to be more detailed and specific, suitable for eliciting a comprehensive response. Provide only the rewritten prompt as the result:\n{{input}}`,
  creative: `Rewrite the following prompt to be more creative and imaginative, encouraging an unconventional or artistic response. Provide only the rewritten prompt as the result:\n{{input}}`,
  educational: `Rewrite the following prompt to be more educational and informative, suitable for learning or explaining a topic. Provide only the rewritten prompt as the result:\n{{input}}`,
  professional: `Rewrite the following prompt to have a more professional and formal tone, suitable for a business or academic context. Provide only the rewritten prompt as the result:\n{{input}}`,
  casual: `Rewrite the following prompt to have a more casual and conversational tone. Provide only the rewritten prompt as the result:\n{{input}}`,
  prioritize_visualizations: `Rewrite the following prompt to emphasize requesting visual outputs, diagrams, or charts. Provide only the rewritten prompt as the result:\n{{input}}`,
  technical: `Rewrite the following prompt to be more technical and precise, suitable for experts or specific domains. Provide only the rewritten prompt as the result:\n{{input}}`
};

// DOM Elements
const mainPage = document.getElementById('main-page');
const settingsPage = document.getElementById('settings-page');
const settingsBtn = document.getElementById('settings-btn');
const backBtn = document.getElementById('back-btn');
const saveSettingsBtn = document.getElementById('save-settings');
const showKeyBtn = document.getElementById('show-key');
const apiKeyInput = document.getElementById('api-key');
const rewriteBtn = document.getElementById('rewrite');
const inputTextarea = document.getElementById('input');
const outputContainer = document.getElementById('output-container');
const outputElement = document.getElementById('output');
const copyBtn = document.getElementById('copy-btn');
const saveNotification = document.createElement('div');
saveNotification.className = 'save-notification';
saveNotification.textContent = 'Settings saved successfully!';
document.body.appendChild(saveNotification);

// Page Navigation
settingsBtn?.addEventListener('click', () => {
  mainPage.classList.remove('active');
  settingsPage.classList.add('active');
});

backBtn?.addEventListener('click', () => {
  settingsPage.classList.remove('active');
  mainPage.classList.add('active');
});

// Toggle API Key visibility
showKeyBtn?.addEventListener('click', () => {
  if (apiKeyInput.type === 'password') {
    apiKeyInput.type = 'text';
    showKeyBtn.textContent = 'Hide';
  } else {
    apiKeyInput.type = 'password';
    showKeyBtn.textContent = 'Show';
  }
});

// Save settings with nice UI indication
saveSettingsBtn?.addEventListener('click', () => {
  const apiKey = apiKeyInput.value.trim();
  console.log('Attempting to save API key:', apiKey ? '******' : '(empty)'); // Log masking the key
  
  // Save to Chrome storage
  chrome.storage.sync.set({ apiKey }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error saving settings:', chrome.runtime.lastError);
      alert('Error saving settings. Check console for details.');
      return;
    }
    console.log('API key saved successfully.');
    // Show success feedback
    saveSettingsBtn.textContent = 'Saved!';
    
    // Show notification
    saveNotification.classList.add('show');
    setTimeout(() => {
      saveNotification.classList.remove('show');
    }, 3000);
    
    setTimeout(() => {
      saveSettingsBtn.textContent = 'Save Settings';
      // Return to main page
      settingsPage.classList.remove('active');
      mainPage.classList.add('active');
    }, 1500);
  });
});

// Load settings on popup open
document.addEventListener('DOMContentLoaded', () => {
  console.log('Popup loaded. Attempting to load API key from storage.');
  chrome.storage.sync.get(['apiKey'], (result) => {
    if (chrome.runtime.lastError) {
      console.error('Error loading settings:', chrome.runtime.lastError);
      alert('Error loading settings. Check console for details.');
      return;
    }
    const loadedApiKey = result.apiKey;
    console.log('API key loaded from storage:', loadedApiKey ? '******' : '(not found)'); // Log masking the key
    if (loadedApiKey) {
      apiKeyInput.value = loadedApiKey;
      console.log('API key input field populated.');
    } else {
      console.log('No API key found in storage.');
    }
  });
  
  // Auto-resize textarea
  inputTextarea.addEventListener('input', function() {
    autoResize(this);
  });
});

// Copy enhanced prompt to clipboard
copyBtn?.addEventListener('click', () => {
  const text = outputElement.textContent;
  navigator.clipboard.writeText(text).then(() => {
    copyBtn.textContent = '✓';
    setTimeout(() => {
      copyBtn.textContent = '📋';
    }, 2000);
  });
});

// Enhance prompt
rewriteBtn?.addEventListener('click', async () => {
  const input = inputTextarea.value.trim();
  const modifier = document.getElementById('modifier').value;
  
  if (!input) {
    alert('Please enter a prompt first.');
    return;
  }
  
  // Show loading state
  rewriteBtn.textContent = 'Enhancing...';
  rewriteBtn.disabled = true;
  outputContainer.classList.add('hidden');
  
  try {
    // Get API key from storage
    console.log('Enhance button clicked. Attempting to retrieve API key for use.');
    chrome.storage.sync.get(['apiKey'], async (result) => {
      if (chrome.runtime.lastError) {
        console.error('Error retrieving API key for API call:', chrome.runtime.lastError);
        alert('Could not retrieve API key from storage. Please save it again.');
        rewriteBtn.textContent = 'Enhance Prompt';
        rewriteBtn.disabled = false;
        return;
      }
      
      const apiKeyToUse = result.apiKey;
      console.log('API key retrieved for use:', apiKeyToUse ? '******' : '(not found)');
      
      if (!apiKeyToUse) {
        alert('Please set your API key in settings first.');
        settingsPage.classList.add('active');
        mainPage.classList.remove('active');
        rewriteBtn.textContent = 'Enhance Prompt';
        rewriteBtn.disabled = false;
        return;
      }
      
      try {
        const template = templates[modifier].replace('{{input}}', input);
        const response = await callGeminiAPI(template, apiKeyToUse);
        
        // Display result
        outputElement.textContent = response;
        outputContainer.classList.remove('hidden');
        outputContainer.classList.add('visible');
      } catch (error) {
        console.error('API Error:', error);
        alert(`Error: ${error.message || 'Failed to enhance prompt. Please check your API key and try again.'}`);
      } finally {
        // Reset button state
        rewriteBtn.textContent = 'Enhance Prompt';
        rewriteBtn.disabled = false;
      }
    });
  } catch (error) {
    console.error('General Error during enhance process:', error);
    alert('An unexpected error occurred. Please try again.');
    rewriteBtn.textContent = 'Enhance Prompt';
    rewriteBtn.disabled = false;
  }
});

// Call Gemini API - Updated endpoint
async function callGeminiAPI(prompt, apiKey) {
  // Use the v1beta endpoint and gemini-1.5-flash model
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  try {
    console.log('Calling Gemini API with prompt:', prompt);
    const requestBody = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.4,
        topK: 32,
        topP: 1,
        maxOutputTokens: 500
      }
    };
    
    console.log('Request body:', JSON.stringify(requestBody));
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    console.log('API Response Status:', response.status);
    
    if (!response.ok) {
      let errorBody = 'Could not read error body.';
      try {
        // Attempt to read the response body for more detailed error info
        errorBody = await response.text(); 
        console.error('API Error Body:', errorBody); // Log the raw error body
      } catch (e) {
        console.error('Failed to read error response body:', e);
      }
      // Include status and potentially the body in the error message
      throw new Error(`API error (${response.status}): ${errorBody.substring(0, 100)}... Check console for full body.`); 
    }
    
    const data = await response.json();
    console.log('API Response Data:', JSON.stringify(data));
    
    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('No response from API');
    }
    
    if (data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts.length > 0) {
      return data.candidates[0].content.parts[0].text;
    } else {
      console.error('Invalid response format:', JSON.stringify(data));
      throw new Error('Invalid response format from API');
    }
  } catch (error) {
    console.error('API call failed:', error);
    throw error;
  }
}

// Message listener for prompts from background script or content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'promptReady' || request.action === 'rewritePrompt') {
    console.log('Popup received prompt for enhancement:', request.prompt ? request.prompt.substring(0, 30) + '...' : 'empty');
    // Set the modifier from saved preference
    const lastModifier = localStorage.getItem('lastModifier') || 'short';
    document.getElementById('modifier').value = lastModifier;
    inputTextarea.value = request.prompt;
    rewriteBtn.click();
  }
});

// Context menu handling is now in background.js

// Add interactive background effects
document.addEventListener('mousemove', (e) => {
  const blobs = document.querySelectorAll('.gradient-blob');
  const rect = document.body.getBoundingClientRect();
  const mouseX = (e.clientX - rect.left) / rect.width;
  const mouseY = (e.clientY - rect.top) / rect.height;
  
  blobs.forEach((blob, index) => {
    const offsetX = (mouseX - 0.5) * (20 + index * 5) * (index % 2 === 0 ? 1 : -1);
    const offsetY = (mouseY - 0.5) * (20 + index * 5) * (index % 2 === 0 ? -1 : 1);
    
    blob.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
  });
});

// Automatically resize input field based on content
function autoResize(element) {
  element.style.height = 'auto';
  const newHeight = Math.max(100, Math.min(element.scrollHeight, 300));
  element.style.height = newHeight + 'px';
}
