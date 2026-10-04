importScripts('shared.js', 'i18n.js');
const { t } = SPTI18N;
let serial = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  serial = serial.then(() => handle(message, sender)).then(reply, error => reply({ error: error.message }));
  return true;
});
async function handle(message, sender) {
  if (!sender.tab || sender.id !== chrome.runtime.id) throw new Error(t('errorUnauthorized'));
  const key = 'task:' + message.token;
  const task = (await chrome.storage.session.get(key))[key];
  if (message.type === 'open') {
    if (!SPT.page(sender.url, 'list')) throw new Error(t('errorListOnly'));
    const url = SPT.itemPage(message.url);
    if (!url) throw new Error(t('errorInvalidItem'));
    const token = crypto.randomUUID();
    url.searchParams.set('download', 'true');
    url.searchParams.set('spt_task', token);
    const created = await chrome.tabs.create({ url: url.href, active: false });
    await chrome.storage.session.set({ ['task:' + token]: { owner: sender.tab.id, tab: created.id, url: url.href, expires: Date.now() + 60000, state: 'waiting' } });
    return { token };
  }
  if (!task) return { state: 'missing' };
  if (message.type === 'status' || message.type === 'cancel') {
    if (task.owner !== sender.tab.id) throw new Error(t('errorOtherTask'));
    if (message.type === 'cancel') await chrome.storage.session.remove(key);
    return { state: task.state, error: task.error };
  }
  if (task.tab !== sender.tab.id || task.expires < Date.now() || task.state !== 'waiting' || !SPT.itemPage(sender.url) || new URL(sender.url).pathname !== new URL(task.url).pathname) return { state: 'ignored' };
  if (message.type === 'ready') return { state: 'authorized' };
  if (message.type === 'dispatch') {
    const url = SPT.endpoint(message.url, task.url);
    if (!url) throw new Error(t('errorDownloadUrl'));
    const watchKey = 'download-tab:' + task.tab;
    await chrome.storage.session.set({ [watchKey]: {
      tab: task.tab, urls: [url, task.url, new URL(task.url).origin + new URL(task.url).pathname],
      expires: Date.now() + 30 * 60 * 1000
    } });
    try {
      await chrome.tabs.update(task.tab, { url });
    } catch (error) {
      await chrome.storage.session.remove(watchKey);
      throw error;
    }
    task.state = 'requested';
  } else if (message.type === 'failed') {
    task.state = 'failed';
    task.error = String(message.error).slice(0, 300);
  } else return { state: 'ignored' };
  await chrome.storage.session.set({ [key]: task });
  return { state: task.state };
}
chrome.tabs.onRemoved.addListener(tabId => {
  serial = serial.then(async () => {
    await chrome.storage.session.remove('download-tab:' + tabId);
    const tasks = await chrome.storage.session.get(null);
    for (const [key, task] of Object.entries(tasks)) {
      if (!key.startsWith('task:')) continue;
      if (task.owner === tabId) await chrome.storage.session.remove(key);
      else if (task.tab === tabId && task.state === 'waiting') await chrome.storage.session.set({ [key]: { ...task, state: 'failed', error: t('errorTabClosed') } });
    }
  }).catch(console.error);
});

// Track redirects only for tabs opened for a download. Session storage survives
// service worker suspension and is independent of the list's queue cleanup.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url) return;
  serial = serial.then(async () => {
    const key = 'download-tab:' + tabId;
    const watch = (await chrome.storage.session.get(key))[key];
    if (!watch) return;
    if (watch.expires < Date.now()) { await chrome.storage.session.remove(key); return; }
    if (!watch.urls.includes(change.url)) {
      watch.urls.push(change.url);
      await chrome.storage.session.set({ [key]: watch });
    }
  }).catch(console.error);
});
chrome.downloads.onCreated.addListener(item => {
  serial = serial.then(async () => {
    if (item.state === 'interrupted') return;
    const urls = [item.url, item.finalUrl, item.referrer].filter(Boolean);
    const matches = [];
    for (const [key, watch] of Object.entries(await chrome.storage.session.get(null))) {
      if (!key.startsWith('download-tab:')) continue;
      if (watch.expires < Date.now()) { await chrome.storage.session.remove(key); continue; }
      if (watch.urls.some(url => urls.includes(url))) matches.push([key, watch]);
    }
    // DownloadItem has no tab ID. Never guess when the URL match is ambiguous.
    if (matches.length !== 1) return;
    const [key, watch] = matches[0];
    await chrome.storage.session.remove(key);
    await chrome.tabs.remove(watch.tab).catch(() => {});
  }).catch(console.error);
});
