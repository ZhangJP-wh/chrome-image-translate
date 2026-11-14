/* 图片翻译 - service worker */
'use strict';

importScripts('buffer-codec.js');

const MENU_ROOT_ID = 'cit-translate-root';
const MENU_GOOGLE_ID = 'cit-translate-google';
const MENU_BING_ID = 'cit-translate-bing';
const MENU_HINT_ID = 'cit-menu-hint';
const TARGET_ZH = 'zh-CN';
const TARGET_EN = 'en';
const BING_TO_ZH = 'zh-Hans';
const BING_TO_EN = 'en';

// Characters that appear in only one of the two standard written forms.
// Shared characters such as 你/好/是/的 are ignored. If there are no exclusive
// markers, Chinese text is treated as Simplified (the user's exception case).
const SIMP_ONLY = new Set(
  '爱办报备贝笔边变宾补参仓层产车彻尘陈衬称诚迟齿冲虫处触从达带单担胆党导灯敌递点电东动冻读断对队儿尔发范饭飞废费奋愤风缝妇复盖赶干钢个给关观广汉号后护划怀坏欢环会机积级计记济继价驾间艰检简减荐见将奖讲较节结仅紧进尽经惊举剧据克垦恳库况扩阔来兰蓝栏乐类离里礼历丽联练粮两疗辽邻灵龄领龙楼录陆驴乱论罗吗买麦门们梦面庙亩纳难恼脑农盘齐气迁签钱浅枪墙桥窃亲庆穷区驱权劝让扰热认荣虽扫杀伤烧设摄识时实势师湿适释数术帅双顺说丝肃随损摊坛叹汤讨誊体条听铜统头图涂团袜弯湾万网为卫务雾无习戏虾吓鲜闲显险县现线乡详响项须许绪续选压亚严颜盐杨扬养样钥页业医遗仪蚁艺阴隐应营拥优犹与屿语誉预员缘远愿跃运杂载赞赃脏枣灶则泽这针侦诊阵镇症证织职执纸质钟种肿众专转庄装壮准综总纵钻'
);
const TRAD_ONLY = new Set(
  '愛辦報備貝筆邊變賓補參倉層產車徹塵陳襯稱誠遲齒衝蟲處觸從達帶單擔膽黨導燈敵遞點電東動凍讀斷對隊兒爾發範飯飛廢費奮憤風縫婦復蓋趕幹鋼個給關觀廣漢號後護劃懷壞歡環會機積級計記濟繼價駕間艱檢簡減薦見將獎講較節結僅緊進盡經驚舉劇據剋墾懇庫況擴闊來蘭藍欄樂類離裡裏禮歷麗聯練糧兩療遼鄰靈齡領龍樓錄陸驢亂論羅嗎買麥門們夢麵廟畝納難惱腦農盤齊氣遷簽錢淺槍牆橋竊親慶窮區驅權勸讓擾熱認榮雖掃殺傷燒設攝識時實勢師濕適釋數術帥雙順說絲肅隨損攤壇嘆湯討謄體條聽銅統頭圖塗團襪彎灣萬網為衛務霧無習戲蝦嚇鮮閒顯險縣現線鄉詳響項須許緒續選壓亞嚴顏鹽楊揚養樣鑰頁業醫遺儀蟻藝陰隱應營擁優猶與嶼語譽預員緣遠願躍運雜載贊贓髒棗竈則澤這針偵診陣鎮症證織職執紙質鐘種腫眾專轉莊裝壯準綜總縱鑽國學過還開麼臺灣廳廠義戰寫黨齊龍龜鬱'
);

function countMarkers(text, set) {
  let n = 0;
  for (const ch of String(text || '')) {
    if (set.has(ch)) n += 1;
  }
  return n;
}

function isSimplifiedChineseSource(text) {
  const sample = String(text || '');
  const han = [];
  let letters = 0;
  let kana = 0;
  let hangul = 0;
  for (const ch of sample) {
    if (/\p{Script=Han}/u.test(ch)) {
      han.push(ch);
      letters += 1;
    } else if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(ch)) {
      kana += 1;
      letters += 1;
    } else if (/\p{Script=Hangul}/u.test(ch)) {
      hangul += 1;
      letters += 1;
    } else if (/\p{L}/u.test(ch)) {
      letters += 1;
    }
  }
  // Japanese / Korean are not Chinese.
  if (kana >= 2 && kana >= Math.max(1, han.length * 0.15)) return false;
  if (hangul >= 2 && hangul >= han.length) return false;
  if (han.length === 0) return false;
  if (letters >= 8 && han.length / letters < 0.25) return false;
  const trad = countMarkers(sample, TRAD_ONLY);
  const simp = countMarkers(sample, SIMP_ONLY);
  if (trad > simp) return false;
  return true;
}

