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

  // ── Prompt Scoring System ─────────────────────────────────────────────────
  // Returns a deterministic 0-100 score with breakdown and suggestions.

  scorePrompt(text) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return {
        overall: 0,
        breakdown: { specificity: 0, clarity: 0, structure: 0, context: 0, actionability: 0 },
        suggestions: ['Provide a non-empty prompt to score.']
      };
    }

    const trimmed = text.trim();
    const specificity  = this._scoreSpecificity(trimmed);
    const clarity      = this._scoreClarity(trimmed);
    const structure    = this._scoreStructure(trimmed);
    const context      = this._scoreContext(trimmed);
    const actionability = this._scoreActionability(trimmed);

    // Weighted average: actionability and specificity matter most
    const overall = Math.round(
      specificity  * 0.22 +
      clarity      * 0.20 +
      structure    * 0.18 +
      context      * 0.18 +
      actionability * 0.22
    );

    const suggestions = this._generateSuggestions(trimmed, {
      specificity, clarity, structure, context, actionability
    });

    return {
      overall,
      breakdown: { specificity, clarity, structure, context, actionability },
      suggestions
    };
  },

  // ── Specificity Score ─────────────────────────────────────────────────────
  // Penalizes vague words, rewards numbers, technical terms, named entities.
  _scoreSpecificity(text) {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return 0;

    let score = 50; // Start neutral

    // Penalize vague/filler words
    const vagueWords = /\b(something|stuff|things?|good|bad|nice|cool|great|awesome|interesting|important|basically|just|really|very|like|kind\s+of|sort\s+of|a\s+lot|some|certain|various|many|few|several|much|quite|pretty\s+much|somehow|whatever|anything|everything|somewhere|someone|anybody)\b/gi;
    const vagueMatches = text.match(vagueWords) || [];
    const vagueRatio = vagueMatches.length / words.length;
    score -= Math.min(35, Math.round(vagueRatio * 200));

    // Reward numbers and quantifiers (specific amounts, dates, percentages)
    const numberMatches = text.match(/\b\d+[\d.,]*%?\b/g) || [];
    score += Math.min(15, numberMatches.length * 5);

    // Reward technical terms (camelCase, snake_case, PascalCase, acronyms, file extensions)
    const technicalPatterns = text.match(/\b[a-z]+[A-Z][a-zA-Z]*\b|[a-z]+_[a-z]+|\b[A-Z]{2,}\b|\b\w+\.\w{1,5}\b/g) || [];
    score += Math.min(12, technicalPatterns.length * 3);

    // Reward quoted terms (shows specificity)
    const quotedTerms = text.match(/[""][^""]+[""]|'[^']+'/g) || [];
    score += Math.min(8, quotedTerms.length * 4);

    // Reward specific named entities (capitalized multi-word phrases not at sentence start)
    const namedEntities = text.match(/(?<=[.!?]\s+|,\s+|\band\s+|\bfor\s+|\bin\s+|\busing\s+|\bwith\s+)[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g) || [];
    score += Math.min(10, namedEntities.length * 5);

    // Penalize extremely short prompts (few words = likely vague)
    if (words.length <= 3) score -= 20;
    else if (words.length <= 6) score -= 10;
    else if (words.length <= 10) score -= 5;

    // Reward moderate-to-long prompts that still avoid vagueness
    if (words.length > 20 && vagueMatches.length <= 1) score += 5;

    return Math.max(0, Math.min(100, score));
  },

  // ── Clarity Score ─────────────────────────────────────────────────────────
  // Penalizes run-on sentences, ambiguous pronouns, double negatives, passive voice.
  _scoreClarity(text) {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length === 0) return 0;

    let score = 60; // Start slightly above neutral

    // Penalize run-on sentences (>30 words)
    let runOnCount = 0;
    let shortClearCount = 0;
    for (const sentence of sentences) {
      const wordCount = sentence.trim().split(/\s+/).filter(w => w.length > 0).length;
      if (wordCount > 30) runOnCount++;
      else if (wordCount >= 5 && wordCount <= 20) shortClearCount++;
    }
    score -= runOnCount * 10;
    score += Math.min(10, shortClearCount * 3);

    // Penalize ambiguous pronouns without clear referents in short prompts
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const pronouns = text.match(/\b(it|this|that|these|those|they|them|he|she)\b/gi) || [];
    if (words.length < 20 && pronouns.length >= 2) {
      score -= pronouns.length * 5;
    } else if (pronouns.length > 0) {
      // In longer text, mild penalty proportional to density
      const pronounRatio = pronouns.length / words.length;
      if (pronounRatio > 0.1) score -= Math.round(pronounRatio * 30);
    }

    // Penalize double negatives
    const doubleNegatives = text.match(/\b(not|n't|no|never|neither|nor)\b[^.!?]{0,20}\b(not|n't|no|never|neither|none|nothing|nobody|nowhere)\b/gi) || [];
    score -= doubleNegatives.length * 8;

    // Penalize excessive passive voice
    const passivePatterns = text.match(/\b(is|are|was|were|be|been|being)\s+(being\s+)?\w+ed\b/gi) || [];
    score -= Math.min(15, passivePatterns.length * 4);

    // Reward presence of clear punctuation (structured thought)
    const hasSemicolons = (text.match(/;/g) || []).length;
    const hasColons = (text.match(/:/g) || []).length;
    const hasParenthetical = (text.match(/\([^)]+\)/g) || []).length;
    score += Math.min(8, (hasSemicolons + hasColons + hasParenthetical) * 2);

    // Penalize ALL-CAPS sections (unclear emphasis)
    const capsWords = text.match(/\b[A-Z]{3,}\b/g) || [];
    const capsRatio = capsWords.length / Math.max(words.length, 1);
    if (capsRatio > 0.15) score -= 10;

    // Very short prompts that are single clear sentences get a small bonus
    if (sentences.length === 1 && words.length >= 5 && words.length <= 25 && runOnCount === 0) {
      score += 5;
    }

    return Math.max(0, Math.min(100, score));
  },

  // ── Structure Score ───────────────────────────────────────────────────────
  // Rewards organized formatting, penalizes wall-of-text.
  _scoreStructure(text) {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return 0;

    let score = 40; // Start below neutral — structure must be earned

    const lines = text.split('\n');
    const nonEmptyLines = lines.filter(l => l.trim().length > 0);

    // Reward numbered lists
    const numberedItems = (text.match(/(?:^|\n)\s*\d+[.)]\s/gm) || []).length;
    score += Math.min(20, numberedItems * 6);

    // Reward bullet points
    const bulletItems = (text.match(/(?:^|\n)\s*[-*•]\s/gm) || []).length;
    score += Math.min(15, bulletItems * 5);

    // Reward headers (markdown-style)
    const headers = (text.match(/(?:^|\n)\s*#{1,4}\s/gm) || []).length;
    score += Math.min(15, headers * 7);

    // Reward paragraph breaks (multiple paragraphs = organized thought)
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    if (paragraphs.length >= 2) score += Math.min(10, paragraphs.length * 3);

    // Reward section-like separators (---  ===  blank lines between topics)
    const separators = (text.match(/(?:^|\n)\s*[-=]{3,}\s*(?:\n|$)/gm) || []).length;
    score += Math.min(5, separators * 3);

    // Penalize wall-of-text: long text with no line breaks
    if (words.length > 40 && nonEmptyLines.length <= 1) {
      score -= 20;
    } else if (words.length > 80 && nonEmptyLines.length <= 3) {
      score -= 15;
    }

    // Reward logical ordering keywords (suggests deliberate structure)
    const orderingWords = text.match(/\b(first|second|third|then|next|finally|lastly|step\s*\d+|phase\s*\d+|part\s*\d+)\b/gi) || [];
    score += Math.min(10, orderingWords.length * 3);

    // Short prompts that are inherently one-liner get a pass (not penalized for no structure)
    if (words.length <= 15) {
      // Single-sentence prompts don't need structure; normalize to neutral
      score = Math.max(score, 40);
    }

    return Math.max(0, Math.min(100, score));
  },

  // ── Context Score ─────────────────────────────────────────────────────────
  // Checks for background info, assumptions, audience, scope.
  _scoreContext(text) {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return 0;

    let score = 30; // Start low — context must be demonstrated

    const lower = text.toLowerCase();

    // Reward background/context phrases
    const backgroundPhrases = [
      /\b(background|context|for context)\b/i,
      /\b(i am|i'm|we are|we're|our team|my team)\b/i,
      /\b(currently|right now|at the moment)\b/i,
      /\b(working on|building|developing|creating|maintaining)\b/i,
      /\b(project|application|system|codebase|repository|product)\b/i,
    ];
    let bgCount = 0;
    for (const p of backgroundPhrases) {
      if (p.test(text)) bgCount++;
    }
    score += Math.min(20, bgCount * 6);

    // Reward stated assumptions
    const assumptionPhrases = [
      /\b(assum(e|ing|ption)|given that|suppose|considering)\b/i,
      /\b(prerequisite|requirement|constraint|limitation)\b/i,
    ];
    for (const p of assumptionPhrases) {
      if (p.test(text)) score += 5;
    }

    // Reward target audience specification
    const audiencePatterns = [
      /\b(audience|reader|user|beginner|expert|developer|manager|student|client|customer|stakeholder)\b/i,
      /\b(for\s+(a|an|the)\s+\w+\s+(audience|team|group|person|developer|reader))\b/i,
      /\b(aimed at|intended for|targeted at|written for)\b/i,
    ];
    let audienceFound = false;
    for (const p of audiencePatterns) {
      if (p.test(text)) { audienceFound = true; score += 6; break; }
    }

    // Reward scope definition
    const scopePatterns = [
      /\b(scope|focus on|limited to|specifically|in particular|only\s+\w+ing)\b/i,
      /\b(don't|do not|avoid|exclude|skip|ignore)\b/i,
      /\b(between\s+\d+\s+and\s+\d+|at least|at most|no more than|up to|maximum|minimum)\b/i,
    ];
    for (const p of scopePatterns) {
      if (p.test(text)) score += 5;
    }

    // Reward examples being provided
    const examplePatterns = [
      /\b(for example|e\.g\.|such as|like\s+this|here'?s?\s+an?\s+example)\b/i,
      /\b(example|sample|instance|illustration)\b/i,
    ];
    for (const p of examplePatterns) {
      if (p.test(text)) { score += 7; break; }
    }

    // Penalize pure-instruction-with-zero-context
    // (starts with imperative verb, short, no background phrases)
    const startsImperative = /^(write|create|make|build|generate|list|give|explain|tell|show|describe|summarize|fix|find|help|do)\b/i.test(text);
    if (startsImperative && bgCount === 0 && words.length < 20) {
      score -= 15;
    }

    // Reward longer prompts proportionally (more words = more likely context exists)
    if (words.length > 30) score += 5;
    if (words.length > 60) score += 5;
    if (words.length > 100) score += 5;

    return Math.max(0, Math.min(100, score));
  },

  // ── Actionability Score ───────────────────────────────────────────────────
  // Checks for clear action verbs, output format, constraints.
  _scoreActionability(text) {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return 0;

    let score = 35; // Start below neutral

    const lower = text.toLowerCase();

    // Reward clear action verbs
    const actionVerbs = [
      /\b(write|create|generate|build|implement|develop|design|draft|compose|produce)\b/i,
      /\b(explain|describe|summarize|outline|analyze|evaluate|compare|contrast)\b/i,
      /\b(list|enumerate|identify|categorize|classify|rank|prioritize)\b/i,
      /\b(convert|translate|transform|reformat|refactor|optimize|migrate)\b/i,
      /\b(fix|debug|resolve|diagnose|troubleshoot|test|validate|verify)\b/i,
      /\b(review|critique|assess|audit|check|proofread|edit)\b/i,
    ];
    let verbCount = 0;
    for (const p of actionVerbs) {
      const matches = text.match(p);
      if (matches) verbCount += matches.length;
    }
    score += Math.min(20, verbCount * 6);

    // Reward output format specification
    const formatPatterns = [
      /\b(format|formatted as|in the form of|as a)\b/i,
      /\b(table|list|bullet|numbered|json|csv|markdown|html|xml|yaml)\b/i,
      /\b(paragraph|essay|report|email|letter|memo|presentation|slide)\b/i,
      /\b(code|function|class|module|script|snippet|api|endpoint)\b/i,
    ];
    let formatCount = 0;
    for (const p of formatPatterns) {
      if (p.test(text)) formatCount++;
    }
    score += Math.min(12, formatCount * 4);

    // Reward length/depth hints
    const depthPatterns = [
      /\b(brief|concise|short|detailed|comprehensive|thorough|in-depth|high-level|overview)\b/i,
      /\b(\d+\s*words?|\d+\s*sentences?|\d+\s*paragraphs?|\d+\s*pages?|\d+\s*lines?|\d+\s*items?)\b/i,
      /\b(at least|at most|no more than|approximately|around|about)\s+\d+/i,
    ];
    for (const p of depthPatterns) {
      if (p.test(text)) { score += 8; break; }
    }

    // Reward explicit constraints
    const constraintPatterns = [
      /\b(must|should|shall|need to|has to|have to|required)\b/i,
      /\b(don't|do not|never|avoid|exclude|without|except)\b/i,
      /\b(ensure|make sure|guarantee|always|only)\b/i,
    ];
    let constraintCount = 0;
    for (const p of constraintPatterns) {
      if (p.test(text)) constraintCount++;
    }
    score += Math.min(10, constraintCount * 4);

    // Penalize prompts with no clear ask (no verbs, no question mark)
    const hasQuestion = /\?/.test(text);
    if (verbCount === 0 && !hasQuestion) {
      score -= 20;
    }

    // Reward question marks (shows a clear ask)
    if (hasQuestion) score += 5;

    // Reward role/persona assignment
    if (/\b(act as|you are|pretend|imagine you|role|persona|as a|as an)\b/i.test(text)) {
      score += 7;
    }

    return Math.max(0, Math.min(100, score));
  },

  // ── Suggestion Generator ──────────────────────────────────────────────────
  // Returns 1-3 targeted suggestions based on the lowest-scoring dimensions.
  _generateSuggestions(text, scores) {
    const suggestions = [];
    const words = text.split(/\s+/).filter(w => w.length > 0);

    // Sort dimensions by score ascending to prioritize the weakest areas
    const ranked = Object.entries(scores).sort((a, b) => a[1] - b[1]);

    for (const [dimension, dimScore] of ranked) {
      if (suggestions.length >= 3) break;
      if (dimScore >= 70) continue; // Don't suggest fixes for strong areas

      switch (dimension) {
        case 'specificity':
          if (dimScore < 40) {
            const vagueWords = text.match(/\b(something|stuff|things?|good|bad|nice|cool|basically|just|really|very)\b/gi);
            if (vagueWords && vagueWords.length > 0) {
              const unique = [...new Set(vagueWords.map(w => w.toLowerCase()))].slice(0, 3);
              suggestions.push(`Replace vague terms (${unique.join(', ')}) with specific nouns, numbers, or named entities.`);
            } else if (words.length <= 6) {
              suggestions.push('Add specific details: names, quantities, technical terms, or concrete examples.');
            } else {
              suggestions.push('Increase specificity by replacing general language with precise terms and measurable criteria.');
            }
          } else {
            suggestions.push('Add more specific details such as exact numbers, names, or technical terms.');
          }
          break;

        case 'clarity':
          if (text.split(/[.!?]+/).some(s => s.trim().split(/\s+/).length > 30)) {
            suggestions.push('Break long sentences (30+ words) into shorter, focused statements.');
          } else if ((text.match(/\b(it|this|that|they)\b/gi) || []).length >= 2 && words.length < 20) {
            suggestions.push('Replace ambiguous pronouns (it, this, that) with the specific nouns they refer to.');
          } else {
            suggestions.push('Use direct, active voice and keep sentences under 25 words for maximum clarity.');
          }
          break;

        case 'structure':
          if (words.length > 40 && text.split('\n').filter(l => l.trim()).length <= 1) {
            suggestions.push('Break the wall of text into paragraphs, bullet points, or numbered steps.');
          } else if (words.length > 20) {
            suggestions.push('Add structure with numbered steps, headers, or bullet points to organize your request.');
          } else {
            suggestions.push('For multi-part requests, use a numbered list to separate each requirement.');
          }
          break;

        case 'context':
          if (/^(write|create|make|build|generate|list|give|explain)\b/i.test(text) && words.length < 20) {
            suggestions.push('Add context: who is the audience, what is the purpose, and what constraints apply?');
          } else {
            suggestions.push('Provide background context: state your assumptions, target audience, or project scope.');
          }
          break;

        case 'actionability':
          if (!(text.match(/\b(write|create|explain|analyze|list|build|fix|review|generate|describe|summarize)\b/i))) {
            suggestions.push('Start with a clear action verb (write, explain, create, analyze) so the AI knows exactly what to produce.');
          } else {
            suggestions.push('Specify the desired output format, length, and depth to make the request more actionable.');
          }
          break;
      }
    }

    // If all scores are high, give a positive note
    if (suggestions.length === 0) {
      suggestions.push('This prompt is well-crafted. Consider adding edge cases or constraints for an even stronger result.');
    }

    return suggestions;
  },
};
