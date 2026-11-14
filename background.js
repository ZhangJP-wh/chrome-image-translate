/* 图片翻译 - service worker */
'use strict';

importScripts('buffer-codec.js');

const MENU_ROOT_ID = 'cit-translate-root';
const MENU_GOOGLE_ID = 'cit-translate-google';
const MENU_BING_ID = 'cit-translate-bing';
const TARGET_LANG = 'zh-CN';
const TRANSLATE_URL = 'https://translate-pa.googleapis.com/v1/translateHtml';
// Public te_lib client key embedded in Google's official translate library (not a user secret).
const TRANSLATE_API_KEY = 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520';
const OCR_TIMEOUT_MS = 90000;
const TRANSLATE_CHUNK = 80;
const BING_MAX_CHARS = 1000;
const BING_SESSION_URLS = [
  'https://www.bing.com/translator',
  'https://cn.bing.com/translator'
];

const DEFAULT_ENGINES = { google: true, bing: true };
const MENU_CONTEXTS = ['image', 'selection'];

async function getEngineSettings() {
  try {
    const data = await chrome.storage.local.get('engines');
    const saved = data && data.engines;
    const google = saved && typeof saved.google === 'boolean' ? saved.google : true;
    const bing = saved && typeof saved.bing === 'boolean' ? saved.bing : true;
    if (!google && !bing) return { ...DEFAULT_ENGINES };
    return { google, bing };
  } catch (_err) {
    return { ...DEFAULT_ENGINES };
  }
}

async function setupMenus() {
  const engines = await getEngineSettings();
  await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
  if (engines.google && engines.bing) {
    chrome.contextMenus.create({
      id: MENU_ROOT_ID,
      title: '翻译',
      contexts: MENU_CONTEXTS
    });
    chrome.contextMenus.create({
      id: MENU_GOOGLE_ID,
      parentId: MENU_ROOT_ID,
      title: '谷歌翻译',
      contexts: MENU_CONTEXTS
    });
    chrome.contextMenus.create({
      id: MENU_BING_ID,
      parentId: MENU_ROOT_ID,
      title: '必应翻译',
      contexts: MENU_CONTEXTS
    });
    return;
  }
  if (engines.google) {
    chrome.contextMenus.create({
      id: MENU_GOOGLE_ID,
      title: '谷歌翻译',
      contexts: MENU_CONTEXTS
    });
    return;
  }
  chrome.contextMenus.create({
    id: MENU_BING_ID,
    title: '必应翻译',
    contexts: MENU_CONTEXTS
  });
}

chrome.runtime.onInstalled.addListener(() => {
  setupMenus();
});
chrome.runtime.onStartup.addListener(() => {
  setupMenus();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.engines) setupMenus();
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function friendlyError(err, fallback) {
  const msg = (err && err.message) ? String(err.message) : '';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) {
    return '网络错误，请检查网络后重试';
  }
  return msg || fallback || '翻译失败，请稍后重试';
}

function sniffMime(buffer) {
  return citSniffMime(buffer);
}

let offscreenPromise = null;

async function hasOffscreenDocument() {
  if (chrome.offscreen.hasDocument) {
    return chrome.offscreen.hasDocument();
  }
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  return contexts.length > 0;
}

async function pingOffscreen() {
  const res = await chrome.runtime.sendMessage({ type: 'CIT_PING' });
  return !!(res && res.ok);
}

async function ensureOffscreen() {
  if (!offscreenPromise) {
    offscreenPromise = (async () => {
      if (!(await hasOffscreenDocument())) {
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['WORKERS'],
          justification: '在后台使用 OCR 识别图片中的文字，避免卡住网页'
        });
      }
      let lastErr = null;
      for (let i = 0; i < 25; i += 1) {
        try {
          if (await pingOffscreen()) return;
        } catch (err) {
          lastErr = err;
        }
        await sleep(50);
      }
      throw lastErr || new Error('OCR 组件启动失败');
    })().catch((err) => {
      offscreenPromise = null;
      throw err;
    });
  }
  return offscreenPromise;
}