function resolveTargets(text) {
  if (isSimplifiedChineseSource(text)) {
    return { google: TARGET_EN, bing: BING_TO_EN };
  }
  return { google: TARGET_ZH, bing: BING_TO_ZH };
}

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
    chrome.contextMenus.create({
      id: MENU_HINT_ID,
      parentId: MENU_ROOT_ID,
      title: '提示：在扩展设置里只勾选一项，可去掉二级菜单',
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

async function requestTranslateChunk(chunk, targetLang) {
  let res;
  try {
    res = await fetch(TRANSLATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json+protobuf',
        'X-Goog-API-Key': TRANSLATE_API_KEY
      },
      body: JSON.stringify([[chunk, 'auto', targetLang || TARGET_ZH], 'te_lib'])
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

async function translateChunk(chunk, targetLang) {
  try {
    return await requestTranslateChunk(chunk, targetLang);
  } catch (err) {
    if (err.status !== 400 || chunk.length === 1) throw err;
    const out = [];
    for (const line of chunk) {
      try {
        const [translated] = await requestTranslateChunk([line], targetLang);
        out.push(translated);
      } catch (inner) {
        if (inner.status !== 400) throw inner;
        out.push(line);
      }
    }
    return out;
  }
}

async function translateLinesGoogle(lines, targetLang) {
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
    const translated = await translateChunk(chunkItems.map((item) => item.text), targetLang);
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

async function requestBingText(text, allowRefresh, targetLang) {
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
        to: targetLang || BING_TO_ZH,
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
    return requestBingText(text, false, targetLang);
  }
  if (!res.ok || statusCode) {
    throw new Error(`必应翻译暂时不可用（${statusCode || res.status}）`);
  }
  const translated = extractBingTranslatedText(data);
  if (translated == null) throw new Error('必应翻译结果格式异常');
  return translated;
}

async function translateBingLineGroup(lines, targetLang) {
  const translated = await requestBingText(lines.join('\n'), true, targetLang);
  const parts = String(translated).split('\n');
  if (parts.length === lines.length) return parts;
  const out = lines.map(() => '');
  for (let i = 0; i < lines.length; i++) {
    out[i] = lines[i] === '' ? '' : await requestBingText(lines[i], true, targetLang);
  }
  return out;
}

async function translateLinesBing(lines, targetLang) {
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
    const translated = await translateBingLineGroup(group, targetLang);
    out.push(...translated);
    start = end;
  }
  return out;
}

async function translateLines(lines, engine, targetLang) {
  if (engine === 'bing') return translateLinesBing(lines, targetLang);
  return translateLinesGoogle(lines, targetLang);
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

async function openSettingsFromHint() {
  try {
    if (chrome.storage.session) {
      await chrome.storage.session.set({ focusEngines: true });
    } else {
      await chrome.storage.local.set({ focusEngines: true });
    }
  } catch (_err) {
    // Highlight is optional; still open the settings page.
  }
  try {
    if (chrome.runtime.openOptionsPage) {
      await chrome.runtime.openOptionsPage();
      return;
    }
  } catch (_err) {
    // Fall through to a settings tab.
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL('options.html#engines') });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_HINT_ID) {
    openSettingsFromHint();
    return;
  }
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
    const targets = resolveTargets(source);
    const translatedParts = await translateLines(parts, engine, engine === 'bing' ? targets.bing : targets.google);
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

    const sourceLines = units.map((unit) => unit.text);
    const targets = resolveTargets(sourceLines.join('\n'));
    const translations = await translateLines(sourceLines, engine, engine === 'bing' ? targets.bing : targets.google);
    const boxes = units.map((unit, index) => ({
      text: translations[index] || unit.text,
      source: unit.text,
      bbox: unit.bbox
    }));

    await sendToFrame(tabId, frameId, {
      type: 'CIT_RESULT',
      requestId,
      text: translations.join('\n'),
      boxes,
      imageWidth: ocr.imageWidth,
      imageHeight: ocr.imageHeight
    });
  } catch (err) {
    console.error('图片翻译失败', err);
    await reportError(friendlyError(err, '翻译失败，请稍后重试'));
  }
}
