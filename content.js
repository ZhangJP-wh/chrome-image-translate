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
  let lastGoodSelectionSnapshot = null;
  let lastPointer = null;
  let currentSelectionView = null;

  function rememberPointer(event) {
    if (!event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    lastPointer = { x: event.clientX, y: event.clientY, time: Date.now() };
  }

  function lastPointerMouse(maxAge) {
    const age = Number.isFinite(maxAge) ? maxAge : 120000;
    if (!lastPointer || (Date.now() - lastPointer.time) > age) return null;
    return { x: lastPointer.x, y: lastPointer.y };
  }

  function rememberGoodSnapshot(snapshot) {
    if (snapshot && String(snapshot.text || '').trim()) {
      lastGoodSelectionSnapshot = snapshot;
    }
  }

  function onContextMenuCapture(event) {
    rememberPointer(event);
    try {
      const img = findImageInEvent(event);
      if (img) {
        lastContextImage = img;
        lastContextTime = Date.now();
      }
    } catch (_err) {}
    try {
      const snap = captureSelectionSnapshot(event);
      if (snap && String(snap.text || '').trim()) {
        lastSelectionSnapshot = snap;
        rememberGoodSnapshot(snap);
      } else if (lastGoodSelectionSnapshot) {
        lastSelectionSnapshot = Object.assign({}, lastGoodSelectionSnapshot, {
          mouse: { x: event.clientX, y: event.clientY },
          time: Date.now()
        });
      } else {
        lastSelectionSnapshot = snap;
      }
    } catch (_err) {
      if (lastGoodSelectionSnapshot) {
        lastSelectionSnapshot = Object.assign({}, lastGoodSelectionSnapshot, {
          mouse: { x: event.clientX, y: event.clientY },
          time: Date.now()
        });
      }
    }
  }

  window.addEventListener('pointerdown', rememberPointer, true);
  window.addEventListener('contextmenu', onContextMenuCapture, true);

  let selectionChangeTimer = 0;
  document.addEventListener('selectionchange', () => {
    clearTimeout(selectionChangeTimer);
    selectionChangeTimer = setTimeout(() => {
      try {
        rememberGoodSnapshot(captureSelectionSnapshot(null));
      } catch (_err) {}
    }, 80);
  });

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
      if (overlay) overlay.showResult(message.text || '', message.blocks || null);
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
        const layout = CITLayout.layoutOcrBoxes(message.boxes || [], message.imageWidth || 0);
        const blocks = layout.blocks || [];
        overlay.ocrLayout = layout.column ? {
          column: layout.column,
          textRects: layout.textRects || [],
          imageWidth: message.imageWidth || 0,
          imageHeight: message.imageHeight || 0
        } : null;
        overlay.showResult(joined, blocks.length ? blocks : null);
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
    let created = null;
    created = new FloatPanel(message.requestId, () => anchorFromImage(img, created && created.ocrLayout), {
      img,
      anchorEl: img
    });
    overlay = created;
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
      min-width: 0;
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
      overflow: auto;
      padding: 8px 14px 14px;
      color: inherit;
      user-select: text;
      cursor: text;
    }
    .para {
      margin: 0 0 0.9em;
    }
    .para:last-child {
      margin-bottom: 0;
    }
    .para.is-ocr {
      margin-bottom: 0;
    }
    .para.is-heading {
      font-weight: 600;
      line-height: 1.4;
    }
    .para.is-bullet {
      position: relative;
      padding-left: calc(var(--cit-indent, 0px) + 1.25em);
    }
    .para.is-bullet::before {
      content: "•";
      position: absolute;
      left: calc(var(--cit-indent, 0px) + 0.25em);
      top: 0;
      line-height: 1.55;
    }
    .line {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
      min-height: 1.55em;
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
    let liveRects = null;
    if (snapshot.range && isRangeLive(snapshot.range)) {
      try {
        const rects = serializeRects(snapshot.range.getClientRects());
        if (usableRects(rects)) liveRects = rects;
      } catch (_err) {
        // Range may become unusable after DOM updates.
      }
    }
    let frozen = null;
    if (snapshot.rects && snapshot.rects.length) {
      const adjusted = adjustRectsForScroll(snapshot.rects, snapshot.scrollX, snapshot.scrollY);
      if (usableRects(adjusted)) frozen = adjusted;
    }
    if (liveRects && frozen) {
      const liveUnion = unionRect(liveRects);
      const frozenUnion = unionRect(frozen);
      const liveArea = liveUnion.width * liveUnion.height;
      const frozenArea = frozenUnion.width * frozenUnion.height;
      const liveGrew = frozenArea > 0 && liveArea > frozenArea * 2.2;
      const jumpedTop = frozenUnion.top > 80 && liveUnion.top < 24 && liveUnion.height > frozenUnion.height * 1.6;
      if (liveGrew || jumpedTop) return { rects: frozen, live: false };
      return { rects: liveRects, live: true };
    }
    if (liveRects) return { rects: liveRects, live: true };
    if (frozen) return { rects: frozen, live: false };
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


  const EXPLICIT_BLOCK_TAGS = new Set([
    'P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'BLOCKQUOTE', 'PRE', 'TD', 'TH', 'TR', 'DT', 'DD',
    'ARTICLE', 'SECTION', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE',
    'ADDRESS', 'FIGCAPTION', 'CENTER'
  ]);
  const PARA_BREAK_TAGS = new Set([
    'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'BLOCKQUOTE', 'TR', 'PRE', 'DT', 'DD', 'ADDRESS', 'FIGCAPTION'
  ]);

  function isSkippableElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    return tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT';
  }

  function isBlockLike(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === 'BR' || isSkippableElement(el)) return false;
    if (EXPLICIT_BLOCK_TAGS.has(tag)) return true;
    try {
      const display = getComputedStyle(el).display;
      return display === 'block' || display === 'list-item' || display === 'table'
        || display === 'table-row' || display === 'table-cell' || display === 'flex'
        || display === 'grid' || display === 'table-caption';
    } catch (_err) {
      return false;
    }
  }

  function isVisuallyHidden(node) {
    let el = node && (node.nodeType === 1 ? node : node.parentElement);
    while (el && el !== document.documentElement && el !== document.body) {
      if (el.hidden || el.nodeName === 'NOSCRIPT') return true;
      try {
        if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return true;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
          return true;
        }
        const rect = el.getBoundingClientRect();
        if ((style.overflow === 'hidden' || style.clip !== 'auto') && rect.width <= 1 && rect.height <= 1) {
          return true;
        }
        if ((style.position === 'absolute' || style.position === 'fixed')
            && (rect.bottom < -8 || rect.right < -8 || rect.left > (window.innerWidth || 0) + 8 || rect.top > (window.innerHeight || 0) + 8)
            && (parseInt(style.left, 10) < -80 || parseInt(style.top, 10) < -80 || parseInt(style.textIndent, 10) < -80)) {
          return true;
        }
      } catch (_err) {}
      el = el.parentElement;
    }
    return false;
  }

  function fontSizeOf(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!el) return 16;
    try {
      const size = parseFloat(getComputedStyle(el).fontSize);
      return Number.isFinite(size) && size > 0 ? size : 16;
    } catch (_err) {
      return 16;
    }
  }

  function pushGlyph(list, text, rect) {
    if (!text || !rect) return;
    if (!(rect.width >= 0.5 && rect.height >= 0.5)) return;
    list.push({
      text: String(text),
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.right,
      bottom: rect.bottom
    });
  }

  function collectGlyphsFromTextNode(node, start, end, list) {
    const value = node.nodeValue || '';
    const from = Math.max(0, start);
    const to = Math.min(value.length, end);
    if (to <= from) return;
    const range = document.createRange();
    // Fast path: the whole slice sits on one line.
    try {
      range.setStart(node, from);
      range.setEnd(node, to);
      const rects = serializeRects(range.getClientRects());
      const tooTall = rects.length === 1 && rects[0].height > fontSizeOf(node) * 1.7;
      if (rects.length <= 1 && !tooTall) {
        if (rects[0]) pushGlyph(list, value.slice(from, to), rects[0]);
        return;
      }
    } catch (_err) {
      return;
    }
    let cursor = from;
    while (cursor < to) {
      const cp = value.codePointAt(cursor);
      const len = cp > 0xffff ? 2 : 1;
      try {
        range.setStart(node, cursor);
        range.setEnd(node, cursor + len);
        const rects = serializeRects(range.getClientRects());
        if (rects[0]) pushGlyph(list, value.slice(cursor, cursor + len), rects[0]);
      } catch (_err) {}
      cursor += len;
    }
  }

  function collectGlyphsFromRange(range) {
    if (!range || range.collapsed) return [];
    const glyphs = [];
    const root = range.commonAncestorContainer;
    const walkerRoot = root.nodeType === 1 ? root : (root.parentNode || document.body);
    const walker = document.createTreeWalker(
      walkerRoot,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (node.nodeType === 1) {
            if (isSkippableElement(node)) return NodeFilter.FILTER_REJECT;
            if (isVisuallyHidden(node)) return NodeFilter.FILTER_REJECT;
            const tag = node.tagName;
            if (tag === 'IMG' || tag === 'IMAGE' || tag === 'BR') {
              return rangeIntersects(range, node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            }
            return NodeFilter.FILTER_SKIP;
          }
          if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
          if (isVisuallyHidden(node)) return NodeFilter.FILTER_REJECT;
          return rangeIntersects(range, node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 3) {
        let start = 0;
        let end = (node.nodeValue || '').length;
        if (node === range.startContainer) start = range.startOffset;
        if (node === range.endContainer) end = range.endOffset;
        collectGlyphsFromTextNode(node, start, end, glyphs);
        continue;
      }
      if (node.tagName === 'IMG' || node.tagName === 'IMAGE') {
        const alt = (node.getAttribute && (node.getAttribute('alt') || '')) || '';
        if (!alt) continue;
        try {
          pushGlyph(glyphs, alt, node.getBoundingClientRect());
        } catch (_err) {}
      }
    }
    return glyphs;
  }

  function groupRectsIntoLineBoxes(rects) {
    const items = (rects || []).filter((r) => r && r.width >= 1 && r.height >= 1)
      .slice()
      .sort((a, b) => a.top - b.top || a.left - b.left);
    const lines = [];
    for (const r of items) {
      const mid = (r.top + r.bottom) / 2;
      let found = null;
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i];
        const overlap = Math.min(line.bottom, r.bottom) - Math.max(line.top, r.top);
        const lineH = Math.max(1, line.bottom - line.top);
        if ((mid >= line.top && mid <= line.bottom) || overlap > Math.min(r.height, lineH) * 0.4) {
          found = line;
          break;
        }
      }
      if (found) {
        found.top = Math.min(found.top, r.top);
        found.bottom = Math.max(found.bottom, r.bottom);
        found.left = Math.min(found.left, r.left);
        found.right = Math.max(found.right, r.right);
      } else {
        lines.push({
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right
        });
      }
    }
    lines.sort((a, b) => a.top - b.top || a.left - b.left);
    return lines;
  }

  function caretRangeAt(x, y) {
    try {
      if (typeof document.caretRangeFromPoint === 'function') {
        return document.caretRangeFromPoint(x, y);
      }
    } catch (_err) {}
    try {
      if (typeof document.caretPositionFromPoint === 'function') {
        const pos = document.caretPositionFromPoint(x, y);
        if (!pos || !pos.offsetNode) return null;
        const range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
        return range;
      }
    } catch (_err) {}
    return null;
  }

  function textFromLineBox(selRange, box) {
    const midY = box.top + Math.max(2, (box.bottom - box.top) * 0.5);
    const start = caretRangeAt(box.left + 1, midY);
    const end = caretRangeAt(Math.max(box.left + 1, box.right - 1), midY);
    if (!start || !end) return '';
    try {
      const lineRange = document.createRange();
      lineRange.setStart(start.startContainer, start.startOffset);
      lineRange.setEnd(end.startContainer, end.endOffset);
      if (selRange) {
        if (selRange.compareBoundaryPoints(Range.START_TO_START, lineRange) > 0) {
          lineRange.setStart(selRange.startContainer, selRange.startOffset);
        }
        if (selRange.compareBoundaryPoints(Range.END_TO_END, lineRange) < 0) {
          lineRange.setEnd(selRange.endContainer, selRange.endOffset);
        }
      }
      return String(lineRange.toString() || '').replace(/[ \t]+/g, ' ').replace(/\u00a0/g, ' ').trim();
    } catch (_err) {
      return '';
    }
  }

  function assignGlyphsToLineBoxes(boxes, glyphs) {
    return (boxes || []).map((box) => {
      const hits = [];
      for (const g of glyphs || []) {
        const mid = (g.top + g.bottom) / 2;
        if (mid >= box.top - 1 && mid <= box.bottom + 1) hits.push(g);
      }
      hits.sort((a, b) => a.left - b.left || a.top - b.top);
      const text = hits.map((g) => (g && g.text) || '').join('').replace(/[ \t]+/g, ' ').replace(/\u00a0/g, ' ').trim();
      return { box, text };
    });
  }

  function blocksFromLineItems(items) {
    const lines = (items || []).filter((item) => item && item.box);
    if (!lines.length) return [];
    const heights = lines
      .map((item) => Math.max(0, item.box.bottom - item.box.top))
      .filter((height) => height > 0)
      .sort((a, b) => a - b);
    const medH = heights.length ? heights[Math.floor(heights.length / 2)] : 16;
    const paraGap = Math.max(medH * 0.8, 8);
    const box = CITLayout.unionRect(lines.map((item) => item.box));
    const blocks = [];
    let current = [];
    let lastBottom = null;
    const flush = () => {
      const kept = [];
      const rects = [];
      for (const item of current) {
        const text = (item.text || '').trim();
        if (!text) continue;
        kept.push(text);
        rects.push(item.box);
      }
      current = [];
      if (!kept.length) return;
      blocks.push({
        align: CITLayout.inferAlignFromRects(rects, box) || 'left',
        lines: kept
      });
    };
    for (const item of lines) {
      if (lastBottom != null && (item.box.top - lastBottom) > paraGap) flush();
      current.push(item);
      lastBottom = item.box.bottom;
    }
    flush();
    return blocks;
  }

  function countBlockStructure(blocks) {
    if (!blocks || !blocks.length) return 0;
    return CITLayout.linesFromBlocks(blocks).length + Math.max(0, blocks.length - 1) * 2;
  }

  function extractBlocksFromLineBoxes(range, glyphs) {
    if (!range || range.collapsed) return [];
    const boxes = groupRectsIntoLineBoxes(serializeRects(range.getClientRects()));
    if (boxes.length < 2) return [];
    const assigned = assignGlyphsToLineBoxes(boxes, glyphs);
    for (const item of assigned) {
      if (!item.text) item.text = textFromLineBox(range, item.box);
    }
    return blocksFromLineItems(assigned);
  }

  function extractVisualBlocksFromRange(range) {
    const glyphs = collectGlyphsFromRange(range);
    let fromGlyphs = [];
    if (glyphs.length) {
      fromGlyphs = CITLayout.groupGlyphsIntoBlocks(glyphs, CITLayout.unionRect(glyphs));
    }
    let fromBoxes = [];
    try {
      fromBoxes = extractBlocksFromLineBoxes(range, glyphs);
    } catch (_err) {
      fromBoxes = [];
    }
    if (countBlockStructure(fromBoxes) > countBlockStructure(fromGlyphs)) return fromBoxes;
    return fromGlyphs;
  }

  function nearestBlock(node) {
    let el = node && (node.nodeType === 1 ? node : node.parentElement);
    while (el) {
      if (isBlockLike(el)) return el;
      el = el.parentElement;
    }
    return document.body || document.documentElement;
  }

  function isParagraphBoundary(el) {
    if (!el || el.nodeType !== 1) return false;
    if (PARA_BREAK_TAGS.has(el.tagName)) return true;
    try {
      const style = getComputedStyle(el);
      const mt = parseFloat(style.marginTop) || 0;
      const pt = parseFloat(style.paddingTop) || 0;
      if (mt + pt >= 8) return true;
    } catch (_err) {}
    return false;
  }

  function isBlockVisuallyEmpty(el) {
    if (!el) return false;
    const text = String(el.innerText || el.textContent || '').replace(/\u00a0/g, ' ').trim();
    return !text;
  }

  function readBlockAlign(el) {
    if (!el) return 'left';
    try {
      const style = getComputedStyle(el);
      const css = CITLayout.normalizeAlign(style.textAlign, style.direction);
      const attr = el.getAttribute && el.getAttribute('align');
      const fromAttr = attr ? CITLayout.normalizeAlign(attr, style.direction) : 'left';
      if (css !== 'left') return css;
      if (fromAttr !== 'left') return fromAttr;
      const box = el.getBoundingClientRect();
      const padL = parseFloat(style.paddingLeft) || 0;
      const padR = parseFloat(style.paddingRight) || 0;
      const content = {
        left: box.left + padL,
        right: box.right - padR,
        width: Math.max(0, box.width - padL - padR)
      };
      const probe = document.createRange();
      probe.selectNodeContents(el);
      const lineRects = serializeRects(probe.getClientRects());
      return CITLayout.inferAlignFromRects(lineRects, content) || 'left';
    } catch (_err) {
      return 'left';
    }
  }

  function sliceTextInRange(node, range) {
    let text = node.nodeValue || '';
    if (node === range.startContainer && node === range.endContainer) {
      text = text.slice(range.startOffset, range.endOffset);
    } else if (node === range.startContainer) {
      text = text.slice(range.startOffset);
    } else if (node === range.endContainer) {
      text = text.slice(0, range.endOffset);
    }
    return text.replace(/\u00a0/g, ' ');
  }

  function rangeIntersects(range, node) {
    try {
      return range.intersectsNode(node);
    } catch (_err) {
      return false;
    }
  }

  function extractBlocksFromRange(range) {
    if (!range || range.collapsed) return [];
    const root = range.commonAncestorContainer;
    const walkerRoot = root.nodeType === 1 ? root : (root.parentNode || document.body);
    const events = [];
    let currentText = '';
    let currentAlign = 'left';
    let currentBlock = null;
    let paraBefore = false;

    function flushLine() {
      const line = currentText.replace(/[ \t]+/g, ' ').trim();
      currentText = '';
      if (!line) return false;
      events.push({ type: 'line', text: line, align: currentAlign, paraBefore });
      paraBefore = false;
      return true;
    }

    function enterBlock(block, forcePara) {
      if (!block || block === currentBlock) return;
      flushLine();
      if (currentBlock && (forcePara || isParagraphBoundary(block) || isParagraphBoundary(currentBlock))) {
        paraBefore = true;
      }
      currentBlock = block;
      currentAlign = readBlockAlign(block);
    }

    const walker = document.createTreeWalker(
      walkerRoot,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (node.nodeType === 1) {
            if (isSkippableElement(node)) return NodeFilter.FILTER_REJECT;
            if (node.tagName === 'BR' || isBlockLike(node)) {
              return rangeIntersects(range, node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            }
            return NodeFilter.FILTER_SKIP;
          }
          if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
          return rangeIntersects(range, node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 3) {
        enterBlock(nearestBlock(node), false);
        currentText += sliceTextInRange(node, range);
        if (currentText.includes('\n')) {
          const parts = currentText.split('\n');
          currentText = '';
          for (let i = 0; i < parts.length; i += 1) {
            if (i === parts.length - 1) {
              currentText = parts[i];
            } else {
              currentText = parts[i];
              const had = flushLine();
              if (!had) paraBefore = true;
            }
          }
        }
        continue;
      }
      if (node.tagName === 'BR') {
        enterBlock(nearestBlock(node), false);
        const had = flushLine();
        if (!had || isBlockVisuallyEmpty(nearestBlock(node))) {
          paraBefore = true;
        }
        continue;
      }
      if (isBlockLike(node)) {
        enterBlock(node, isParagraphBoundary(node));
        if (isBlockVisuallyEmpty(node)) {
          flushLine();
          paraBefore = true;
        }
      }
    }
    flushLine();

    const blocks = [];
    let lines = [];
    let align = 'left';
    const pushPara = () => {
      while (lines.length && lines[0] === '') lines.shift();
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      if (lines.length) {
        blocks.push({ align, lines: lines.slice() });
        lines = [];
      }
    };
    for (const event of events) {
      if (event.paraBefore) pushPara();
      if (lines.length && event.align !== align) pushPara();
      align = event.align || 'left';
      lines.push(event.text);
    }
    pushPara();
    return blocks;
  }

  function readFormAlign(form) {
    try {
      const style = getComputedStyle(form);
      return CITLayout.normalizeAlign(style.textAlign, style.direction);
    } catch (_err) {
      return 'left';
    }
  }

  function captureSelectionSnapshot(event) {
    const mouse = event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
      ? { x: event.clientX, y: event.clientY }
      : lastPointerMouse();
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const time = Date.now();
    const form = event ? findFormControlInPath(event) : (isFormControl(document.activeElement) ? document.activeElement : null);

    if (form) {
      let text = '';
      try {
        if (typeof form.selectionStart === 'number' && typeof form.selectionEnd === 'number') {
          text = String(form.value || '').slice(form.selectionStart, form.selectionEnd);
        }
      } catch (_err) {
        // Some input types throw when reading selectionStart.
      }
      const align = readFormAlign(form);
      return {
        text,
        inFormControl: true,
        formEl: form,
        mouse,
        scrollX,
        scrollY,
        rects: [],
        range: null,
        blocks: CITLayout.blocksFromPlainText(text, align),
        time
      };
    }

    const candidates = collectSelectionCandidates(event);
    const best = candidates.find((item) => item.text && item.text.trim()) || candidates[0] || {
      text: '',
      range: null,
      rects: []
    };

    let blocks = [];
    if (best.range) {
      try {
        blocks = extractVisualBlocksFromRange(best.range);
      } catch (_err) {
        blocks = [];
      }
      if (!blocks.length) {
        try {
          blocks = extractBlocksFromRange(best.range);
        } catch (_err) {
          blocks = [];
        }
      }
    }
    if (!blocks.length && (best.text || '').trim()) {
      blocks = CITLayout.blocksFromPlainText(best.text, 'left');
    }

    return {
      text: blocks.length ? CITLayout.blocksToSourceText(blocks) : (best.text || ''),
      inFormControl: false,
      mouse,
      scrollX,
      scrollY,
      rects: best.rects || [],
      range: best.range || null,
      blocks,
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
    const mouse = (snapshot && snapshot.mouse && Number.isFinite(snapshot.mouse.x))
      ? snapshot.mouse
      : lastPointerMouse();
    const placed = snapshot ? getPlacementRects(snapshot) : null;
    const rawRects = (placed && placed.rects && placed.rects.length)
      ? placed.rects
      : ((snapshot && snapshot.rects) || []);
    const clustered = CITLayout.clusterRects(rawRects, mouse, 96, 80);
    let sourceRect = clustered.length ? (CITLayout.unionRect(clustered) || unionRect(clustered)) : null;
    if (sourceRect && mouse && sourceRect.height > 220) {
      const near = clustered.filter((r) => {
        const top = r.top;
        const bottom = r.bottom != null ? r.bottom : r.top + r.height;
        return top <= mouse.y + 120 && bottom >= mouse.y - 120;
      });
      const local = near.length ? (CITLayout.unionRect(near) || unionRect(near)) : null;
      if (local && local.height >= 8) sourceRect = local;
    }
    return { mouse, sourceRect, prefer: 'below' };
  }

  function anchorFromImage(img, layout) {
    if (!isElementCurrent(img)) {
      return { prefer: 'right' };
    }
    const r = img.getBoundingClientRect();
    const anchor = { sourceRect: r, prefer: 'right' };
    if (!layout || !layout.column || !(layout.imageWidth > 0)) return anchor;
    try {
      const m = getImageMapping(img);
      if (!(m.cssWidth > 1 && m.cssHeight > 1)) return anchor;
      const ratioX = (m.nw || layout.imageWidth) / layout.imageWidth;
      const ratioY = layout.imageHeight > 0 ? (m.nh || layout.imageHeight) / layout.imageHeight : ratioX;
      const imageRect = {
        left: m.cssLeft,
        top: m.cssTop,
        width: m.cssWidth,
        height: m.cssHeight,
        right: m.cssLeft + m.cssWidth,
        bottom: m.cssTop + m.cssHeight
      };
      const toScreen = (b) => {
        const left = m.cssLeft + (b.x0 * ratioX - m.originX) * m.scaleX;
        const top = m.cssTop + (b.y0 * ratioY - m.originY) * m.scaleY;
        const right = m.cssLeft + (b.x1 * ratioX - m.originX) * m.scaleX;
        const bottom = m.cssTop + (b.y1 * ratioY - m.originY) * m.scaleY;
        return CITLayout.intersectRect({
          left,
          top,
          width: Math.max(0, right - left),
          height: Math.max(0, bottom - top)
        }, imageRect);
      };
      const columnRect = toScreen(layout.column);
      if (!columnRect) return anchor;
      anchor.imageRect = imageRect;
      anchor.columnRect = columnRect;
      anchor.textRects = (layout.textRects || []).map(toScreen).filter(Boolean);
      // Panel = text column width plus the panel's own padding/border.
      anchor.preferWidth = Math.round(columnRect.width + 30);
    } catch (_err) {}
    return anchor;
  }

  function selectionAnchorElement(snapshot) {
    if (!snapshot) return null;
    if (snapshot.formEl && snapshot.formEl.isConnected) return snapshot.formEl;
    let node = null;
    try {
      node = snapshot.range && snapshot.range.startContainer;
    } catch (_err) {
      node = null;
    }
    let el = node && (node.nodeType === 1 ? node : node.parentElement);
    for (let i = 0; el && i < 6; i += 1) {
      try {
        if (el.isConnected) {
          const r = el.getBoundingClientRect();
          if (r.width >= 1 && r.height >= 1) return el;
        }
      } catch (_err) {}
      el = el.parentElement;
    }
    return null;
  }

  function handlePrepareSelection(message) {
    let snapshot = isSnapshotFresh(lastSelectionSnapshot) ? lastSelectionSnapshot : null;
    if (!(snapshot && String(snapshot.text || '').trim()) && isSnapshotFresh(lastGoodSelectionSnapshot)) {
      snapshot = Object.assign({}, lastGoodSelectionSnapshot, {
        mouse: (snapshot && snapshot.mouse) || lastPointerMouse() || lastGoodSelectionSnapshot.mouse,
        time: Date.now()
      });
    }
    try {
      const live = captureSelectionSnapshot(null);
      if (live && String(live.text || '').trim()) {
        const liveBetter = countBlockStructure(live.blocks) > countBlockStructure(snapshot && snapshot.blocks);
        if (!snapshot || !String(snapshot.text || '').trim() || liveBetter) {
          snapshot = Object.assign({}, live, {
            mouse: (snapshot && snapshot.mouse) || lastPointerMouse() || live.mouse
          });
        } else if (snapshot && !(snapshot.rects && snapshot.rects.length) && live.rects && live.rects.length) {
          snapshot = Object.assign({}, snapshot, {
            rects: live.rects,
            range: live.range || snapshot.range,
            scrollX: live.scrollX,
            scrollY: live.scrollY
          });
        }
      }
    } catch (_err) {}
    const text = pickSelectionText(snapshot, message.fallbackText);
    if (!text.trim()) {
      return { ok: false, error: '没有可翻译的文字' };
    }
    if (currentSelectionView) currentSelectionView.destroy();
    const view = new FloatPanel(message.requestId, () => chooseAnchor(snapshot), {
      anchorEl: selectionAnchorElement(snapshot)
    });
    currentSelectionView = view;
    activeOverlays.add(view);
    view.showLoading();
    const blocks = (snapshot && snapshot.blocks && snapshot.blocks.length)
      ? snapshot.blocks
      : CITLayout.blocksFromPlainText(text, 'left');
    return { ok: true, text: CITLayout.blocksToSourceText(blocks) || text, blocks };
  }

  function currentRouteKey() {
    try {
      const u = new URL(location.href);
      const h = u.hash || '';
      const hashRoute = (h.startsWith('#/') || h.startsWith('#!')) ? h : '';
      return u.origin + u.pathname + u.search + hashRoute;
    } catch (_err) {
      return String(location.href || '');
    }
  }

  function destroyAllPanels() {
    for (const overlay of [...activeOverlays]) {
      try {
        overlay.destroy();
      } catch (_err) {}
    }
    try {
      document.querySelectorAll('[data-cit-float]').forEach((node) => node.remove());
    } catch (_err) {}
  }

  // Close the floating window on refresh / close / back-forward cache, SPA
  // navigation, and Escape.
  window.addEventListener('pagehide', destroyAllPanels, true);
  window.addEventListener('beforeunload', destroyAllPanels, true);
  window.addEventListener('pageshow', (event) => {
    if (event && event.persisted) destroyAllPanels();
  }, true);
  const onRouteMaybeChanged = () => {
    for (const overlay of [...activeOverlays]) overlay.checkAlive();
  };
  window.addEventListener('popstate', onRouteMaybeChanged, true);
  window.addEventListener('hashchange', onRouteMaybeChanged, true);
  window.addEventListener('keydown', (event) => {
    if (!event || event.key !== 'Escape' || event.isComposing) return;
    if (activeOverlays.size) destroyAllPanels();
  }, true);

  class FloatPanel {
    constructor(requestId, getAnchor, options) {
      this.requestId = requestId;
      this.getAnchor = typeof getAnchor === 'function' ? getAnchor : () => ({ x: 24, y: 24 });
      this.img = options && options.img ? options.img : null;
      this.anchorEl = options && options.anchorEl ? options.anchorEl : this.img;
      this.destroyed = false;
      this.errorTimer = 0;
      this.userMoved = false;
      this.dragging = false;
      this.phase = 'loading';
      this.ocrLayout = null;
      // Panel position relative to the anchor's reference point, so the panel
      // moves with page content (window scroll and nested scroll containers).
      this.offset = null;
      this.lastRef = null;
      this.pos = null;
      this.missingTicks = 0;
      this.routeKey = currentRouteKey();

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

      this.onResize = () => this.handleResize();
      this.onScroll = () => this.follow();
      window.addEventListener('resize', this.onResize, true);
      document.addEventListener('scroll', this.onScroll, true);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', this.onResize);
        window.visualViewport.addEventListener('scroll', this.onScroll);
      }
      this.tick = () => {
        if (this.destroyed) return;
        this.follow();
        this.rafId = requestAnimationFrame(this.tick);
      };
      this.rafId = requestAnimationFrame(this.tick);
      this.aliveTimer = setInterval(() => this.checkAlive(), 400);
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
      this.place();
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
      this.place();
      clearTimeout(this.errorTimer);
      this.errorTimer = setTimeout(() => {
        if (!this.destroyed) this.destroy();
      }, 4000);
    }

    showResult(text, blocks) {
      this.phase = 'result';
      clearTimeout(this.errorTimer);
      this.clearStage();
      this.buildPopup('result');
      this.addToolbar();
      const body = document.createElement('div');
      body.className = 'body';
      const paras = (blocks && blocks.length)
        ? blocks
        : CITLayout.blocksFromPlainText(text || '', 'left');
      if (!paras.length) {
        const para = document.createElement('div');
        para.className = 'para';
        const line = document.createElement('div');
        line.className = 'line';
        line.textContent = text || '';
        para.appendChild(line);
        body.appendChild(para);
      } else {
        for (const block of paras) {
          const para = document.createElement('div');
          para.className = 'para';
          para.style.textAlign = block.align || 'left';
          if (block.kind) {
            // Image OCR layout: headings, bullets, indents, original gaps.
            para.classList.add('is-ocr', `is-${block.kind}`);
            if (block.region === 'aside') para.classList.add('is-aside');
            if (block.kind === 'heading' && Number(block.scale) > 1) {
              para.style.fontSize = `${Math.min(1.6, Number(block.scale))}em`;
            }
            const gap = Number(block.gapBefore);
            para.style.marginTop = Number.isFinite(gap)
              ? `${Math.min(1.6, Math.max(0.3, gap * 0.55)).toFixed(2)}em`
              : '0';
            const indent = Number(block.indent);
            if (indent > 0) {
              const pct = `${(Math.min(0.4, indent) * 100).toFixed(1)}%`;
              if (block.kind === 'bullet') para.style.setProperty('--cit-indent', pct);
              else para.style.paddingLeft = pct;
            }
          }
          const lines = block.lines && block.lines.length ? block.lines : [''];
          for (const item of lines) {
            const line = document.createElement('div');
            line.className = 'line';
            line.textContent = item;
            para.appendChild(line);
          }
          body.appendChild(para);
        }
      }
      this.popup.appendChild(body);
      this.bodyEl = body;
      this.place();
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
        this.dragging = true;
        const onMove = (ev) => {
          if (this.destroyed) return;
          this.placeAt(ev.clientX - dx, ev.clientY - dy);
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove, true);
          window.removeEventListener('pointerup', onUp, true);
          window.removeEventListener('pointercancel', onUp, true);
          this.dragging = false;
          if (this.destroyed) return;
          const r = this.host.getBoundingClientRect();
          this.placeAt(r.left, r.top);
          this.rememberOffset();
        };
        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onUp, true);
        window.addEventListener('pointercancel', onUp, true);
      });
    }

    applySize() {
      const margin = 8;
      const vw = window.innerWidth || document.documentElement.clientWidth || 320;
      const vh = window.innerHeight || document.documentElement.clientHeight || 240;
      const minW = this.phase === 'result' ? 140 : 168;
      const capW = Math.max(minW, vw - margin * 2);

      this.host.style.height = 'auto';
      this.host.style.overflow = 'visible';
      this.host.style.width = 'auto';
      this.host.style.maxWidth = 'none';
      if (this.popup) this.popup.style.width = 'max-content';
      if (this.bodyEl) {
        this.bodyEl.style.maxHeight = 'none';
        this.bodyEl.style.overflow = 'visible';
      }

      let natural = Math.ceil((this.popup || this.host).getBoundingClientRect().width);
      if (!Number.isFinite(natural) || natural < minW) natural = minW;

      const anchor = this.getAnchor() || {};
      const source = anchor.sourceRect;
      const lineCount = this.bodyEl ? this.bodyEl.querySelectorAll('.line').length : 0;
      const sourceW = (source && source.width >= 80) ? Math.round(source.width) : 0;
      const maxReasonable = Math.min(capW, Math.max(sourceW, Math.round(Math.min(vw * 0.5, 560)), 420));
      let width = Math.min(maxReasonable, Math.max(minW, natural));
      if (this.phase === 'result' && anchor.preferWidth > 0) {
        // Image OCR: as wide as the original text column on screen.
        width = Math.min(capW, Math.max(Math.min(260, capW), Math.round(anchor.preferWidth)));
      } else if (this.phase === 'result' && sourceW) {
        const longContent = lineCount >= 2 || natural >= sourceW * 0.45;
        if (longContent) {
          width = Math.min(capW, Math.max(width, sourceW));
        }
      }
      if (this.phase !== 'result') {
        width = Math.min(width, 240);
      }

      this.host.style.width = `${width}px`;
      if (this.popup) this.popup.style.width = '100%';

      const toolbarH = this.toolbar ? this.toolbar.getBoundingClientRect().height : 0;
      const maxBody = Math.max(72, Math.floor(vh * 0.86) - Math.ceil(toolbarH) - 8);
      if (this.bodyEl && this.phase === 'result') {
        this.bodyEl.style.maxHeight = `${maxBody}px`;
        this.bodyEl.style.overflow = 'auto';
      }
      return width;
    }

    setHostPos(left, top) {
      this.pos = { x: left, y: top };
      this.host.style.left = `${Math.round(left * 10) / 10}px`;
      this.host.style.top = `${Math.round(top * 10) / 10}px`;
    }

    // Clamp into the viewport: used only for initial placement and dragging.
    placeAt(left, top) {
      const margin = 8;
      const vw = window.innerWidth || document.documentElement.clientWidth || 320;
      const vh = window.innerHeight || document.documentElement.clientHeight || 240;
      const w = this.host.offsetWidth || 0;
      const h = this.host.offsetHeight || 0;
      left = Math.min(Math.max(margin, left), Math.max(margin, vw - w - margin));
      top = Math.min(Math.max(margin, top), Math.max(margin, vh - h - margin));
      this.setHostPos(left, top);
    }

    refPoint() {
      const el = this.anchorEl;
      if (el) {
        try {
          if (el.isConnected) {
            const r = el.getBoundingClientRect();
            if (r.width >= 1 || r.height >= 1) {
              this.lastRef = { x: r.left, y: r.top };
              return this.lastRef;
            }
          }
        } catch (_err) {}
        // Hidden/removed anchor: hold still until checkAlive closes us.
        if (this.lastRef) return this.lastRef;
      }
      // No element anchor: follow the document (window scroll).
      return {
        x: -(window.scrollX || window.pageXOffset || 0),
        y: -(window.scrollY || window.pageYOffset || 0)
      };
    }

    rememberOffset() {
      if (!this.pos) return;
      const ref = this.refPoint();
      this.offset = { x: this.pos.x - ref.x, y: this.pos.y - ref.y };
    }

    follow() {
      if (this.destroyed || this.dragging || !this.offset) return;
      const ref = this.refPoint();
      const x = ref.x + this.offset.x;
      const y = ref.y + this.offset.y;
      if (!this.pos || Math.abs(this.pos.x - x) > 0.25 || Math.abs(this.pos.y - y) > 0.25) {
        this.setHostPos(x, y);
      }
    }

    handleResize() {
      if (this.destroyed) return;
      if (this.userMoved) {
        this.follow();
        return;
      }
      this.place();
    }

    checkAlive() {
      if (this.destroyed) return;
      if (currentRouteKey() !== this.routeKey) {
        this.destroy();
        return;
      }
      const el = this.anchorEl;
      if (!el) return;
      let gone = false;
      try {
        if (!el.isConnected) {
          gone = true;
        } else if (this.img) {
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) {
            gone = true;
          } else {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') gone = true;
          }
        }
      } catch (_err) {
        gone = true;
      }
      if (gone) {
        this.missingTicks += 1;
        if (this.missingTicks >= 2) this.destroy();
      } else {
        this.missingTicks = 0;
      }
    }

    place() {
      if (this.destroyed) return;
      if (this.img && !isElementCurrent(this.img)) {
        this.destroy();
        return;
      }
      const preferW = this.applySize();
      if (this.userMoved && this.offset) {
        this.follow();
        return;
      }
      const margin = 8;
      const vw = window.innerWidth || document.documentElement.clientWidth || 320;
      const vh = window.innerHeight || document.documentElement.clientHeight || 240;
      const anchor = this.getAnchor() || {};
      let x;
      let y;
      if (this.phase === 'result' && anchor.imageRect && anchor.columnRect) {
        const res = CITLayout.pickImagePanelPlacement({
          vw,
          vh,
          margin,
          imageRect: anchor.imageRect,
          columnRect: anchor.columnRect,
          textRects: anchor.textRects,
          preferW,
          minW: Math.min(260, preferW),
          measure: (w) => {
            this.host.style.width = `${w}px`;
            return this.host.getBoundingClientRect().height || this.host.offsetHeight || 80;
          }
        });
        this.host.style.width = `${res.width}px`;
        x = res.x;
        y = res.y;
      } else {
        const rect = this.host.getBoundingClientRect();
        const w = rect.width || this.host.offsetWidth || 240;
        const h = rect.height || this.host.offsetHeight || 80;
        const pos = CITLayout.pickPanelPosition({
          sourceRect: anchor.sourceRect,
          mouse: anchor.mouse,
          panelW: w,
          panelH: h,
          vw,
          vh,
          margin,
          prefer: anchor.prefer
        });
        x = pos.x;
        y = pos.y;
      }
      this.setHostPos(x, y);
      this.rememberOffset();
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      clearTimeout(this.errorTimer);
      clearInterval(this.aliveTimer);
      if (this.rafId) cancelAnimationFrame(this.rafId);
      window.removeEventListener('resize', this.onResize, true);
      document.removeEventListener('scroll', this.onScroll, true);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', this.onResize);
        window.visualViewport.removeEventListener('scroll', this.onScroll);
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
