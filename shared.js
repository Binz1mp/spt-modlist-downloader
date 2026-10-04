(function (root) {
  const origin = 'https://sp-mod.com';
  function page(value, kind) {
    try {
      const url = new URL(value, origin);
      return url.origin === origin && new RegExp(`^/${kind}/[0-9]+/[^/]+/?$`).test(url.pathname) ? url : null;
    } catch { return null; }
  }
  function endpoint(value, mod) {
    try {
      const url = new URL(value, origin);
      const source = itemPage(mod);
      const kind = source?.pathname.split('/')[1];
      return source && url.origin === origin && url.pathname.startsWith(`/${kind}/download/${source.pathname.split('/')[2]}/`) && /^\/(mod|addon)\/download\/\d+\/[^/]+\/[^/]+\/?$/.test(url.pathname) ? url.href : null;
    } catch { return null; }
  }
  function fromAction(value, mod) {
    const match = (value || '').match(/window\.open\(\s*(['"])(.*?)\1/);
    return match ? endpoint(match[2], mod) : null;
  }
  function itemPage(value) {
    return page(value, 'mod') || page(value, 'addon');
  }
  function collectEntries(doc) {
    const entries = new Map();
    const cardIds = new Map();
    const addonParents = new Map();
    const selector = 'div[wire\\:key^="list-group-"], div[wire\\:key^="list-addon-"]';
    for (const card of doc.querySelectorAll(selector)) {
      const kind = card.getAttribute('wire:key').startsWith('list-addon-') ? 'addon' : 'mod';
      for (const anchor of card.querySelectorAll('a[href]')) {
        // Addons can be nested inside a mod group. Process them at their own
        // position in the list rather than collecting them from the parent.
        if (anchor.closest(selector) !== card) continue;
        const url = page(anchor.href, kind);
        if (!url) continue;
        const id = `${kind}:${url.pathname.split('/')[2]}`;
        cardIds.set(card, id);
        if (kind === 'addon') {
          const parentCard = card.parentElement?.closest('div[wire\\:key^="list-group-"]');
          if (parentCard && !addonParents.has(id)) addonParents.set(id, parentCard);
        }
        const name = anchor.textContent.trim();
        if (!entries.has(id) || name) entries.set(id, {
          url: url.origin + url.pathname, kind,
          name: name || url.pathname.split('/')[3]
        });
      }
    }
    for (const [id, parentCard] of addonParents) {
      const parentId = cardIds.get(parentCard);
      if (parentId) entries.get(id).parentId = parentId;
    }
    return entries;
  }
  const api = { page, itemPage, endpoint, fromAction, collectEntries };
  root.SPT = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
