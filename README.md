# PromptCraft

**Bad prompts, bad answers. PromptCraft fixes that in one click.**

https://github.com/user-attachments/assets/a64a511d-0ccc-4a24-b761-bea628b81a16

<div align="center">

<table>
  <tr>
    <td><img src="https://github.com/user-attachments/assets/7b249ceb-b7cd-47d7-80e2-33b805942187" alt="PromptCraft UI" width="350"/></td>
    <td><img src="https://github.com/user-attachments/assets/088e3223-1f7c-4907-b436-e089c9495a5e" alt="PromptCraft Enhancement" width="550"/></td>
    <td><img src="https://github.com/user-attachments/assets/66b18fa1-9001-457f-8632-56464d05dc43" alt="PromptCraft Features" width="550"/></td>
  </tr>
</table>

</div>

PromptCraft is a free, open-source Chrome extension that enhances your AI prompts with a single click. It works across ChatGPT, Claude, Gemini, DeepSeek, Perplexity, Grok, HuggingFace, and OpenRouter — with support for OpenAI, Gemini, Claude, Ollama, and any OpenAI-compatible API.

---

## Features

- **One-Click Enhancement** — Select text on any AI chat site, hit the shortcut or click the button, and get an optimized prompt instantly
- **14+ Built-in Templates** — Debug code, write emails, brainstorm ideas, compare options, summarize text, and more
- **5 Tones + Custom Presets** — Concise, Detailed, Creative, Technical, Reasoning — or build your own
- **Smart Input Analysis** — Detects code, errors, quotes, URLs, and intent. Enhances differently based on what you typed
- **Deep Analysis (LLM-Powered)** — Optional second pass that uses your AI provider to deeply understand your input before enhancing
- **Word-Level Diff View** — See exactly what changed with green/red highlighting after each enhancement
- **Multi-Step Enhancement** — Three-pass pipeline: Expand, Structure, Polish for maximum quality
- **Provider-Aware Optimization** — Tailors enhanced prompts to the specific AI you're chatting with
- **Prompt Scoring** — 0-100 quality score across 5 dimensions (specificity, clarity, structure, context, actionability)
- **Streaming Responses** — Real-time token streaming for OpenAI, Gemini, and custom endpoints
- **Conversation Context** — Extracts and ranks chat history by relevance to make context-aware enhancements
- **Prompt History** — Every enhancement saved locally with before/after scores. Search, revisit, export
- **Usage Analytics** — Track enhancements, estimated cost, tokens used, and model breakdown
- **Dark Mode** — Full dark theme with system preference detection
- **Undo** — Revert any enhancement instantly

## Supported Providers

| Provider | Type | Notes |
|---|---|---|
| **OpenAI** | API | GPT-4o, GPT-4o Mini, GPT-4 Turbo, o3-mini |
| **Google Gemini** | API | Gemini 2.0 Flash, 1.5 Flash, 1.5 Pro |
| **Claude** | API | Claude Sonnet 4, Claude Haiku 4.5 |
| **Ollama** | Local | Any installed model (llama3, etc.) — completely free |
| **Custom** | API | Any OpenAI-compatible endpoint (Groq, Together, OpenRouter, vLLM, LiteLLM) |

## Supported AI Chat Sites

ChatGPT, Claude, Gemini, DeepSeek, Perplexity, Grok, HuggingFace, OpenRouter — works on all of them with platform-specific optimization.

---

## Install

1. **Clone the repo**
   ```bash
   git clone https://github.com/colingalbraith/PromptCraft.git
   ```

2. **Load in Chrome**
   - Go to `chrome://extensions/`
   - Enable **Developer mode**
   - Click **Load unpacked**
   - Select the `PromptCraft` folder

3. **Add your API key**
   - Click the PromptCraft icon in your toolbar
   - Go to Settings
   - Pick your provider and paste your API key
   - Or use Ollama for a completely free, local setup

---

## How It Works

1. **Type your prompt** in any AI chat — don't worry about wording
2. **Click the PromptCraft button** or press `Ctrl+Shift+E`
3. **Your prompt is analyzed** — the input parser detects content type, intent, quality issues
4. **Enhanced and inserted** — the improved prompt replaces your original, with undo available

### Enhancement Pipeline

```
Your Input
    |
    v
[Local Analysis] — segments content, detects intent, scores quality
    |
    v
[Deep Analysis] — (optional) LLM-powered semantic understanding
    |
    v
[Template + Tone] — applies style template with context and analysis hints
    |
    v
[Provider Call] — sends to your configured AI provider
    |
    v
[Preamble Strip] — removes any "Here's your improved prompt:" leakage
    |
    v
Enhanced Prompt (streamed into your chat input)
```

---

## Project Structure

```
PromptCraft/
  background.js      # Service worker — API gateway, provider routing, streaming
  content.js         # Content script — DOM injection, context extraction, diff view
  constants.js       # Configuration — prompts, templates, models, platform hints
  input-parser.js    # Input analysis — segmentation, intent, scoring, deep analysis
  popup.html         # Extension popup UI
  popup.js           # Popup logic — settings, templates, history, usage
  popup.css          # Popup styles with dark mode
  panel.js           # Floating panel injection
  manifest.json      # Chrome extension manifest v3
  icons/             # Extension icons
  icon.png           # Main logo
```

---

## Contributing

Open an issue or submit a pull request. All contributions welcome.

---

## License

MIT License
