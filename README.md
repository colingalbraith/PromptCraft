# PromptCraft – Chrome Extension for Effortless Prompt Engineering

![Untitled design (5)](https://github.com/user-attachments/assets/7b249ceb-b7cd-47d7-80e2-33b805942187)

![ChatGPT Image May 4, 2025, 10_53_52 PM](https://github.com/user-attachments/assets/088e3223-1f7c-4907-b436-e089c9495a5e)

![Untitled design (7)](https://github.com/user-attachments/assets/66b18fa1-9001-457f-8632-56464d05dc43)


PromptCraft is a lightweight Chrome extension powered by the **Gemini API (`gemini-1.5-flash` model)** that helps you **rewrite, refine, and stylize prompts** effortlessly.

Tired of manually typing or tweaking the same prompts over and over? PromptCraft lets you focus on your ideas while it takes care of phrasing. Choose a style (like Concise, Educational, Creative, Technical, etc.) and let PromptCraft enhance your input.

---

## Features

- **Prompt Rewriting in One Click**  
  Choose a style (e.g., Concise, Educational, Visual-focused, Technical, Creative) and rewrite any prompt with Gemini's help.

- **Secure API Key Storage**
  Enter your Gemini API key via the secure Settings page. The key is stored locally using `chrome.storage.sync` and is *never* sent to external servers.

- **Modern UI**
  Enjoy a clean, intuitive interface with visual feedback.

- **Built for Prompt Engineers & Power Users**  
  Designed for those who constantly interact with AI systems and want a smoother, more enjoyable prompting experience.

---

## Setup Instructions

1. **Fork or Clone the Repository**
   ```bash
   git clone https://github.com/colingalbraith/PromptCraft.git
   ```

2. **Load the Extension in Chrome**
   - Go to `chrome://extensions/`
   - Enable **Developer mode** (usually a toggle in the top right)
   - Click **Load unpacked**
   - Select the `PromptCraft` folder you cloned.

3. **Add Your Gemini API Key**
   - Click the PromptCraft extension icon in your browser toolbar.
   - Click the Settings icon (⚙️) within the popup.
   - Paste your Gemini API Key (get one [here](https://aistudio.google.com/app/apikey)) into the input field.
   - Click "Save Settings". Your key is now stored securely.

---

## Example Use Case

Prompt:  
> "Can you explain reinforcement learning like I'm 10?"

Select style: **Concise**  
🠒 Rewritten as:  
> "Explain reinforcement learning simply, like to a 10-year-old."

---

## Customization Guide

Want to add your own prompt styles like "Sarcastic", "Academic", or "GPT-Style"? You can easily extend the dropdown options and logic in `popup.js` to suit your needs. The modular design makes tweaking behavior fast and fun.

---

## Folder Structure

```
PromptCraft/
├── icons/              # Extension icons
├── popup.html          # Main popup interface
├── popup.js            # Handles style logic + Gemini requests
├── popup.css           # Styling for the popup
└── manifest.json       # Chrome extension config
```

---

## Why Use PromptCraft?

> Because great prompting shouldn't be tedious.  
PromptCraft lets you offload the "prompt phrasing" to AI, freeing you up to explore ideas faster and more creatively.

---

## Feedback & Contributions

Feel free to open an issue or submit a pull request. PromptCraft is designed to be community-driven and flexible.

---

## License

MIT License 
