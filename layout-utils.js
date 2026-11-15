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

  // ---------------------------------------------------------------------
  // OCR layout (0.1.12): infer the original text column(s) from line boxes
  // and lay the translation out like the source (left / center / right,
  // headings, bullet lists with hanging indent, paragraph gaps).
  // ---------------------------------------------------------------------

  const STRONG_BULLET_RE = /^\s*([\u2022\u00b7\u2219\u25cf\u25cb\u25e6\u25aa\u25a0\u25a1\u25ba\u25b8\u2023\u2043\u25c6\u25c7\u2713\u2714\u27a4\u2192\u30fb])\s*(?=\S)/;
  const WEAK_BULLET_RE = /^\s*([\-\u2013\u2014*+\u00bb\u00ab\u00b0\u3002oeO])\s+(?=\S)/;
  const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

  function median(values, fallback) {
    const list = (values || []).filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
    if (!list.length) return fallback;
    const mid = Math.floor(list.length / 2);
    return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  }

  function isNoiseText(text, confidence) {
    const t = String(text || '').trim();
    if (!t) return true;
    let core = '';
    try {
      core = t.replace(/[\s\p{P}\p{S}]/gu, '');
    } catch (_err) {
      core = t.replace(/[\s!-\/:-@\[-`{-~\u00a0-\u00bf\u2000-\u206f\u2190-\u2bff\u3000-\u303f]/g, '');
    }
    if (!core) return true;
    if (CJK_RE.test(core)) return false;
    // A lone Latin letter (logo marks such as "x", stray glyphs).
    if (core.length === 1 && /[A-Za-z]/.test(core) && t.length <= 3) return true;
    if (confidence != null && Number.isFinite(Number(confidence)) && Number(confidence) < 45 && core.length <= 2) {
      return true;
    }
    return false;
  }

  function bulletLead(text) {
    const t = String(text || '');
    let m = STRONG_BULLET_RE.exec(t);
    if (m) return { strong: true, lead: m[1], rest: t.slice(m[0].length) };
    m = WEAK_BULLET_RE.exec(t);
    if (m) return { strong: false, lead: m[1], rest: t.slice(m[0].length) };
    return null;
  }

  function stripBulletLead(text) {
    const lead = bulletLead(text);
    return lead ? lead.rest : String(text == null ? '' : text);
  }

  function normalizeOcrItems(boxes) {
    return (boxes || []).map((box, index) => {
      const bbox = box && box.bbox ? box.bbox : (box || {});
      const text = box && box.text != null ? String(box.text) : '';
      const source = box && box.source != null ? String(box.source) : text;
      const conf = box && box.confidence != null ? Number(box.confidence) : null;
      return {
        index,
        text,
        source,
        conf: Number.isFinite(conf) ? conf : null,
        x0: Number(bbox.x0) || 0,
        y0: Number(bbox.y0) || 0,
        x1: Number(bbox.x1) || 0,
        y1: Number(bbox.y1) || 0,
        noise: box && typeof box.noise === 'boolean' ? box.noise : null,
        bullet: box && typeof box.bullet === 'boolean' ? box.bullet : null
      };
    }).filter((item) => (item.text || item.source).trim())
      .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  }

  function referenceHeight(items) {
    const longH = items
      .filter((it) => String(it.source || it.text).trim().length >= 12)
      .map((it) => it.y1 - it.y0)
      .filter((h) => h > 0);
    const allH = items.map((it) => it.y1 - it.y0).filter((h) => h > 0);
    return median(longH.length >= 2 ? longH : allH, 16) || 16;
  }

  function markBullets(items, refH) {
    const tol = Math.max(6, refH * 0.6);
    const leads = items.map((it) => (it.bullet === false ? null : bulletLead(it.source || it.text)));
    items.forEach((it, i) => {
      if (it.bullet === true) return;
      if (it.bullet === false) return;
      const lead = leads[i];
      if (!lead) {
        it.bullet = false;
        return;
      }
      if (lead.strong) {
        it.bullet = true;
        return;
      }
      const next = items[i + 1];
      const hanging = !!(next
        && (next.y0 - it.y1) < refH * 1.2
        && next.x0 > it.x0 + refH * 0.4
        && next.x0 < it.x0 + refH * 3.5
        && !leads[i + 1]);
      let sibling = false;
      for (let j = 0; j < items.length && !sibling; j += 1) {
        if (j !== i && leads[j] && Math.abs(items[j].x0 - it.x0) <= tol) sibling = true;
      }
      it.bullet = hanging || sibling;
    });
  }

  function prepareOcrUnits(units) {
    const items = normalizeOcrItems((units || []).map((u) => Object.assign({}, u, {
      source: u && u.text != null ? String(u.text) : ''
    })));
    const kept = [];
    for (const it of items) {
      if (it.noise == null) it.noise = isNoiseText(it.source, it.conf);
    }
    const clean = items.filter((it) => !it.noise);
    markBullets(clean, referenceHeight(clean));
    for (const it of items) {
      const raw = it.source;
      kept.push({
        text: it.bullet ? stripBulletLead(raw).trim() || raw : raw,
        raw,
        bbox: { x0: it.x0, y0: it.y0, x1: it.x1, y1: it.y1 },
        confidence: it.conf,
        noise: !!it.noise,
        bullet: !!it.bullet
      });
    }
    return kept;
  }

  function clusterLeftEdges(items, tol) {
    const sorted = items.slice().sort((a, b) => a.x0 - b.x0);
    const clusters = [];
    for (const it of sorted) {
      const last = clusters[clusters.length - 1];
      if (last && it.x0 - last.mean <= tol) {
        last.items.push(it);
        last.mean = last.items.reduce((s, v) => s + v.x0, 0) / last.items.length;
      } else {
        clusters.push({ items: [it], mean: it.x0 });
      }
    }
    for (const c of clusters) {
      c.count = c.items.length;
      c.weight = c.items.reduce((s, v) => s + (v.x1 - v.x0), 0);
      c.left = median(c.items.map((v) => v.x0), c.mean);
    }
    return clusters.sort((a, b) => b.count - a.count || b.weight - a.weight);
  }

  function layoutOcrBoxes(boxes, imageWidth) {
    let items = normalizeOcrItems(boxes);
    items = items.filter((it) => {
      if (it.noise === true) return false;
      if (it.noise === false) return true;
      return !isNoiseText(it.source || it.text, it.conf);
    });
    if (!items.length) return { blocks: [], column: null, textRects: [], refHeight: 16 };

    const refH = referenceHeight(items);
    const tol = Math.max(6, refH * 0.6);
    markBullets(items, refH);
    items.forEach((it) => {
      it.h = Math.max(1, it.y1 - it.y0);
      it.heading = it.h > refH * 1.25 && String(it.source || it.text).trim().length >= 2;
    });

    const n = items.length;
    const union = {
      x0: Math.min(...items.map((it) => it.x0)),
      x1: Math.max(...items.map((it) => it.x1))
    };
    const uW = Math.max(1, union.x1 - union.x0);
    const uMid = (union.x0 + union.x1) / 2;
    const clusters = clusterLeftEdges(items, tol);
    const best = clusters[0];
    const centeredCnt = items.filter((it) => (it.x1 - it.x0) < uW * 0.9
      && Math.abs((it.x0 + it.x1) / 2 - uMid) <= Math.max(tol * 1.5, uW * 0.03)).length;
    const leftAnchored = n === 1
      ? (inferAlignFromBox(items[0].x0, items[0].x1, imageWidth) === 'left')
      : (best.count >= 2 && best.count >= n * 0.3
        && !(centeredCnt >= n * 0.5 && centeredCnt >= best.count));

    let colLeft;
    let main;
    if (leftAnchored) {
      colLeft = n === 1 ? items[0].x0 : best.left;
      main = items.filter((it) => it.x0 >= colLeft - tol * 1.5);
    } else if (n === 1 && imageWidth > 0) {
      colLeft = 0;
      main = items;
    } else {
      colLeft = union.x0;
      main = items;
    }
    const mainSet = new Set(main);
    let colRight = Math.max(...main.map((it) => it.x1));
    if (!leftAnchored && n === 1 && imageWidth > 0) colRight = imageWidth;
    const colW = Math.max(1, colRight - colLeft);
    const colMid = (colLeft + colRight) / 2;
    const column = {
      x0: Math.min(...main.map((it) => it.x0)),
      y0: Math.min(...main.map((it) => it.y0)),
      x1: Math.max(...main.map((it) => it.x1)),
      y1: Math.max(...main.map((it) => it.y1))
    };

    // First pass: candidate alignment per line, relative to its column.
    for (const it of items) {
      if (!mainSet.has(it)) {
        it.align = 'left';
        it.indent = 0;
        it.region = 'aside';
        continue;
      }
      it.region = 'main';
      const leftD = it.x0 - colLeft;
      const rightD = colRight - it.x1;
      const w = it.x1 - it.x0;
      it.indent = 0;
      if (w >= colW * 0.9) {
        it.align = 'neutral';
      } else if (leftAnchored && Math.abs(leftD) <= tol) {
        it.align = 'left';
      } else if (Math.abs(leftD - rightD) <= Math.max(tol * 1.5, colW * 0.04) && leftD > tol) {
        it.align = 'center?';
      } else if (rightD <= tol && leftD > tol) {
        it.align = 'right?';
      } else {
        it.align = 'left';
        it.indent = Math.max(0, leftD);
      }
    }

    // Second pass: only keep center/right when the column clearly has them.
    const centerCands = items.filter((it) => it.align === 'center?');
    const rightCands = items.filter((it) => it.align === 'right?');
    const clearlyCentered = !leftAnchored || centerCands.length >= 2;
    const rightLefts = rightCands.map((it) => it.x0);
    const rightVaries = rightLefts.length >= 2 && (Math.max(...rightLefts) - Math.min(...rightLefts)) > tol;
    const rightEdgeShared = (it) => main.some((o) => o !== it && Math.abs(o.x1 - it.x1) <= tol);
    for (const it of items) {
      if (it.align === 'center?') {
        if (clearlyCentered || it.heading) it.align = 'center';
        else { it.align = 'left'; it.indent = Math.max(0, it.x0 - colLeft); }
      } else if (it.align === 'right?') {
        const single = rightCands.length === 1 && (it.x0 - colLeft) > colW * 0.35 && rightEdgeShared(it);
        if (rightVaries || single) it.align = 'right';
        else { it.align = 'left'; it.indent = Math.max(0, it.x0 - colLeft); }
      }
    }

    if (n === 1 && imageWidth > 0) {
      items[0].align = inferAlignFromBox(items[0].x0, items[0].x1, imageWidth);
      items[0].indent = 0;
    }

    // Paragraph gap threshold from the typical line gap.
    const gaps = [];
    for (let i = 1; i < items.length; i += 1) {
      const g = items[i].y0 - items[i - 1].y1;
      if (g >= 0) gaps.push(g);
    }
    const smallGaps = gaps.filter((g) => g <= refH);
    const lineGap = smallGaps.length ? median(smallGaps, refH * 0.3) : refH * 0.3;
    const paraGap = Math.max(lineGap + refH * 0.5, refH * 0.75);

    const blocks = [];
    let cur = null;
    let prev = null;
    const flush = () => {
      if (!cur) return;
      if (cur.align === 'neutral') {
        // Full-width lines follow the column's style (a centered poster title).
        cur.align = (!leftAnchored && centerCands.length) ? 'center' : 'left';
      }
      blocks.push(cur.block());
      cur = null;
    };
    const displayText = (it) => {
      const t = it.text != null && it.text !== '' ? it.text : it.source;
      return it.bullet ? (stripBulletLead(t).trim() || t) : t;
    };
    const startBlock = (it, gapBefore) => {
      const kind = it.bullet ? 'bullet' : (it.heading ? 'heading' : 'para');
      const state = {
        kind,
        align: it.bullet ? 'left' : it.align,
        region: it.region,
        lines: [displayText(it)],
        first: it,
        heights: [it.h],
        minX0: it.x0,
        gapBefore
      };
      state.block = () => {
        const block = {
          align: state.align,
          lines: state.lines,
          kind: state.kind,
          region: state.region
        };
        if (state.gapBefore != null) block.gapBefore = Math.round(state.gapBefore * 100) / 100;
        if (state.kind === 'heading') {
          block.scale = Math.round(Math.min(1.6, Math.max(1.12, median(state.heights, refH) / refH)) * 100) / 100;
        }
        const indentPx = state.kind === 'bullet'
          ? Math.max(0, state.first.x0 - colLeft)
          : (state.align === 'left' ? Math.max(0, state.minX0 - colLeft) : 0);
        const indent = state.region === 'main' && indentPx > tol ? Math.min(0.4, indentPx / colW) : 0;
        if (indent) block.indent = Math.round(indent * 1000) / 1000;
        return block;
      };
      cur = state;
    };

    for (const it of items) {
      const gap = prev ? it.y0 - prev.y1 : null;
      if (!cur) {
        startBlock(it, null);
        prev = it;
        continue;
      }
      let breakHere = false;
      if (it.region !== cur.region) breakHere = true;
      else if (gap > paraGap) breakHere = true;
      else if (it.bullet) breakHere = true;
      else if (!!it.heading !== (cur.kind === 'heading')) breakHere = true;
      else if (cur.kind === 'bullet') {
        // Continuation lines hang under the bullet text.
        if (!(it.x0 > cur.first.x0 + refH * 0.4)) breakHere = true;
      } else if (it.align !== 'neutral' && cur.align !== 'neutral' && it.align !== cur.align) {
        breakHere = true;
      }
      if (breakHere) {
        flush();
        startBlock(it, gap == null ? null : Math.max(0, gap) / refH);
      } else {
        cur.lines.push(displayText(it));
        cur.heights.push(it.h);
        cur.minX0 = Math.min(cur.minX0, it.x0);
        if (cur.align === 'neutral' && it.align !== 'neutral') cur.align = it.align;
      }
      prev = it;
    }
    flush();

    return {
      blocks,
      column,
      textRects: items.map((it) => ({ x0: it.x0, y0: it.y0, x1: it.x1, y1: it.y1 })),
      refHeight: refH
    };
  }

  function groupOcrBoxes(boxes, imageWidth) {
    return layoutOcrBoxes(boxes, imageWidth).blocks;
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

  function clusterRects(rects, point, maxGap, maxYGap) {
    const items = (rects || []).map(asRect).filter((r) => r && r.width >= 2 && r.height >= 2);
    if (!items.length) return [];
    let gapLimit = 240;
    let yLimit = Infinity;
    if (maxGap && typeof maxGap === 'object') {
      if (Number.isFinite(maxGap.maxGap) && maxGap.maxGap > 0) gapLimit = maxGap.maxGap;
      if (Number.isFinite(maxGap.maxYGap) && maxGap.maxYGap > 0) yLimit = maxGap.maxYGap;
    } else {
      if (Number.isFinite(maxGap) && maxGap > 0) gapLimit = maxGap;
      if (Number.isFinite(maxYGap) && maxYGap > 0) yLimit = maxYGap;
    }
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
        const next = unused[i];
        const yGap = Math.max(0, Math.max(next.top, union.top) - Math.min(next.bottom, union.bottom));
        if (yGap > yLimit) continue;
        if (rectGap(next, union) <= gapLimit) {
          cluster.push(next);
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

  function focusRectAroundMouse(visible, mouse, panelH) {
    if (!mouse || !visible) return visible;
    const tall = visible.height > Math.max((panelH || 0) * 2, 120);
    if (!tall) return visible;
    const band = Math.max(40, Math.min(140, visible.height));
    let top = mouse.y - band / 2;
    let bottom = mouse.y + band / 2;
    if (mouse.y >= visible.top && mouse.y <= visible.bottom) {
      top = Math.max(visible.top, mouse.y - band / 2);
      bottom = Math.min(visible.bottom, mouse.y + band / 2);
    } else {
      const nearest = mouse.y < visible.top ? visible.top : visible.bottom;
      top = Math.max(visible.top, nearest - band / 2);
      bottom = Math.min(visible.bottom, nearest + band / 2);
    }
    if (bottom - top < 8) {
      bottom = Math.min(visible.bottom, top + 8);
      top = Math.max(visible.top, bottom - 8);
    }
    return {
      left: visible.left,
      top,
      width: visible.width,
      height: bottom - top,
      right: visible.right,
      bottom
    };
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
    const rawVisible = opts.sourceRect ? intersectRect(opts.sourceRect, viewport) : null;
    const visible = (prefer === 'right' || !mouse)
      ? rawVisible
      : focusRectAroundMouse(rawVisible, mouse, panelH);

    if (visible && visible.width >= 2 && visible.height >= 2) {
      const x0 = clamp(visible.left, margin).x;
      const below = { x: x0, y: visible.bottom + margin };
      const above = { x: x0, y: visible.top - panelH - margin };
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

  function overlapArea(a, b) {
    const r = intersectRect(a, b);
    return r ? r.width * r.height : 0;
  }

  // Place the image-translation panel beside the image without covering the
  // OCR text. measure(width) must return the panel height at that width.
  function pickImagePanelPlacement(options) {
    const opts = options || {};
    const margin = Number.isFinite(opts.margin) ? opts.margin : 8;
    const vw = Number(opts.vw) || 0;
    const vh = Number(opts.vh) || 0;
    const minW = Math.max(120, Number(opts.minW) || 260);
    const maxW = Math.max(minW, vw - margin * 2);
    const preferW = Math.min(maxW, Math.max(minW, Number(opts.preferW) || minW));
    const measure = typeof opts.measure === 'function' ? opts.measure : () => Number(opts.panelH) || 120;
    const viewport = { left: 0, top: 0, width: vw, height: vh, right: vw, bottom: vh };
    const image = asRect(opts.imageRect);
    const column = asRect(opts.columnRect) || image;
    const pad = 6;
    const texts = (opts.textRects || []).map(asRect).filter(Boolean).map((r) => ({
      left: r.left - pad,
      top: r.top - pad,
      width: r.width + pad * 2,
      height: r.height + pad * 2
    })).filter((r) => intersectRect(r, viewport));
    if (column && !texts.length) texts.push(column);
    const textTop = texts.length ? Math.min(...texts.map((r) => r.top)) : (column ? column.top : margin);
    const textBottom = texts.length ? Math.max(...texts.map((r) => r.top + r.height)) : (column ? column.bottom : margin);

    const widths = [preferW];
    const addW = (w) => {
      if (!Number.isFinite(w)) return;
      const v = Math.floor(Math.min(preferW, w));
      if (v >= minW && !widths.some((x) => Math.abs(x - v) < 8)) widths.push(v);
    };
    if (image) {
      addW(vw - image.right - margin * 2);
      addW(image.left - margin * 2);
    }
    if (column) {
      addW(vw - column.right - margin * 2);
      addW(column.left - margin * 2);
    }

    const clampX = (x, w) => Math.min(Math.max(margin, x), Math.max(margin, vw - w - margin));
    const clampY = (y, h) => Math.min(Math.max(margin, y), Math.max(margin, vh - h - margin));
    let best = null;
    for (const w of widths) {
      const rawH = Number(measure(w)) || 80;
      const h = Math.min(rawH, Math.max(40, vh - margin * 2));
      const xs = [];
      const ys = [];
      if (image) {
        xs.push(image.right + margin, image.left - w - margin);
        ys.push(image.top);
      }
      if (column) {
        xs.push(column.right + margin, column.left - w - margin, column.left);
        ys.push(column.top, column.bottom + margin, column.top - h - margin);
      }
      xs.push(margin, vw - w - margin);
      ys.push(textTop, textBottom + margin, textTop - h - margin, margin, vh - h - margin);
      for (const rx of xs) {
        for (const ry of ys) {
          const x = clampX(rx, w);
          const y = clampY(ry, h);
          const rect = { left: x, top: y, width: w, height: h };
          const area = Math.max(1, w * h);
          let textOv = 0;
          for (const t of texts) textOv += overlapArea(rect, t);
          const imgOv = image ? overlapArea(rect, image) : 0;
          const ref = column || image || { left: 0, top: 0, right: 0, bottom: 0 };
          const dx = Math.max(0, ref.left - (x + w), x - ref.right);
          const dy = Math.abs(y - Math.max(margin, Math.min(ref.top, vh - h - margin)));
          let cost = (textOv / area) * 100 + (imgOv / area) * 2;
          cost += ((preferW - w) / preferW) * 1.5;
          cost += (dx + dy * 0.5) / Math.max(1, vw + vh);
          if (image && x + w <= image.left + 0.5) cost += 0.05;
          if (!best || cost < best.cost - 1e-9) best = { x, y, width: w, height: h, cost, textOverlap: textOv, imageOverlap: imgOv };
        }
      }
    }
    if (!best) return { x: margin, y: margin, width: preferW, height: 0, cost: 0 };
    return best;
  }

  root.CITLayout = {
    normalizeAlign,
    inferAlignFromBox,
    inferAlignFromRects,
    groupOcrBoxes,
    layoutOcrBoxes,
    prepareOcrUnits,
    isNoiseText,
    stripBulletLead,
    pickImagePanelPlacement,
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
