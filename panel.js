// PromptCraft — Floating Panel (content script, listens for toggle message)

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action !== 'togglePanel') return;
  sendResponse({ ok: true });

  const PANEL_ID = '__promptcraft-panel';
  const OVERLAY_ID = '__promptcraft-overlay';

  // Toggle off if already open
  const existing = document.getElementById(PANEL_ID);
  if (existing) {
    const o = document.getElementById(OVERLAY_ID);
    if (existing) { existing.style.transform = 'scale(0.92) translateY(-10px)'; existing.style.opacity = '0'; }
    if (o) { o.style.opacity = '0'; }
    setTimeout(() => { if (existing) existing.remove(); if (o) o.remove(); }, 350);
    return;
  }

  // Create overlay
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', background: 'rgba(0, 0, 0, 0.12)',
    zIndex: '2147483646', opacity: '0', transition: 'opacity 0.3s ease'
  });

  // Create iframe
  const iframe = document.createElement('iframe');
  iframe.id = PANEL_ID;
  iframe.src = msg.popupURL;
  iframe.allow = 'clipboard-write';
  Object.assign(iframe.style, {
    position: 'fixed', top: '12px', right: '12px', width: '440px', height: '480px',
    border: 'none', borderRadius: '16px', background: 'transparent',
    zIndex: '2147483647',
    boxShadow: '0 12px 48px rgba(0, 0, 0, 0.2), 0 4px 16px rgba(0, 0, 0, 0.1)',
    transform: 'scale(0.92) translateY(-10px)', opacity: '0',
    transition: 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease',
    colorScheme: 'light', overflow: 'hidden'
  });

  function closePanel() {
    const o = document.getElementById(OVERLAY_ID);
    const p = document.getElementById(PANEL_ID);
    document.removeEventListener('keydown', onEsc);
    if (p) { p.style.transform = 'scale(0.92) translateY(-10px)'; p.style.opacity = '0'; }
    if (o) { o.style.opacity = '0'; }
    setTimeout(() => { if (p) p.remove(); if (o) o.remove(); }, 350);
  }

  function onEsc(e) { if (e.key === 'Escape') closePanel(); }

  overlay.addEventListener('click', closePanel);
  document.addEventListener('keydown', onEsc);

  const root = document.body || document.documentElement;
  root.appendChild(overlay);
  root.appendChild(iframe);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      iframe.style.transform = 'scale(1) translateY(0)';
      iframe.style.opacity = '1';
    });
  });
});
