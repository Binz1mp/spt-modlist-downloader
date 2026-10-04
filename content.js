(() => {
  const { t, localize, isContextValid, isContextInvalidated } = SPTI18N;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const send = async message => {
    if (!ensureContext()) throw new Error('Extension context invalidated.');
    try {
      const result = await chrome.runtime.sendMessage(message);
      if (result?.error && !result.state) throw new Error(result.error);
      return result;
    } catch (error) {
      if (isContextInvalidated(error)) dispose();
      throw error;
    }
  };
  let running = false;
  let stopped = false;
  let currentToken;
  let panel;
  let outsideClickController;
  let scrollInputController;
  let route = location.href;
  let disposed = false;
  let observer;
  let mountTimer;
  const lifecycleController = new AbortController();
  function dispose() {
    if (disposed) return;
    disposed = true;
    stopped = true;
    outsideClickController?.abort();
    scrollInputController?.abort();
    lifecycleController.abort();
    observer?.disconnect();
    clearTimeout(mountTimer);
    for (const dialog of panel?.querySelectorAll('dialog[open]') || []) dialog.close();
    panel?.remove();
  }
  function ensureContext() {
    if (disposed) return false;
    if (isContextValid()) return true;
    dispose();
    return false;
  }
  function reportError(error) {
    if (isContextInvalidated(error)) dispose();
    else console.error(error);
  }
  SPTI18N.onInvalidated = dispose;
  const svgIcon = (path, className) => `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function lockPageScroll(dialog) {
    if (!ensureContext()) return;
    scrollInputController?.abort();
    const controller = new AbortController();
    scrollInputController = controller;
    const options = { capture: true, passive: false, signal: controller.signal };
    const guardScroll = (event, deltaX, deltaY) => {
      if (!ensureContext()) return;
      if (!dialog.open || !dialog.isConnected) { controller.abort(); return; }
      const path = event.composedPath();
      if (path.includes(dialog)) {
        for (const node of path) {
          if (node instanceof Element) {
            const style = getComputedStyle(node);
            const canScroll = (delta, position, size, viewport, overflow) =>
              /^(auto|scroll|overlay)$/.test(overflow) && size > viewport
              && (delta < 0 ? position > 0 : delta > 0 && position < size - viewport - 1);
            if (canScroll(deltaY, node.scrollTop, node.scrollHeight, node.clientHeight, style.overflowY)
              || canScroll(deltaX, node.scrollLeft, node.scrollWidth, node.clientWidth, style.overflowX)) return;
          }
          if (node === dialog) break;
        }
      }
      event.preventDefault();
    };
    document.addEventListener('wheel', event => {
      if (!event.ctrlKey) guardScroll(event, event.deltaX, event.deltaY);
    }, options);
    let touch;
    document.addEventListener('touchstart', event => {
      touch = event.touches.length === 1 ? event.touches[0] : null;
    }, { ...options, passive: true });
    document.addEventListener('touchmove', event => {
      if (!touch || event.touches.length !== 1) return;
      const next = event.touches[0];
      guardScroll(event, touch.clientX - next.clientX, touch.clientY - next.clientY);
      touch = next;
    }, options);
    document.addEventListener('keydown', event => {
      if (!ensureContext()) return;
      if (!dialog.open || !dialog.isConnected) { controller.abort(); return; }
      if (!event.composedPath().includes(dialog)
        && [' ', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
      }
    }, options);
    dialog.addEventListener('close', () => controller.abort(), { once: true });
  }
  function animateSurface(element, opening, duration = 200) {
    if (reducedMotion()) return null;
    const hidden = { opacity: 0, transform: 'translateY(10px) scale(.97)' };
    const shown = { opacity: 1, transform: 'translateY(0) scale(1)' };
    return element.animate(opening ? [hidden, shown] : [shown, hidden], {
      duration, easing: opening ? 'cubic-bezier(.2,.8,.2,1)' : 'ease-in'
    });
  }
  function updateBadge(ui, processed, total) {
    if (!ensureContext()) return;
    const badge = ui.querySelector('[data-badge]');
    const text = `${processed}/${total}`;
    if (badge.textContent !== text) {
      badge.textContent = text;
      if (!reducedMotion()) badge.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 220 });
    }
    badge.title = t('badgeProgress', processed, total);
  }
  function mount() {
    if (!ensureContext()) return;
    if (route !== location.href) { stopped = true; route = location.href; panel?.remove(); outsideClickController?.abort(); scrollInputController?.abort(); }
    if (!SPT.page(location.href, 'list')) { panel?.remove(); outsideClickController?.abort(); scrollInputController?.abort(); return; }
    if (document.getElementById('spt-downloader')) {
      if (!panel.dataset.started) updateBadge(panel, 0, collectMods().size);
      return;
    }
    scrollInputController?.abort();
    panel = document.createElement('section');
    panel.id = 'spt-downloader';
    panel.setAttribute('aria-label', t('panelTitle'));
    panel.lang = t('@@ui_locale').replaceAll('_', '-');
    panel.innerHTML = '<div id="spt-downloader-menu" hidden><strong data-i18n="panelTitle"></strong><div data-actions><button type="button" data-start data-i18n="download"></button><button type="button" data-stop data-i18n="stop" disabled></button></div><p role="status" aria-live="polite" data-i18n="menuHint"></p><ol></ol></div><div data-launcher><button type="button" data-toggle aria-expanded="false" aria-controls="spt-downloader-menu" data-i18n-aria="openMenu"></button><span data-badge role="status" aria-live="polite">0/0</span></div>';
    localize(panel);
    if (!ensureContext()) return;
    panel.querySelector('[data-toggle]').innerHTML = svgIcon('M12 5v14M5 12h14', 'spt-plus-icon');
    document.body.append(panel);
    const ui = panel;
    const toggle = ui.querySelector('[data-toggle]');
    const menu = ui.querySelector('#spt-downloader-menu');
    let menuAnimation;
    const setExpanded = expanded => {
      if (!ensureContext()) return;
      if (expanded === (toggle.getAttribute('aria-expanded') === 'true')) return;
      menuAnimation?.cancel();
      if (!expanded && menu.contains(document.activeElement)) toggle.focus();
      menu.inert = !expanded;
      menu.hidden = false;
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-label', t(expanded ? 'closeMenu' : 'openMenu'));
      const duration = expanded ? 220 : 150;
      menuAnimation = animateSurface(menu, expanded, duration);
      if (!expanded) {
        if (menuAnimation) menuAnimation.finished.then(() => {
          if (toggle.getAttribute('aria-expanded') === 'false') {
            menu.hidden = true;
          }
        }).catch(() => {});
        else menu.hidden = true;
      }
    };
    toggle.addEventListener('click', () => setExpanded(toggle.getAttribute('aria-expanded') !== 'true'));
    outsideClickController?.abort();
    outsideClickController = new AbortController();
    document.addEventListener('click', event => {
      if (!ensureContext()) return;
      if (toggle.getAttribute('aria-expanded') === 'true'
        && !event.composedPath().includes(ui) && !ui.querySelector('dialog[open]')) {
        setExpanded(false);
      }
    }, { capture: true, signal: outsideClickController.signal });
    ui.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !ui.querySelector('dialog[open]')) { setExpanded(false); toggle.focus(); }
    });
    ui.querySelector('[data-start]').addEventListener('click', () => chooseMods(ui));
    ui.querySelector('[data-stop]').addEventListener('click', () => { stopped = true; });
    updateBadge(ui, 0, collectMods().size);
  }
  function collectMods() {
    return SPT.collectEntries(document);
  }
  function chooseMods(ui) {
    if (!ensureContext()) return;
    if (running || ui.querySelector('dialog[open]')) return;
    const mods = collectMods();
    const dialog = document.createElement('dialog');
    dialog.className = 'spt-mod-picker';
    dialog.setAttribute('aria-labelledby', 'spt-picker-title');
    dialog.innerHTML = '<h2 id="spt-picker-title" data-i18n="pickerTitle"></h2><p data-i18n="pickerHint"></p><label data-select-all><input type="checkbox"><span data-i18n="selectAll"></span></label><div data-mod-list></div><div data-selection-count role="status" aria-live="polite"></div><div data-picker-actions><button type="button" data-cancel data-i18n="cancel"></button><button type="button" data-all data-i18n="downloadAll"></button><button type="button" data-selected disabled></button></div>';
    localize(dialog);
    const list = dialog.querySelector('[data-mod-list]');
    const checks = new Map();
    const rootList = document.createElement('ul');
    rootList.className = 'spt-picker-list';
    list.append(rootList);
    const modRows = new Map();
    const addonLists = new Map();
    let rowIndex = 0;
    // Build parent rows first so each addon can be attached to its actual mod.
    for (const [id, mod] of mods) {
      if (mod.kind !== 'mod') continue;
      const row = document.createElement('li');
      row.className = 'spt-picker-mod';
      modRows.set(id, row);
    }
    for (const [id, mod] of mods) {
      const row = modRows.get(id) || document.createElement('li');
      const label = document.createElement('label');
      label.style.setProperty('--spt-row-delay', `${Math.min(rowIndex++, 8) * 25}ms`);
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      const name = document.createElement('span');
      name.textContent = mod.name;
      name.className = 'spt-picker-name';
      label.append(checkbox, name);
      if (mod.kind === 'addon') {
        const badge = document.createElement('span');
        badge.className = 'spt-addon-badge';
        badge.textContent = t('addonBadge');
        label.append(badge);
      }
      row.prepend(label);
      const parent = mod.kind === 'addon' && modRows.get(mod.parentId);
      if (parent) {
        const branch = document.createElement('span');
        branch.className = 'spt-branch-icon';
        branch.innerHTML = svgIcon('M6 4v12h12', 'spt-elbow-icon');
        branch.setAttribute('aria-hidden', 'true');
        label.prepend(branch);
        let children = addonLists.get(mod.parentId);
        if (!children) {
          children = document.createElement('ul');
          children.className = 'spt-picker-addons';
          children.setAttribute('aria-label', t('parentAddons', mods.get(mod.parentId).name));
          parent.append(children);
          addonLists.set(mod.parentId, children);
        }
        children.append(row);
      } else {
        rootList.append(row);
      }
      checks.set(id, checkbox);
    }
    const selectAll = dialog.querySelector('[data-select-all] input');
    const selectedButton = dialog.querySelector('[data-selected]');
    const updateSelection = () => {
      const count = [...checks.values()].filter(input => input.checked).length;
      selectAll.checked = mods.size > 0 && count === mods.size;
      selectAll.indeterminate = count > 0 && count < mods.size;
      selectedButton.disabled = count === 0;
      selectedButton.textContent = t('downloadSelected', count);
      dialog.querySelector('[data-selection-count]').textContent = t('selectionCount', count, mods.size);
    };
    selectAll.disabled = mods.size === 0;
    dialog.querySelector('[data-all]').disabled = mods.size === 0;
    if (!mods.size) list.textContent = t('emptyList');
    selectAll.addEventListener('change', () => {
      for (const input of checks.values()) input.checked = selectAll.checked;
      updateSelection();
    });
    list.addEventListener('change', updateSelection);
    let closing = false;
    let dialogAnimation;
    const closePicker = afterClose => {
      if (closing || !dialog.open) return;
      closing = true;
      dialogAnimation?.cancel();
      // Prevent further selection or a second download while the dialog fades.
      for (const control of dialog.querySelectorAll('button, input')) control.disabled = true;
      dialog.classList.add('is-closing');
      const finish = () => {
        dialog.close();
        if (ensureContext() && ui.isConnected && SPT.page(location.href, 'list')) afterClose?.();
      };
      dialogAnimation = animateSurface(dialog, false, 150);
      if (dialogAnimation) dialogAnimation.finished.then(finish).catch(() => {});
      else finish();
    };
    const start = selected => {
      if (running || !selected.size) return;
      closePicker(() => { void run(ui, ui, selected); });
    };
    dialog.querySelector('[data-all]').addEventListener('click', () => start(mods));
    selectedButton.addEventListener('click', () => start(new Map([...mods].filter(([id]) => checks.get(id).checked))));
    dialog.querySelector('[data-cancel]').addEventListener('click', () => closePicker());
    dialog.addEventListener('cancel', event => { event.preventDefault(); closePicker(); });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    const isBackdrop = event => {
      const rect = dialog.getBoundingClientRect();
      return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
    };
    let pressedBackdrop = false;
    dialog.addEventListener('pointerdown', event => { pressedBackdrop = isBackdrop(event); });
    dialog.addEventListener('pointercancel', () => { pressedBackdrop = false; });
    dialog.addEventListener('click', event => {
      if (pressedBackdrop && isBackdrop(event)) closePicker();
      pressedBackdrop = false;
    });
    // Let the native dialog consume Escape without collapsing the floating menu.
    dialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
    if (!ensureContext()) return;
    ui.append(dialog);
    updateSelection();
    if (!ensureContext()) return;
    dialog.showModal();
    lockPageScroll(dialog);
    dialogAnimation = animateSurface(dialog, true, 220);
  }
  function entryName(entry) {
    return entry.kind === 'addon' ? `[${t('addonBadge')}] ${entry.name}` : entry.name;
  }
  async function run(ui, buttons, mods) {
    if (!ensureContext()) return;
    if (running) return;
    updateBadge(ui, 0, mods.size);
    const status = ui.querySelector('p');
    if (!mods.size) { status.textContent = t('emptyList'); return; }
    running = true; stopped = false;
    ui.dataset.started = 'true';
    buttons.querySelector('[data-start]').disabled = true;
    buttons.querySelector('[data-stop]').disabled = false;
    ui.querySelector('ol').replaceChildren();
    let processed = 0, requested = 0;
    try {
      for (const mod of mods.values()) {
        if (!ensureContext() || stopped) break;
        const name = entryName(mod);
        const row = document.createElement('li');
        row.textContent = name + ' — ' + t('waiting');
        ui.querySelector('ol').append(row);
        try {
          currentToken = (await send({ type: 'open', url: mod.url })).token;
          const deadline = Date.now() + 50000;
          let result;
          while (!stopped && Date.now() < deadline) {
            result = await send({ type: 'status', token: currentToken });
            if (result.state !== 'waiting') break;
            await sleep(500);
          }
          if (result?.state === 'requested') { requested++; row.textContent = name + ' — ' + t('downloadRequested'); }
          else row.textContent = name + ' — ' + (stopped ? t('stopped') : result?.error || t('responseTimeout'));
        } catch (error) {
          if (isContextInvalidated(error)) { dispose(); break; }
          row.textContent = name + ' — ' + error.message;
        }
        finally {
          if (currentToken && !disposed) await send({ type: 'cancel', token: currentToken }).catch(() => {});
          currentToken = null;
        }
        if (!ensureContext()) break;
        processed++;
        updateBadge(ui, processed, mods.size);
        status.textContent = t('progressStatus', processed, mods.size, requested);
        if (processed < mods.size && !stopped) {
          const until = Date.now() + 300 + Math.random() * 1400;
          while (!stopped && Date.now() < until) await sleep(250);
        }
      }
    } finally {
      running = false;
      if (ensureContext()) {
        status.textContent = t('summaryStatus', t(stopped ? 'stopped' : 'finished'), processed, mods.size, requested);
        buttons.querySelector('[data-start]').disabled = false;
        buttons.querySelector('[data-stop]').disabled = true;
      }
    }
  }
  async function automate() {
    if (!ensureContext()) return;
    const url = SPT.itemPage(location.href);
    const token = url?.searchParams.get('spt_task');
    if (!token || url.searchParams.get('download') !== 'true') return;
    if ((await send({ type: 'ready', token })).state !== 'authorized') return;
    const deadline = Date.now() + 35000;
    let clicked = false;
    while (Date.now() < deadline) {
      if (!ensureContext() || location.href !== url.href) return;
      const latest = [...document.querySelectorAll('button')].find(button => /Download Latest Version/i.test(button.textContent) && !button.disabled && button.getClientRects().length);
      if (latest && !clicked) { latest.click(); clicked = true; }
      for (const modal of document.querySelectorAll('dialog[data-modal]')) {
        for (const element of modal.querySelectorAll('button, a[href]')) {
          if (element.disabled) continue;
          const target = SPT.fromAction(element.getAttribute('x-on:click'), url.href) || SPT.endpoint(element.getAttribute('href'), url.href);
          if (clicked && target) {
            await send({ type: 'dispatch', token, url: target });
            return;
          }
        }
      }
      await sleep(500);
    }
    await send({ type: 'failed', token, error: t('errorDownloadButton') });
  }
  let scheduled = false;
  observer = new MutationObserver(() => {
    if (!ensureContext()) return;
    if (!scheduled) { scheduled = true; mountTimer = setTimeout(() => { scheduled = false; mount(); }, 200); }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('livewire:navigated', mount, { signal: lifecycleController.signal });
  window.addEventListener('popstate', mount, { signal: lifecycleController.signal });
  mount();
  automate().catch(reportError);
})();