async function fetchImage(url) {
  let res;
  try {
    res = await fetch(url, { credentials: 'include', cache: 'force-cache' });
  } catch (err) {
    throw new Error(friendlyError(err, '图片下载失败'));
  }
  if (!res.ok) {
    throw new Error(`图片下载失败（${res.status}）`);
  }
  const buffer = await res.arrayBuffer();
  if (!buffer.byteLength) {
    throw new Error('图片下载失败（空文件）');
  }
  let mime = (res.headers.get('content-type') || '').split(';')[0].trim();
  const sniffed = sniffMime(buffer);
  if (sniffed === 'text/html') {
    throw new Error('图片下载失败（返回了网页而不是图片）');
  }
  if (sniffed.startsWith('image/')) {
    mime = sniffed;
  } else if (!mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream') {
    mime = sniffed;
  }
  return { buffer, mime };
}

async function ocrImage(buffer, mime) {
  await ensureOffscreen();
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('识别超时，请稍后重试')), OCR_TIMEOUT_MS);
  });
  const response = await Promise.race([
    chrome.runtime.sendMessage({ type: 'CIT_OCR', mime, bufferB64: citEncodeBuffer(buffer) }),
    timeout
  ]);
  if (!response || !response.ok) {
    throw new Error((response && response.error) || '文字识别失败');
  }
  return response.result;
}

async function requestTranslateChunk(chunk) {
  let res;
  try {
    res = await fetch(TRANSLATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json+protobuf',
        'X-Goog-API-Key': TRANSLATE_API_KEY
      },
      body: JSON.stringify([[chunk, 'auto', TARGET_LANG], 'te_lib'])
    });
  } catch (err) {
    throw new Error(friendlyError(err, '谷歌翻译失败，请稍后重试'));
  }
  if (!res.ok) {
    const error = new Error(`谷歌翻译暂时不可用（${res.status}）`);
    error.status = res.status;
    throw error;
  }
  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error('翻译结果格式异常');
  }
  const translated = Array.isArray(data) ? data[0] : null;
  if (!Array.isArray(translated) || translated.length !== chunk.length) {
    throw new Error('翻译结果格式异常');
  }
  return translated.map((item) => (item == null ? '' : String(item)));
}

async function translateChunk(chunk) {
  try {
    return await requestTranslateChunk(chunk);
  } catch (err) {
    if (err.status !== 400 || chunk.length === 1) throw err;
    const out = [];
    for (const line of chunk) {
      try {
        const [translated] = await requestTranslateChunk([line]);
        out.push(translated);
      } catch (inner) {
        if (inner.status !== 400) throw inner;
        out.push(line);
      }
    }
    return out;
  }
}

async function translateLinesGoogle(lines) {
  const source = (lines || []).map((line) => (line == null ? '' : String(line)));
  if (!source.length) return [];
  const out = source.map(() => '');
  const work = [];
  source.forEach((line, index) => {
    // The translateHtml API returns HTTP 400 for empty strings.
    if (line !== '') work.push({ index, text: line });
  });
  if (!work.length) return out;
  for (let i = 0; i < work.length; i += TRANSLATE_CHUNK) {
    const chunkItems = work.slice(i, i + TRANSLATE_CHUNK);
    const translated = await translateChunk(chunkItems.map((item) => item.text));
    chunkItems.forEach((item, j) => {
      out[item.index] = translated[j] == null ? '' : String(translated[j]);
    });
  }
  return out;
}

let bingSession = null;
let bingSessionPromise = null;

function parseBingSession(html, pageUrl) {
  const ig = html.match(/IG:"([0-9A-Fa-f]+)"/);
  const helper = html.match(/params_AbusePreventionHelper\s*=\s*(\[[^\]]+\])/);
  if (!ig || !helper) return null;
  const params = JSON.parse(helper[1]);
  const iid = html.match(/data-iid="([^"]+)"/);
  const ttl = Number(params[2]) || 3600000;
  return {
    origin: new URL(pageUrl).origin,
    ig: ig[1],
    iid: (iid && iid[1]) || 'translator.5023',
    token: String(params[1] || ''),
    key: String(params[0] || ''),
    expireAt: Date.now() + Math.max(60 * 1000, ttl - 60 * 1000)
  };
}

