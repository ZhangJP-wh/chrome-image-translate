/* 图片翻译 - content script */
'use strict';

if (!window.__citImageTranslateLoaded) {
  window.__citImageTranslateLoaded = true;
  boot();
}

function boot() {
  const overlays = new WeakMap();
  const activeOverlays = new Set();
  let lastContextImage = null;
  let lastContextTime = 0;
  let lastSelectionSnapshot = null;
  let currentSelectionView = null;

  document.addEventListener('contextmenu', (event) => {
    const img = findImageInEvent(event);
    if (img) {
      lastContextImage = img;
      lastContextTime = Date.now();
    }
    lastSelectionSnapshot = captureSelectionSnapshot(event);
  }, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return undefined;
    if (message.type === 'CIT_PING') {
      sendResponse({ ok: true });
      return undefined;
    }
    if (message.type === 'CIT_PREPARE') {
      handlePrepare(message).then(sendResponse).catch((err) => {
        sendResponse({ ok: false, error: (err && err.message) || '找不到要翻译的图片' });
      });
      return true;
    }
    if (message.type === 'CIT_PREPARE_SELECTION') {
      Promise.resolve(handlePrepareSelection(message)).then(sendResponse).catch((err) => {
        sendResponse({ ok: false, error: (err && err.message) || '没有可翻译的文字' });
      });
      return true;
    }
    if (message.type === 'CIT_SELECTION_RESULT') {
      const overlay = findOverlayByRequest(message.requestId);
      if (overlay) overlay.showResult(message.text || '');
      return undefined;
    }
    if (message.type === 'CIT_FETCH_FROM_PAGE') {
      fetchBytesFromPage(message.url).then((data) => {
        sendResponse({ ok: true, bufferB64: data.bufferB64, mime: data.mime });
      }).catch((err) => {
        sendResponse({ ok: false, error: (err && err.message) || '无法读取这张图片' });
      });
      return true;
    }
    if (message.type === 'CIT_RESULT') {
      const overlay = findOverlayByRequest(message.requestId);
      if (overlay) {
        const joined = (message.text != null && String(message.text))
          || (message.boxes || []).map((item) => (item && item.text) ? String(item.text) : '').join('\n');
        overlay.showResult(joined);
      }
      return undefined;
    }
    if (message.type === 'CIT_ERROR') {
      const overlay = findOverlayByRequest(message.requestId);
      if (overlay) overlay.showError(message.error || '翻译失败，请稍后重试');
      else showDetachedToast(message.error || '翻译失败，请稍后重试');
      return undefined;
    }
    return undefined;
  });

  function findOverlayByRequest(requestId) {
    for (const overlay of activeOverlays) {
      if (overlay.requestId === requestId) return overlay;
    }
    return null;
  }

  function asImage(node) {
    if (!node || node.nodeType !== 1) return null;
    if (node.tagName === 'IMG' || node instanceof HTMLImageElement) return node;
    if (node.tagName === 'IMAGE' || (typeof SVGImageElement !== 'undefined' && node instanceof SVGImageElement)) {
      return node;
    }
    return null;
  }

  function findImageInEvent(event) {
    const path = event.composedPath ? event.composedPath() : [event.target];
    for (const node of path) {
      const img = asImage(node);
      if (img) return img;
      if (node && node.closest) {
        const nested = node.closest('img');
        if (nested) return nested;
      }
    }
    return null;
  }

  function addSrc(set, value) {
    if (!value) return;
    set.add(value);
    try {
      set.add(new URL(value, document.baseURI).href);
    } catch (_err) {
      // ignore invalid URLs
    }
  }

  function collectSrcs(img) {
    const srcs = new Set();
    if (img instanceof HTMLImageElement) {
      addSrc(srcs, img.currentSrc);
      addSrc(srcs, img.src);
      addSrc(srcs, img.getAttribute('src'));
      const srcset = img.srcset || img.getAttribute('srcset') || '';
      if (srcset) {
        for (const part of srcset.split(',')) {
          addSrc(srcs, part.trim().split(/\s+/)[0]);
        }
      }
    } else {
      addSrc(srcs, img.href && img.href.baseVal);
      addSrc(srcs, img.getAttribute('href'));
      addSrc(srcs, img.getAttributeNS('http://www.w3.org/1999/xlink', 'href'));
    }
    return srcs;
  }

  function getBestSrc(img) {
    if (img instanceof HTMLImageElement) {
      return img.currentSrc || img.src || '';
    }
    const href = (img.href && img.href.baseVal)
      || img.getAttribute('href')
      || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
      || '';
    try {
      return new URL(href, document.baseURI).href;
    } catch (_err) {
      return href;
    }
  }

  function findImageBySrc(srcUrl) {
    if (lastContextImage && isElementCurrent(lastContextImage)) {
      if (!srcUrl) return lastContextImage;
      if (collectSrcs(lastContextImage).has(srcUrl)) return lastContextImage;
      if (Date.now() - lastContextTime < 8000) return lastContextImage;
    }
    if (!srcUrl) return lastContextImage && isElementCurrent(lastContextImage) ? lastContextImage : null;
    const matches = [...document.querySelectorAll('img, image')]
      .filter((el) => collectSrcs(el).has(srcUrl));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1 && lastContextImage && matches.includes(lastContextImage)) {
      return lastContextImage;
    }
    return matches[0] || null;
  }

  function isElementCurrent(el) {
    return !!(el && el.isConnected !== false && document.contains(el));
  }

  async function handlePrepare(message) {
    const img = findImageBySrc(message.srcUrl);
    if (!img) {
      return { ok: false, error: '找不到要翻译的图片' };
    }

    let overlay = overlays.get(img);
    if (overlay) overlay.destroy();
    overlay = new FloatPanel(message.requestId, () => anchorFromImage(img), { img });
    overlays.set(img, overlay);
    activeOverlays.add(overlay);
    overlay.showLoading();

    const payload = await readImagePayload(img);
    return { ok: true, ...payload };
  }

  async function readImagePayload(img) {
    const src = getBestSrc(img);
    if (!src) {
      const captured = await captureFromCanvas(img);
      if (captured) return captured;
      throw new Error('无法读取这张图片');
    }
    if (src.startsWith('blob:') || src.startsWith('data:')) {
      try {
        return await fetchBytesFromPage(src);
      } catch (err) {
        const captured = await captureFromCanvas(img);
        if (captured) return captured;
        throw err;
      }
    }
    return { url: src };
  }

  async function fetchBytesFromPage(url) {
    const res = await fetch(url, { credentials: 'include', cache: 'force-cache' });
    if (!res.ok) {
      throw new Error(`无法读取这张图片（${res.status}）`);
    }
    const buffer = await res.arrayBuffer();
    if (!buffer.byteLength) {
      throw new Error('无法读取这张图片');
    }
    const headerMime = (res.headers.get('content-type') || '').split(';')[0].trim() || guessMimeFromUrl(url);
    const sniffed = citSniffMime(buffer);
    if (sniffed === 'text/html') {
      throw new Error('无法读取这张图片');
    }
    const mime = sniffed.startsWith('image/') ? sniffed : headerMime;
    return { bufferB64: citEncodeBuffer(buffer), mime };
  }

  function guessMimeFromUrl(url) {
    if (url.startsWith('data:')) {
      const match = /^data:([^;,]+)/.exec(url);
      return match ? match[1] : 'image/png';
    }
    return 'image/png';
  }

  async function captureFromCanvas(img) {
    try {
      const width = img.naturalWidth || img.width || 0;
      const height = img.naturalHeight || img.height || 0;
      if (!width || !height) return null;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) resolve(result);
          else reject(new Error('无法读取这张图片'));
        }, 'image/png');
      });
      return { bufferB64: citEncodeBuffer(await blob.arrayBuffer()), mime: 'image/png' };
    } catch (_err) {
      return null;
    }
  }

  function parseObjectPosition(value) {
    const parts = String(value || '50% 50%').trim().split(/\s+/);
    const keywordX = { left: 0, center: 0.5, right: 1 };
    const keywordY = { top: 0, center: 0.5, bottom: 1 };
    const parsePart = (part, keywords, fallback) => {
      if (part == null) return fallback;
      if (Object.prototype.hasOwnProperty.call(keywords, part)) return keywords[part];
      if (part.endsWith('%')) {
        const n = parseFloat(part);
        return Number.isFinite(n) ? n / 100 : fallback;
      }
      return fallback;
    };
    if (parts.length === 1) {
      if (parts[0] in keywordY && !(parts[0] in keywordX)) {
        return [0.5, keywordY[parts[0]]];
      }
      return [parsePart(parts[0], keywordX, 0.5), 0.5];
    }
    return [parsePart(parts[0], keywordX, 0.5), parsePart(parts[1], keywordY, 0.5)];
  }

  function getImageMapping(img) {
    const rect = img.getBoundingClientRect();
    const cs = getComputedStyle(img);
    const bl = parseFloat(cs.borderLeftWidth) || 0;
    const br = parseFloat(cs.borderRightWidth) || 0;
    const bt = parseFloat(cs.borderTopWidth) || 0;
    const bb = parseFloat(cs.borderBottomWidth) || 0;
    const pl = parseFloat(cs.paddingLeft) || 0;
    const pr = parseFloat(cs.paddingRight) || 0;
    const pt = parseFloat(cs.paddingTop) || 0;
    const pb = parseFloat(cs.paddingBottom) || 0;

    const box = {
      left: rect.left + bl + pl,
      top: rect.top + bt + pt,
      width: Math.max(0, rect.width - bl - br - pl - pr),
      height: Math.max(0, rect.height - bt - bb - pt - pb)
    };

    const nw = img.naturalWidth || box.width || 0;
    const nh = img.naturalHeight || box.height || 0;
    if (!nw || !nh || !box.width || !box.height) {
      return {
        cssLeft: box.left,
        cssTop: box.top,
        cssWidth: box.width,
        cssHeight: box.height,
        scaleX: 1,
        scaleY: 1,
        originX: 0,
        originY: 0,
        nw: nw || 1,
        nh: nh || 1
      };
    }

    const fit = cs.objectFit || 'fill';
    if (fit === 'fill') {
      return {
        cssLeft: box.left,
        cssTop: box.top,
        cssWidth: box.width,
        cssHeight: box.height,
        scaleX: box.width / nw,
        scaleY: box.height / nh,
        originX: 0,
        originY: 0,
        nw,
        nh
      };
    }

    let scale;
    if (fit === 'contain') {
      scale = Math.min(box.width / nw, box.height / nh);
    } else if (fit === 'scale-down') {
      scale = Math.min(1, box.width / nw, box.height / nh);
    } else if (fit === 'none') {
      scale = 1;
    } else {
      // cover (and any unknown non-fill value treated as cover-like)
      scale = Math.max(box.width / nw, box.height / nh);
    }

    const contentW = nw * scale;
    const contentH = nh * scale;
    const [posX, posY] = parseObjectPosition(cs.objectPosition);
    const offsetX = (box.width - contentW) * posX;
    const offsetY = (box.height - contentH) * posY;

    const visLeft = Math.max(box.left, box.left + offsetX);
    const visTop = Math.max(box.top, box.top + offsetY);
    const visRight = Math.min(box.left + box.width, box.left + offsetX + contentW);
    const visBottom = Math.min(box.top + box.height, box.top + offsetY + contentH);

    return {
      cssLeft: visLeft,
      cssTop: visTop,
      cssWidth: Math.max(0, visRight - visLeft),
      cssHeight: Math.max(0, visBottom - visTop),
      scaleX: scale,
      scaleY: scale,
      originX: (visLeft - (box.left + offsetX)) / scale,
      originY: (visTop - (box.top + offsetY)) / scale,
      nw,
      nh
    };
  }


  const SNAPSHOT_MAX_AGE_MS = 60000;
  const FLOAT_CSS = `
    :host { all: initial; }
    .popup {
      box-sizing: border-box;
      pointer-events: auto;
      background: #fff;
      color: #202124;
      border-radius: 8px;
      padding: 0;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
      border: 1px solid rgba(32, 33, 36, 0.12);
      width: 100%;
      font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Heiti SC", sans-serif;
    }
    .popup.is-error,
    .popup.is-loading {
      background: rgba(32, 33, 36, 0.94);
      color: #fff;
      border-color: transparent;
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      padding: 8px 10px 0;
      cursor: move;
      user-select: none;
    }
    .toolbar button {
      appearance: none;
      border: 0;
      margin: 0;
      cursor: pointer;
      background: #f1f3f4;
      color: #202124;
      font-size: 12px;
      line-height: 1;
      padding: 6px 8px;
      border-radius: 4px;
      font-family: inherit;
    }
    .toolbar button:hover { background: #e8eaed; }
    .popup.is-error .toolbar button,
    .popup.is-loading .toolbar button {
      background: #fff;
      color: #202124;
    }
    .body {
      font-size: 14px;
      line-height: 1.55;
      overflow-wrap: anywhere;
      word-break: break-word;
      max-height: min(50vh, 360px);
      overflow: auto;
      padding: 10px 14px 14px;
      color: inherit;
      user-select: text;
      cursor: text;
      white-space: pre-wrap;
    }
    .popup.is-loading .body {
      display: flex;
      align-items: center;
      gap: 8px;
      max-height: none;
      overflow: visible;
      cursor: default;
      user-select: none;
    }
    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,0.35);
      border-top-color: #fff;
      border-radius: 50%;
      animation: cit-spin 0.8s linear infinite;
      flex: 0 0 auto;
    }
    @keyframes cit-spin { to { transform: rotate(360deg); } }
  `;

  function isFormControl(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function findFormControlInPath(event) {
    const path = event.composedPath ? event.composedPath() : [event.target];
    for (const node of path) {
      if (isFormControl(node)) return node;
    }
    if (isFormControl(document.activeElement)) return document.activeElement;
    return null;
  }

  function serializeRects(clientRects) {
    const out = [];
    for (const r of clientRects) {
      if (r.width >= 1 && r.height >= 1) {
        out.push({
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
          right: r.right,
          bottom: r.bottom
        });
      }
    }
    return out;
  }

  function usableRects(rects) {
    return Array.isArray(rects) && rects.some((r) => r && r.width >= 2 && r.height >= 2);
  }

  function nodeIsInDocument(node) {
    if (!node) return false;
    try {
      if (document.contains(node)) return true;
      const root = node.getRootNode && node.getRootNode();
      if (root && root instanceof ShadowRoot && root.host) {
        return document.contains(root.host);
      }
    } catch (_err) {
      return false;
    }
    return false;
  }

  function isRangeLive(range) {
    try {
      if (!range || range.collapsed) return false;
      return nodeIsInDocument(range.startContainer) && nodeIsInDocument(range.endContainer);
    } catch (_err) {
      return false;
    }
  }

  function adjustRectsForScroll(rects, scrollX, scrollY) {
    const dx = (window.scrollX || window.pageXOffset || 0) - (scrollX || 0);
    const dy = (window.scrollY || window.pageYOffset || 0) - (scrollY || 0);
    return (rects || []).map((r) => {
      const left = r.left - dx;
      const top = r.top - dy;
      return {
        left,
        top,
        width: r.width,
        height: r.height,
        right: left + r.width,
        bottom: top + r.height
      };
    }).filter((r) => r.width >= 2 && r.height >= 2);
  }

  function getPlacementRects(snapshot) {
    if (!snapshot) return null;
    if (snapshot.range && isRangeLive(snapshot.range)) {
      try {
        const rects = serializeRects(snapshot.range.getClientRects());
        if (usableRects(rects)) return { rects, live: true };
      } catch (_err) {
        // Range may become unusable after DOM updates.
      }
    }
    if (snapshot.rects && snapshot.rects.length) {
      const adjusted = adjustRectsForScroll(snapshot.rects, snapshot.scrollX, snapshot.scrollY);
      if (usableRects(adjusted)) return { rects: adjusted, live: false };
    }
    return null;
  }

  function unionRect(rects) {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const r of rects) {
      left = Math.min(left, r.left);
      top = Math.min(top, r.top);
      right = Math.max(right, r.right != null ? r.right : r.left + r.width);
      bottom = Math.max(bottom, r.bottom != null ? r.bottom : r.top + r.height);
    }
    return {
      left,
      top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
      right,
      bottom
    };
  }

  function readSelectionFrom(sel) {
    if (!sel || sel.rangeCount < 1 || sel.isCollapsed) return null;
    const text = String(sel);
    let range = null;
    let rects = [];
    try {
      range = sel.getRangeAt(0).cloneRange();
      rects = serializeRects(range.getClientRects());
    } catch (_err) {
      range = null;
      rects = [];
    }
    return { text, range, rects };
  }

  function collectSelectionCandidates(event) {
    const candidates = [];
    const seen = new Set();
    const pushSel = (sel) => {
      if (!sel || seen.has(sel)) return;
      seen.add(sel);
      const read = readSelectionFrom(sel);
      if (read && read.text) candidates.push(read);
    };

    try { pushSel(window.getSelection()); } catch (_err) {}
    try { pushSel(document.getSelection()); } catch (_err) {}

    const path = (event && typeof event.composedPath === 'function') ? event.composedPath() : [];
    for (const node of path) {
      try {
        if (node && node.getSelection) pushSel(node.getSelection());
        const root = node && (node.shadowRoot || (node.host && node));
        if (root && root.getSelection) pushSel(root.getSelection());
      } catch (_err) {
        // Closed shadow roots may throw or return nothing.
      }
    }

    let node = event && event.target;
    for (let i = 0; i < 8 && node; i += 1) {
      try {
        if (node.getSelection) pushSel(node.getSelection());
        if (node.shadowRoot && node.shadowRoot.getSelection) {
          pushSel(node.shadowRoot.getSelection());
        }
      } catch (_err) {}
      node = node.parentNode || node.host || (node.getRootNode && node.getRootNode().host) || null;
    }
    return candidates;
  }

  function captureSelectionSnapshot(event) {
    const mouse = { x: event.clientX, y: event.clientY };
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const time = Date.now();
    const form = findFormControlInPath(event);

    if (form) {
      let text = '';
      try {
        if (typeof form.selectionStart === 'number' && typeof form.selectionEnd === 'number') {
          text = String(form.value || '').slice(form.selectionStart, form.selectionEnd);
        }
      } catch (_err) {
        // Some input types throw when reading selectionStart.
      }
      return {
        text,
        inFormControl: true,
        mouse,
        scrollX,
        scrollY,
        rects: [],
        range: null,
        time
      };
    }

    const candidates = collectSelectionCandidates(event);
    const best = candidates.find((item) => item.text && item.text.trim()) || candidates[0] || {
      text: '',
      range: null,
      rects: []
    };

    return {
      text: best.text || '',
      inFormControl: false,
      mouse,
      scrollX,
      scrollY,
      rects: best.rects || [],
      range: best.range || null,
      time
    };
  }

  function isSnapshotFresh(snapshot) {
    return !!(snapshot && (Date.now() - snapshot.time) < SNAPSHOT_MAX_AGE_MS);
  }

  function pickSelectionText(snapshot, fallbackText) {
    const snapText = snapshot && typeof snapshot.text === 'string' ? snapshot.text : '';
    if (snapText.trim()) return snapText;
    return String(fallbackText || '');
  }

  function chooseAnchor(snapshot) {
    const fallback = (snapshot && snapshot.mouse) || { x: Math.round(window.innerWidth / 2), y: 24 };
    const placed = snapshot ? getPlacementRects(snapshot) : null;
    if (placed && placed.rects.length) {
      const union = unionRect(placed.rects);
      return { x: union.left, y: union.bottom + 8, sourceRect: union };
    }
    if (snapshot && snapshot.rects && snapshot.rects[0]) {
      const r = snapshot.rects[0];
      return { x: r.left, y: r.bottom + 8 };
    }
    return fallback;
  }

  function anchorFromImage(img) {
    if (!isElementCurrent(img)) {
      return { x: 24, y: 24 };
    }
    const r = img.getBoundingClientRect();
    const vw = window.innerWidth || 800;
    const margin = 8;
    if (r.right + margin + 240 <= vw) {
      return { x: r.right + margin, y: Math.max(margin, r.top), sourceRect: r };
    }
    return { x: r.left, y: r.bottom + margin, sourceRect: r };
  }

  function handlePrepareSelection(message) {
    const snapshot = isSnapshotFresh(lastSelectionSnapshot) ? lastSelectionSnapshot : null;
    const text = pickSelectionText(snapshot, message.fallbackText);
    if (!text.trim()) {
      return { ok: false, error: '没有可翻译的文字' };
    }
    if (currentSelectionView) currentSelectionView.destroy();
    const view = new FloatPanel(message.requestId, () => chooseAnchor(snapshot));
    currentSelectionView = view;
    activeOverlays.add(view);
    view.showLoading();
    return { ok: true, text };
  }

  class FloatPanel {
    constructor(requestId, getAnchor, options) {
      this.requestId = requestId;
      this.getAnchor = typeof getAnchor === 'function' ? getAnchor : () => ({ x: 24, y: 24 });
      this.img = options && options.img ? options.img : null;
      this.destroyed = false;
      this.errorTimer = 0;
      this.userMoved = false;
      this.phase = 'loading';

      this.host = document.createElement('div');
      this.host.setAttribute('data-cit-float', '1');
      this.host.style.cssText = [
        'all: initial',
        'display: block',
        'position: fixed',
        'left: 0',
        'top: 0',
        'width: 0',
        'height: auto',
        'overflow: visible',
        'z-index: 2147483647',
        'pointer-events: none',
        'margin: 0',
        'padding: 0',
        'border: 0',
        'box-sizing: border-box'
      ].join(';');

      this.shadow = this.host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = FLOAT_CSS;
      this.wrap = document.createElement('div');
      this.shadow.append(style, this.wrap);
      (document.documentElement || document.body).appendChild(this.host);

      this.onSync = () => this.syncPosition();
      window.addEventListener('resize', this.onSync, true);
      document.addEventListener('scroll', this.onSync, true);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', this.onSync);
        window.visualViewport.addEventListener('scroll', this.onSync);
      }
    }

    clearStage() {
      this.wrap.replaceChildren();
      this.popup = null;
      this.bodyEl = null;
      this.toolbar = null;
    }

    showLoading() {
      this.phase = 'loading';
      clearTimeout(this.errorTimer);
      this.clearStage();
      this.buildPopup('loading');
      const body = document.createElement('div');
      body.className = 'body';
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      const label = document.createElement('span');
      label.textContent = '翻译中…';
      body.append(spinner, label);
      this.popup.appendChild(body);
      this.bodyEl = body;
      this.syncPosition();
    }

    showError(message) {
      this.phase = 'error';
      this.clearStage();
      this.buildPopup('error');
      this.addToolbar();
      const body = document.createElement('div');
      body.className = 'body';
      body.textContent = message || '翻译失败，请稍后重试';
      this.popup.appendChild(body);
      this.bodyEl = body;
      this.syncPosition();
      clearTimeout(this.errorTimer);
      this.errorTimer = setTimeout(() => {
        if (!this.destroyed) this.destroy();
      }, 4000);
    }

    showResult(text) {
      this.phase = 'result';
      clearTimeout(this.errorTimer);
      this.clearStage();
      this.buildPopup('result');
      this.addToolbar();
      const body = document.createElement('div');
      body.className = 'body';
      body.textContent = text || '';
      this.popup.appendChild(body);
      this.bodyEl = body;
      this.syncPosition();
    }

    buildPopup(kind) {
      this.popup = document.createElement('div');
      this.popup.className = 'popup';
      if (kind === 'error') this.popup.classList.add('is-error');
      if (kind === 'loading') this.popup.classList.add('is-loading');
      this.wrap.appendChild(this.popup);
    }

    addToolbar() {
      const toolbar = document.createElement('div');
      toolbar.className = 'toolbar';
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = '关闭';
      close.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.destroy();
      });
      toolbar.appendChild(close);
      if (this.popup) this.popup.prepend(toolbar);
      this.toolbar = toolbar;
      this.bindDrag(toolbar);
    }

    bindDrag(handle) {
      handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        if (event.target && event.target.closest && event.target.closest('button')) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = this.host.getBoundingClientRect();
        const dx = event.clientX - rect.left;
        const dy = event.clientY - rect.top;
        this.userMoved = true;
        const onMove = (ev) => {
          if (this.destroyed) return;
          this.placeAt(ev.clientX - dx, ev.clientY - dy);
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove, true);
          window.removeEventListener('pointerup', onUp, true);
          window.removeEventListener('pointercancel', onUp, true);
        };
        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onUp, true);
        window.addEventListener('pointercancel', onUp, true);
      });
    }

    placeAt(left, top) {
      const margin = 8;
      const vw = window.innerWidth || document.documentElement.clientWidth || 320;
      const vh = window.innerHeight || document.documentElement.clientHeight || 240;
      const w = this.host.offsetWidth || 0;
      const h = this.host.offsetHeight || 0;
      left = Math.min(Math.max(margin, left), Math.max(margin, vw - w - margin));
      top = Math.min(Math.max(margin, top), Math.max(margin, vh - h - margin));
      this.host.style.left = `${left}px`;
      this.host.style.top = `${top}px`;
    }

    syncPosition() {
      if (this.destroyed) return;
      if (this.img && !isElementCurrent(this.img)) {
        this.destroy();
        return;
      }
      if (this.userMoved) return;
      const margin = 8;
      const vw = window.innerWidth || document.documentElement.clientWidth || 320;
      const vh = window.innerHeight || document.documentElement.clientHeight || 240;
      const maxW = Math.min(420, Math.max(200, vw - margin * 2));
      this.host.style.width = `${maxW}px`;
      this.host.style.height = 'auto';
      this.host.style.overflow = 'visible';

      const anchor = this.getAnchor() || { x: 24, y: 24 };
      this.host.style.left = `${Math.max(margin, anchor.x)}px`;
      this.host.style.top = `${Math.max(margin, anchor.y)}px`;

      const rect = this.host.getBoundingClientRect();
      let left = rect.left;
      let top = rect.top;
      const w = rect.width || maxW;
      const h = rect.height || 80;
      if (left + w + margin > vw) left = vw - w - margin;
      if (top + h + margin > vh) {
        if (anchor.sourceRect && anchor.sourceRect.top - h - margin >= margin) {
          top = anchor.sourceRect.top - h - 8;
        } else {
          top = Math.max(margin, vh - h - margin);
        }
      }
      if (left < margin) left = margin;
      if (top < margin) top = margin;
      this.host.style.left = `${left}px`;
      this.host.style.top = `${top}px`;
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      clearTimeout(this.errorTimer);
      window.removeEventListener('resize', this.onSync, true);
      document.removeEventListener('scroll', this.onSync, true);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', this.onSync);
        window.visualViewport.removeEventListener('scroll', this.onSync);
      }
      this.host.remove();
      activeOverlays.delete(this);
      if (currentSelectionView === this) currentSelectionView = null;
      if (this.img && overlays.get(this.img) === this) overlays.delete(this.img);
    }
  }

  function showDetachedToast(message) {
    const host = document.createElement('div');
    host.setAttribute('data-cit-toast', '1');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;left:50%;bottom:24px;transform:translateX(-50%);pointer-events:auto;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = 'div{font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;background:rgba(32,33,36,0.94);color:#fff;border-radius:8px;padding:10px 16px;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,0.28);}';
    const card = document.createElement('div');
    card.textContent = message;
    shadow.append(style, card);
    (document.documentElement || document.body).appendChild(host);
    setTimeout(() => host.remove(), 4000);
  }
}
