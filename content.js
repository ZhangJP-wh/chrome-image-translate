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
      if (overlay && overlay.showSelectionResult) {
        overlay.showSelectionResult(message.source || '', message.text || '');
      }
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
      if (overlay) overlay.showBoxes(message.boxes || [], message.imageWidth, message.imageHeight);
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
    overlay = new Overlay(img, message.requestId);
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

  const OVERLAY_CSS = `
    :host { all: initial; }
    .wrap {
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
      pointer-events: none;
      font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Heiti SC", sans-serif;
    }
    .status {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(32, 33, 36, 0.32);
      z-index: 1;
    }
    .card {
      pointer-events: auto;
      background: rgba(32, 33, 36, 0.94);
      color: #fff;
      border-radius: 8px;
      padding: 10px 16px;
      font-size: 14px;
      line-height: 1.4;
      max-width: calc(100% - 24px);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
      display: flex;
      align-items: center;
      gap: 8px;
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
    .box {
      position: absolute;
      box-sizing: border-box;
      background: rgba(255, 255, 255, 0.92);
      border-radius: 2px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      padding: 1px 3px;
    }
    .box .text {
      color: #202124;
      text-align: center;
      width: 100%;
      overflow-wrap: anywhere;
      word-break: break-word;
      line-height: 1.25;
      font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Heiti SC", sans-serif;
    }
    .wrap.is-original .box { visibility: hidden; }
    .toolbar {
      position: absolute;
      top: 8px;
      right: 8px;
      display: flex;
      gap: 6px;
      pointer-events: auto;
      z-index: 2;
      filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.28));
    }
    .toolbar button {
      appearance: none;
      border: 0;
      margin: 0;
      cursor: pointer;
      background: #fff;
      color: #202124;
      font-size: 12px;
      line-height: 1;
      padding: 6px 8px;
      border-radius: 4px;
      font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Heiti SC", sans-serif;
    }
    .toolbar button:hover { background: #f1f3f4; }
    .hidden { display: none !important; }
  `;

  class Overlay {
    constructor(img, requestId) {
      this.img = img;
      this.requestId = requestId;
      this.boxes = [];
      this.coordWidth = img.naturalWidth || 0;
      this.coordHeight = img.naturalHeight || 0;
      this.showingOriginal = false;
      this.destroyed = false;
      this.errorTimer = 0;

      this.host = document.createElement('div');
      this.host.setAttribute('data-cit-overlay', '1');
      this.host.style.cssText = [
        'all: initial',
        'display: block',
        'position: fixed',
        'left: 0',
        'top: 0',
        'width: 0',
        'height: 0',
        'overflow: hidden',
        'z-index: 2147483646',
        'pointer-events: none',
        'margin: 0',
        'padding: 0',
        'border: 0',
        'box-sizing: border-box'
      ].join(';');

      this.shadow = this.host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = OVERLAY_CSS;
      this.wrap = document.createElement('div');
      this.wrap.className = 'wrap';
      this.shadow.append(style, this.wrap);
      (document.documentElement || document.body).appendChild(this.host);

      this.onSync = () => this.syncPosition();
      this.resizeObserver = new ResizeObserver(this.onSync);
      this.resizeObserver.observe(img);
      window.addEventListener('resize', this.onSync, true);
      document.addEventListener('scroll', this.onSync, true);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', this.onSync);
        window.visualViewport.addEventListener('scroll', this.onSync);
      }
      this.syncPosition();
    }

    syncPosition() {
      if (this.destroyed) return;
      if (!isElementCurrent(this.img)) {
        this.destroy();
        return;
      }
      const map = getImageMapping(this.img);
      this.mapping = map;
      this.host.style.left = `${map.cssLeft}px`;
      this.host.style.top = `${map.cssTop}px`;
      this.host.style.width = `${map.cssWidth}px`;
      this.host.style.height = `${map.cssHeight}px`;
      this.layoutBoxes();
    }

    clearStage() {
      this.wrap.replaceChildren();
      this.wrap.classList.remove('is-original');
    }

    showLoading() {
      this.clearStage();
      const status = document.createElement('div');
      status.className = 'status';
      status.innerHTML = '<div class="card"><span class="spinner"></span><span>翻译中…</span></div>';
      this.wrap.appendChild(status);
      this.syncPosition();
    }

    showError(message) {
      this.clearStage();
      const status = document.createElement('div');
      status.className = 'status';
      const card = document.createElement('div');
      card.className = 'card';
      card.textContent = message || '翻译失败，请稍后重试';
      status.appendChild(card);
      this.addToolbar(true);
      this.wrap.appendChild(status);
      this.syncPosition();
      clearTimeout(this.errorTimer);
      this.errorTimer = setTimeout(() => {
        if (!this.destroyed) this.destroy();
      }, 4000);
    }

    showBoxes(boxes, imageWidth, imageHeight) {
      this.boxes = Array.isArray(boxes) ? boxes : [];
      if (imageWidth) this.coordWidth = imageWidth;
      if (imageHeight) this.coordHeight = imageHeight;
      this.showingOriginal = false;
      this.clearStage();
      this.boxLayer = document.createElement('div');
      this.wrap.appendChild(this.boxLayer);
      this.addToolbar(false);
      this.syncPosition();
    }

    addToolbar(errorMode) {
      const toolbar = document.createElement('div');
      toolbar.className = 'toolbar';
      if (!errorMode) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.textContent = '显示原文';
        toggle.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.showingOriginal = !this.showingOriginal;
          this.wrap.classList.toggle('is-original', this.showingOriginal);
          toggle.textContent = this.showingOriginal ? '显示译文' : '显示原文';
        });
        toolbar.appendChild(toggle);
      }
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = '关闭';
      close.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.destroy();
      });
      toolbar.appendChild(close);
      this.wrap.appendChild(toolbar);
    }

    layoutBoxes() {
      if (!this.boxLayer || !this.mapping) return;
      this.boxLayer.replaceChildren();
      const map = this.mapping;
      const coordW = this.coordWidth || map.nw;
      const coordH = this.coordHeight || map.nh;
      const scaleAdjustX = coordW ? map.nw / coordW : 1;
      const scaleAdjustY = coordH ? map.nh / coordH : 1;

      for (const item of this.boxes) {
        const bbox = item.bbox;
        if (!bbox) continue;
        const x0 = bbox.x0 * scaleAdjustX;
        const y0 = bbox.y0 * scaleAdjustY;
        const x1 = bbox.x1 * scaleAdjustX;
        const y1 = bbox.y1 * scaleAdjustY;
        const left = (x0 - map.originX) * map.scaleX;
        const top = (y0 - map.originY) * map.scaleY;
        const width = Math.max(2, (x1 - x0) * map.scaleX);
        const height = Math.max(2, (y1 - y0) * map.scaleY);
        const el = document.createElement('div');
        el.className = 'box';
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.width = `${width}px`;
        el.style.height = `${height}px`;
        const text = document.createElement('div');
        text.className = 'text';
        text.textContent = item.text || '';
        el.appendChild(text);
        this.boxLayer.appendChild(el);
        fitText(text, width, height);
      }
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      clearTimeout(this.errorTimer);
      this.resizeObserver.disconnect();
      window.removeEventListener('resize', this.onSync, true);
      document.removeEventListener('scroll', this.onSync, true);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', this.onSync);
        window.visualViewport.removeEventListener('scroll', this.onSync);
      }
      this.host.remove();
      activeOverlays.delete(this);
      if (overlays.get(this.img) === this) overlays.delete(this.img);
    }
  }

  function fitText(textEl, boxW, boxH) {
    const maxH = Math.max(8, boxH - 2);
    const maxW = Math.max(8, boxW - 4);
    let lo = 6;
    let hi = Math.min(64, Math.floor(maxH));
    let best = 6;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      textEl.style.fontSize = `${mid}px`;
      if (textEl.scrollWidth <= maxW + 0.5 && textEl.scrollHeight <= maxH + 0.5) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    textEl.style.fontSize = `${best}px`;
  }

  const SNAPSHOT_MAX_AGE_MS = 60000;
  const TOOLBAR_H = 32;
  const SELECTION_CSS = `
    :host { all: initial; }
    .wrap {
      position: relative;
      width: 100%;
      height: 100%;
      pointer-events: none;
      font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Heiti SC", sans-serif;
    }
    .status {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1;
    }
    .card {
      pointer-events: auto;
      background: rgba(32, 33, 36, 0.94);
      color: #fff;
      border-radius: 8px;
      padding: 10px 16px;
      font-size: 14px;
      line-height: 1.4;
      max-width: calc(100% - 16px);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
      display: flex;
      align-items: center;
      gap: 8px;
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
    .region {
      position: absolute;
      box-sizing: border-box;
      background: rgba(255, 255, 255, 0.94);
      border-radius: 2px;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      overflow: hidden;
      padding: 1px 4px;
      pointer-events: auto;
    }
    .region .text {
      color: #202124;
      text-align: left;
      width: 100%;
      overflow-wrap: anywhere;
      word-break: break-word;
      line-height: 1.25;
      font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Heiti SC", sans-serif;
    }
    .wrap.is-original .region { visibility: hidden; }
    .popup {
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      box-sizing: border-box;
      pointer-events: auto;
      background: #fff;
      color: #202124;
      border-radius: 8px;
      padding: 12px 14px 12px;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.28);
      max-width: 100%;
    }
    .popup .body {
      font-size: 14px;
      line-height: 1.55;
      overflow-wrap: anywhere;
      word-break: break-word;
      max-height: min(50vh, 360px);
      overflow: auto;
      color: #202124;
    }
    .popup.is-error .body,
    .popup.is-loading .body {
      color: #fff;
    }
    .popup.is-error,
    .popup.is-loading {
      background: rgba(32, 33, 36, 0.94);
      color: #fff;
    }
    .popup.is-loading .body {
      display: flex;
      align-items: center;
      gap: 8px;
      max-height: none;
      overflow: visible;
    }
    .toolbar {
      position: absolute;
      top: 0;
      right: 0;
      display: flex;
      gap: 6px;
      pointer-events: auto;
      z-index: 2;
      filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.28));
    }
    .toolbar.toolbar-in-popup {
      position: relative;
      top: auto;
      right: auto;
      justify-content: flex-end;
      margin: 0 0 8px;
      filter: none;
    }
    .toolbar button {
      appearance: none;
      border: 0;
      margin: 0;
      cursor: pointer;
      background: #fff;
      color: #202124;
      font-size: 12px;
      line-height: 1;
      padding: 6px 8px;
      border-radius: 4px;
      font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Heiti SC", sans-serif;
    }
    .toolbar button:hover { background: #f1f3f4; }
    .popup.is-error .toolbar button,
    .popup.is-loading .toolbar button {
      background: #fff;
      color: #202124;
    }
    .hidden { display: none !important; }
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

    let text = '';
    let range = null;
    let rects = [];
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        text = String(sel);
        if (!sel.isCollapsed) {
          range = sel.getRangeAt(0).cloneRange();
          rects = serializeRects(range.getClientRects());
        }
      }
    } catch (_err) {
      // Selection may be inaccessible (e.g. some closed shadow trees).
    }

    return {
      text,
      inFormControl: false,
      mouse,
      scrollX,
      scrollY,
      rects,
      range,
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

  function choosePlacement(snapshot) {
    const fallbackAnchor = (snapshot && snapshot.mouse)
      || { x: Math.round(window.innerWidth / 2), y: 24 };
    if (!snapshot || snapshot.inFormControl) {
      return { mode: 'popup', anchor: fallbackAnchor };
    }
    const placed = getPlacementRects(snapshot);
    if (placed && placed.rects.length) {
      return { mode: 'overlay', rects: placed.rects, live: placed.live };
    }
    if (snapshot.rects && snapshot.rects[0]) {
      const r = snapshot.rects[0];
      return { mode: 'popup', anchor: { x: r.left, y: r.bottom } };
    }
    return { mode: 'popup', anchor: fallbackAnchor };
  }

  function handlePrepareSelection(message) {
    const snapshot = isSnapshotFresh(lastSelectionSnapshot) ? lastSelectionSnapshot : null;
    const text = pickSelectionText(snapshot, message.fallbackText);
    if (!text.trim()) {
      return { ok: false, error: '没有可翻译的文字' };
    }
    if (currentSelectionView) currentSelectionView.destroy();
    const placement = choosePlacement(snapshot);
    const view = new SelectionView(message.requestId, snapshot, placement, text);
    currentSelectionView = view;
    activeOverlays.add(view);
    view.showLoading();
    return { ok: true, text, mode: placement.mode };
  }

  class SelectionView {
    constructor(requestId, snapshot, placement, sourceText) {
      this.requestId = requestId;
      this.snapshot = snapshot || {
        mouse: placement.anchor || { x: 24, y: 24 },
        scrollX: window.scrollX || 0,
        scrollY: window.scrollY || 0,
        rects: [],
        range: null,
        inFormControl: true,
        time: Date.now()
      };
      this.mode = placement.mode;
      this.anchor = placement.anchor || this.snapshot.mouse || { x: 24, y: 24 };
      this.sourceText = sourceText || '';
      this.translatedText = '';
      this.showingOriginal = false;
      this.destroyed = false;
      this.errorTimer = 0;
      this.phase = 'loading';
      this.lastError = '';
      this._switchingToPopup = false;

      this.host = document.createElement('div');
      this.host.setAttribute('data-cit-selection', '1');
      this.host.style.cssText = [
        'all: initial',
        'display: block',
        'position: fixed',
        'left: 0',
        'top: 0',
        'width: 0',
        'height: 0',
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
      style.textContent = SELECTION_CSS;
      this.wrap = document.createElement('div');
      this.wrap.className = 'wrap';
      this.shadow.append(style, this.wrap);
      (document.documentElement || document.body).appendChild(this.host);

      this.onSync = () => this.syncPosition();
      this.resizeObserver = new ResizeObserver(this.onSync);
      this.observeRangeAncestor();
      window.addEventListener('resize', this.onSync, true);
      document.addEventListener('scroll', this.onSync, true);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', this.onSync);
        window.visualViewport.addEventListener('scroll', this.onSync);
      }
    }

    switchToPopup(anchor) {
      const r = this.snapshot && this.snapshot.rects && this.snapshot.rects[0];
      this.mode = 'popup';
      this.anchor = anchor || this.anchor || this.snapshot.mouse || (r ? { x: r.left, y: r.bottom } : { x: 24, y: 24 });
      if (this._switchingToPopup) {
        this.layoutPopup();
        return;
      }
      this._switchingToPopup = true;
      try {
        if (this.phase === 'error') {
          this.showError(this.lastError || '翻译失败，请稍后重试');
        } else if (this.phase === 'result') {
          this.showSelectionResult(this.sourceText, this.translatedText);
        } else {
          this.showLoading();
        }
      } finally {
        this._switchingToPopup = false;
      }
    }

    observeRangeAncestor() {
      try {
        const range = this.snapshot && this.snapshot.range;
        if (!range) return;
        const node = range.commonAncestorContainer;
        const el = node && (node.nodeType === 1 ? node : node.parentElement);
        if (el) this.resizeObserver.observe(el);
      } catch (_err) {
        // ignore
      }
    }

    syncPosition() {
      if (this.destroyed) return;
      if (this.mode === 'overlay') {
        const placed = getPlacementRects(this.snapshot);
        if (!placed || !placed.rects.length) {
          const r = this.snapshot.rects && this.snapshot.rects[0];
          this.switchToPopup(this.snapshot.mouse || (r ? { x: r.left, y: r.bottom } : { x: 24, y: 24 }));
          return;
        }
        this.layoutOverlay(placed.rects);
        return;
      }
      this.layoutPopup();
    }

    clearStage() {
      this.wrap.replaceChildren();
      this.wrap.classList.remove('is-original');
      this.region = null;
      this.bodyEl = null;
    }

    showLoading() {
      this.phase = 'loading';
      this.clearStage();
      if (this.mode === 'overlay') {
        const status = document.createElement('div');
        status.className = 'status';
        status.innerHTML = '<div class="card"><span class="spinner"></span><span>翻译中…</span></div>';
        this.wrap.appendChild(status);
      } else {
        this.buildPopupChrome('loading');
        const body = document.createElement('div');
        body.className = 'body';
        body.innerHTML = '<span class="spinner"></span><span>翻译中…</span>';
        this.popup.appendChild(body);
        this.bodyEl = body;
      }
      this.syncPosition();
    }

    showError(message) {
      this.phase = 'error';
      this.lastError = message || '翻译失败，请稍后重试';
      this.clearStage();
      const text = this.lastError;
      if (this.mode === 'overlay') {
        const status = document.createElement('div');
        status.className = 'status';
        const card = document.createElement('div');
        card.className = 'card';
        card.textContent = text;
        status.appendChild(card);
        this.addToolbar(true);
        this.wrap.appendChild(status);
      } else {
        this.buildPopupChrome('error');
        this.addToolbar(true, true);
        const body = document.createElement('div');
        body.className = 'body';
        body.textContent = text;
        this.popup.appendChild(body);
        this.bodyEl = body;
      }
      this.syncPosition();
      clearTimeout(this.errorTimer);
      this.errorTimer = setTimeout(() => {
        if (!this.destroyed) this.destroy();
      }, 4000);
    }

    showSelectionResult(source, translated) {
      this.sourceText = source || this.sourceText || '';
      this.translatedText = translated || '';
      this.showingOriginal = false;
      this.phase = 'result';
      this.clearStage();
      if (this.mode === 'overlay') {
        this.region = document.createElement('div');
        this.region.className = 'region';
        const text = document.createElement('div');
        text.className = 'text';
        text.textContent = this.translatedText;
        this.region.appendChild(text);
        this.textEl = text;
        this.wrap.appendChild(this.region);
        this.addToolbar(false);
      } else {
        this.buildPopupChrome('result');
        this.addToolbar(false, true);
        const body = document.createElement('div');
        body.className = 'body';
        body.textContent = this.translatedText;
        this.popup.appendChild(body);
        this.bodyEl = body;
      }
      this.syncPosition();
    }

    buildPopupChrome(kind) {
      this.popup = document.createElement('div');
      this.popup.className = 'popup';
      if (kind === 'error') this.popup.classList.add('is-error');
      if (kind === 'loading') this.popup.classList.add('is-loading');
      this.wrap.appendChild(this.popup);
    }

    addToolbar(errorMode, inPopup) {
      const toolbar = document.createElement('div');
      toolbar.className = inPopup ? 'toolbar toolbar-in-popup' : 'toolbar';
      if (!errorMode) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.textContent = '显示原文';
        toggle.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.showingOriginal = !this.showingOriginal;
          if (this.mode === 'overlay' && this.phase === 'result') {
            this.wrap.classList.toggle('is-original', this.showingOriginal);
          } else if (this.bodyEl) {
            this.bodyEl.textContent = this.showingOriginal ? this.sourceText : this.translatedText;
          }
          toggle.textContent = this.showingOriginal ? '显示译文' : '显示原文';
        });
        toolbar.appendChild(toggle);
      }
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = '关闭';
      close.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.destroy();
      });
      toolbar.appendChild(close);
      if (inPopup && this.popup) this.popup.prepend(toolbar);
      else this.wrap.appendChild(toolbar);
      this.toolbar = toolbar;
    }

    layoutOverlay(rects) {
      const union = unionRect(rects);
      if (!union.width || !union.height) {
        this.switchToPopup(this.anchor || (this.snapshot && this.snapshot.mouse));
        return;
      }
      const pad = 2;
      let boxLeft = union.left - pad;
      let boxTop = union.top - pad;
      let boxW = Math.max(8, union.width + pad * 2);
      let boxH = Math.max(8, union.height + pad * 2);
      const vw = window.innerWidth || document.documentElement.clientWidth || boxW;
      const vh = window.innerHeight || document.documentElement.clientHeight || boxH;
      const canAbove = boxTop >= TOOLBAR_H + 4;
      const canBelow = boxTop + boxH + TOOLBAR_H + 4 <= vh;
      let hostLeft = boxLeft;
      let hostTop;
      let hostW = boxW;
      let hostH;
      let toolbarPos = 'above';
      if (canAbove) {
        hostTop = boxTop - TOOLBAR_H;
        hostH = boxH + TOOLBAR_H;
        toolbarPos = 'above';
      } else if (canBelow) {
        hostTop = boxTop;
        hostH = boxH + TOOLBAR_H;
        toolbarPos = 'below';
      } else {
        hostTop = boxTop;
        hostH = boxH;
        toolbarPos = 'inside';
      }

      // Keep the host on-screen horizontally if possible, but do not shrink the text box.
      if (hostLeft + hostW > vw - 4 && hostW < vw) {
        hostLeft = Math.max(4, vw - 4 - hostW);
      }
      if (hostLeft < 4 && boxLeft >= 0) hostLeft = Math.max(0, boxLeft);

      this.host.style.left = `${hostLeft}px`;
      this.host.style.top = `${hostTop}px`;
      this.host.style.width = `${hostW}px`;
      this.host.style.height = `${hostH}px`;
      this.host.style.overflow = 'visible';

      if (this.toolbar && this.mode === 'overlay') {
        this.toolbar.style.left = 'auto';
        this.toolbar.style.right = '0px';
        if (toolbarPos === 'above') {
          this.toolbar.style.top = '0px';
        } else if (toolbarPos === 'below') {
          this.toolbar.style.top = `${boxH + 4}px`;
        } else {
          this.toolbar.style.top = '0px';
        }
      }

      if (this.phase === 'loading' || this.phase === 'error') {
        const status = this.wrap.querySelector('.status');
        if (status) {
          const minW = 160;
          const minH = 44;
          if (hostW < minW || hostH < minH) {
            const extraW = Math.max(0, minW - hostW);
            const extraH = Math.max(0, minH - hostH);
            hostLeft = Math.max(4, hostLeft - extraW / 2);
            hostW += extraW;
            hostH += extraH;
            if (hostLeft + hostW > vw - 4) hostLeft = Math.max(4, vw - 4 - hostW);
            this.host.style.left = `${hostLeft}px`;
            this.host.style.width = `${hostW}px`;
            this.host.style.height = `${hostH}px`;
          }
        }
        return;
      }

      if (this.region && this.textEl && this.phase === 'result') {
        const relLeft = boxLeft - hostLeft;
        const relTop = boxTop - hostTop;
        this.region.style.left = `${relLeft}px`;
        this.region.style.top = `${relTop}px`;
        this.region.style.width = `${boxW}px`;
        this.region.style.height = `${boxH}px`;
        this.region.style.alignItems = boxH <= 40 ? 'center' : 'flex-start';
        fitText(this.textEl, boxW, boxH);
        const computed = parseFloat(this.textEl.style.fontSize) || 0;
        if (computed < 12 && this.translatedText) {
          const neededH = Math.min(Math.max(boxH, 48), Math.max(boxH, Math.min(vh * 0.5, 280)));
          if (neededH > boxH) {
            const grownH = neededH;
            if (toolbarPos === 'below') hostH = grownH + TOOLBAR_H;
            else if (toolbarPos === 'above') hostH = grownH + TOOLBAR_H;
            else hostH = grownH;
            const overflow = hostTop + hostH - (vh - 4);
            if (overflow > 0) hostTop = Math.max(4, hostTop - overflow);
            this.host.style.top = `${hostTop}px`;
            this.host.style.height = `${hostH}px`;
            this.region.style.top = `${boxTop - hostTop}px`;
            this.region.style.height = `${grownH}px`;
            if (this.toolbar && toolbarPos === 'below') {
              this.toolbar.style.top = `${grownH + 4}px`;
            }
            fitText(this.textEl, boxW, grownH);
          }
        }
      }
    }

    layoutPopup() {
      const margin = 8;
      const vw = window.innerWidth || document.documentElement.clientWidth || 320;
      const vh = window.innerHeight || document.documentElement.clientHeight || 240;
      const maxW = Math.min(420, Math.max(200, vw - margin * 2));
      this.host.style.width = `${maxW}px`;
      this.host.style.height = 'auto';
      this.host.style.overflow = 'visible';

      let x = (this.anchor && this.anchor.x) || 24;
      let y = (this.anchor && this.anchor.y) || 24;
      const placed = this.snapshot ? getPlacementRects(this.snapshot) : null;
      if (this.mode === 'popup' && placed && placed.rects.length) {
        const union = unionRect(placed.rects);
        x = union.left;
        y = union.bottom + 6;
      }

      this.host.style.left = `${Math.max(margin, x)}px`;
      this.host.style.top = `${Math.max(margin, y)}px`;

      const rect = this.host.getBoundingClientRect();
      let left = rect.left;
      let top = rect.top;
      const w = rect.width || maxW;
      const h = rect.height || 80;
      if (left + w + margin > vw) left = vw - w - margin;
      if (top + h + margin > vh) top = Math.max(margin, y - h - 12);
      if (top + h + margin > vh) top = vh - h - margin;
      if (left < margin) left = margin;
      if (top < margin) top = margin;
      this.host.style.left = `${left}px`;
      this.host.style.top = `${top}px`;
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      clearTimeout(this.errorTimer);
      try { this.resizeObserver.disconnect(); } catch (_err) { /* ignore */ }
      window.removeEventListener('resize', this.onSync, true);
      document.removeEventListener('scroll', this.onSync, true);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', this.onSync);
        window.visualViewport.removeEventListener('scroll', this.onSync);
      }
      this.host.remove();
      activeOverlays.delete(this);
      if (currentSelectionView === this) currentSelectionView = null;
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
