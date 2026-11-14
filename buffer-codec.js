/* 图片翻译 - JSON-safe binary helpers
 * Chrome extension messaging uses JSON (not structured clone) unless opted in
 * on very new Chrome versions, so ArrayBuffer arrives as {}.
 */
'use strict';

function citEncodeBuffer(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function citDecodeBuffer(base64) {
  if (!base64 || typeof base64 !== 'string') {
    throw new Error('无法读取这张图片');
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function citSniffMime(buffer) {
  const u = new Uint8Array(buffer);
  if (u.length >= 8 && u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) {
    return 'image/png';
  }
  if (u.length >= 3 && u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) {
    return 'image/jpeg';
  }
  if (u.length >= 6 && u[0] === 0x47 && u[1] === 0x49 && u[2] === 0x46) {
    return 'image/gif';
  }
  if (u.length >= 12 && u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46 &&
      u[8] === 0x57 && u[9] === 0x45 && u[10] === 0x42 && u[11] === 0x50) {
    return 'image/webp';
  }
  if (u.length >= 2 && u[0] === 0x42 && u[1] === 0x4d) {
    return 'image/bmp';
  }
  if (u.length >= 12) {
    const box = String.fromCharCode(u[4], u[5], u[6], u[7]);
    const brand = String.fromCharCode(u[8], u[9], u[10], u[11]);
    if (box === 'ftyp' && /^(avif|avis|mif1|msf1|heic|heif)$/.test(brand)) {
      return brand.startsWith('hei') ? 'image/heic' : 'image/avif';
    }
  }
  const head = Array.from(u.subarray(0, Math.min(u.length, 80)), (b) => String.fromCharCode(b))
    .join('')
    .trim()
    .toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    return 'text/html';
  }
  return 'application/octet-stream';
}
