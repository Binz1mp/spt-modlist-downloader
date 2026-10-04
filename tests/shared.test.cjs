const { test } = require('node:test');
const assert = require('node:assert/strict');
const { page, itemPage, endpoint, fromAction, collectEntries } = require('../shared.js');
test('restrict supported pages to exact HTTPS host and numeric IDs', () => {
  assert.ok(page('https://sp-mod.com/list/127491/deltamod', 'list'));
  for (const url of ['https://evil.com/list/1/a', 'http://sp-mod.com/list/1/a', '/list/a/b', '/list/1/a/extra', '/mod/1/a']) assert.equal(page(url, 'list'), null);
});
test('extract modal action without evaluating JavaScript', () => {
  assert.equal(fromAction("$flux.modal('download-show-desktop').close(); window.open('/mod/download/2934/armor-class-icon/1.1.1', '_blank')", '/mod/2934/armor-class-icon'), 'https://sp-mod.com/mod/download/2934/armor-class-icon/1.1.1');
});
test('reject cross-origin and wrong-mod download targets', () => {
  for (const url of ['https://evil.com/mod/download/2934/a/1', '/mod/download/9/a/1', 'javascript:alert(1)', null]) assert.equal(endpoint(url, '/mod/2934/a'), null);
  assert.equal(fromAction('alert(1)', '/mod/2934/a'), null);
});
test('support addon pages and only their matching download route', () => {
  assert.ok(itemPage('/addon/123/orbit-fika-addon?download=true'));
  assert.equal(itemPage('/list/123/test'), null);
  assert.equal(fromAction("window.open('/addon/download/123/orbit-fika-addon/1.1.0', '_blank')", '/addon/123/orbit-fika-addon'), 'https://sp-mod.com/addon/download/123/orbit-fika-addon/1.1.0');
  for (const target of ['/mod/download/123/a/1', '/addon/download/124/a/1', 'https://evil.com/addon/download/123/a/1']) {
    assert.equal(endpoint(target, '/addon/123/a'), null);
  }
  assert.equal(endpoint('/addon/download/123/a/1', '/mod/123/a'), null);
});
test('collect nested addons once, preserving names, order and distinct mod/addon IDs', () => {
  const card = key => ({
    anchors: [], getAttribute: () => key,
    querySelectorAll() { return this.anchors; }
  });
  const mod = card('list-group-1');
  const addon = card('list-addon-2');
  addon.parentElement = { closest: () => mod };
  const duplicate = card('list-addon-3');
  const anchor = (owner, href, name) => ({ href, textContent: name, closest: () => owner });
  const addonLinks = [anchor(addon, 'https://sp-mod.com/addon/123/orbit-fika-addon', ''), anchor(addon, 'https://sp-mod.com/addon/123/orbit-fika-addon', 'ORBIT - Fika Addon')];
  mod.anchors = [anchor(mod, 'https://sp-mod.com/mod/123/orbit', ''), anchor(mod, 'https://sp-mod.com/mod/123/orbit', 'ORBIT'), ...addonLinks];
  addon.anchors = addonLinks;
  duplicate.anchors = [anchor(duplicate, 'https://sp-mod.com/addon/123/orbit-fika-addon', '')];
  const entries = collectEntries({ querySelectorAll: () => [mod, addon, duplicate] });
  assert.deepEqual([...entries.keys()], ['mod:123', 'addon:123']);
  assert.equal(entries.get('mod:123').name, 'ORBIT');
  assert.equal(entries.get('addon:123').name, 'ORBIT - Fika Addon');
  assert.equal(entries.get('addon:123').kind, 'addon');
  assert.equal(entries.get('addon:123').parentId, 'mod:123');
  assert.equal(entries.get('mod:123').parentId, undefined);
});
test('addons without a matching containing mod stay ungrouped', () => {
  const addon = {
    getAttribute: () => 'list-addon-1',
    parentElement: { closest: () => null },
    querySelectorAll: () => [{
      href: 'https://sp-mod.com/addon/123/orbit-fika-addon',
      textContent: 'Fika Addon', closest: () => addon
    }]
  };
  const entries = collectEntries({ querySelectorAll: () => [addon] });
  assert.equal(entries.get('addon:123').parentId, undefined);
  assert.equal(entries.size, 1);
});
