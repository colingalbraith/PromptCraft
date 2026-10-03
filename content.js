// PromptCraft — Content Script
// Puts a small badge inside the text box you are writing in. The badge opens a
// review of the draft (score, weak spots, tone) and offers a rewrite, which is
// written into the box only when you accept it. On AI chat sites it also reads
// the conversation for context. On any other page it is injected on demand
// (context menu or keyboard shortcut).

(function () {
  // The script can arrive from the manifest and from on-demand injection — run once
  if (window.__promptcraftLoaded) return;
  window.__promptcraftLoaded = true;

  const HOST_ID = 'promptcraft-root';
  const IS_CHAT_SITE = detectPlatform() !== null;
  const SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘⇧E' : 'Ctrl+Shift+E';

  // Provider label, tone list and selected tone from the background worker.
  // API keys never reach this script.
  let publicSettings = null;

  // The text box the badge sits in, and the worker's review of the draft in it
  let field = null;
  let review = null;

  // The open card, the rewrite in flight, and the finished rewrite awaiting Accept
  let card = null;
  let run = null;
  let suggestion = null;

  // The last accepted rewrite, for Undo
  let undoState = null;

  // Most recently focused text field, for when focus has moved to our own UI
  let lastFocusedInput = null;

  // ── Word-level Diff (LCS-based) ──────────────────────────────────────────

  // The LCS table is (original tokens × rewritten tokens); beyond this it costs too much memory
  const MAX_DIFF_CELLS = 4000000;

  /**
   * Tokenize text into word tokens preserving whitespace runs.
   * Returns an array of tokens where each token is either a word
   * (including attached punctuation) or a whitespace run.
   */
  function diffTokenize(text) {
    const tokens = [];
    const re = /(\S+|\s+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      tokens.push(m[0]);
    }
    return tokens;
  }

  /**
   * LCS (Longest Common Subsequence) on two token arrays.
   * Returns the LCS length table for back-tracking.
   */
  function lcsTable(a, b) {
    const m = a.length;
    const n = b.length;
    // Use flat arrays for performance on large texts
    const dp = new Uint16Array((m + 1) * (n + 1));
    const w = n + 1;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i * w + j] = dp[(i - 1) * w + (j - 1)] + 1;
        } else {
          dp[i * w + j] = Math.max(dp[(i - 1) * w + j], dp[i * w + (j - 1)]);
        }
      }
    }
    return { dp, w, m, n };
  }

  /**
   * Back-track the LCS table to produce a diff.
   * Returns array of { type: 'equal'|'removed'|'added', value: string },
   * or null when the texts are too long to compare word by word.
   */
  function computeDiff(original, enhanced) {
    const a = diffTokenize(original);
    const b = diffTokenize(enhanced);
    if ((a.length + 1) * (b.length + 1) > MAX_DIFF_CELLS) return null;
    const { dp, w, m, n } = lcsTable(a, b);

    // Back-track
    const ops = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
        ops.push({ type: 'equal', value: a[i - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i * w + (j - 1)] >= dp[(i - 1) * w + j])) {
        ops.push({ type: 'added', value: b[j - 1] });
        j--;
      } else {
        ops.push({ type: 'removed', value: a[i - 1] });
        i--;
      }
    }
    ops.reverse();
    return ops;
  }

  // ── In-page UI ────────────────────────────────────────────────────────────
  // Everything PromptCraft draws on a page lives in one shadow root: the site's
  // CSS can't restyle it, and its CSS can't leak into the site. It follows the
  // page's light or dark theme and uses the logo's teal and gold.

  const UI_CSS = `
    :host {
      --pc-bg: #FFFFFF;
      --pc-sunken: #F3F5F4;
      --pc-ink: #15171C;
      --pc-ink-soft: #5A616B;
      --pc-line: #E1E4E1;
      --pc-accent: #064E5B;
      --pc-accent-wash: rgba(6, 78, 91, 0.08);
      --pc-action: #064E5B;
      --pc-gold: #F5BF66;
      --pc-mark: rgba(245, 191, 102, 0.5);
      --pc-mark-ink: #15171C;
      --pc-ok: #1F7A4D;
      --pc-error: #C2281E;
      --pc-hover: rgba(21, 23, 28, 0.06);
      --pc-shadow: 0 12px 32px rgba(21, 23, 28, 0.16), 0 2px 6px rgba(21, 23, 28, 0.08);
      --pc-scrim: rgba(21, 23, 28, 0.45);
      --pc-toast: #15171C;
    }
    :host([data-theme="dark"]) {
      --pc-bg: #1B1E24;
      --pc-sunken: #252930;
      --pc-ink: #E7E9ED;
      --pc-ink-soft: #9EA5B0;
      --pc-line: #333842;
      --pc-accent: #6FC4CF;
      --pc-accent-wash: rgba(111, 196, 207, 0.14);
      --pc-action: #0F7285;
      --pc-mark: rgba(245, 191, 102, 0.24);
      --pc-mark-ink: #F8D9A3;
      --pc-ok: #6FCB98;
      --pc-error: #FF8A80;
      --pc-hover: rgba(255, 255, 255, 0.08);
      --pc-shadow: 0 12px 32px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.35);
      --pc-scrim: rgba(0, 0, 0, 0.6);
      --pc-toast: #2D323B;
    }

    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .pc-badge, .pc-card, .pc-toast, .pc-diff {
      font: 400 13px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      color: var(--pc-ink);
      text-align: left;
    }
    button { font: inherit; color: inherit; cursor: pointer; margin: 0; }
    p { margin: 0; }
    :focus-visible { outline: 2px solid var(--pc-accent); outline-offset: 2px; }

    /* ── Badge: sits in the corner of the text box ── */
    .pc-badge {
      position: fixed;
      top: 0;
      left: 0;
      width: 26px;
      height: 26px;
      padding: 0;
      border: none;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--pc-action);
      color: #FFFFFF;
      box-shadow: 0 1px 4px rgba(21, 23, 28, 0.3);
      opacity: 0.88;
      transition: opacity 0.15s ease, box-shadow 0.15s ease;
    }
    .pc-badge:hover, .pc-badge[aria-expanded="true"] { opacity: 1; box-shadow: 0 2px 8px rgba(21, 23, 28, 0.35); }
    .pc-badge svg { width: 14px; height: 14px; }
    /* How many things the review found */
    .pc-count {
      position: absolute;
      top: -5px;
      right: -5px;
      min-width: 15px;
      height: 15px;
      padding: 0 4px;
      border-radius: 8px;
      background: var(--pc-gold);
      color: #15171C;
      font-size: 10px;
      font-weight: 700;
      line-height: 15px;
      text-align: center;
    }
    .pc-badge.pc-busy::after, .pc-spinner {
      content: '';
      border-radius: 50%;
      border: 2px solid transparent;
      border-top-color: var(--pc-gold);
      animation: pc-spin 0.8s linear infinite;
    }
    .pc-badge.pc-busy::after { position: absolute; inset: -4px; }
    .pc-spinner { width: 18px; height: 18px; flex-shrink: 0; border-color: var(--pc-line); border-top-color: var(--pc-accent); }
    @keyframes pc-spin { to { transform: rotate(360deg); } }

    /* ── Card: review, rewrite in progress, or suggested rewrite ── */
    .pc-card {
      position: fixed;
      display: flex;
      flex-direction: column;
      background: var(--pc-bg);
      border: 1px solid var(--pc-line);
      border-radius: 12px;
      box-shadow: var(--pc-shadow);
      overflow: hidden;
      animation: pc-pop 0.14s ease-out;
    }
    @keyframes pc-pop { from { opacity: 0; transform: translateY(4px); } }
    /* Moving from one view to the next: the card is already open, so it doesn't pop in again */
    .pc-card.pc-steady { animation: none; }
    .pc-head { display: flex; align-items: center; gap: 10px; padding: 12px 10px 10px 14px; flex-shrink: 0; }
    .pc-title { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; }
    .pc-title small { display: block; font-size: 12px; font-weight: 400; color: var(--pc-ink-soft); }
    .pc-body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 0 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .pc-actions { display: flex; gap: 8px; padding: 12px 14px; flex-shrink: 0; }
    .pc-foot {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 9px 14px;
      flex-shrink: 0;
      border-top: 1px solid var(--pc-line);
      background: var(--pc-sunken);
      font-size: 12px;
      color: var(--pc-ink-soft);
    }
    .pc-end { margin-left: auto; }

    .pc-btn {
      padding: 7px 14px;
      border-radius: 8px;
      border: 1px solid var(--pc-line);
      background: var(--pc-bg);
      font-weight: 500;
      white-space: nowrap;
      transition: border-color 0.15s ease, background 0.15s ease, filter 0.15s ease;
    }
    .pc-btn:hover { border-color: var(--pc-accent); }
    .pc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .pc-btn.pc-primary {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border-color: var(--pc-action);
      background: var(--pc-action);
      color: #FFFFFF;
      font-weight: 600;
    }
    .pc-btn.pc-primary:hover:not(:disabled) { filter: brightness(1.12); }
    .pc-btn.pc-small { padding: 3px 10px; font-size: 12px; }
    kbd { font: inherit; font-size: 11px; font-weight: 400; opacity: 0.75; }
    .pc-link { padding: 0; border: none; background: none; font-size: 12px; font-weight: 500; color: var(--pc-ink-soft); }
    .pc-link:hover { color: var(--pc-accent); }
    .pc-icon-btn {
      width: 26px;
      height: 26px;
      padding: 0;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      border: none;
      background: transparent;
      color: var(--pc-ink-soft);
      font-size: 13px;
    }
    .pc-icon-btn:hover { background: var(--pc-hover); color: var(--pc-ink); }

    /* The score: teal once the draft is in decent shape, gold while it needs work */
    .pc-ring {
      position: relative;
      width: 36px;
      height: 36px;
      flex-shrink: 0;
      display: grid;
      place-items: center;
      font-size: 12px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .pc-ring svg { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
    .pc-ring circle { fill: none; stroke-width: 3; }
    .pc-ring-track { stroke: var(--pc-line); }
    .pc-ring-value { stroke: var(--pc-accent); stroke-linecap: round; transition: stroke-dasharray 0.3s ease; }
    .pc-ring.pc-low .pc-ring-value { stroke: var(--pc-gold); }
    .pc-ring.pc-none .pc-ring-value { display: none; }

    .pc-issues { display: flex; flex-direction: column; gap: 6px; }
    .pc-issue { display: flex; align-items: flex-start; gap: 10px; padding: 9px 10px; border-radius: 8px; background: var(--pc-sunken); }
    .pc-issue::before { content: ''; width: 6px; height: 6px; margin-top: 6px; flex-shrink: 0; border-radius: 50%; background: var(--pc-gold); }
    .pc-issue-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .pc-issue-text b { font-weight: 600; }
    .pc-issue-text span, .pc-note { font-size: 12px; color: var(--pc-ink-soft); }
    .pc-note.pc-error { color: var(--pc-error); }

    .pc-label { font-size: 12px; font-weight: 600; color: var(--pc-ink-soft); }
    .pc-tone-row { display: flex; flex-direction: column; gap: 6px; }
    .pc-tones { display: flex; flex-wrap: wrap; gap: 6px; }
    .pc-chip {
      padding: 3px 10px;
      border-radius: 999px;
      border: 1px solid var(--pc-line);
      background: transparent;
      font-size: 12px;
      transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
    }
    .pc-chip:hover { border-color: var(--pc-accent); }
    .pc-chip[aria-pressed="true"] { border-color: var(--pc-accent); background: var(--pc-accent-wash); color: var(--pc-accent); font-weight: 600; }

    .pc-context { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--pc-ink-soft); cursor: pointer; }
    .pc-context input { width: 14px; height: 14px; margin: 0; flex-shrink: 0; accent-color: var(--pc-accent); cursor: pointer; }

    .pc-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--pc-ok); flex-shrink: 0; }
    .pc-dot.pc-off { background: var(--pc-error); }
    .pc-provider { flex: 1; min-width: 0; margin-left: -6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* The rewrite itself. It scrolls on its own, so the fields under it stay in view. */
    .pc-text {
      max-height: 240px;
      overflow-y: auto;
      flex-shrink: 0;
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--pc-sunken);
      font-size: 13px;
      line-height: 1.55;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .pc-text:empty { min-height: 58px; animation: pc-wait 1.2s ease-in-out infinite; }
    @keyframes pc-wait { 50% { background: var(--pc-accent-wash); } }
    .pc-delta {
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--pc-accent-wash);
      color: var(--pc-accent);
      font-size: 12px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .pc-blanks { display: flex; flex-direction: column; gap: 6px; }
    .pc-blank { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--pc-ink-soft); }
    .pc-blank input {
      font: inherit;
      font-size: 13px;
      width: 100%;
      padding: 6px 9px;
      border-radius: 8px;
      border: 1px solid var(--pc-line);
      background: var(--pc-bg);
      color: var(--pc-ink);
    }
    .pc-blank input:focus { outline: none; border-color: var(--pc-accent); box-shadow: 0 0 0 3px var(--pc-accent-wash); }

    /* Highlighter for what the rewrite added; a strike for what it dropped */
    mark.pc-add { background: var(--pc-mark); color: var(--pc-mark-ink); border-radius: 3px; }
    mark.pc-del { background: none; color: var(--pc-ink-soft); text-decoration: line-through; }

    /* ── Toast ── */
    .pc-toast {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      max-width: min(420px, calc(100vw - 32px));
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 9px 14px;
      border-radius: 10px;
      background: var(--pc-toast);
      color: #FFFFFF;
      box-shadow: var(--pc-shadow);
      overflow-wrap: anywhere;
      animation: pc-pop 0.14s ease-out;
    }
    .pc-toast .pc-link { font-size: 13px; font-weight: 600; color: var(--pc-gold); }

    /* ── Changes dialog ── */
    .pc-diff {
      position: fixed;
      inset: 0;
      padding: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--pc-scrim);
    }
    .pc-diff-modal {
      width: 100%;
      max-width: 920px;
      max-height: 84vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--pc-line);
      border-radius: 14px;
      background: var(--pc-bg);
      box-shadow: var(--pc-shadow);
    }
    .pc-diff-head {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px 16px;
      padding: 14px 14px 14px 20px;
      border-bottom: 1px solid var(--pc-line);
    }
    .pc-diff-title { font-size: 16px; font-weight: 600; }
    .pc-diff-stats { display: flex; gap: 12px; margin-right: auto; font-size: 12px; color: var(--pc-ink-soft); }
    .pc-diff-stats b { font-weight: 600; color: var(--pc-ink); }
    .pc-diff-stats b.pc-add { padding: 0 4px; border-radius: 3px; background: var(--pc-mark); color: var(--pc-mark-ink); }
    .pc-tabs { display: flex; gap: 6px; }
    .pc-diff-body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 16px 20px;
      font-size: 13.5px;
      line-height: 1.65;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .pc-diff-body.pc-split { display: grid; grid-template-columns: 1fr 1fr; padding: 0; overflow: hidden; }
    .pc-col { min-height: 0; overflow: auto; padding: 14px 20px 16px; }
    .pc-col + .pc-col { border-left: 1px solid var(--pc-line); }
    .pc-col .pc-label { display: block; margin-bottom: 6px; white-space: normal; }
    .pc-diff-foot {
      display: flex;
      justify-content: flex-end;
      padding: 12px 20px;
      border-top: 1px solid var(--pc-line);
      background: var(--pc-sunken);
    }
    .pc-diff-foot .pc-btn.pc-primary { flex: none; }

    @media (prefers-reduced-motion: reduce) {
      * { transition: none !important; animation-duration: 0s !important; }
      .pc-badge.pc-busy::after, .pc-spinner { animation-duration: 1.6s !important; }
    }
  `;

  let uiRoot = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function uiButton(label, className, onClick) {
    const btn = el('button', className, label);
    btn.type = 'button';
    btn.addEventListener('click', onClick);
    return btn;
  }

  // Built node by node: some sites forbid assigning HTML strings (Trusted Types)
  function svg(tag, attrs, ...children) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    node.append(...children);
    return node;
  }

  // Chat sites have their own theme switch, so read the page rather than the OS setting
  function pageIsDark() {
    for (const node of [document.body, document.documentElement]) {
      const parts = node && getComputedStyle(node).backgroundColor.match(/[\d.]+/g);
      if (parts && (parts.length < 4 || Number(parts[3]) > 0.5)) {
        const [r, g, b] = parts.map(Number);
        return 0.299 * r + 0.587 * g + 0.114 * b < 128;
      }
    }
    // No background set: the browser paints white unless the page opted into a dark colour scheme
    const scheme = getComputedStyle(document.documentElement).colorScheme || '';
    if (!scheme.includes('dark')) return false;
    return !scheme.includes('light') || window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  // Returns the shadow root, creating (or re-creating) its host element as needed
  function getUi() {
    let host = document.getElementById(HOST_ID);
    if (!host || !uiRoot || uiRoot.host !== host) {
      if (host) host.remove();
      host = document.createElement('div');
      host.id = HOST_ID;
      // Inline and !important so no site stylesheet can move or hide the host
      host.style.cssText = 'all: initial !important; display: block !important; position: fixed !important; ' +
        'top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important;';
      uiRoot = host.attachShadow({ mode: 'open' });
      uiRoot.appendChild(el('style', '', UI_CSS));
      (document.body || document.documentElement).appendChild(host);
    }
    host.dataset.theme = pageIsDark() ? 'dark' : 'light';
    return uiRoot;
  }

  const $ui = (selector) => (uiRoot ? uiRoot.querySelector(selector) : null);

  // Keys typed into our own controls shouldn't trigger the site's shortcuts
  function keepKeysLocal(node) {
    for (const type of ['keydown', 'keyup', 'keypress']) {
      node.addEventListener(type, (e) => e.stopPropagation());
    }
  }

  // ── Changes Dialog ────────────────────────────────────────────────────────

  let diffReturnFocus = null;

  function removeDiffOverlay() {
    const dialog = $ui('.pc-diff');
    if (!dialog) return;
    dialog.remove();
    document.removeEventListener('keydown', onDiffKeydown, true);
    if (diffReturnFocus && diffReturnFocus.isConnected) diffReturnFocus.focus();
    diffReturnFocus = null;
  }

  // Escape closes; Tab cycles within the dialog
  function onDiffKeydown(e) {
    const dialog = $ui('.pc-diff');
    if (!dialog) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      removeDiffOverlay();
    } else if (e.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll('button')];
      const index = focusable.indexOf(uiRoot.activeElement);
      const next = e.shiftKey
        ? (index <= 0 ? focusable.length - 1 : index - 1)
        : (index === -1 || index === focusable.length - 1 ? 0 : index + 1);
      e.preventDefault();
      focusable[next].focus();
    }
  }

  // Renders diff operations of the given types, merging neighbouring runs
  function diffFragment(ops, types) {
    const frag = document.createDocumentFragment();
    let piece = null;
    const flush = () => {
      if (!piece) return;
      if (piece.type === 'equal') frag.appendChild(document.createTextNode(piece.text));
      else frag.appendChild(el('mark', piece.type === 'added' ? 'pc-add' : 'pc-del', piece.text));
    };
    const shown = ops.filter(op => types.includes(op.type));
    shown.forEach((op, i) => {
      let type = op.type;
      // A space between two changed words reads better as part of the change than as a gap
      const next = shown[i + 1];
      if (type === 'equal' && !op.value.trim() && piece && piece.type !== 'equal' && next && next.type === piece.type) type = piece.type;
      if (piece && piece.type === type) {
        piece.text += op.value;
      } else {
        flush();
        piece = { type, text: op.value };
      }
    });
    flush();
    return frag;
  }

  function showDiffOverlay(originalText, enhancedText) {
    removeDiffOverlay();
    const root = getUi();
    diffReturnFocus = root.activeElement;
    const ops = computeDiff(originalText, enhancedText);
    const countWords = (type) => ops.filter(op => op.type === type && op.value.trim()).length;

    const dialog = el('div', 'pc-diff');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Prompt changes');
    dialog.addEventListener('mousedown', (e) => { if (e.target === dialog) removeDiffOverlay(); });
    keepKeysLocal(dialog);

    const modal = el('div', 'pc-diff-modal');
    const head = el('div', 'pc-diff-head');
    head.appendChild(el('span', 'pc-diff-title', 'Prompt changes'));

    const stats = el('div', 'pc-diff-stats');
    if (ops) {
      const added = el('span');
      added.append(el('b', 'pc-add', `+${countWords('added')}`), ' added');
      const removed = el('span');
      removed.append(el('b', '', `−${countWords('removed')}`), ' removed');
      const kept = el('span');
      kept.append(el('b', '', String(countWords('equal'))), ' unchanged');
      stats.append(added, removed, kept);
    } else {
      stats.textContent = 'Too long to highlight individual changes';
    }
    head.appendChild(stats);

    const body = el('div', 'pc-diff-body');
    const column = (title, content) => {
      const col = el('div', 'pc-col');
      col.append(el('span', 'pc-label', title), content);
      return col;
    };
    const views = {
      split() {
        body.classList.add('pc-split');
        body.replaceChildren(
          column('Your draft', ops ? diffFragment(ops, ['equal', 'removed']) : originalText),
          column('Rewrite', ops ? diffFragment(ops, ['equal', 'added']) : enhancedText)
        );
      },
      inline() {
        body.classList.remove('pc-split');
        body.replaceChildren(ops ? diffFragment(ops, ['equal', 'removed', 'added']) : enhancedText);
      }
    };

    const tabs = el('div', 'pc-tabs');
    const showView = (name) => {
      views[name]();
      tabs.querySelectorAll('.pc-chip').forEach(t => t.setAttribute('aria-pressed', String(t.dataset.view === name)));
    };
    for (const [name, label] of [['split', 'Side by side'], ['inline', 'Inline']]) {
      const tab = uiButton(label, 'pc-chip', () => showView(name));
      tab.dataset.view = name;
      tabs.appendChild(tab);
    }
    head.appendChild(tabs);

    const close = uiButton('✕', 'pc-icon-btn', removeDiffOverlay);
    close.setAttribute('aria-label', 'Close');
    head.appendChild(close);

    const foot = el('div', 'pc-diff-foot');
    const copy = uiButton('Copy rewrite', 'pc-btn pc-primary', () => {
      navigator.clipboard.writeText(enhancedText).then(() => {
        copy.textContent = 'Copied';
        setTimeout(() => { copy.textContent = 'Copy rewrite'; }, 1500);
      }).catch(() => {});
    });
    foot.appendChild(copy);

    modal.append(head, body, foot);
    dialog.appendChild(modal);
    root.appendChild(dialog);
    // Two columns need room; on narrow windows start with the inline view
    showView(window.innerWidth >= 760 ? 'split' : 'inline');

    document.addEventListener('keydown', onDiffKeydown, true);
    close.focus();
  }

  // ── Background worker ─────────────────────────────────────────────────────

  // Messages the worker; quietly does nothing once the extension has been reloaded
  function send(message, onReply) {
    try {
      chrome.runtime.sendMessage(message, (reply) => {
        if (chrome.runtime.lastError) return;
        if (onReply) onReply(reply);
      });
    } catch {}
  }

  function fetchSettings() {
    send({ action: 'getPublicSettings' }, (reply) => {
      if (!reply || !reply.success) return;
      const changed = JSON.stringify(reply.settings) !== JSON.stringify(publicSettings);
      publicSettings = reply.settings;
      if (changed) renderSettings();
    });
  }

  // ── Conversation Extraction ───────────────────────────────────────────────

  function detectPlatform() {
    const host = window.location.hostname;
    // Exact domain match — this script can now run on any site, and a substring
    // test would treat e.g. netflix.com as x.com
    const on = (domain) => host === domain || host.endsWith('.' + domain);
    if (on('chatgpt.com')) return 'ChatGPT';
    if (on('claude.ai')) return 'Claude';
    if (on('gemini.google.com')) return 'Gemini';
    if (on('deepseek.com')) return 'DeepSeek';
    if (on('perplexity.ai')) return 'Perplexity';
    if (on('grok.com') || (on('x.com') && window.location.pathname.includes('/grok'))) return 'Grok';
    if (on('huggingface.co')) return 'HuggingFace';
    if (on('openrouter.ai')) return 'OpenRouter';
    return null;
  }

  function extractChatGPTMessages() {
    const messages = [];
    const els = document.querySelectorAll('[data-message-author-role]');
    els.forEach(el => {
      const role = el.getAttribute('data-message-author-role');
      if (role !== 'user' && role !== 'assistant') return;
      const contentEl = el.querySelector('.whitespace-pre-wrap') || el.querySelector('.markdown') || el;
      const text = (contentEl.innerText || '').trim();
      if (text) messages.push({ role, text });
    });
    return messages;
  }

  function extractClaudeMessages() {
    const messages = [];
    const turns = document.querySelectorAll('[data-testid$="-turn"]');
    if (turns.length > 0) {
      turns.forEach(turn => {
        const testId = (turn.getAttribute('data-testid') || '').toLowerCase();
        const role = testId.includes('human') || testId.includes('user') ? 'user' : 'assistant';
        const text = (turn.innerText || '').trim();
        if (text) messages.push({ role, text });
      });
      return messages;
    }
    document.querySelectorAll('.font-claude-message, .font-user-message, [class*="UserMessage"], [class*="AssistantMessage"]').forEach(el => {
      const cls = (el.className || '').toLowerCase();
      const role = cls.includes('user') || cls.includes('human') ? 'user' : 'assistant';
      const text = (el.innerText || '').trim();
      if (text) messages.push({ role, text });
    });
    return messages;
  }

  function extractGeminiMessages() {
    const messages = [];
    const els = document.querySelectorAll('user-query, model-response');
    if (els.length > 0) {
      els.forEach(el => {
        const role = el.tagName.toLowerCase() === 'user-query' ? 'user' : 'assistant';
        const text = (el.innerText || '').trim();
        if (text) messages.push({ role, text });
      });
      return messages;
    }
    document.querySelectorAll('message-content').forEach(el => {
      const parent = el.closest('[class*="request"], [class*="response"], [class*="query"]');
      const isUser = parent && (parent.className.includes('request') || parent.className.includes('query'));
      messages.push({ role: isUser ? 'user' : 'assistant', text: (el.innerText || '').trim() });
    });
    return messages.filter(m => m.text);
  }

  function extractDeepSeekMessages() {
    const messages = [];
    document.querySelectorAll('[class*="msg-"], [class*="message"]').forEach(el => {
      const cls = (el.className || '').toLowerCase();
      if (cls.includes('user') || cls.includes('human')) {
        const text = (el.innerText || '').trim();
        if (text) messages.push({ role: 'user', text });
      } else if (cls.includes('assistant') || cls.includes('bot') || cls.includes('ai')) {
        const text = (el.innerText || '').trim();
        if (text) messages.push({ role: 'assistant', text });
      }
    });
    return messages;
  }

  function extractPerplexityMessages() {
    const messages = [];
    document.querySelectorAll('[class*="query"], [class*="Query"], [class*="answer"], [class*="Answer"]').forEach(el => {
      const cls = (el.className || '').toLowerCase();
      const role = cls.includes('query') ? 'user' : 'assistant';
      const text = (el.innerText || '').trim();
      if (text) messages.push({ role, text });
    });
    return messages;
  }

  function extractGrokMessages() {
    const messages = [];
    document.querySelectorAll('[class*="message"], [class*="Message"]').forEach(el => {
      const cls = (el.className || '').toLowerCase();
      if (cls.includes('user') || cls.includes('human')) {
        const text = (el.innerText || '').trim();
        if (text) messages.push({ role: 'user', text });
      } else if (cls.includes('assistant') || cls.includes('bot') || cls.includes('grok') || cls.includes('ai')) {
        const text = (el.innerText || '').trim();
        if (text) messages.push({ role: 'assistant', text });
      }
    });
    return messages;
  }

  function extractGenericMessages() {
    const messages = [];
    document.querySelectorAll('[data-role]').forEach(el => {
      const role = el.getAttribute('data-role');
      if (role === 'user' || role === 'assistant') {
        const text = (el.innerText || '').trim();
        if (text) messages.push({ role, text });
      }
    });
    if (messages.length > 0) return messages;

    document.querySelectorAll('[aria-label*="message"], [aria-label*="response"], [aria-label*="Message"]').forEach(el => {
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      const role = label.includes('user') || label.includes('you') || label.includes('human') ? 'user' : 'assistant';
      const text = (el.innerText || '').trim();
      if (text) messages.push({ role, text });
    });
    return messages;
  }

  // ── Stopwords for keyword relevance scoring ──────────────────────────────
  const STOPWORDS = new Set([
    'a','about','above','after','again','against','all','am','an','and','any',
    'are','as','at','be','because','been','before','being','below','between',
    'both','but','by','can','could','did','do','does','doing','down','during',
    'each','few','for','from','further','get','got','had','has','have','having',
    'he','her','here','hers','herself','him','himself','his','how','i','if',
    'in','into','is','it','its','itself','just','ll','let','like','me','might',
    'more','most','my','myself','no','nor','not','now','of','off','on','once',
    'only','or','other','our','ours','ourselves','out','over','own','re','s',
    'same','shall','she','should','so','some','such','t','than','that','the',
    'their','theirs','them','themselves','then','there','these','they','this',
    'those','through','to','too','under','until','up','ve','very','was','we',
    'were','what','when','where','which','while','who','whom','why','will',
    'with','would','you','your','yours','yourself','yourselves','d','m',
    'also','been','don','doesn','didn','hadn','hasn','haven','isn','wasn',
    'weren','won','wouldn','shouldn','couldn','mustn','needn','shan',
    'ok','okay','yes','no','yeah','please','thanks','thank','hello','hi',
    'hey','sure','right','well','oh','um','uh','ah','hmm'
  ]);

  /**
   * Tokenize text into lowercase words, filtering out stopwords and
   * very short tokens (length < 2).
   */
  function tokenize(text) {
    return text.toLowerCase().match(/[a-z0-9_]+(?:\.[a-z0-9_]+)*/g)?.filter(
      w => w.length >= 2 && !STOPWORDS.has(w)
    ) || [];
  }

  /**
   * Detect likely technical terms, proper nouns, and domain-specific vocabulary
   * in a text. These are weighted higher in relevance scoring.
   * Looks for: camelCase, PascalCase, UPPER_CASE, dotted.names, words with
   * digits, and known tech patterns.
   */
  function extractSpecialTerms(text) {
    const terms = new Set();
    // camelCase / PascalCase identifiers (e.g. useState, DataFrame)
    const camelCase = text.match(/[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*/g) || [];
    camelCase.forEach(t => terms.add(t.toLowerCase()));
    // PascalCase starting with uppercase
    const pascal = text.match(/[A-Z][a-z]+[A-Z][a-zA-Z0-9]*/g) || [];
    pascal.forEach(t => terms.add(t.toLowerCase()));
    // UPPER_CASE constants
    const upperConst = text.match(/[A-Z][A-Z0-9_]{2,}/g) || [];
    upperConst.forEach(t => terms.add(t.toLowerCase()));
    // dotted identifiers (e.g. np.array, os.path)
    const dotted = text.match(/[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
    dotted.forEach(t => terms.add(t.toLowerCase()));
    // Words containing digits mixed with letters (e.g. h264, utf8, int32)
    const alphaNum = text.match(/[a-zA-Z]+\d+[a-zA-Z0-9]*/g) || [];
    alphaNum.forEach(t => terms.add(t.toLowerCase()));
    const numAlpha = text.match(/\d+[a-zA-Z]+[a-zA-Z0-9]*/g) || [];
    numAlpha.forEach(t => terms.add(t.toLowerCase()));
    // Code-like patterns with underscores (e.g. my_function, data_frame)
    const underscore = text.match(/[a-zA-Z][a-zA-Z0-9]*_[a-zA-Z0-9_]+/g) || [];
    underscore.forEach(t => terms.add(t.toLowerCase()));
    return terms;
  }

  /**
   * Score a single message for relevance to the prompt.
   *
   * Components:
   *   - keywordOverlap: fraction of prompt keywords found in the message
   *   - specialTermOverlap: bonus for shared technical/domain terms
   *   - recency: normalized position (0 = oldest, 1 = newest)
   *   - roleWeight: user messages get a slight boost
   *
   * Returns a numeric score (higher = more relevant).
   */
  function scoreMessage(msg, promptTokens, promptSpecialTerms, index, totalMessages) {
    // Keyword overlap
    const msgTokens = new Set(tokenize(msg.text));
    let keywordHits = 0;
    for (const pt of promptTokens) {
      if (msgTokens.has(pt)) keywordHits++;
    }
    const keywordScore = promptTokens.length > 0
      ? keywordHits / promptTokens.length
      : 0;

    // Semantic proximity — shared special/technical terms
    const msgSpecial = extractSpecialTerms(msg.text);
    let specialHits = 0;
    for (const term of promptSpecialTerms) {
      if (msgSpecial.has(term)) specialHits++;
      // Also check if the term appears as a substring in any msg special term
      for (const mt of msgSpecial) {
        if (mt !== term && (mt.includes(term) || term.includes(mt))) {
          specialHits += 0.5;
          break;
        }
      }
    }
    const specialScore = promptSpecialTerms.size > 0
      ? Math.min(1, specialHits / promptSpecialTerms.size)
      : 0;

    // Recency: linear scale, most recent = 1
    const recency = totalMessages > 1
      ? index / (totalMessages - 1)
      : 1;

    // Role weight: user messages slightly more relevant for understanding intent
    const roleWeight = msg.role === 'user' ? 1.15 : 1.0;

    // Weighted combination
    const score = (
      keywordScore * 0.40 +
      specialScore * 0.25 +
      recency * 0.20 +
      0.15 // base relevance so all messages have some score
    ) * roleWeight;

    return score;
  }

  /**
   * Select the most relevant messages from the full conversation, given the
   * current prompt text. Always includes the last 2 messages for immediate
   * context, then fills remaining budget with highest-scored messages.
   *
   * @param {Array} messages - All extracted messages [{role, text}, ...]
   * @param {string} promptText - The user's current prompt being enhanced
   * @param {number} maxChars - Maximum total characters for selected context (default 3000)
   * @returns {Array} Selected messages in original chronological order
   */
  function selectRelevantMessages(messages, promptText, maxChars) {
    maxChars = maxChars || 3000;
    const MAX_MSG_LEN = 400; // truncate individual messages to this length

    // Truncate individual message texts for scoring and output
    const prepared = messages.map((m, i) => ({
      role: m.role,
      text: m.text.length > MAX_MSG_LEN ? m.text.substring(0, MAX_MSG_LEN) + '...' : m.text,
      originalIndex: i
    }));

    if (prepared.length === 0) return [];

    // If no prompt text, fall back to taking the most recent messages that fit
    if (!promptText || !promptText.trim()) {
      let total = 0;
      const result = [];
      for (let i = prepared.length - 1; i >= 0; i--) {
        const cost = prepared[i].text.length + 20; // 20 chars overhead for label
        if (total + cost > maxChars) break;
        total += cost;
        result.unshift(prepared[i]);
      }
      return result;
    }

    // Precompute prompt analysis
    const promptTokens = tokenize(promptText);
    const promptSpecialTerms = extractSpecialTerms(promptText);

    // Score every message
    const scored = prepared.map((m, idx) => ({
      ...m,
      score: scoreMessage(m, promptTokens, promptSpecialTerms, idx, prepared.length)
    }));

    // Always include the most recent 2 messages (guaranteed immediate context)
    const guaranteedCount = Math.min(2, scored.length);
    const guaranteedIndices = new Set();
    for (let i = scored.length - guaranteedCount; i < scored.length; i++) {
      guaranteedIndices.add(i);
    }

    // Calculate budget used by guaranteed messages
    let charBudget = maxChars;
    for (const idx of guaranteedIndices) {
      charBudget -= scored[idx].text.length + 20;
    }

    // Rank remaining messages by score (descending)
    const candidates = scored
      .map((m, idx) => ({ ...m, scoredIndex: idx }))
      .filter((_, idx) => !guaranteedIndices.has(idx))
      .sort((a, b) => b.score - a.score);

    // Greedily select top-scored messages that fit in remaining budget
    const selectedIndices = new Set(guaranteedIndices);
    for (const candidate of candidates) {
      const cost = candidate.text.length + 20;
      if (cost > charBudget) continue;
      charBudget -= cost;
      selectedIndices.add(candidate.scoredIndex);
    }

    // Return selected messages in original chronological order
    const result = [];
    for (let i = 0; i < scored.length; i++) {
      if (selectedIndices.has(i)) {
        result.push({ role: scored[i].role, text: scored[i].text });
      }
    }
    return result;
  }

  // Legacy fallback: simple recency-based truncation (used when no prompt is available)
  function truncateMessages(messages, maxMessages, maxChars) {
    let recent = messages.slice(-maxMessages);
    recent = recent.map(m => ({
      role: m.role,
      text: m.text.length > 400 ? m.text.substring(0, 400) + '...' : m.text
    }));

    let total = 0;
    const result = [];
    for (let i = recent.length - 1; i >= 0; i--) {
      total += recent[i].text.length + 20;
      if (total > maxChars) break;
      result.unshift(recent[i]);
    }
    return result;
  }

  /**
   * Extract conversation context from the page.
   *
   * @param {string} [promptText] - Optional current prompt text. When provided,
   *   messages are ranked by relevance to the prompt. When omitted, falls back
   *   to simple recency-based selection (last 8 messages, 3000 chars).
   * @returns {{ platform: string, conversation: string, messageCount: number } | null}
   */
  function extractPageConversation(promptText) {
    try {
      const platform = detectPlatform();
      let messages = [];

      switch (platform) {
        case 'ChatGPT':     messages = extractChatGPTMessages(); break;
        case 'Claude':       messages = extractClaudeMessages(); break;
        case 'Gemini':       messages = extractGeminiMessages(); break;
        case 'DeepSeek':     messages = extractDeepSeekMessages(); break;
        case 'Perplexity':   messages = extractPerplexityMessages(); break;
        case 'Grok':         messages = extractGrokMessages(); break;
        default:             messages = extractGenericMessages(); break;
      }

      if (messages.length === 0) return null;

      // Use relevance-based selection when prompt text is available,
      // otherwise fall back to simple recency truncation.
      let selected;
      if (promptText && promptText.trim()) {
        selected = selectRelevantMessages(messages, promptText, 3000);
      } else {
        selected = truncateMessages(messages, 8, 3000);
      }
      if (selected.length === 0) return null;

      const conversation = selected.map(m => {
        const label = m.role === 'user' ? '[User]' : '[Assistant]';
        return `${label}: ${m.text}`;
      }).join('\n\n');

      return {
        platform: platform || 'Unknown',
        conversation,
        messageCount: selected.length
      };
    } catch (err) {
      // Silently handle extraction errors
      return null;
    }
  }

  // ── Text Boxes ──────────────────────────────────────────────────────────

  // Never read password or other non-text inputs
  const TEXT_INPUT_TYPES = ['', 'text', 'search', 'url', 'email', 'tel'];

  function isEditable(el) {
    // Our own controls (the blanks in a suggestion) are never the user's text box
    if (!el || el.nodeType !== 1 || (uiRoot && el.getRootNode() === uiRoot)) return false;
    if (el.tagName === 'TEXTAREA') return !el.readOnly && !el.disabled;
    if (el.tagName === 'INPUT') {
      return TEXT_INPUT_TYPES.includes((el.getAttribute('type') || '').toLowerCase()) && !el.readOnly && !el.disabled;
    }
    return el.isContentEditable;
  }

  // Follows focus through shadow roots to the element that really has it
  function deepActiveElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  // For rich editors, the outermost editable element is the one to read and write
  function editingHost(el) {
    let host = el;
    while (host.isContentEditable && host.parentElement && host.parentElement.isContentEditable) host = host.parentElement;
    return host;
  }

  // A chat site's prompt box: the first visible multi-line editor
  function findPromptBox() {
    for (const selector of ['textarea', 'div[contenteditable="true"]', '[role="textbox"]', '.ProseMirror']) {
      for (const node of document.querySelectorAll(selector)) {
        if (node.offsetParent !== null && isEditable(node)) return node;
      }
    }
    return null;
  }

  // The text box an action applies to: the focused one, else the last one used
  function findTextInput() {
    const active = deepActiveElement();
    if (isEditable(active)) return editingHost(active);
    if (lastFocusedInput && lastFocusedInput.isConnected && isEditable(lastFocusedInput)) return lastFocusedInput;
    // Outside chat sites there is no obvious prompt box, so don't guess
    return IS_CHAT_SITE ? findPromptBox() : null;
  }

  function getTextFromElement(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
    // innerText keeps the line breaks between paragraphs; textContent would run them together
    return el.innerText || el.textContent || '';
  }

  // Replaces the whole content in one edit, in a way the site's framework notices
  function setTextDirect(el, text) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      // The native setter gets past React's own value tracking
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (nativeSetter) nativeSetter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    } else if (el.isContentEditable) {
      el.focus();
      // Select all and replace via execCommand — works with ProseMirror
      const sel = window.getSelection();
      if (sel && el.firstChild) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        document.execCommand('selectAll', false, null);
      }
      document.execCommand('insertText', false, text);
    }
    el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  }

  // ── Toast ───────────────────────────────────────────────────────────────

  let toastTimer = null;

  // A short message at the top of the page, optionally with one action (e.g. Undo)
  function showToast(message, duration = 3500, action = null) {
    const root = getUi();
    const old = $ui('.pc-toast');
    if (old) old.remove();
    clearTimeout(toastTimer);

    const toast = el('div', 'pc-toast');
    toast.setAttribute('role', 'status');
    toast.appendChild(el('span', '', message));
    if (action) {
      toast.appendChild(uiButton(action.label, 'pc-link', () => {
        toast.remove();
        action.run();
      }));
    }
    root.appendChild(toast);
    toastTimer = setTimeout(() => toast.remove(), duration);
  }

  // ── Badge ───────────────────────────────────────────────────────────────
  // Follows the text box in use: the focused one, or on chat sites the prompt
  // box whether focused or not. syncBadge() is the one place that derives the
  // badge's position and state, and it runs at most once per frame.

  const BADGE_SIZE = 26;
  const BADGE_INSET = 6;
  const CARD_WIDTH = 340;
  const CARD_GAP = 8;

  let syncQueued = false;
  let lastFieldSearch = 0;
  let searchTimer = null;
  let reviewTimer = null;
  const fieldResize = new ResizeObserver(queueSync);

  function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(syncBadge);
  }

  function createBadge() {
    const badge = el('button', 'pc-badge');
    badge.type = 'button';
    badge.setAttribute('aria-label', 'Review this prompt with PromptCraft');
    badge.setAttribute('aria-haspopup', 'dialog');
    // The stacked-layers mark the in-page button has always used
    badge.append(
      svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
        svg('path', { d: 'M12 2L2 7l10 5 10-5-10-5z' }),
        svg('path', { d: 'M2 17l10 5 10-5' }),
        svg('path', { d: 'M2 12l10 5 10-5' })),
      el('span', 'pc-count')
    );
    // Keep focus in the text box while the badge is clicked
    badge.addEventListener('mousedown', (e) => e.preventDefault());
    badge.addEventListener('click', () => {
      if (card) closeCard();
      else showReview();
    });
    // Settings can change in the side panel, and the site's theme can be switched, at any time
    badge.addEventListener('mouseenter', () => {
      getUi();
      fetchSettings();
    });
    getUi().appendChild(badge);
    return badge;
  }

  // Which text box the badge belongs in right now
  function pickField() {
    // A card stays with its text box until it closes
    if (card && field && field.isConnected) return field;
    const active = deepActiveElement();
    if (isEditable(active)) return editingHost(active);
    if (!IS_CHAT_SITE) return null;
    // On chat sites the prompt box is the point, focused or not
    const isPromptBox = (node) => !!node && node.tagName !== 'INPUT' && node.isConnected && node.getClientRects().length > 0;
    if (isPromptBox(field)) return field;
    if (isPromptBox(lastFocusedInput)) return lastFocusedInput;
    // The search walks the page, so pages that re-render constantly get it twice a second at most
    if (Date.now() - lastFieldSearch < 500) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(queueSync, 500);
      return null;
    }
    lastFieldSearch = Date.now();
    return findPromptBox();
  }

  function setField(next) {
    fieldResize.disconnect();
    field = next;
    review = null;
    if (!next) return;
    fieldResize.observe(next);
    requestReview(0);
  }

  function wantsBadge(rect) {
    if (rect.width < 140 || rect.height < 24) return false;
    if (card) return true;
    // Single-line inputs are searches and form fields; the shortcut still works in them
    if (field.tagName === 'INPUT') return false;
    // Outside chat sites, stay out of the way until there is a draft to review
    return IS_CHAT_SITE || (!!review && review.text.length > 0);
  }

  function syncBadge() {
    syncQueued = false;
    // The site rebuilt the page under an open card
    if (card && !card.isConnected) dropCard();

    const next = pickField();
    if (next !== field) setField(next);

    let badge = $ui('.pc-badge');
    const rect = field ? field.getBoundingClientRect() : null;
    if (!rect || !wantsBadge(rect)) {
      if (badge) badge.hidden = true;
      if (card) closeCard();
      return;
    }
    if (!badge || !badge.isConnected) badge = createBadge();

    // Bottom-right corner of the box (clear of its scrollbar); centred in a single-line box
    const gutter = field.offsetWidth - field.clientWidth;
    const x = Math.min(rect.right, window.innerWidth) - gutter - BADGE_SIZE - BADGE_INSET;
    const y = rect.height < 44
      ? rect.top + (rect.height - BADGE_SIZE) / 2
      : Math.min(rect.bottom, window.innerHeight) - BADGE_SIZE - BADGE_INSET;
    const where = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (badge.style.transform !== where) badge.style.transform = where;
    badge.hidden = rect.bottom < BADGE_SIZE || rect.top > window.innerHeight - BADGE_SIZE;

    const count = !run && review ? review.issues.length : 0;
    const counter = badge.querySelector('.pc-count');
    counter.hidden = count === 0;
    counter.textContent = String(count);
    badge.classList.toggle('pc-busy', !!run);
    badge.setAttribute('aria-expanded', String(!!card));

    if (card) placeCard(rect);
  }

  // Beside the text box, never over it: above when there is room (chat boxes
  // sit at the bottom of the window), otherwise below. A box that fills the
  // window gets the card inside its bottom corner instead.
  function placeCard(rect) {
    const width = Math.min(CARD_WIDTH, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const above = rect.top - CARD_GAP - 8;
    const below = window.innerHeight - rect.bottom - CARD_GAP - 8;
    const room = Math.max(above, below);

    let top = '';
    let bottom = '';
    if (room < 200) bottom = `${window.innerHeight - Math.min(rect.bottom, window.innerHeight) + BADGE_SIZE + BADGE_INSET * 2}px`;
    else if (above >= 320 || above >= below) bottom = `${window.innerHeight - rect.top + CARD_GAP}px`;
    else top = `${rect.bottom + CARD_GAP}px`;

    Object.assign(card.style, {
      width: `${width}px`,
      left: `${left}px`,
      top,
      bottom,
      maxHeight: `${Math.min(520, room < 200 ? window.innerHeight - 80 : room)}px`
    });
  }

  // Asks the worker to score the draft. Local heuristics only, so it can follow typing.
  function requestReview(delay = 350) {
    clearTimeout(reviewTimer);
    reviewTimer = setTimeout(() => {
      const target = field;
      if (!target || !target.isConnected) return;
      const text = getTextFromElement(target).trim();
      if (review && review.text === text) return;
      const apply = (score, issues) => {
        if (field !== target) return;
        review = { text, score, issues };
        updateReview();
        queueSync();
      };
      if (!text) apply(null, []);
      else send({ action: 'analyzeDraft', text }, (reply) => { if (reply && reply.success) apply(reply.score ?? null, reply.issues || []); });
    }, delay);
  }

  // ── Cards ───────────────────────────────────────────────────────────────
  // One card at a time, anchored to the text box. Its `view` is one of:
  // review (opened from the badge), working, suggestion, problem.

  function openCard(view) {
    const root = getUi();
    const replacing = !!card;
    if (card) card.remove();
    card = el('div', replacing ? 'pc-card pc-steady' : 'pc-card');
    card.dataset.view = view;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'PromptCraft');
    keepKeysLocal(card);
    root.appendChild(card);
    return card;
  }

  // Forgets the card and anything in progress, without touching the text box
  function dropCard() {
    if (run) endRun(run);
    suggestion = null;
    if (card) card.remove();
    card = null;
  }

  function closeCard() {
    dropCard();
    queueSync();
  }

  function dismissCard() {
    const target = field;
    closeCard();
    if (target && target.isConnected) target.focus({ preventScroll: true });
  }

  function closeButton() {
    const close = uiButton('✕', 'pc-icon-btn', dismissCard);
    close.setAttribute('aria-label', 'Close');
    return close;
  }

  function scoreRing() {
    const ring = el('span', 'pc-ring pc-none');
    ring.title = 'Prompt quality score (0-100)';
    ring.append(
      svg('svg', { viewBox: '0 0 36 36', 'aria-hidden': 'true' },
        svg('circle', { class: 'pc-ring-track', cx: '18', cy: '18', r: '15.5' }),
        svg('circle', { class: 'pc-ring-value', cx: '18', cy: '18', r: '15.5', pathLength: '100', 'stroke-dasharray': '0 100' })),
      el('b', '', '–')
    );
    return ring;
  }

  // ── Review card ─────────────────────────────────────────────────────────
  // The draft's score, its weakest spots (each with a one-click fix), the
  // tone, and the button that asks for a full rewrite.

  function showReview() {
    const node = openCard('review');

    const head = el('div', 'pc-head');
    const title = el('div', 'pc-title', 'Prompt review');
    title.appendChild(el('small'));
    head.append(scoreRing(), title, closeButton());

    const body = el('div', 'pc-body');
    const tone = el('div', 'pc-tone-row');
    const tones = el('div', 'pc-tones');
    tones.setAttribute('role', 'group');
    tones.setAttribute('aria-label', 'Tone');
    tone.append(el('span', 'pc-label', 'Tone'), tones);
    // Chat sites: whether the conversation on the page goes to the model along with the draft
    const context = el('label', 'pc-context');
    const useContext = el('input');
    useContext.type = 'checkbox';
    useContext.addEventListener('change', () => setUseContext(useContext.checked));
    context.append(useContext, el('span'));
    body.append(el('div', 'pc-issues'), tone, context);

    const actions = el('div', 'pc-actions');
    const improve = uiButton('Improve prompt', 'pc-btn pc-primary', () => startEnhance());
    improve.appendChild(el('kbd', '', SHORTCUT));
    actions.appendChild(improve);

    const foot = el('div', 'pc-foot');
    foot.append(el('span', 'pc-dot'), el('span', 'pc-provider'), uiButton('Open panel', 'pc-link', openPanel));

    node.append(head, body, actions, foot);
    updateReview();
    renderSettings();
    syncBadge();
    fetchSettings();
  }

  // Fills the review card from the latest review of the draft
  function updateReview() {
    if (!card || card.dataset.view !== 'review') return;
    const hasText = !!review && review.text.length > 0;
    const issues = hasText ? review.issues : [];

    const ring = card.querySelector('.pc-ring');
    const score = hasText ? review.score : null;
    ring.classList.toggle('pc-none', score === null);
    ring.classList.toggle('pc-low', score !== null && score < 50);
    ring.querySelector('.pc-ring-value').setAttribute('stroke-dasharray', `${score || 0} 100`);
    ring.querySelector('b').textContent = score === null ? '–' : String(score);

    card.querySelector('.pc-title small').textContent = !review ? 'Reading your draft…'
      : !hasText ? 'Nothing to review yet'
      : issues.length === 0 ? 'No obvious gaps'
      : issues.length === 1 ? '1 thing to improve'
      : `${issues.length} things to improve`;

    const list = card.querySelector('.pc-issues');
    list.replaceChildren();
    if (review && !hasText) {
      list.appendChild(el('p', 'pc-note', 'Write your prompt in the box and PromptCraft will point out what is missing.'));
    }
    for (const issue of issues) {
      const row = el('div', 'pc-issue');
      const text = el('div', 'pc-issue-text');
      text.append(el('b', '', issue.title), el('span', '', issue.detail));
      const fix = uiButton('Fix', 'pc-btn pc-small', () => startEnhance({ focus: issue.id }));
      fix.setAttribute('aria-label', `Fix: ${issue.title}`);
      row.append(text, fix);
      list.appendChild(row);
    }
    list.hidden = list.childElementCount === 0;
    card.querySelector('.pc-primary').disabled = !hasText;
  }

  // Fills the review card's tone chips, conversation switch and provider line from the worker's settings
  function renderSettings() {
    if (!card || card.dataset.view !== 'review') return;
    const tones = card.querySelector('.pc-tones');
    tones.replaceChildren();
    for (const style of publicSettings?.styles || []) {
      const chip = uiButton(style.label, 'pc-chip', () => selectTone(style.id));
      chip.dataset.tone = style.id;
      chip.setAttribute('aria-pressed', String(style.id === publicSettings.modifier));
      tones.appendChild(chip);
    }
    const conversation = IS_CHAT_SITE ? extractPageConversation() : null;
    const context = card.querySelector('.pc-context');
    context.hidden = !conversation;
    if (conversation) {
      const count = conversation.messageCount;
      context.querySelector('input').checked = publicSettings?.useContext !== false;
      context.querySelector('span').textContent = `Use this conversation for context (${count} message${count === 1 ? '' : 's'})`;
    }

    const ready = !!publicSettings && publicSettings.ready;
    card.querySelector('.pc-dot').classList.toggle('pc-off', !!publicSettings && !ready);
    card.querySelector('.pc-provider').textContent = !publicSettings ? '…'
      : ready ? `${publicSettings.providerLabel} · ${publicSettings.model}`
      : `${publicSettings.providerLabel} is not set up`;
  }

  function selectTone(id) {
    if (!publicSettings) return;
    publicSettings.modifier = id;
    card.querySelectorAll('.pc-chip[data-tone]').forEach(chip => chip.setAttribute('aria-pressed', String(chip.dataset.tone === id)));
    send({ action: 'setModifier', modifier: id });
  }

  function setUseContext(value) {
    if (!publicSettings) return;
    publicSettings.useContext = value;
    send({ action: 'setUseContext', value });
  }

  // Provider setup, history and templates live in the side panel
  function openPanel() {
    send({ action: 'openPanel' });
  }

  // ── Rewrite ─────────────────────────────────────────────────────────────
  // Opens a port to the background worker, which streams the rewrite back into
  // the card. Disconnecting the port cancels the request. The text box is not
  // touched until the user accepts.

  const STAGE_LABELS = {
    analyzing: 'Reading your draft…',
    generating: 'Writing…',
    structuring: 'Structuring…',
    polishing: 'Polishing…'
  };

  // options.focus: fix one weakness only. options.refine: another pass over the current suggestion.
  function startEnhance(options = {}) {
    if (run) return;

    const base = options.refine && suggestion ? suggestion : null;
    const inputEl = base ? base.inputEl : (card && field ? field : findTextInput());
    if (!inputEl || !inputEl.isConnected) {
      showToast(IS_CHAT_SITE ? 'No text box found on this page' : 'Click into a text box first, then try again');
      return;
    }

    // Another pass re-works the user's own draft, not the previous rewrite
    const original = base ? base.original : getTextFromElement(inputEl).trim();
    if (!original) {
      showToast('Type a prompt first');
      return;
    }

    let port;
    try {
      port = chrome.runtime.connect({ name: 'enhance' });
    } catch {
      showToast('PromptCraft was updated. Reload this page to keep using it.', 5000);
      return;
    }

    if (!base) suggestion = null;
    if (field !== inputEl) setField(inputEl);
    const stale = $ui('.pc-toast');
    if (stale) stale.remove();
    const current = { port, inputEl, original, options, finished: false };
    run = current;
    showWorking();

    port.onMessage.addListener((msg) => {
      if (current.finished) return;
      if (msg.type === 'stage') {
        card.querySelector('.pc-title').textContent = STAGE_LABELS[msg.stage] || STAGE_LABELS.generating;
      } else if (msg.type === 'delta') {
        const text = card.querySelector('.pc-text');
        text.append(msg.text);
        text.scrollTop = text.scrollHeight;
      } else if (msg.type === 'done') {
        endRun(current);
        suggestion = {
          inputEl,
          original,
          text: msg.text,
          modifier: msg.modifier,
          pre: msg.preScore?.overall,
          post: msg.postScore?.overall,
          truncated: msg.truncated
        };
        showSuggestion();
      } else if (msg.type === 'error') {
        failRun(current, msg.error || 'The rewrite failed.');
      }
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      failRun(current, 'Lost the connection to PromptCraft. Try again.');
    });

    port.postMessage({
      type: 'start',
      prompt: original,
      modifier: publicSettings?.modifier,
      context: IS_CHAT_SITE && publicSettings?.useContext !== false ? extractPageConversation(original) : null,
      refine: base ? options.refine : null,
      focus: options.focus || null
    });
  }

  function endRun(target) {
    target.finished = true;
    if (run === target) run = null;
    try { target.port.disconnect(); } catch {}
    queueSync();
  }

  function failRun(target, message) {
    if (target.finished) return;
    endRun(target);
    // A failed second pass leaves the first suggestion on offer
    if (suggestion) {
      showSuggestion();
      showToast(message, 5000);
    } else {
      showProblem(message, target.options);
    }
  }

  function stopRun() {
    endRun(run);
    if (suggestion) showSuggestion();
    else dismissCard();
  }

  function showWorking() {
    const node = openCard('working');
    const head = el('div', 'pc-head');
    head.append(el('span', 'pc-spinner'), el('div', 'pc-title', STAGE_LABELS.analyzing), closeButton());
    const body = el('div', 'pc-body');
    body.appendChild(el('div', 'pc-text'));
    const actions = el('div', 'pc-actions');
    actions.appendChild(uiButton('Stop', 'pc-btn', stopRun));
    node.append(head, body, actions);
    syncBadge();
  }

  function showProblem(message, options) {
    const node = openCard('problem');
    const head = el('div', 'pc-head');
    head.append(el('div', 'pc-title', 'That didn’t work'), closeButton());
    const body = el('div', 'pc-body');
    body.appendChild(el('p', 'pc-note pc-error', message));
    const actions = el('div', 'pc-actions');
    const retry = uiButton('Try again', 'pc-btn pc-primary', () => startEnhance(options));
    actions.append(retry, uiButton('Open panel', 'pc-btn', openPanel));
    node.append(head, body, actions);
    syncBadge();
    retry.focus({ preventScroll: true });
  }

  // Bracketed blanks the rewrite left for details only the user knows
  function findBlanks(original, enhanced) {
    const found = enhanced.match(/\[(?![ xX]\])[A-Za-z][^\[\]\n]{2,60}\](?!\()/g) || [];
    return [...new Set(found.filter(blank => !original.includes(blank)))].slice(0, 5);
  }

  // The rewrite as the card shows it. When most of the draft survived, what was
  // added is highlighted; otherwise only the blanks left for the user are.
  function markedRewrite(original, text, blanks) {
    const ops = computeDiff(original, text);
    if (ops) {
      const words = (type) => ops.filter(op => op.type === type && op.value.trim()).length;
      if (words('equal') >= words('added')) return diffFragment(ops, ['equal', 'added']);
    }
    const frag = document.createDocumentFragment();
    let rest = text;
    while (rest) {
      const hit = blanks.map(blank => ({ blank, at: rest.indexOf(blank) })).filter(h => h.at !== -1).sort((a, b) => a.at - b.at)[0];
      if (!hit) break;
      frag.append(rest.slice(0, hit.at), el('mark', 'pc-add', hit.blank));
      rest = rest.slice(hit.at + hit.blank.length);
    }
    frag.append(rest);
    return frag;
  }

  function showSuggestion() {
    const { original, text, pre, post, truncated } = suggestion;
    const blanks = findBlanks(original, text);
    const node = openCard('suggestion');

    const head = el('div', 'pc-head');
    head.appendChild(el('div', 'pc-title', 'Suggested rewrite'));
    if (typeof pre === 'number' && typeof post === 'number') {
      const delta = el('span', 'pc-delta', `${pre} → ${post}`);
      delta.title = 'Prompt quality score, before and after (0-100)';
      head.appendChild(delta);
    }
    head.appendChild(closeButton());

    const body = el('div', 'pc-body');
    const preview = el('div', 'pc-text');
    preview.appendChild(markedRewrite(original, text, blanks));
    body.appendChild(preview);

    // One field per blank; whatever is filled in goes into the text on Accept
    const fields = blanks.map((blank) => {
      const label = el('label', 'pc-blank', blank.slice(1, -1));
      const input = el('input');
      input.type = 'text';
      input.autocomplete = 'off';
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          accept.click();
        }
      });
      label.appendChild(input);
      return { blank, input, label };
    });
    if (fields.length > 0) {
      const form = el('div', 'pc-blanks');
      form.append(el('span', 'pc-label', 'Fill in the details (optional)'), ...fields.map(f => f.label));
      body.appendChild(form);
    }
    if (truncated) body.appendChild(el('p', 'pc-note', 'The model hit its length limit, so the end may be cut off.'));

    const actions = el('div', 'pc-actions');
    const accept = uiButton('Accept', 'pc-btn pc-primary', () => {
      let final = text;
      for (const { blank, input } of fields) {
        if (input.value.trim()) final = final.split(blank).join(input.value.trim());
      }
      acceptSuggestion(final);
    });
    actions.append(accept, uiButton('Dismiss', 'pc-btn', dismissCard));

    const refine = (kind) => () => startEnhance({ refine: { kind, previous: text } });
    const foot = el('div', 'pc-foot');
    foot.append(
      uiButton('Shorter', 'pc-link', refine('shorter')),
      uiButton('More detail', 'pc-link', refine('longer')),
      uiButton('Try again', 'pc-link', refine('retry')),
      uiButton('Compare', 'pc-link pc-end', () => showDiffOverlay(original, text))
    );

    node.append(head, body, actions, foot);
    syncBadge();
    // Enter accepts, Esc dismisses
    accept.focus({ preventScroll: true });
  }

  function acceptSuggestion(text) {
    const { inputEl, modifier } = suggestion;
    const before = getTextFromElement(inputEl);
    closeCard();
    try {
      if (!inputEl.isConnected) throw new Error('The text box is gone');
      setTextDirect(inputEl, text);
    } catch {
      navigator.clipboard.writeText(text)
        .then(() => showToast('Could not update the text box, so the rewrite was copied instead'))
        .catch(() => showToast('Could not update the text box'));
      return;
    }
    inputEl.focus({ preventScroll: true });
    undoState = { el: inputEl, text: before, modifier, platform: detectPlatform() };
    showToast('Prompt updated', 8000, { label: 'Undo', run: handleUndo });
  }

  function handleUndo() {
    if (!undoState) return;
    const { el: inputEl, text, modifier, platform } = undoState;
    undoState = null;
    if (!inputEl.isConnected) return;
    setTextDirect(inputEl, text);
    // Feeds the undo-rate hint that makes later rewrites more conservative
    send({ action: 'recordUndo', modifier, platform });
    showToast('Your draft is back');
  }

  // ── Keyboard & Pointer ──────────────────────────────────────────────────
  // Chrome's own shortcut (chrome://extensions/shortcuts) normally handles
  // Ctrl+Shift+E before the page sees it; this covers the case where that
  // binding is taken or was removed.

  document.addEventListener('keydown', (e) => {
    if ($ui('.pc-diff')) return; // the changes dialog handles its own keys
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'E' || e.key === 'e')) {
      e.preventDefault();
      e.stopPropagation();
      startEnhance();
    } else if (e.key === 'Escape' && card) {
      e.preventDefault();
      e.stopPropagation();
      dismissCard();
    }
  }, true);

  // A click elsewhere closes the review. A rewrite stays until it is accepted
  // or dismissed, so a stray click can't throw it away.
  document.addEventListener('mousedown', (e) => {
    if (card && card.dataset.view === 'review' && !e.composedPath().includes(uiRoot.host)) closeCard();
  }, true);

  // Remember the last text field the user was in, for the side panel's "Insert" button
  document.addEventListener('focusin', (e) => {
    const target = e.composedPath ? e.composedPath()[0] : e.target;
    if (isEditable(target)) lastFocusedInput = editingHost(target);
    queueSync();
  }, true);

  // ── Message Listener ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Context menu and keyboard shortcut
    if (msg.action === 'triggerEnhance') {
      startEnhance();
      sendResponse({ ok: true });
      return;
    }

    if (msg.action === 'getConversation') {
      sendResponse({ context: IS_CHAT_SITE ? extractPageConversation() : null, hasInput: !!findTextInput() });
      return;
    }

    // The side panel's "Insert" button
    if (msg.action === 'insertText') {
      const target = findTextInput();
      if (!target || typeof msg.text !== 'string') {
        sendResponse({ ok: false });
        return;
      }
      setTextDirect(target, msg.text);
      sendResponse({ ok: true });
    }
  });

  // ── Init ────────────────────────────────────────────────────────────────

  function init() {
    fetchSettings();
    window.addEventListener('scroll', queueSync, { capture: true, passive: true });
    window.addEventListener('resize', queueSync);
    document.addEventListener('focusout', queueSync, true);
    document.addEventListener('input', () => {
      requestReview();
      queueSync();
    }, true);
    // Chat sites re-render their prompt box, and sometimes <body>, at will
    if (IS_CHAT_SITE) new MutationObserver(queueSync).observe(document.documentElement, { childList: true, subtree: true });
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync') fetchSettings();
      });
    } catch {}
    queueSync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
