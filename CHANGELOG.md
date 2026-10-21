# Changelog

## 1.1.1

### Changed
- **Shorter rewrites.** *Concise* aims for one to three sentences (with gemma3:4b the typical rewrite went from 63 to 39 words), and *Shorter* asks for about half the length of the rewrite it shortens, which it now delivers.
- The previous rewrite in a tab is passed along only when the new draft continues it, and today's date only when the draft is time-sensitive. Small models were rewriting the earlier draft instead of the new one, or adding the date to unrelated prompts.
- A rewrite of a few sentences written as one paragraph is no longer scored down as a wall of text. When a rewrite does score lower than the draft, the before → after badge is highlighted and says why.
- New installs default to `gemma3` for Ollama, matching the setup steps; updates from 1.0 keep `llama3`. Embedding models are left out of the Ollama model list, so one can't become the default.
- The side panel's shortcut hint reads ⌘ Enter on a Mac, and a rewrite that is stopped or fails partway is cleared instead of left half-written.

### Fixed
- Small models that repeated their instructions ("Enhance this prompt to be maximally effective…") and the template's guidelines had them written into the text box. They are removed, and every request now ends by asking for the prompt alone.

## 1.1.0

### Added
- **Side panel.** The toolbar icon opens PromptCraft in Chrome's side panel. It stays open while you switch tabs and follows the page beside it.
- **Badge in the prompt box.** A small badge in the corner of the text box replaces the floating button. It shows how many things the review found and opens a card with the score, the weak spots (each with a one-click *Fix*), the tone, and *Improve prompt*.
- **Suggest, then accept.** A rewrite streams into a card beside the box and is only written into it when you press *Accept* or `Enter`. *Dismiss* or `Esc` leaves your text alone, and *Undo* is offered after accepting.
- **Live prompt review**, on the page and in the side panel: a 0-100 score and up to three things to improve as you type. It is scored locally; nothing is sent to a model until you ask for a rewrite.
- **Built-in model, no setup.** Where the browser has its own on-device model (Gemini Nano in recent desktop Chrome), PromptCraft offers it as a provider and as the recommended choice in onboarding: no API key, no cost, and prompts never leave the computer. It is hidden where the browser or the computer cannot run it.
- **Streaming on every provider**, including Claude and Ollama. Press `Esc` or *Stop* to cancel.
- **Works on any site.** Right-click a text field → *Enhance with PromptCraft*, or press `Ctrl+Shift+E`. The shortcut can be rebound at `chrome://extensions/shortcuts`.
- **One-click refinement** after a rewrite: *Shorter*, *More detail*, *Try again*.
- **Fill in the blanks.** Rewrites leave a `[bracketed blank]` where only you know the detail, and the suggestion card offers a field for each.
- **Tone switching from the badge's review card.**
- **One switch for conversation context.** "Use this conversation" in the badge's card and "Use conversation" in the side panel are the same remembered setting. When it is off, the conversation on the page is not read for a rewrite or sent to the provider.
- **Custom provider settings** for any OpenAI-compatible API (Groq, Together, OpenRouter, LM Studio, vLLM), and a toggle for multi-step enhancement.
- **Live model lists.** ↻ in Settings loads the provider's current models.
- **Insert** button in the side panel puts the result into the page's text box.
- Before → after prompt score on every rewrite.
- Side-by-side view in the changes dialog.
- Test suite (`node --test`) and a store packaging script (`node scripts/package.js`).

### Changed
- Model defaults and lists updated to current OpenAI, Gemini and Claude models, including Claude Haiku 5.5. Saved Gemini 1.5 / 2.0 selections are moved to a current model.
- Choosing Ollama during onboarding selects a model that is already installed, and the setup steps include allowing browser extensions (`OLLAMA_ORIGINS`).
- *Clear* in History asks for a second click, like *Reset Stats*.
- The logo is a 256 px image, so the store package is about 240 KB instead of 1.5 MB.
- OpenAI requests use the Responses API. Claude requests no longer send sampling parameters, which current models reject.
- Usage statistics use the token counts the provider reports, and include models without a known price.
- History stores full prompts (previously cut at 500 / 800 characters).
- Deep analysis is off by default for new installs (it adds an API call per enhancement).
- **New look.** A clean writing-assistant layout in the logo's colours: white cards, one teal accent, and gold as the highlighter for what needs attention. Gradients and glass blobs are gone.
- The side panel has a tab bar (Write, Templates, History, Settings); Usage is reached from Settings.
- The changes dialog highlights additions and strikes out deletions.
- In-page UI is isolated in a shadow root, follows the page's light or dark theme, and shares the side panel's look.
- The Inter font is bundled; nothing is fetched from third parties.
- Decorative looping animations removed; `prefers-reduced-motion` is respected.

### Fixed
- Every enhancement on OpenAI, Gemini or a custom endpoint made two API calls and discarded the first.
- Streaming never reached the chat box.
- Rewrites beginning "Below is…" or "I've created…" were deleted by preamble stripping, failing the enhancement.
- `$$`, `$&` and `$'` in a prompt were altered before reaching the model.
- The enhanced prompt was hidden in the popup at its normal size.
- Requests to local models timed out after 15 seconds.
- Undo was never recorded, so the undo-rate hint never applied.
- Ordinary words such as "from", "class" and "public" marked a prompt as code.
- Line breaks were lost when reading a prompt from rich-text chat boxes.
- The side panel stayed on "Loading..." (no onboarding, tones or settings) in browsers where the built-in model never answers whether it is available. The check now gives up after a few seconds and the panel no longer waits for it.
- *Open panel* in the in-page card did nothing: the click's user gesture was lost before the side panel was asked to open.
- Settings reported "Connected" to an Ollama that refuses browser extensions, so every rewrite then failed. The connection check now makes the same kind of request a rewrite does.
- Small models that echoed the `<draft_prompt>` tags, or wrapped the rewrite in quotes, had those written into the text box.
- `$$`, `$&` and `{{input}}` typed into a template's fields were altered when the template was filled in.
- History tooltips cut off a prompt at its first double quote.
- A long word with no spaces (such as a pasted key or minified code) made the live review take half a second per pause in typing.

### Security and privacy
- API keys stay in the service worker. Content scripts are refused settings and history and cannot read extension storage.
- The extension no longer runs on every website, and no extension page is exposed to web pages.
- Removed the `tabs` permission.
- Password fields are never read.

### Accessibility
- Keyboard focus is visible throughout; model pickers, history rows and template cards work from the keyboard.
- Icon buttons are labelled; off-screen pages are inert; status messages are announced.
