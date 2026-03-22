// PromptCraft v2.0 — Shared constants
// Loaded by popup.html via <script> and background.js via importScripts()

const PROVIDERS = {
  API: 'api',
  OLLAMA: 'ollama'
};

const API_PROVIDERS = {
  OPENAI: 'openai',
  GEMINI: 'gemini',
  CLAUDE: 'claude'
};

const API_PROVIDER_LABELS = {
  openai: 'OpenAI',
  gemini: 'Gemini',
  claude: 'Claude'
};

// ── System Prompt (used for all enhancement API calls) ──────────────────────

const SYSTEM_PROMPT = `You are PromptCraft, a world-class prompt engineer. Your sole purpose is to transform user-written prompts into highly effective prompts that extract the best possible responses from AI assistants.

## Enhancement Principles
1. **Clarity & Precision** — Replace vague language with specific, unambiguous instructions.
2. **Structure** — Organize complex requests into logical sections, steps, or constraints.
3. **Context** — Add relevant background that helps the AI understand scope and intent.
4. **Output Specification** — Define what a great response looks like: format, length, depth.
5. **Edge Cases** — Anticipate ambiguity and address it proactively.
6. **Persona & Tone** — Match the sophistication level to the user's intent.

## Rules
- CRITICAL: Return ONLY the enhanced prompt text. Nothing else. No preamble, no commentary, no "Here's your improved prompt:", no "Okay, let's...", no "Sure!", no thinking out loud. Your entire response IS the enhanced prompt — the user will paste it directly into an AI chat.
- Preserve the user's core intent — enhance, don't redirect or change the topic.
- Don't add unnecessary complexity to simple requests.
- If conversation context is provided, use it to make the enhanced prompt more relevant, specific, and aware of what has already been discussed.
- Never wrap the output in quotes or markdown code blocks.
- If a previous enhancement is referenced, build on that trajectory rather than starting fresh.
- If an Input Analysis section is provided, use it to guide your enhancement strategy. It tells you what kind of content the user submitted (code, errors, pasted text, etc.), their intent, and specific quality issues to address. Follow its guidance on what to preserve vs. rewrite.`;

// ── Deep Analysis Prompt (LLM-powered input analysis) ───────────────────────

const DEEP_ANALYSIS_PROMPT = `You are an input analyzer for a prompt enhancement tool. Your job is to deeply understand what the user is trying to accomplish so the enhancement engine can do a better job.

Analyze the user's input and return a concise analysis in this exact format (no other text):

INTENT: [1-2 sentence description of what the user actually wants — not literally what they typed, but the underlying goal]
DOMAIN: [the subject domain — e.g., "web development", "creative writing", "data analysis", "general knowledge"]
TONE_MATCH: [what tone the enhanced prompt should use — e.g., "technical and precise", "conversational", "academic", "professional"]
MISSING: [what critical information is missing that would make this prompt much better — be specific, e.g., "no target audience specified", "no programming language mentioned", "no desired output format"]
PRESERVE: [what parts of the input must NOT be changed — e.g., "the error message on line 3", "the code block", "the quoted text", "the URLs"]
STRATEGY: [1-2 sentence recommendation for how to enhance this prompt — e.g., "add specificity about the tech stack and desired output format", "separate the debugging request from the feature request", "the user pasted an article and wants a summary — frame as a summarization task with constraints"]

Be brutally concise. No pleasantries. No markdown formatting. Just the labeled lines.`;

// ── Per-Style Configuration ─────────────────────────────────────────────────

const STYLE_CONFIG = {
  short:     { temperature: 0.3, maxTokens: 600 },
  detailed:  { temperature: 0.4, maxTokens: 1500 },
  creative:  { temperature: 0.8, maxTokens: 1200 },
  technical: { temperature: 0.3, maxTokens: 1500 },
  cot:       { temperature: 0.4, maxTokens: 1800 }
};

// ── Templates ───────────────────────────────────────────────────────────────
// {{context}} is replaced with conversation context (or empty string)
// {{input}} is replaced with the user's prompt

