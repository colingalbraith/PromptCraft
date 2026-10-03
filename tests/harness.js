// Loads background.js into a sandbox with a fake `chrome` API and a scripted
// `fetch`, so the service worker can be exercised from Node with no browser.
// Run the suite with: node --test tests/

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const EXTENSION_ID = 'testextensionid';
const EXTENSION_URL = `chrome-extension://${EXTENSION_ID}/`;

const SENDERS = {
  // A content script running in a chat page
  page: { id: EXTENSION_ID, url: 'https://chatgpt.com/c/1', tab: { id: 7 } },
  // popup.html, the side panel page
  popup: { id: EXTENSION_ID, url: `${EXTENSION_URL}popup.html` }
};

function storageArea(data) {
  const pick = (keys) => {
    if (keys == null) return { ...data };
    const out = {};
    for (const key of [].concat(keys)) if (key in data) out[key] = structuredClone(data[key]);
    return out;
  };
  return {
    data,
    get: async (keys) => pick(keys),
    set: async (items) => { Object.assign(data, structuredClone(items)); },
    remove: async (keys) => { for (const key of [].concat(keys)) delete data[key]; },
    setAccessLevel: async () => {}
  };
}

function event() {
  const listeners = [];
  return { listeners, addListener: (fn) => listeners.push(fn) };
}

// A streaming HTTP response whose body arrives in the given chunks
function streamResponse(chunks, { status = 200, gapMs = 0, signal } = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        if (gapMs) await new Promise(r => setTimeout(r, gapMs));
        if (signal?.aborted) return controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });
  return new Response(body, { status });
}

// A stand-in for the browser's built-in model (the Prompt API's LanguageModel).
// `availability` is what it reports; `chunks` is what a session streams back;
// `error` makes the stream fail after them. `log` records what the worker did.
function fakeLanguageModel({ availability = 'available', chunks = ['Rewritten ', 'prompt.'], error = null, gapMs = 0 } = {}) {
  const log = { created: [], prompts: [], destroyed: 0 };
  return {
    log,
    availability: async () => availability,
    async create(options) {
      log.created.push(options);
      return {
        promptStreaming(input, { signal } = {}) {
          log.prompts.push(input);
          return new ReadableStream({
            async start(controller) {
              for (const chunk of chunks) {
                if (gapMs) await new Promise(r => setTimeout(r, gapMs));
                if (signal?.aborted) return controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                controller.enqueue(chunk);
              }
              if (error) controller.error(error);
              else controller.close();
            }
          });
        },
        destroy() { log.destroyed++; }
      };
    }
  };
}

const sse = (events) => events.map(e => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`);
const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), { status });

/**
 * @param {object} options
 * @param {object} [options.sync]   initial chrome.storage.sync contents
 * @param {object} [options.local]  initial chrome.storage.local contents
 * @param {(call: {url: string, body: any, headers: object, signal: AbortSignal, init: object}) => Response|Promise<Response>} options.fetch
 *   Answers each request the worker makes. Use `fetch(call.url, call.init)` to pass one through to a real server.
 * @param {object} [options.languageModel]  the browser's built-in model, e.g. fakeLanguageModel(); absent by default
 */
function loadWorker({ sync = {}, local = {}, fetch: respond, languageModel } = {}) {
  const calls = [];
  const tabMessages = [];
  const events = {
    onConnect: event(), onMessage: event(), onInstalled: event(), onRemoved: event(),
    onCommand: event(), menuClicked: event()
  };

  let sidePanelBehavior = null;
  const sidePanelOpened = [];
  const chrome = {
    runtime: {
      id: EXTENSION_ID,
      lastError: null,
      getURL: (file) => EXTENSION_URL + file,
      onConnect: events.onConnect,
      onMessage: events.onMessage,
      onInstalled: events.onInstalled
    },
    storage: { sync: storageArea(structuredClone(sync)), local: storageArea(structuredClone(local)), session: storageArea({}) },
    tabs: {
      onRemoved: events.onRemoved,
      query: async () => [{ id: 7 }],
      sendMessage: async (tabId, message) => { tabMessages.push({ tabId, message }); return null; }
    },
    scripting: { executeScript: async () => [] },
    contextMenus: { removeAll: (cb) => cb && cb(), create: () => {}, onClicked: events.menuClicked },
    commands: { onCommand: events.onCommand },
    sidePanel: {
      setPanelBehavior: async (options) => { sidePanelBehavior = options; },
      open: async (options) => { sidePanelOpened.push(options); }
    }
  };

  async function fakeFetch(url, init = {}) {
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const call = {
      url: String(url),
      method: init.method || 'GET',
      headers: init.headers || {},
      body: init.body ? JSON.parse(init.body) : null,
      signal: init.signal,
      init
    };
    calls.push(call);
    return respond(call);
  }

  const sandbox = vm.createContext({
    chrome, fetch: fakeFetch, console, setTimeout, clearTimeout, AbortController, TextDecoder, TextEncoder,
    structuredClone, URL
  });
  if (languageModel) sandbox.LanguageModel = languageModel;
  sandbox.importScripts = (...files) => {
    for (const file of files) vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  };
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), sandbox, { filename: 'background.js' });

  // Opens an "enhance" port the way content.js and popup.js do
  function connect(sender = SENDERS.page) {
    const received = [];
    const waiters = [];
    const messageListeners = [];
    const disconnectListeners = [];
    const port = {
      name: 'enhance',
      sender,
      onMessage: { addListener: (fn) => messageListeners.push(fn) },
      onDisconnect: { addListener: (fn) => disconnectListeners.push(fn) },
      postMessage(message) {
        received.push(message);
        waiters.splice(0).forEach(check => check());
      }
    };
    events.onConnect.listeners.forEach(fn => fn(port));

    const client = {
      received,
      send: (message) => messageListeners.forEach(fn => fn(message)),
      disconnect: () => disconnectListeners.forEach(fn => fn()),
      // Resolves with the first message matching `match` (a type name or predicate)
      waitFor(match, timeoutMs = 5000) {
        const test = typeof match === 'function' ? match : (m) => m.type === match;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`Timed out waiting for port message; got ${JSON.stringify(received)}`)), timeoutMs);
          const check = () => {
            const found = received.find(test);
            if (found) { clearTimeout(timer); resolve(found); } else waiters.push(check);
          };
          check();
        });
      },
      // Sends a start message and resolves with the terminal done/error message
      async enhance(request, timeoutMs) {
        client.send({ type: 'start', modifier: 'short', ...request });
        return client.waitFor(m => m.type === 'done' || m.type === 'error', timeoutMs);
      },
      streamed: () => received.filter(m => m.type === 'delta').map(m => m.text).join('')
    };
    return client;
  }

  // Sends a one-shot message the way chrome.runtime.sendMessage does
  function send(message, sender = SENDERS.popup) {
    return new Promise((resolve) => {
      let answered = false;
      const respondOnce = (value) => { answered = true; resolve(value); };
      const keptOpen = events.onMessage.listeners.map(fn => fn(message, sender, respondOnce)).some(Boolean);
      if (!keptOpen && !answered) resolve(undefined);
    });
  }

  return { chrome, calls, tabMessages, events, connect, send, sandbox, storage: chrome.storage, sidePanelBehavior: () => sidePanelBehavior, sidePanelOpened };
}

module.exports = { loadWorker, streamResponse, sse, jsonResponse, fakeLanguageModel, SENDERS };
