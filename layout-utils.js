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

  function asRect(r) {
    if (!r) return null;
    const left = Number(r.left);
    const top = Number(r.top);
    const width = r.width != null ? Number(r.width) : (Number(r.right) - left);
    const height = r.height != null ? Number(r.height) : (Number(r.bottom) - top);
    if (![left, top, width, height].every(Number.isFinite)) return null;
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height
    };
  }

  function unionRect(rects) {
    const items = (rects || []).map(asRect).filter(Boolean);
    if (!items.length) return null;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const r of items) {
      left = Math.min(left, r.left);
      top = Math.min(top, r.top);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
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

  function intersectRect(a, b) {
    const ra = asRect(a);
    const rb = asRect(b);
    if (!ra || !rb) return null;
    const left = Math.max(ra.left, rb.left);
    const top = Math.max(ra.top, rb.top);
    const right = Math.min(ra.right, rb.right);
    const bottom = Math.min(ra.bottom, rb.bottom);
    if (right - left < 1 || bottom - top < 1) return null;
    return {
      left,
      top,
      width: right - left,
      height: bottom - top,
      right,
      bottom
    };
  }

  function rectGap(a, b) {
    const ra = asRect(a);
    const rb = asRect(b);
    if (!ra || !rb) return Infinity;
    const xGap = Math.max(0, Math.max(ra.left, rb.left) - Math.min(ra.right, rb.right));
    const yGap = Math.max(0, Math.max(ra.top, rb.top) - Math.min(ra.bottom, rb.bottom));
    return Math.hypot(xGap, yGap);
  }

  function clusterRects(rects, point, maxGap) {
    const items = (rects || []).map(asRect).filter((r) => r && r.width >= 2 && r.height >= 2);
    if (!items.length) return [];
    const gapLimit = (Number.isFinite(maxGap) && maxGap > 0) ? maxGap : 240;
    const dist = (r) => {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return 0;
      return Math.hypot((r.left + r.width / 2) - point.x, (r.top + r.height / 2) - point.y);
    };
    const unused = items.slice().sort((a, b) => dist(a) - dist(b) || a.top - b.top || a.left - b.left);
    const cluster = [unused.shift()];
    let union = unionRect(cluster);
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = unused.length - 1; i >= 0; i -= 1) {
        if (rectGap(unused[i], union) <= gapLimit) {
          cluster.push(unused[i]);
          unused.splice(i, 1);
          union = unionRect(cluster);
          changed = true;
        }
      }
    }
    return cluster;
  }

  function lineTextFromGlyphs(glyphs) {
    return (glyphs || [])
      .slice()
      .sort((a, b) => (a.left - b.left) || (a.top - b.top))
      .map((g) => (g && g.text != null) ? String(g.text) : '')
      .join('')
      .replace(/[ 	]+/g, ' ')
      .replace(/ /g, ' ')
      .trim();
  }

  function groupGlyphsIntoBlocks(glyphs, containerRect) {
    const items = (glyphs || []).map((g) => {
      const rect = asRect(g);
      if (!rect || !g || g.text == null) return null;
      return Object.assign({}, rect, { text: String(g.text) });
    }).filter((g) => g && (g.text.length || (g.width >= 1 && g.height >= 1)));

    if (!items.length) return [];

    const sorted = items.slice().sort((a, b) => a.top - b.top || a.left - b.left);
    const lines = [];
    for (const glyph of sorted) {
      const mid = (glyph.top + glyph.bottom) / 2;
      const h = Math.max(1, glyph.height);
      let found = null;
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i];
        const overlap = Math.min(line.bottom, glyph.bottom) - Math.max(line.top, glyph.top);
        if (mid >= line.top && mid <= line.bottom) {
          found = line;
          break;
        }
        if (overlap > Math.min(h, Math.max(1, line.bottom - line.top)) * 0.4) {
          found = line;
          break;
        }
      }
      if (found) {
        found.glyphs.push(glyph);
        found.top = Math.min(found.top, glyph.top);
        found.bottom = Math.max(found.bottom, glyph.bottom);
        found.left = Math.min(found.left, glyph.left);
        found.right = Math.max(found.right, glyph.right);
      } else {
        lines.push({
          glyphs: [glyph],
          top: glyph.top,
          bottom: glyph.bottom,
          left: glyph.left,
          right: glyph.right
        });
      }
    }

    lines.sort((a, b) => a.top - b.top || a.left - b.left);
    const heights = lines
      .map((line) => Math.max(0, line.bottom - line.top))
      .filter((height) => height > 0)
      .sort((a, b) => a - b);
    const medH = heights.length ? heights[Math.floor(heights.length / 2)] : 16;
    // CSS line boxes usually abut when wrapping. A visual blank line leaves a
    // gap around one line-height; use a threshold below that.
    const paraGap = Math.max(medH * 0.8, 8);
    const box = asRect(containerRect) || unionRect(lines);

    const blocks = [];
    let current = [];
    let lastBottom = null;
    const flush = () => {
      const kept = [];
      const rects = [];
      for (const line of current) {
        const text = lineTextFromGlyphs(line.glyphs);
        if (!text) continue;
        kept.push(text);
        rects.push(line);
      }
      current = [];
      if (!kept.length) return;
      blocks.push({
        align: inferAlignFromRects(rects, box) || 'left',
        lines: kept
      });
    };

    for (const line of lines) {
      if (lastBottom != null && (line.top - lastBottom) > paraGap) flush();
      current.push(line);
      lastBottom = line.bottom;
    }
    flush();
    return blocks;
  }

  function pickPanelPosition(options) {
    const opts = options || {};
    const margin = Number.isFinite(opts.margin) ? opts.margin : 8;
    const vw = Number(opts.vw) || 0;
    const vh = Number(opts.vh) || 0;
    const panelW = Math.max(0, Number(opts.panelW) || 0);
    const panelH = Math.max(0, Number(opts.panelH) || 0);
    const mouse = opts.mouse && Number.isFinite(opts.mouse.x) && Number.isFinite(opts.mouse.y)
      ? opts.mouse
      : null;
    const prefer = opts.prefer === 'right' ? 'right' : 'below';

    function clamp(x, y) {
      return {
        x: Math.min(Math.max(margin, x), Math.max(margin, vw - panelW - margin)),
        y: Math.min(Math.max(margin, y), Math.max(margin, vh - panelH - margin))
      };
    }

    function fits(x, y) {
      return x >= margin
        && y >= margin
        && (x + panelW + margin) <= vw + 0.5
        && (y + panelH + margin) <= vh + 0.5;
    }

    const viewport = { left: 0, top: 0, width: vw, height: vh, right: vw, bottom: vh };
    const visible = opts.sourceRect ? intersectRect(opts.sourceRect, viewport) : null;

    if (visible && visible.width >= 2 && visible.height >= 2) {
      const below = { x: visible.left, y: visible.bottom + margin };
      const above = { x: visible.left, y: visible.top - panelH - margin };
      const right = { x: visible.right + margin, y: visible.top };
      const left = { x: visible.left - panelW - margin, y: visible.top };
      const order = prefer === 'right'
        ? [right, below, above, left]
        : [below, above, right, left];
      for (const cand of order) {
        if (fits(cand.x, cand.y)) return { x: cand.x, y: cand.y };
      }
      for (const cand of [right, left]) {
        if (cand.x >= margin && cand.x + panelW + margin <= vw) {
          return clamp(cand.x, visible.top);
        }
      }
      if (mouse) return clamp(visible.left, mouse.y + margin);
      return clamp(visible.left, visible.bottom + margin);
    }

    if (mouse) return clamp(mouse.x + 12, mouse.y + 12);
    return clamp(margin, margin);
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
    sanitizeBlocks,
    unionRect,
    intersectRect,
    rectGap,
    clusterRects,
    groupGlyphsIntoBlocks,
    pickPanelPosition
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.CITLayout;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
