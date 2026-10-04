const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const SPT = require('../shared.js');
for (const locale of ['en', 'ko']) for (const kind of ['mod', 'addon']) test(`${locale}/${kind}: authorize only the created tab; cancellation prevents subsequent dispatch`, async () => {
  const messages = JSON.parse(fs.readFileSync(`_locales/${locale}/messages.json`, 'utf8'));
  let listener;
  let downloadCreated, tabUpdated;
  const data = {};
  const navigations = [];
  const timers = [];
  const closed = [];
  const context = {
    SPT, URL, crypto: require('node:crypto').webcrypto, console,
    importScripts(...files) { for (const file of files) vm.runInContext(fs.readFileSync(file, 'utf8'), context); },
    setTimeout(callback, delay) { timers.push({ callback, delay }); },
    chrome: {
      i18n: { getMessage: key => messages[key]?.message || '' },
      runtime: { id: 'test', onMessage: { addListener(fn) { listener = fn; } } },
      downloads: { onCreated: { addListener(fn) { downloadCreated = fn; } } },
      storage: { session: {
        async get(key) { return key === null ? { ...data } : { [key]: data[key] }; },
        async set(values) { Object.assign(data, values); },
        async remove(key) { delete data[key]; }
      } },
      tabs: {
        async create() { return { id: 2 }; },
        async update(id, options) { navigations.push({ id, ...options }); },
        async remove(id) { closed.push(id); },
        onRemoved: { addListener() {} },
        onUpdated: { addListener(fn) { tabUpdated = fn; } }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('background.js', 'utf8'), context);
  const flush = () => vm.runInContext('serial', context);
  const owner = { id: 'test', tab: { id: 1 }, url: 'https://sp-mod.com/list/1/test' };
  const child = { id: 'test', tab: { id: 2 }, url: `https://sp-mod.com/${kind}/2934/armor-class-icon` };
  const downloadUrl = `/${kind}/download/2934/armor-class-icon/1.1.1`;
  const send = (message, sender) => new Promise(resolve => listener(message, sender, resolve));
  const { token } = await send({ type: 'open', url: child.url }, owner);
  assert.equal((await send({ type: 'ready', token }, child)).state, 'authorized');
  assert.equal((await send({ type: 'ready', token }, owner)).state, 'ignored');
  const wrongKind = kind === 'mod' ? 'addon' : 'mod';
  assert.equal((await send({ type: 'ready', token }, { ...child, url: `https://sp-mod.com/${wrongKind}/2934/armor-class-icon` })).state, 'ignored');
  assert.ok((await send({ type: 'dispatch', token, url: `/${wrongKind}/download/2934/armor-class-icon/1.1.1` }, child)).error);
  assert.equal((await send({ type: 'dispatch', token, url: 'https://evil.com/' }, child)).error, messages.errorDownloadUrl.message);
  await send({ type: 'cancel', token }, owner);
  assert.equal((await send({ type: 'dispatch', token, url: downloadUrl }, child)).state, 'missing');
  assert.equal(navigations.length, 0);
  assert.equal(timers.length, 0);
  const next = await send({ type: 'open', url: child.url }, owner);
  assert.equal((await send({ type: 'dispatch', token: next.token, url: downloadUrl }, child)).state, 'requested');
  await send({ type: 'dispatch', token: next.token, url: downloadUrl }, child);
  assert.equal(navigations.length, 1);
  assert.equal(timers.length, 0);
  assert.deepEqual(closed, []);
  // Queue cleanup must not discard download tracking.
  await send({ type: 'cancel', token: next.token }, owner);
  downloadCreated({ url: 'https://unrelated.example/file.zip' });
  await flush();
  assert.deepEqual(closed, []);
  tabUpdated(child.tab.id, { url: 'https://host.example/releases/mod' });
  await flush();
  downloadCreated({ url: 'https://host.example/file.zip', referrer: 'https://host.example/releases/mod', state: 'interrupted' });
  await flush();
  assert.deepEqual(closed, []);
  downloadCreated({ url: 'https://host.example/file.zip', referrer: 'https://host.example/releases/mod', state: 'in_progress' });
  await flush();
  assert.deepEqual(closed, [child.tab.id]);
});