async function getBingSession(force) {
  if (!force && bingSession && Date.now() < bingSession.expireAt) {
    return bingSession;
  }
  if (bingSessionPromise && !force) {
    return bingSessionPromise;
  }
  const run = (async () => {
    let lastError = new Error('必应翻译暂时不可用');
    for (const url of BING_SESSION_URLS) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          credentials: 'omit',
          redirect: 'follow',
          signal: AbortSignal.timeout(10000)
        });
        if (!res.ok) {
          lastError = new Error(`必应翻译页面无法打开（${res.status}）`);
          continue;
        }
        const html = await res.text();
        const session = parseBingSession(html, res.url || url);
        if (!session || !session.token || !session.key) {
          lastError = new Error('必应翻译参数解析失败');
          continue;
        }
        bingSession = session;
        return session;
      } catch (err) {
        lastError = new Error(friendlyError(err, '必应翻译暂时不可用'));
      }
    }
    throw lastError;
  })();
  bingSessionPromise = run;
  try {
    return await run;
  } finally {
    if (bingSessionPromise === run) bingSessionPromise = null;
  }
}

function extractBingTranslatedText(data) {
  if (Array.isArray(data) && data[0] && Array.isArray(data[0].translations) && data[0].translations[0]) {
    const text = data[0].translations[0].text;
    if (typeof text === 'string') return text;
  }
  return null;
}

async function requestBingText(text, allowRefresh) {
  if (text === '') return '';
  const session = await getBingSession(false);
  const api = `${session.origin}/ttranslatev3?isVertical=1&IG=${encodeURIComponent(session.ig)}&IID=${encodeURIComponent(session.iid)}`;
  let res;
  try {
    res = await fetch(api, {
      method: 'POST',
      credentials: 'omit',
      signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        fromLang: 'auto-detect',
        to: 'zh-Hans',
        text,
        token: session.token,
        key: session.key
      })
    });
  } catch (err) {
    throw new Error(friendlyError(err, '必应翻译失败，请检查网络后重试'));
  }
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch (_err) {
    throw new Error('必应翻译结果格式异常');
  }
  const statusCode = data && !Array.isArray(data) ? Number(data.statusCode) : 0;
  if (allowRefresh !== false && (statusCode === 205 || statusCode === 400)) {
    bingSession = null;
    await getBingSession(true);
    return requestBingText(text, false);
  }
  if (!res.ok || statusCode) {
    throw new Error(`必应翻译暂时不可用（${statusCode || res.status}）`);
  }
  const translated = extractBingTranslatedText(data);
  if (translated == null) throw new Error('必应翻译结果格式异常');
  return translated;
}

async function translateBingLineGroup(lines) {
  const translated = await requestBingText(lines.join('\n'));
  const parts = String(translated).split('\n');
  if (parts.length === lines.length) return parts;
  const out = lines.map(() => '');
  for (let i = 0; i < lines.length; i++) {
    out[i] = lines[i] === '' ? '' : await requestBingText(lines[i]);
  }
  return out;
}

async function translateLinesBing(lines) {
  const source = (lines || []).map((line) => (line == null ? '' : String(line)));
  if (!source.length) return [];
  if (!source.some((line) => line !== '')) return source.map(() => '');
  const out = [];
  let start = 0;
  while (start < source.length) {
    let end = start;
    let size = 0;
    while (end < source.length) {
      const extra = source[end].length + (end > start ? 1 : 0);
      if (end > start && size + extra > BING_MAX_CHARS) break;
      size += extra;
      end += 1;
      if (source[end - 1].length >= BING_MAX_CHARS) break;
    }
    const group = source.slice(start, end);
    const translated = await translateBingLineGroup(group);
    out.push(...translated);
    start = end;
  }
  return out;
}

async function translateLines(lines, engine) {
  if (engine === 'bing') return translateLinesBing(lines);
  return translateLinesGoogle(lines);
}

async function ensureContentScript(tabId, frameId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'CIT_PING' }, { frameId });
    if (pong && pong.ok) return;
  } catch (_err) {
    // Content script not injected yet (page opened before install, etc.).
  }
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    files: ['content.js']
  });
}

async function sendToFrame(tabId, frameId, message) {
  return chrome.tabs.sendMessage(tabId, message, { frameId });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_GOOGLE_ID && info.menuItemId !== MENU_BING_ID) return;
  if (!tab || tab.id == null) return;
  handleTranslateClick(info, tab);
});

function isImageClick(info) {
  return info.mediaType === 'image' || !!info.srcUrl;
}

