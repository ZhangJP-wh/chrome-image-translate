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

  document.addEventListener('contextmenu', (event) => {
    const img = findImageInEvent(event);
    if (img) {
      lastContextImage = img;
      lastContextTime = Date.now();
    }
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
    if (message.type === 'CIT_FETCH_FROM_PAGE') {
      fetchBytesFromPage(message.url).then((data) => {
        sendResponse({ ok: true, buffer: data.buffer, mime: data.mime });
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
    const mime = (res.headers.get('content-type') || '').split(';')[0].trim() || guessMimeFromUrl(url);
    return { buffer, mime };
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
      return { buffer: await blob.arrayBuffer(), mime: 'image/png' };
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
