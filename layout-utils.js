/* 图片翻译 - layout helpers (browser + node) */
(function (root) {
  'use strict';

  function normalizeAlign(textAlign, direction) {
    const v = String(textAlign || '').toLowerCase();
    const rtl = String(direction || '').toLowerCase() === 'rtl';
    if (v === 'center') return 'center';
    if (v === 'justify') return 'justify';
    if (v === 'right') return 'right';
    if (v === 'left') return 'left';
    if (v === 'end') return rtl ? 'left' : 'right';
    if (v === 'start') return rtl ? 'right' : 'left';
    return 'left';
  }

  function inferAlignFromBox(x0, x1, width) {
    if (!(width > 0) || !(x1 > x0)) return 'left';
    const left = Math.max(0, x0);
    const right = Math.max(0, width - x1);
    const lineW = x1 - x0;
    if (lineW / width >= 0.85) return 'left';
    const diff = left - right;
    const slop = Math.max(10, width * 0.08);
    if (Math.abs(diff) <= slop && left > slop && right > slop) return 'center';
    if (diff > slop && right <= slop * 1.25) return 'right';
    return 'left';
  }

  function inferAlignFromRects(lineRects, containerRect) {
    if (!lineRects || !lineRects.length || !containerRect || !(containerRect.width > 0)) {
      return null;
    }
    let leftish = 0;
    let rightish = 0;
    let centerish = 0;
    for (const r of lineRects) {
      const leftGap = r.left - containerRect.left;
      const rightGap = containerRect.right - (r.right != null ? r.right : r.left + r.width);
      const vote = inferAlignFromBox(leftGap, containerRect.width - rightGap, containerRect.width);
      if (vote === 'center') centerish += 1;
      else if (vote === 'right') rightish += 1;
      else leftish += 1;
    }
    const n = lineRects.length;
    if (centerish >= n * 0.6 && centerish >= leftish && centerish >= rightish) return 'center';
    if (rightish >= n * 0.6 && rightish > leftish) return 'right';
    return 'left';
  }

  function groupOcrBoxes(boxes, imageWidth) {
    const items = (boxes || []).map((box) => {
      const bbox = box && box.bbox ? box.bbox : {};
      return {
        text: box && box.text != null ? String(box.text) : '',
        x0: Number(bbox.x0) || 0,
        y0: Number(bbox.y0) || 0,
        x1: Number(bbox.x1) || 0,
        y1: Number(bbox.y1) || 0
      };
    }).filter((item) => item.text).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

    if (!items.length) return [];

    const heights = items
      .map((item) => Math.max(0, item.y1 - item.y0))
      .filter((height) => height > 0)
      .sort((a, b) => a - b);
    const medH = heights.length ? heights[Math.floor(heights.length / 2)] : 16;
    const gapThreshold = Math.max(medH * 1.35, 8);

    const paras = [];
    let current = null;
    for (const item of items) {
      const align = inferAlignFromBox(item.x0, item.x1, imageWidth);
      if (!current) {
        current = { align, lines: [item.text], lastY1: item.y1 };
        continue;
      }
      const gap = item.y0 - current.lastY1;
      if (gap > gapThreshold || align !== current.align) {
        paras.push({ align: current.align, lines: current.lines });
        current = { align, lines: [item.text], lastY1: item.y1 };
      } else {
        current.lines.push(item.text);
        current.lastY1 = item.y1;
      }
    }
    if (current) paras.push({ align: current.align, lines: current.lines });
    return paras;
  }

  function blocksFromPlainText(text, align) {
    const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!normalized) return [];
    return normalized.split(/\n{2,}/).map((para) => ({
      align: align || 'left',
      lines: para.split('\n')
    }));
  }

  function blocksToSourceText(blocks) {
    return (blocks || [])
      .map((block) => ((block && block.lines) || []).join('\n'))
      .join('\n\n');
  }

  function linesFromBlocks(blocks) {
    const lines = [];
    (blocks || []).forEach((block) => {
      ((block && block.lines) || []).forEach((line) => {
        lines.push(line == null ? '' : String(line));
      });
    });
    return lines;
  }

  function applyTranslations(blocks, translatedLines) {
    let index = 0;
    const list = translatedLines || [];
    return (blocks || []).map((block) => ({
      align: (block && block.align) || 'left',
      lines: ((block && block.lines) || []).map(() => {
        const text = list[index];
        index += 1;
        return text == null ? '' : String(text);
      })
    }));
  }

  function sanitizeBlocks(blocks, fallbackAlign) {
    const align = fallbackAlign || 'left';
    if (!Array.isArray(blocks) || !blocks.length) return [];
    return blocks.map((block) => ({
      align: normalizeAlign(block && block.align, null) || align,
      lines: Array.isArray(block && block.lines)
        ? block.lines.map((line) => (line == null ? '' : String(line)))
        : [block && block.text != null ? String(block.text) : '']
    }));
  }

  root.CITLayout = {
    normalizeAlign,
    inferAlignFromBox,
    inferAlignFromRects,
    groupOcrBoxes,
    blocksFromPlainText,
    blocksToSourceText,
    linesFromBlocks,
    applyTranslations,
    sanitizeBlocks
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.CITLayout;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
