// PromptCraft — Input Parser
// Analyzes user input before enhancement to provide structured metadata
// that helps the AI understand what it's working with.

const InputParser = {

  // ── Main entry point (local analysis — instant, free) ─────────────────────
  analyze(text) {
    if (!text || typeof text !== 'string') {
      return { raw: '', segments: [], signals: {}, hints: '' };
    }

    const trimmed = text.trim();
    const segments = this.segmentContent(trimmed);
    const signals = {
      intent: this.detectIntent(trimmed),
      complexity: this.measureComplexity(trimmed),
      quality: this.assessQuality(trimmed),
      language: this.detectLanguageStyle(trimmed),
      contentTypes: this.detectContentTypes(trimmed),
      structure: this.analyzeStructure(trimmed),
    };

    const hints = this.buildHints(segments, signals);

    return { raw: trimmed, segments, signals, hints };
  },

  // ── Deep analysis (LLM-powered — uses the user's configured provider) ─────
  // Returns an additional hints string from LLM semantic analysis.
  // callerFn: async function(prompt, systemPrompt) => string
  async analyzeDeep(text, callerFn) {
    if (!text || text.trim().length < 5) return '';

    try {
      const response = await callerFn(text.substring(0, 2000), DEEP_ANALYSIS_PROMPT);
      if (!response || response.trim().length === 0) return '';

      // Parse the structured response
      const lines = response.trim().split('\n').filter(l => l.trim());
      const parsed = {};
      for (const line of lines) {
        const match = line.match(/^(INTENT|DOMAIN|TONE_MATCH|MISSING|PRESERVE|STRATEGY):\s*(.+)/i);
        if (match) {
          parsed[match[1].toLowerCase()] = match[2].trim();
        }
      }

      // Build hints from parsed LLM analysis
      const parts = [];
      if (parsed.intent) parts.push(`Underlying goal: ${parsed.intent}`);
      if (parsed.domain) parts.push(`Domain: ${parsed.domain}`);
      if (parsed.tone_match) parts.push(`Target tone: ${parsed.tone_match}`);
      if (parsed.missing) parts.push(`Missing from input: ${parsed.missing}`);
      if (parsed.preserve) parts.push(`Must preserve: ${parsed.preserve}`);
      if (parsed.strategy) parts.push(`Enhancement strategy: ${parsed.strategy}`);

      if (parts.length === 0) return '';

      return '\n\nDeep Analysis (LLM-powered insights):\n' + parts.map(p => `• ${p}`).join('\n') + '\n';
    } catch (err) {
      // Deep analysis is best-effort — don't block enhancement if it fails
      console.warn('Deep analysis failed:', err.message);
      return '';
    }
  },

  // ── Content Segmentation ──────────────────────────────────────────────────
  // Breaks input into typed segments: user text, quotes, code, urls, errors, data
  segmentContent(text) {
    const segments = [];
    let remaining = text;

    // Extract fenced code blocks first (```...```)
    remaining = this._extract(remaining, segments,
      /```[\s\S]*?```/g,
      'code'
    );

    // Extract inline code (`...`)
    remaining = this._extract(remaining, segments,
      /`[^`\n]{3,}`/g,
      'code_inline'
    );

    // Extract URLs
    remaining = this._extract(remaining, segments,
      /https?:\/\/[^\s<>"')\]]+/g,
      'url'
    );

    // Extract quoted blocks ("..." or '...' spanning 20+ chars)
    remaining = this._extract(remaining, segments,
      /[""][^""]{20,}[""]|['][^']{20,}[']/g,
      'quote'
    );

    // Extract error-like patterns (stack traces, error messages)
    remaining = this._extract(remaining, segments,
      /(?:Error|Exception|TypeError|SyntaxError|ReferenceError|Traceback|FATAL|WARN|ERR)[:\s].*?(?:\n\s+at\s.*)*(?:\n|$)/gi,
      'error'
    );

    // Extract data-like patterns (JSON objects, CSV-like rows, key:value pairs)
    remaining = this._extract(remaining, segments,
      /\{[\s\S]{10,}?\}|\[[\s\S]{10,}?\]/g,
      'data'
    );

    // Whatever's left is user prose
    const prose = remaining.trim();
    if (prose.length > 0) {
      segments.unshift({ type: 'prose', content: prose });
    }

    return segments;
  },

  _extract(text, segments, regex, type) {
    const matches = text.match(regex);
    if (matches) {
      for (const match of matches) {
        segments.push({ type, content: match.trim() });
        text = text.replace(match, ' ');
      }
    }
    return text;
  },

  // ── Intent Detection ──────────────────────────────────────────────────────
  // What is the user trying to do?
  detectIntent(text) {
    const lower = text.toLowerCase();
    const intents = [];

    // Question — asking for information
    const questionPatterns = [
      /^(what|how|why|when|where|who|which|can|could|would|should|is|are|do|does|will|has|have)\b/i,
      /\?\s*$/,
      /\bexplain\b/i,
      /\btell me\b/i,
      /\bwhat is\b/i,
      /\bhow (do|does|can|to)\b/i,
    ];
    if (questionPatterns.some(p => p.test(text))) {
      intents.push('question');
    }

    // Instruction — commanding the AI to do something
    const instructionPatterns = [
      /^(write|create|make|build|generate|design|develop|implement|draft|compose|produce)\b/i,
      /^(list|give|provide|show|outline|summarize|describe)\b/i,
      /^(convert|translate|transform|reformat|restructure|reorganize)\b/i,
    ];
    if (instructionPatterns.some(p => p.test(text))) {
      intents.push('instruction');
    }

    // Debug/Fix — troubleshooting
    const debugPatterns = [
      /\b(fix|debug|error|bug|issue|problem|broken|doesn'?t work|not working|failing|crash)\b/i,
      /\b(troubleshoot|diagnose|resolve|solve)\b/i,
      /\bwhy (is|does|am|are) .*(error|fail|break|wrong|crash)/i,
    ];
    if (debugPatterns.some(p => p.test(text))) {
      intents.push('debug');
    }

    // Review/Analyze — looking at existing content
    const reviewPatterns = [
      /\b(review|analyze|evaluate|assess|critique|check|audit|inspect)\b/i,
      /\b(compare|contrast|pros and cons|advantages|disadvantages)\b/i,
      /\bwhat do you think\b/i,
      /\bgive (me |your )?(feedback|opinion|thoughts)\b/i,
    ];
    if (reviewPatterns.some(p => p.test(text))) {
      intents.push('review');
    }

    // Creative — artistic/imaginative output
    const creativePatterns = [
      /\b(story|poem|song|lyrics|creative|imagine|fiction|narrative|dialogue)\b/i,
      /\b(brainstorm|ideas?|inspire|inspiration|innovative)\b/i,
    ];
    if (creativePatterns.some(p => p.test(text))) {
      intents.push('creative');
    }

    // Refine — user wants to improve existing text
    const refinePatterns = [
      /\b(improve|rewrite|rephrase|revise|edit|polish|refine|enhance|upgrade)\b/i,
      /\bmake (it |this )?(better|clearer|shorter|longer|more)\b/i,
    ];
    if (refinePatterns.some(p => p.test(text))) {
      intents.push('refine');
    }

    // Reference action — "this", "it", "that" with an action = pasted content + instruction
    const referencePatterns = [
      /\b(fix|explain|summarize|translate|rewrite|analyze|review|check|respond to|reply to) (this|that|it|the above|the following)\b/i,
      /^(this|that|it)\b/i,
    ];
    if (referencePatterns.some(p => p.test(text))) {
      intents.push('reference_action');
    }

    if (intents.length === 0) {
      // Fallback: if it's very short and has no clear intent, it's likely vague
      if (text.length < 15) intents.push('vague');
      else intents.push('general');
    }

    return intents;
  },

  // ── Complexity Measurement ────────────────────────────────────────────────
  measureComplexity(text) {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const avgWordsPerSentence = words.length / Math.max(sentences.length, 1);

    // Count distinct requests/questions
    const questionMarks = (text.match(/\?/g) || []).length;
    const imperativeStarts = (text.match(/(?:^|\.\s+)[A-Z][a-z]+\b/g) || []).length;

    // Multi-part detection
    const listIndicators = (text.match(/(?:^|\n)\s*(?:\d+[.)]\s|-\s|\*\s|•\s)/gm) || []).length;
    const andAlso = (text.match(/\b(and also|additionally|furthermore|moreover|plus|also)\b/gi) || []).length;

    const multiPartScore = questionMarks + listIndicators + andAlso;

    let level;
    if (words.length <= 5) level = 'minimal';
    else if (words.length <= 20 && multiPartScore <= 1) level = 'simple';
    else if (words.length <= 60 && multiPartScore <= 2) level = 'moderate';
    else level = 'complex';

    return {
      level,
      wordCount: words.length,
      sentenceCount: sentences.length,
      avgWordsPerSentence: Math.round(avgWordsPerSentence * 10) / 10,
      multiPartCount: multiPartScore,
      isMultiPart: multiPartScore > 1,
    };
  },

  // ── Quality Assessment ────────────────────────────────────────────────────
  assessQuality(text) {
    const issues = [];

    // Typos / informal markers
    const typoPatterns = [
      /\b(u|ur|pls|plz|thx|idk|imo|tbh|ngl|btw|lol|lmao|brb|smh|fr|rn)\b/gi,
      /\b(gonna|wanna|gotta|kinda|sorta|dunno|lemme|gimme)\b/gi,
    ];
    let typoCount = 0;
    for (const p of typoPatterns) {
      const matches = text.match(p);
      if (matches) typoCount += matches.length;
    }
    if (typoCount > 0) issues.push({ type: 'informal_language', count: typoCount });

    // Vagueness indicators
    const vagueTerms = text.match(/\b(something|stuff|things?|good|bad|nice|cool|some|a lot|kind of|sort of|basically|just|really|very|like)\b/gi);
    if (vagueTerms && vagueTerms.length >= 2) {
      issues.push({ type: 'vague_language', count: vagueTerms.length, examples: [...new Set(vagueTerms.slice(0, 4).map(t => t.toLowerCase()))] });
    }

    // Missing context — pronouns without clear referents
    const danglingPronouns = text.match(/\b(it|this|that|these|those|they)\b/gi);
    const words = text.split(/\s+/);
    if (danglingPronouns && danglingPronouns.length > 0 && words.length < 15) {
      issues.push({ type: 'missing_context', detail: 'Short prompt with pronouns that may lack referents' });
    }

    // Too short to be useful
    if (words.length <= 3) {
      issues.push({ type: 'too_short' });
    }

    // Already well-structured (has sections, bullets, constraints)
    const structureMarkers = (text.match(/(?:^|\n)\s*(?:#{1,3}\s|-\s|\*\s|\d+[.)]\s)/gm) || []).length;
    const hasConstraints = /\b(must|should|do not|don't|avoid|ensure|require|constraint|format|limit)\b/i.test(text);
    if (structureMarkers >= 3 && hasConstraints) {
      issues.push({ type: 'already_structured', detail: 'Prompt is already well-organized' });
    }

    // Repeated words/phrases
    const wordFreq = {};
    for (const w of words.map(w => w.toLowerCase().replace(/[^a-z]/g, ''))) {
      if (w.length > 3) wordFreq[w] = (wordFreq[w] || 0) + 1;
    }
    const repeated = Object.entries(wordFreq).filter(([, c]) => c >= 3).map(([w]) => w);
    if (repeated.length > 0) {
      issues.push({ type: 'repetition', words: repeated });
    }

    return {
      issues,
      score: Math.max(0, 10 - issues.length * 2),
      isAlreadyStrong: issues.length === 0 && words.length > 10,
    };
  },

  // ── Language Style Detection ──────────────────────────────────────────────
  detectLanguageStyle(text) {
    const lower = text.toLowerCase();

    // Detect formality level
    let formalityScore = 5; // neutral

    // Formal indicators
    const formalWords = lower.match(/\b(therefore|consequently|furthermore|nevertheless|regarding|pertaining|utilize|facilitate|implement|comprehensive|subsequently)\b/g);
    if (formalWords) formalityScore += formalWords.length;

    // Informal indicators
    const informalWords = lower.match(/\b(hey|hi|yo|sup|dude|bro|gonna|wanna|gotta|kinda|lol|haha|ok|okay|yeah|yep|nope|cool|awesome|stuff)\b/g);
    if (informalWords) formalityScore -= informalWords.length;

    // Detect if it's a non-English prompt (basic heuristic)
    const nonLatinRatio = (text.match(/[^\x00-\x7F]/g) || []).length / Math.max(text.length, 1);
    const hasNonLatin = nonLatinRatio > 0.3;

    // Detect all-caps shouting
    const capsWords = text.match(/\b[A-Z]{3,}\b/g) || [];
    const totalWords = text.split(/\s+/).length;
    const isShoutingRatio = capsWords.length / Math.max(totalWords, 1);

    let formality;
    if (formalityScore >= 8) formality = 'formal';
    else if (formalityScore >= 5) formality = 'neutral';
    else if (formalityScore >= 3) formality = 'casual';
    else formality = 'very_casual';

    return {
      formality,
      formalityScore: Math.min(10, Math.max(0, formalityScore)),
      hasNonLatin,
      hasShouting: isShoutingRatio > 0.3 && capsWords.length > 2,
    };
  },

  // ── Content Type Detection ────────────────────────────────────────────────
  detectContentTypes(text) {
    const types = [];

    // Code detection — real patterns, not just backticks
    const codePatterns = [
      /\b(function|const|let|var|class|import|export|return|if|else|for|while|switch|try|catch)\b\s*[\({]/,
      /\b(def|class|import|from|print|self|elif|except|lambda)\b/,
      /[{}\[\]();]\s*\n/,
      /(=>|->|::|\.\.|\.\.\.)/,
      /\b(public|private|protected|static|void|int|string|bool)\b/,
      /^\s*(#include|using namespace|package |import java)/m,
      /\bsql\b|SELECT\s+.*\s+FROM|INSERT\s+INTO|CREATE\s+TABLE/i,
      /\.(map|filter|reduce|forEach|push|pop|slice|concat)\(/,
      /[a-zA-Z_]\w*\s*=\s*[a-zA-Z_]\w*\s*\(/,
    ];
    if (codePatterns.some(p => p.test(text))) {
      types.push('code');
    }

    // Error/stack trace
    const errorPatterns = [
      /\bError:\s/,
      /\bTraceback\b/i,
      /\bat\s+\S+\s+\(/,
      /\bException\b/,
      /\bFATAL\b/,
      /\bSegmentation fault\b/i,
      /\bcommand not found\b/i,
      /\bpermission denied\b/i,
      /\bnpm ERR!/,
      /\bSyntaxError\b/,
      /\bTypeError\b/,
      /\bReferenceError\b/,
      /\bModuleNotFoundError\b/,
      /\bFileNotFoundError\b/,
      /exit code \d+/i,
    ];
    if (errorPatterns.some(p => p.test(text))) {
      types.push('error');
    }

    // Pasted/quoted content — long block without instructions
    const lines = text.split('\n');
    const longLines = lines.filter(l => l.trim().length > 80);
    const hasQuoteMarkers = /^[>|"']|[""][^""]{50,}[""]/m.test(text);
    if ((longLines.length >= 3 && longLines.length / lines.length > 0.5) || hasQuoteMarkers) {
      types.push('pasted_content');
    }

    // URLs present
    if (/https?:\/\/[^\s]+/.test(text)) {
      types.push('url');
    }

    // Data/structured content (JSON, CSV, tables)
    if (/^\s*[\[{]/.test(text) && /[\]}]\s*$/.test(text)) {
      types.push('json_data');
    }
    if ((text.match(/,/g) || []).length > 5 && (text.match(/\n/g) || []).length > 2) {
      const firstLine = lines[0];
      const commaCount = (firstLine.match(/,/g) || []).length;
      if (commaCount >= 2 && lines.slice(1, 4).every(l => (l.match(/,/g) || []).length >= commaCount - 1)) {
        types.push('csv_data');
      }
    }

    // List/enumeration
    const listItems = (text.match(/(?:^|\n)\s*(?:\d+[.)]\s|-\s|\*\s|•\s)/gm) || []).length;
    if (listItems >= 3) {
      types.push('list');
    }

    // Math/formulas
    if (/[=+\-*/^]{2,}|\\frac|\\sum|\\int|\b\d+\s*[+\-*/^]\s*\d+/.test(text)) {
      types.push('math');
    }

    if (types.length === 0) types.push('plain_text');
    return types;
  },

  // ── Structure Analysis ────────────────────────────────────────────────────
  analyzeStructure(text) {
    const lines = text.split('\n').filter(l => l.trim());

    // Detect if the prompt has mixed content (instruction + pasted stuff)
    const segments = this.segmentContent(text);
    const hasProse = segments.some(s => s.type === 'prose');
    const hasNonProse = segments.some(s => s.type !== 'prose');
    const isMixed = hasProse && hasNonProse;

    // Detect instruction position relative to content
    let instructionPosition = 'none';
    if (isMixed) {
      const proseIdx = segments.findIndex(s => s.type === 'prose');
      const contentIdx = segments.findIndex(s => s.type !== 'prose');
      if (proseIdx < contentIdx) instructionPosition = 'before_content';
      else if (proseIdx > contentIdx) instructionPosition = 'after_content';
      else instructionPosition = 'interleaved';
    }

    // Detect paragraph breaks (multiple topics)
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());

    return {
      lineCount: lines.length,
      paragraphCount: paragraphs.length,
      isMixed,
      instructionPosition,
      hasHeaders: /^#{1,3}\s/m.test(text),
      hasBullets: /(?:^|\n)\s*[-*•]\s/m.test(text),
      hasNumberedList: /(?:^|\n)\s*\d+[.)]\s/m.test(text),
    };
  },

  // ── Build Human-Readable Hints ────────────────────────────────────────────
  // This is what gets injected into the template for the AI
  buildHints(segments, signals) {
    const parts = [];

    // Content composition
    const typeMap = {
      code: 'code snippet',
      code_inline: 'inline code reference',
      url: 'URL/link',
      quote: 'quoted/pasted text',
      error: 'error message or stack trace',
      data: 'structured data',
      prose: 'user instruction',
    };
    const segmentTypes = [...new Set(segments.map(s => typeMap[s.type] || s.type))];
    if (segmentTypes.length > 0) {
      parts.push(`Input contains: ${segmentTypes.join(', ')}.`);
    }

    // Intent
    const intentLabels = {
      question: 'asking a question',
      instruction: 'giving a task/instruction',
      debug: 'troubleshooting or fixing an issue',
      review: 'requesting analysis or review',
      creative: 'seeking creative/imaginative output',
      refine: 'wanting to improve existing content',
      reference_action: 'referencing pasted/attached content with an action',
      vague: 'very short/vague — needs significant expansion',
      general: 'general request',
    };
    const intentDesc = signals.intent.map(i => intentLabels[i] || i).join(', ');
    parts.push(`User intent: ${intentDesc}.`);

    // Complexity
    parts.push(`Complexity: ${signals.complexity.level} (${signals.complexity.wordCount} words).`);
    if (signals.complexity.isMultiPart) {
      parts.push(`Contains ${signals.complexity.multiPartCount} sub-requests — consider addressing each.`);
    }

    // Quality issues — actionable guidance
    for (const issue of signals.quality.issues) {
      switch (issue.type) {
        case 'informal_language':
          parts.push('Input uses informal language/slang — elevate to clear, precise wording.');
          break;
        case 'vague_language':
          parts.push(`Vague terms detected (${issue.examples.join(', ')}) — replace with specifics.`);
          break;
        case 'missing_context':
          parts.push('Pronouns without clear referents — add explicit context.');
          break;
        case 'too_short':
          parts.push('Very short input — expand with constraints, context, and specificity.');
          break;
        case 'already_structured':
          parts.push('Input is already well-structured — make surgical improvements only.');
          break;
        case 'repetition':
          parts.push(`Repetitive words (${issue.words.join(', ')}) — vary language.`);
          break;
      }
    }

    // Content-specific guidance
    const ct = signals.contentTypes;
    if (ct.includes('error')) {
      parts.push('Contains error/stack trace — DO NOT rewrite the error. Build a prompt that asks for diagnosis and solutions.');
    }
    if (ct.includes('code')) {
      parts.push('Contains code — preserve code exactly. Build the prompt around explaining, fixing, or extending it.');
    }
    if (ct.includes('pasted_content')) {
      parts.push('Contains pasted/quoted text — distinguish user instructions from reference material. Don\'t rewrite the pasted content.');
    }
    if (ct.includes('url')) {
      parts.push('Contains URLs — preserve URLs exactly. Reference them in the enhanced prompt.');
    }
    if (ct.includes('json_data') || ct.includes('csv_data')) {
      parts.push('Contains structured data — preserve data format. Build prompt around analyzing/processing it.');
    }

    // Mixed content guidance
    if (signals.structure.isMixed) {
      if (signals.structure.instructionPosition === 'before_content') {
        parts.push('Structure: instruction followed by reference content. Enhance the instruction, preserve the content.');
      } else if (signals.structure.instructionPosition === 'after_content') {
        parts.push('Structure: reference content followed by instruction. The pasted content is context, the instruction at the end is what to enhance.');
      }
    }

    // Language style
    if (signals.language.formality === 'very_casual') {
      parts.push('Very casual tone — formalize while preserving intent.');
    }
    if (signals.language.hasShouting) {
      parts.push('Contains ALL CAPS emphasis — convert to clear, specific language.');
    }
    if (signals.language.hasNonLatin) {
      parts.push('Contains non-Latin characters — may be non-English. Preserve the language.');
    }

    if (parts.length === 0) return '';

    return '\n\nInput Analysis (use this to guide your enhancement):\n' + parts.map(p => `• ${p}`).join('\n') + '\n';
  },
};
