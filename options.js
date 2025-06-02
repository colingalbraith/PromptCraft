// Options page script

// Save options to chrome.storage.sync
function saveOptions() {
  const apiKey = document.getElementById('apiKey').value.trim();
  const statusEl = document.getElementById('status');
  
  if (!apiKey) {
    statusEl.textContent = 'Please enter a valid API key';
    statusEl.className = 'status error';
    return;
  }
  
  chrome.storage.sync.set({ geminiApiKey: apiKey }, () => {
    // Update status to let user know options were saved
    statusEl.textContent = 'API key saved successfully!';
    statusEl.className = 'status success';
    
    // Hide status after 2 seconds
    setTimeout(() => {
      statusEl.className = 'status';
    }, 2000);
  });
}

// Restore options from chrome.storage.sync
function restoreOptions() {
  chrome.storage.sync.get(['geminiApiKey'], (result) => {
    document.getElementById('apiKey').value = result.geminiApiKey || '';
  });
}

// Add event listeners
document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('saveButton').addEventListener('click', saveOptions);
