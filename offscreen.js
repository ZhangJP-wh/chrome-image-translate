/* 图片翻译 - offscreen OCR (Tesseract.js) */
'use strict';

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await Tesseract.createWorker('eng+chi_sim', 1, {
        workerPath: chrome.runtime.getURL('lib/worker.min.js'),
        corePath: chrome.runtime.getURL('lib'),
        langPath: chrome.runtime.getURL('tessdata'),
        workerBlobURL: false,
        gzip: true,
        cacheMethod: 'none'
      });
      await worker.setParameters({
        tessedit_pageseg_mode: '3',
        preserve_interword_spaces: '1'
      });
      return worker;
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

async function imageFromBlob(blob) {
  try {
    return await createImageBitmap(blob);
  } catch (_err) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('无法解码图片'));
        el.src = url;
      });
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function rasterize(buffer, mime) {
  if (!buffer || !buffer.byteLength) {
    throw new Error('无法解码图片');
  }
  const sniffed = citSniffMime(buffer);
  if (sniffed === 'text/html') {
    throw new Error('无法解码图片');
  }
  const type = sniffed.startsWith('image/')
    ? sniffed
    : (mime && String(mime).startsWith('image/') ? mime : 'image/png');
  const blob = new Blob([buffer], { type });
  const bitmap = await imageFromBlob(blob);
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  if (!srcW || !srcH) {
    if (bitmap.close) bitmap.close();
    throw new Error('无法解码图片');
  }

  const maxSide = 2200;
  const minSide = 720;
  let scale = 1;
  if (Math.max(srcW, srcH) > maxSide) {
    scale = maxSide / Math.max(srcW, srcH);
  } else if (Math.min(srcW, srcH) < minSide) {
    scale = Math.min(2.5, minSide / Math.min(srcW, srcH));
  }

  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (bitmap.close) bitmap.close();

  const outBlob = await canvas.convertToBlob({ type: 'image/png' });
  return { blob: outBlob, scale, srcW, srcH };
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function pushUnit(units, text, bbox, confidence, invScale) {
  const cleaned = normalizeText(text);
  if (!cleaned || !bbox) return;
  if (confidence != null && confidence < 30) return;
  const x0 = bbox.x0 * invScale;
  const y0 = bbox.y0 * invScale;
  const x1 = bbox.x1 * invScale;
  const y1 = bbox.y1 * invScale;
  if ((x1 - x0) < 2 || (y1 - y0) < 2) return;
  units.push({
    text: cleaned,
    bbox: { x0, y0, x1, y1 }
  });
}

function groupWordsIntoLines(words) {
  const filtered = words
    .filter((word) => normalizeText(word.text) && (word.confidence == null || word.confidence >= 30) && word.bbox)
    .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);

  const lines = [];
  for (const word of filtered) {
    const mid = (word.bbox.y0 + word.bbox.y1) / 2;
    let line = null;
    for (const existing of lines) {
      const overlap = Math.min(existing.y1, word.bbox.y1) - Math.max(existing.y0, word.bbox.y0);
      const minH = Math.min(existing.y1 - existing.y0, word.bbox.y1 - word.bbox.y0);
      if ((mid >= existing.y0 && mid <= existing.y1) || (minH > 0 && overlap / minH > 0.5)) {
        line = existing;
        break;
      }
    }
    if (!line) {
      line = {
        words: [],
        x0: word.bbox.x0,
        y0: word.bbox.y0,
        x1: word.bbox.x1,
        y1: word.bbox.y1
      };
      lines.push(line);
    }
    line.words.push(word);
    line.x0 = Math.min(line.x0, word.bbox.x0);
    line.y0 = Math.min(line.y0, word.bbox.y0);
    line.x1 = Math.max(line.x1, word.bbox.x1);
    line.y1 = Math.max(line.y1, word.bbox.y1);
  }

  for (const line of lines) {
    line.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    line.text = line.words.map((word) => word.text).join(' ');
  }
  return lines;
}

function collectFromBlocks(data) {
  const paragraphs = [];
  const lines = [];
  const words = [];
  if (Array.isArray(data.paragraphs)) paragraphs.push(...data.paragraphs);
  if (Array.isArray(data.lines)) lines.push(...data.lines);
  if (Array.isArray(data.words)) words.push(...data.words);

  for (const block of data.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      paragraphs.push(paragraph);
      for (const line of paragraph.lines || []) {
        lines.push(line);
        for (const word of line.words || []) {
          words.push(word);
        }
      }
    }
  }
  return { paragraphs, lines, words };
}

function groupUnits(data, invScale, imageWidth, imageHeight) {
  const units = [];
  const collected = collectFromBlocks(data);

  for (const paragraph of collected.paragraphs) {
    pushUnit(units, paragraph.text, paragraph.bbox, paragraph.confidence, invScale);
  }
  if (units.length) return units;

  for (const line of collected.lines) {
    pushUnit(units, line.text, line.bbox, line.confidence, invScale);
  }
  if (units.length) return units;

  const grouped = groupWordsIntoLines(collected.words);
  for (const line of grouped) {
    pushUnit(units, line.text, line, 100, invScale);
  }
  if (units.length) return units;

  const fallback = normalizeText(data.text);
  if (fallback && imageWidth && imageHeight) {
    units.push({
      text: fallback,
      bbox: { x0: 0, y0: 0, x1: imageWidth, y1: imageHeight }
    });
  }
  return units;
}

async function runOcr(buffer, mime) {
  const raster = await rasterize(buffer, mime);
  const worker = await getWorker();
  const result = await worker.recognize(raster.blob, {}, { text: true, blocks: true });
  const invScale = 1 / raster.scale;
  return {
    units: groupUnits(result.data || {}, invScale, raster.srcW, raster.srcH),
    imageWidth: raster.srcW,
    imageHeight: raster.srcH
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return undefined;
  if (message.type === 'CIT_PING') {
    sendResponse({ ok: true });
    return undefined;
  }
  if (message.type !== 'CIT_OCR') return undefined;

  (async () => {
    try {
      const buffer = citDecodeBuffer(message.bufferB64);
      const result = await runOcr(buffer, message.mime);
      sendResponse({ ok: true, result });
    } catch (err) {
      sendResponse({ ok: false, error: (err && err.message) || '文字识别失败' });
    }
  })();
  return true;
});
