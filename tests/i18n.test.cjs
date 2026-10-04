const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const messages = Object.fromEntries(['en', 'ko'].map(locale => [locale,
  JSON.parse(fs.readFileSync(`_locales/${locale}/messages.json`, 'utf8'))
]));
function translator(locale) {
  const context = { chrome: { i18n: {
    getMessage(key, values = []) {
      const entry = messages[locale][key];
      if (!entry) return '';
      return entry.message.replace(/\$([a-z_]+)\$/gi, (_, name) => {
        const index = Number(entry.placeholders[name.toLowerCase()].content.slice(1)) - 1;
        return values[index] ?? '';
      });
    }
  } } };
  vm.runInNewContext(fs.readFileSync('i18n.js', 'utf8'), context);
  return context.SPTI18N;
}
test('locale keys and placeholder definitions match; all UI and manifest keys exist', () => {
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.ko).sort());
  for (const [key, entry] of Object.entries(messages.en)) {
    assert.equal(typeof entry.message, 'string');
    assert.ok(entry.message.length > 0);
    assert.deepEqual(entry.placeholders, messages.ko[key].placeholders, key);
    for (const locale of ['en', 'ko']) {
      const localized = messages[locale][key];
      for (const match of localized.message.matchAll(/\$([a-z_]+)\$/gi)) {
        assert.match(localized.placeholders[match[1].toLowerCase()].content, /^\$[1-9]$/);
      }
    }
  }
  const source = ['content.js', 'background.js'].map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const keys = [...source.matchAll(/\bt\('([^']+)'|data-i18n(?:-aria)?="([^"]+)"/g)].map(match => match[1] || match[2]);
  // Keys selected dynamically when opening/closing or finishing/stopping.
  keys.push('openMenu', 'closeMenu', 'stopped', 'finished');
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  assert.equal(manifest.default_locale, 'en');
  assert.ok(manifest.content_scripts[0].js.indexOf('i18n.js') < manifest.content_scripts[0].js.indexOf('content.js'));
  keys.push(...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g).map(match => match[1]));
  for (const key of keys.filter(key => !key.startsWith('@@'))) assert.ok(messages.en[key], `Missing translation: ${key}`);
  assert.doesNotMatch(source, /[가-힣]/);
});
test('counts preserve each language word order, including zero and selected totals', () => {
  const en = translator('en'), ko = translator('ko');
  assert.equal(en.t('selectionCount', 2, 120), '2 of 120 selected');
  assert.equal(ko.t('selectionCount', 2, 120), '120개 중 2개 선택');
  assert.equal(en.t('downloadSelected', 0), 'Download selected (0)');
  assert.equal(ko.t('downloadSelected', 0), '선택 다운로드 (0)');
  assert.equal(en.t('summaryStatus', en.t('stopped'), 2, 120, 1), 'Stopped · 2 of 120 processed · download requests: 1');
  assert.equal(ko.t('summaryStatus', ko.t('stopped'), 2, 120, 1), '중지됨 · 120개 중 2개 처리 · 1개 다운로드 요청됨');
  assert.equal(en.t('addonBadge'), 'Addon');
  assert.equal(ko.t('addonBadge'), 'Addon');
});
test('DOM translation sets plain text and accessible labels without parsing names as HTML', () => {
  const { t, localize } = translator('en');
  const text = { dataset: { i18n: 'download' } };
  const attrs = {};
  const button = { dataset: { i18nAria: 'openMenu' }, setAttribute(key, value) { attrs[key] = value; } };
  localize({ querySelectorAll(selector) { return selector === '[data-i18n]' ? [text] : [button]; } });
  assert.equal(text.textContent, 'Download');
  assert.equal(attrs['aria-label'], 'Open download menu');
  assert.equal(t('parentAddons', '<script>$NAME$</script>'), 'Addons for <script>$NAME$</script>');
});

test('invalidated translation calls trigger cleanup; unrelated errors remain visible', () => {
  let cleanups = 0;
  let apiError = new Error('Extension context invalidated.');
  const context = { chrome: {
    runtime: { id: 'test' },
    i18n: { getMessage() { throw apiError; } }
  } };
  vm.runInNewContext(fs.readFileSync('i18n.js', 'utf8'), context);
  context.SPTI18N.onInvalidated = () => cleanups++;
  assert.equal(context.SPTI18N.isContextValid(), true);
  assert.equal(context.SPTI18N.t('download'), '');
  assert.equal(cleanups, 1);
  context.chrome.runtime.id = undefined;
  assert.equal(context.SPTI18N.isContextValid(), false);
  apiError = new Error('Unexpected translation error');
  assert.throws(() => context.SPTI18N.t('download'), /Unexpected translation error/);
  assert.equal(cleanups, 1);
});
