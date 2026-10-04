(function (root) {
  function isContextInvalidated(error) {
    return /Extension context invalidated/i.test(error?.message || String(error));
  }
  function isContextValid() {
    try { return Boolean(chrome.runtime?.id); }
    catch (error) {
      if (isContextInvalidated(error)) return false;
      throw error;
    }
  }
  function t(key, ...values) {
    try { return chrome.i18n.getMessage(key, values.map(String)); }
    catch (error) {
      if (!isContextInvalidated(error)) throw error;
      root.SPTI18N.onInvalidated?.();
      return '';
    }
  }
  function localize(element) {
    for (const node of element.querySelectorAll('[data-i18n]')) {
      node.textContent = t(node.dataset.i18n);
    }
    for (const node of element.querySelectorAll('[data-i18n-aria]')) {
      node.setAttribute('aria-label', t(node.dataset.i18nAria));
    }
  }
  root.SPTI18N = { t, localize, isContextValid, isContextInvalidated };
})(globalThis);
