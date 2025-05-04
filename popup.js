const API_KEY = 'API_KEY_HERE';
const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;

const modifierInstructions = {
  short: `
Revise the user’s prompt so that ChatGPT will reply concisely and directly, omitting any unnecessary detail.  
**Output only** the revised prompt.

Original prompt:
`,
  educational: `
Revise the user’s prompt so that ChatGPT will reply in an educational, step-by-step format—clear explanations, definitions, and examples.  
**Output only** the revised prompt.

Original prompt:

`,
  prioritizeVisualizations: `
Revise the user’s prompt so ChatGPT will generate rich, inline markdown visuals alongside its explanation:
– Mermaid diagrams illustrating key concepts
– ASCII art showing data structures and pointers
– Markdown tables summarizing properties or operations
– Flowcharts or charts depicting workflows or processes
**Output only** the revised prompt.

Original prompt:
`,
  creative: `
Revise the user’s prompt so that ChatGPT will reply with imaginative, engaging, and thought-provoking style.  
**Output only** the revised prompt.

Original prompt:
`,
  technical: `
Revise the user’s prompt so that ChatGPT will reply with precise, structured, and detail-oriented technical content.  
**Output only** the revised prompt.

Original prompt:
`,
};


document.getElementById('rewrite').addEventListener('click', async () => {
  const input = document.getElementById('input').value.trim();
  if (!input) {
    alert('Please enter a prompt.');
    return;
  }
  
  // Automatically resize input field based on content
  autoResize(document.getElementById('input'));
  
  const modifier = document.getElementById('modifier').value;
  const instruction = modifierInstructions[modifier] || '';
  
  // Improved prompt structure
  const promptText = `${instruction}\n\nOriginal prompt:\n${input}\n\nPlease provide only the rewritten prompt without explanations or additional text.`;

  const rewriteBtn = document.getElementById('rewrite');
  rewriteBtn.disabled = true;
  rewriteBtn.innerText = 'Rewriting...';
  rewriteBtn.classList.add('rewriting');

  // Show loading state
  document.getElementById('input').classList.add('loading');
  document.getElementById('modifier').classList.add('loading');

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: promptText }]
        }],
        generationConfig: {
          temperature: 0.3
        }
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('API error details:', res.status, errText);
      throw new Error(`API error ${res.status}${errText ? ': ' + errText : ''}`);
    }
    const data = await res.json();
    if (data.error) {
      console.error('API response error', data.error);
      throw new Error(data.error.message);
    }
    const output = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!output) throw new Error('No output from API');

    document.getElementById('output').value = output;
    document.getElementById('output-container').classList.remove('hidden');
  } catch (err) {
    console.error(err);
    alert(`Error rewriting prompt: ${err.message}`);
  } finally {
    rewriteBtn.disabled = false;
    rewriteBtn.innerText = 'Rewrite Prompt';
    rewriteBtn.classList.remove('rewriting');
    document.getElementById('input').classList.remove('loading');
    document.getElementById('modifier').classList.remove('loading');
  }
});

document.getElementById('copy').addEventListener('click', () => {
  const output = document.getElementById('output').value;
  if (!output) return;
  navigator.clipboard.writeText(output).then(() => {
    const copyBtn = document.getElementById('copy');
    copyBtn.innerText = 'Copied!';
    copyBtn.style.background = 'var(--accent)';
    setTimeout(() => {
      copyBtn.innerText = 'Copy to Clipboard';
      copyBtn.style.background = 'var(--gradient)';
    }, 2000);
  });
});

document.getElementById('input').placeholder = 'Enter a prompt...';
document.getElementById('modifier').placeholder = 'Select a modifier...';

function autoResize(element) {
  element.style.height = 'auto';
  const newHeight = Math.max(100, Math.min(element.scrollHeight, 300));
  element.style.height = newHeight + 'px';
  
  // Adjust font size based on content length
  if (element.value.length > 500) {
    element.style.fontSize = '13px';
  } else if (element.value.length > 1000) {
    element.style.fontSize = '12px';
  } else {
    element.style.fontSize = '14px';
  }
}

// Initialize textarea sizing on load
window.addEventListener('DOMContentLoaded', () => {
  const textareas = document.querySelectorAll('textarea');
  textareas.forEach(textarea => {
    autoResize(textarea);
    textarea.addEventListener('input', () => autoResize(textarea));
  });
});