function splitSelectionText(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (normalized.includes('\n')) return normalized.split('\n');
  return [normalized];
}

function engineFromMenu(info) {
  return info.menuItemId === MENU_BING_ID ? 'bing' : 'google';
}

async function handleTranslateClick(info, tab) {
  const engine = engineFromMenu(info);
  if (isImageClick(info)) {
    return handleImageTranslate(info, tab, engine);
  }
  return handleSelectionTranslate(info, tab, engine);
}

async function handleSelectionTranslate(info, tab, engine) {
  const tabId = tab.id;
  const frameId = info.frameId ?? 0;
  const requestId = `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const reportError = async (error) => {
    try {
      await sendToFrame(tabId, frameId, {
        type: 'CIT_ERROR',
        requestId,
        error
      });
    } catch (_err) {
      console.warn('图片翻译：无法在页面上显示错误', error);
    }
  };

  try {
    await ensureContentScript(tabId, frameId);
    const prepared = await sendToFrame(tabId, frameId, {
      type: 'CIT_PREPARE_SELECTION',
      requestId,
      fallbackText: info.selectionText || ''
    });

    if (!prepared || !prepared.ok) {
      throw new Error((prepared && prepared.error) || '没有可翻译的文字');
    }

    const source = String(prepared.text || '');
    if (!source.trim()) {
      throw new Error('没有可翻译的文字');
    }

    const parts = splitSelectionText(source);
    const translatedParts = await translateLines(parts, engine);
    const translated = translatedParts.join('\n');

    await sendToFrame(tabId, frameId, {
      type: 'CIT_SELECTION_RESULT',
      requestId,
      source,
      text: translated
    });
  } catch (err) {
    console.error('文字翻译失败', err);
    await reportError(friendlyError(err, '翻译失败，请稍后重试'));
  }
}

async function handleImageTranslate(info, tab, engine) {
  const tabId = tab.id;
  const frameId = info.frameId ?? 0;
  const requestId = `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const reportError = async (error) => {
    try {
      await sendToFrame(tabId, frameId, {
        type: 'CIT_ERROR',
        requestId,
        error
      });
    } catch (_err) {
      console.warn('图片翻译：无法在页面上显示错误', error);
    }
  };

  try {
    await ensureContentScript(tabId, frameId);
    const prepared = await sendToFrame(tabId, frameId, {
      type: 'CIT_PREPARE',
      requestId,
      srcUrl: info.srcUrl || ''
    });

    if (!prepared || !prepared.ok) {
      throw new Error((prepared && prepared.error) || '找不到要翻译的图片');
    }

    let buffer = prepared.bufferB64 ? citDecodeBuffer(prepared.bufferB64) : null;
    let mime = prepared.mime || '';

    if (!buffer && prepared.url) {
      try {
        const fetched = await fetchImage(prepared.url);
        buffer = fetched.buffer;
        mime = fetched.mime;
      } catch (err) {
        const again = await sendToFrame(tabId, frameId, {
          type: 'CIT_FETCH_FROM_PAGE',
          requestId,
          url: prepared.url
        });
        if (!again || !again.ok || !again.bufferB64) {
          throw err;
        }
        buffer = citDecodeBuffer(again.bufferB64);
        mime = again.mime || mime;
      }
    }

    if (!buffer) {
      throw new Error('无法读取这张图片');
    }
    if (!mime || mime === 'application/octet-stream') {
      mime = sniffMime(buffer);
    }
    if (mime === 'text/html') {
      throw new Error('无法读取这张图片');
    }

    const ocr = await ocrImage(buffer, mime);
    const units = (ocr && ocr.units) || [];
    if (!units.length) {
      await reportError('未识别到文字');
      return;
    }

    const translations = await translateLines(units.map((unit) => unit.text), engine);
    const boxes = units.map((unit, index) => ({
      text: translations[index] || unit.text,
      source: unit.text,
      bbox: unit.bbox
    }));

    await sendToFrame(tabId, frameId, {
      type: 'CIT_RESULT',
      requestId,
      boxes,
      imageWidth: ocr.imageWidth,
      imageHeight: ocr.imageHeight
    });
  } catch (err) {
    console.error('图片翻译失败', err);
    await reportError(friendlyError(err, '翻译失败，请稍后重试'));
  }
}
