/* 图片翻译 - service worker */
'use strict';

importScripts('buffer-codec.js');

const MENU_ID = 'cit-translate-image';
const TARGET_LANG = 'zh-CN';
const TRANSLATE_URL = 'https://translate-pa.googleapis.com/v1/translateHtml';
// Public te_lib client key embedded in Google's official translate library (not a user secret).
const TRANSLATE_API_KEY = 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520';
const OCR_TIMEOUT_MS = 90000;
const TRANSLATE_CHUNK = 80;

function setupMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: '翻译',
      contexts: ['image', 'selection']
    });
  });
}

chrome.runtime.onInstalled.addListener(setupMenus);
chrome.runtime.onStartup.addListener(setupMenus);

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
    throw new Error(friendlyError(err, '翻译失败，请稍后重试'));
  }
  if (!res.ok) {
    const error = new Error(`翻译服务暂时不可用（${res.status}）`);
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

async function translateLines(lines) {
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
  if (info.menuItemId !== MENU_ID || !tab || tab.id == null) return;
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

async function handleTranslateClick(info, tab) {
  if (isImageClick(info)) {
    return handleImageTranslate(info, tab);
  }
  return handleSelectionTranslate(info, tab);
}

async function handleSelectionTranslate(info, tab) {
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
    const translatedParts = await translateLines(parts);
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

async function handleImageTranslate(info, tab) {
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

    const translations = await translateLines(units.map((unit) => unit.text));
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
