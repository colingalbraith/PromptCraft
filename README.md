# 🌟 PromptCraft – Chrome Extension for Effortless Prompt Engineering



![image](https://github.com/user-attachments/assets/2e86d0d6-3c70-453b-8c22-03e5f4aaeb36)

![image](https://github.com/user-attachments/assets/641fe9cb-fa7e-4db6-b267-3c535aed9d60)



PromptCraft is a lightweight Chrome extension powered by the **Gemini API** that helps you **rewrite, refine, and stylize prompts** effortlessly.

Tired of manually typing or tweaking the same prompts over and over? PromptCraft lets you focus on your ideas while it takes care of phrasing. Whether you want your prompt to be concise, friendly, visual-heavy, or educational, PromptCraft makes it easy.

---

## 🚀 Features

- ✏️ **Prompt Rewriting in One Click**  
  Choose a style (e.g., Concise, Friendly, Educational) and rewrite any prompt with Gemini's help.

- ⚙️ **Fully Customizable**  
  Add your own styles, prompt modifiers, or rewrite logic in `popup.js`. Tailor the prompt engine to your workflow.

- 🔐 **Easy Gemini API Integration**  
  Just fork the repo and paste your free [Gemini API key](https://ai.google.dev/) into `popup.js`.

- 🧠 **Built for Prompt Engineers & Power Users**  
  Designed for those who constantly interact with AI systems and want a smoother, more enjoyable prompting experience.

---

## 🛠️ Setup Instructions

1. **Fork or Clone the Repository**
   ```bash
   git clone https://github.com/colingalbraith/PromptCraft.git
   ```

2. **Insert Your Gemini API Key**  
   In `popup.js`, replace the placeholder with your key:
   ```js
   const GEMINI_API_KEY = "YOUR_API_KEY_HERE";
   ```

3. **Load the Extension in Chrome**
   - Go to `chrome://extensions/`
   - Enable **Developer mode**
   - Click **Load unpacked**
   - Select the folder containing the PromptCraft files

---

## ✨ Example Use Case

Prompt:  
> "Can you explain reinforcement learning like I'm 10?"

Select style: **Concise**  
🠒 Rewritten as:  
> "Explain reinforcement learning simply, like to a 10-year-old."

---

## 🎨 Customization Guide

Want to add your own prompt styles like "Sarcastic", "Academic", or "GPT-Style"? You can easily extend the dropdown options and logic in `popup.js` to suit your needs. The modular design makes tweaking behavior fast and fun.

---

## 📦 Folder Structure

```
PromptCraft/
├── icons/              # Extension icons
├── popup.html          # Main popup interface
├── popup.js            # Handles style logic + Gemini requests
├── style.css           # Styling for the popup
└── manifest.json       # Chrome extension config
```

---

## 🧩 Why Use PromptCraft?

> Because great prompting shouldn't be tedious.  
PromptCraft lets you offload the "prompt phrasing" to AI, freeing you up to explore ideas faster and more creatively.

---

## 💬 Feedback & Contributions

Feel free to open an issue or submit a pull request. PromptCraft is designed to be community-driven and flexible.

---

## 📄 License

MIT License 