const TEMPLATES = {
  short: `Enhance this prompt to be maximally effective while staying concise.

Guidelines:
- Cut filler words, redundancy, and unnecessary qualifiers
- Front-load the core instruction — what matters most comes first
- Replace vague terms ("good", "some", "nice", "help me with") with specific, measurable language
- Make implicit requirements explicit in minimal words
- Add only the constraints that materially improve output quality
- If the prompt is already strong, make surgical improvements rather than rewriting entirely
{{context}}
Prompt to enhance:
{{input}}`,

  detailed: `Enhance this prompt to be comprehensive and produce thorough, high-quality responses.

Guidelines:
- Add specific constraints: desired format, length, depth level, and target audience
- Break complex requests into clearly numbered steps or labeled sections
- Define what an excellent response looks like — give the AI a quality bar
- Include edge cases, exceptions, or "do not" constraints where they prevent common mistakes
- Request structured output (headings, bullet points, tables) when it improves clarity
- Add context that helps the AI understand WHY the user needs this
{{context}}
Prompt to enhance:
{{input}}`,

  creative: `Enhance this prompt to unlock creative, original, and unexpected responses.

Guidelines:
- Add creative constraints that paradoxically increase originality (e.g., "approach this as a noir detective story", "explain using only cooking metaphors")
- Encourage non-obvious connections, analogies, or perspective shifts
- Suggest the AI explore multiple angles or generate variations
- Use evocative framing that inspires the AI beyond default patterns
- Preserve the core intent but push the boundaries of how it could be fulfilled
- Request that the AI surprise the reader while remaining useful and relevant
{{context}}
Prompt to enhance:
{{input}}`,

  technical: `Enhance this prompt for technical precision and production-quality output.

Guidelines:
- Specify the programming language, framework, version, and runtime environment if applicable
- Request error handling, input validation, and edge case coverage
- Ask for code that follows established best practices, patterns, and conventions
- Include requirements for type safety, performance considerations, and security implications
- Request explanations of design decisions and trade-offs made
- Ask for relevant tests, documentation, or usage examples where appropriate
- Specify whether you need a complete implementation vs. a focused snippet
- Mention the codebase context if relevant (existing patterns, libraries in use)
{{context}}
Prompt to enhance:
{{input}}`,

  cot: `Enhance this prompt to encourage structured, step-by-step reasoning before reaching a conclusion.

Guidelines:
- Structure the request so the AI must show its intermediate reasoning steps
- Break the problem into sub-questions that logically build toward the final answer
- Ask the AI to explicitly state its assumptions and justify each one
- Request that the AI consider the problem from at least two different angles before concluding
- Include "verify your reasoning" or "check for logical gaps" directives
- For analytical tasks, require evidence and reasoning before conclusions
- Ask the AI to identify what could change its answer (sensitivity analysis)
- Frame the request so the AI thinks deeply rather than pattern-matching to a quick answer
{{context}}
Prompt to enhance:
{{input}}`,

};

const STYLE_LABELS = {
  short: 'Concise',
  detailed: 'Detailed',
  creative: 'Creative',
  technical: 'Technical',
  cot: 'Reasoning'
};

const STORAGE_KEYS = {
  PROVIDER: 'provider',
  API_PROVIDER: 'apiProvider',
  OPENAI_API_KEY: 'openaiApiKey',
  OPENAI_MODEL: 'openaiModel',
  GEMINI_API_KEY: 'geminiApiKey',
  GEMINI_MODEL: 'geminiModel',
  CLAUDE_API_KEY: 'claudeApiKey',
  CLAUDE_MODEL: 'claudeModel',
  OLLAMA_ENDPOINT: 'ollamaEndpoint',
  OLLAMA_MODEL: 'ollamaModel',
  LAST_MODIFIER: 'lastModifier',
  HISTORY: 'promptHistory',
  CUSTOM_PRESETS: 'customPresets',
  PRESET_OVERRIDES: 'presetOverrides',
  ONBOARDING_COMPLETE: 'onboardingComplete',
  DEEP_ANALYSIS: 'deepAnalysis'
};

// Keys stored in chrome.storage.local (not sync)
const LOCAL_ONLY_KEYS = [STORAGE_KEYS.HISTORY, STORAGE_KEYS.CUSTOM_PRESETS, STORAGE_KEYS.PRESET_OVERRIDES, STORAGE_KEYS.ONBOARDING_COMPLETE];

const DEFAULT_SETTINGS = {
  [STORAGE_KEYS.PROVIDER]: PROVIDERS.API,
  [STORAGE_KEYS.API_PROVIDER]: API_PROVIDERS.GEMINI,
  [STORAGE_KEYS.OPENAI_API_KEY]: '',
  [STORAGE_KEYS.OPENAI_MODEL]: 'gpt-4o-mini',
  [STORAGE_KEYS.GEMINI_API_KEY]: '',
  [STORAGE_KEYS.GEMINI_MODEL]: 'gemini-2.0-flash',
  [STORAGE_KEYS.CLAUDE_API_KEY]: '',
  [STORAGE_KEYS.CLAUDE_MODEL]: 'claude-sonnet-4-20250514',
  [STORAGE_KEYS.OLLAMA_ENDPOINT]: 'http://localhost:11434',
  [STORAGE_KEYS.OLLAMA_MODEL]: 'llama3',
  [STORAGE_KEYS.LAST_MODIFIER]: 'short',
  [STORAGE_KEYS.DEEP_ANALYSIS]: true
};

const API_MODELS = {
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { id: 'o3-mini', label: 'o3-mini' }
  ],
  gemini: [
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' }
  ],
  claude: [
    { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' }
  ]
};

const API_HINTS = {
  openai: { url: 'https://platform.openai.com/api-keys', label: 'OpenAI Platform' },
  gemini: { url: 'https://aistudio.google.com/app/apikey', label: 'Google AI Studio' },
  claude: { url: 'https://console.anthropic.com/settings/keys', label: 'Anthropic Console' }
};

// Maps API provider to its storage keys for key/model
const API_STORAGE_MAP = {
  openai: { key: STORAGE_KEYS.OPENAI_API_KEY, model: STORAGE_KEYS.OPENAI_MODEL },
  gemini: { key: STORAGE_KEYS.GEMINI_API_KEY, model: STORAGE_KEYS.GEMINI_MODEL },
  claude: { key: STORAGE_KEYS.CLAUDE_API_KEY, model: STORAGE_KEYS.CLAUDE_MODEL }
};

const MAX_HISTORY = 100;
