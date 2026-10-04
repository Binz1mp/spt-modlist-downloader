const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  const document = new EventTarget();
  const window = new EventTarget();
  window.matchMedia = () => ({ matches: true });
  let disconnected = false;
  class Node extends EventTarget {
    constructor() {
      super();
      this.attrs = {};
      this.dataset = {};
      this.isConnected = true;
    }
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return this.attrs[name]; }
    contains() { return false; }
    querySelectorAll(selector) { return selector === 'dialog[open]' && this.dialog ? [this.dialog] : []; }
    remove() { this.isConnected = false; }
    close() { this.open = false; this.dispatchEvent(new Event('close')); }
  }
  const panel = new Node();
  const toggle = new Node();
  toggle.attrs['aria-expanded'] = 'false';
  const menu = new Node();
  const badge = new Node();
  const start = new Node(), stop = new Node();
  panel.querySelector = selector => ({
    '[data-toggle]': toggle, '#spt-downloader-menu': menu,
    '[data-start]': start, '[data-stop]': stop, '[data-badge]': badge
  }[selector] || null);
  document.createElement = () => panel;
  document.getElementById = () => null;
  document.body = { append() {} };
  document.documentElement = {};
  let translationError;
  const context = {
    document, window, Element: Node, AbortController, setTimeout, clearTimeout,
    console, location: { href: 'https://sp-mod.com/list/1/test' },
    SPT: { page: (_, kind) => kind === 'list', itemPage: () => null, collectEntries: () => new Map() },
    chrome: {
      runtime: { id: 'test', async sendMessage() {} },
      i18n: { getMessage(key) { if (translationError) throw translationError; return key; } }
    },
    MutationObserver: class {
      observe() {}
      disconnect() { disconnected = true; }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('i18n.js', 'utf8'), context);
  const script = fs.readFileSync('content.js', 'utf8').replace('  mount();\n', '  globalThis.testLock = lockPageScroll;\n  mount();\n');
  vm.runInContext(script, context);
  toggle.dispatchEvent(new Event('click'));
  assert.equal(toggle.attrs['aria-expanded'], 'true');
  return { context, document, window, panel, Node, disconnected: () => disconnected,
    failTranslation() { translationError = new Error('Extension context invalidated.'); } };
}
for (const reason of ['missing runtime', 'translation API throws']) test(reason + ': outside click cleans up without throwing', () => {
  const fixture = setup();
  if (reason === 'missing runtime') fixture.context.chrome.runtime.id = undefined;
  else fixture.failTranslation();
  fixture.document.dispatchEvent(new Event('click'));
  assert.equal(fixture.panel.isConnected, false);
  assert.equal(fixture.disconnected(), true);
  // Late navigation and clicks must not mount another stale UI or call APIs.
  fixture.document.dispatchEvent(new Event('livewire:navigated'));
  fixture.window.dispatchEvent(new Event('popstate'));
  fixture.document.dispatchEvent(new Event('click'));
  assert.equal(fixture.panel.isConnected, false);
});
test('invalidation releases dialog scroll blocking and removes the modal', () => {
  const fixture = setup();
  const dialog = new fixture.Node();
  dialog.open = true;
  fixture.panel.dialog = dialog;
  fixture.context.testLock(dialog);
  const wheel = () => {
    const event = new Event('wheel', { cancelable: true });
    Object.assign(event, { deltaX: 0, deltaY: 20, ctrlKey: false });
    fixture.document.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(wheel(), true);
  fixture.context.chrome.runtime.id = undefined;
  assert.equal(wheel(), false);
  assert.equal(dialog.open, false);
  assert.equal(fixture.panel.isConnected, false);
  assert.equal(wheel(), false);
});
