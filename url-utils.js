/* 图片翻译 - page URL access helpers (browser + node) */
(function (root) {
  'use strict';

  const MENU_DOCUMENT_URL_PATTERNS = ['http://*/*', 'https://*/*', 'file://*/*'];
  const FRIENDLY_RESTRICTED_PAGE =
    '此页面无法使用翻译。浏览器内部页、扩展页和 Chrome 网上应用店不能注入脚本，请到普通网页上再试。';

  const RESTRICTED_SCHEMES = new Set([
    'chrome:',
    'edge:',
    'about:',
    'devtools:',
    'view-source:',
    'chrome-extension:',
    'moz-extension:'
  ]);

  // about:blank / about:srcdoc iframes are common on ordinary http(s) pages
  // and are already covered by the content script's match_about_blank flag.
  const ALLOWED_ABOUT = new Set(['blank', 'srcdoc']);

  function normalizeUrl(url) {
    if (url == null) return '';
    return String(url).trim();
  }

  function parseUrl(raw) {
    if (!raw) return null;
    try {
      return new URL(raw);
    } catch (_err) {
      return null;
    }
  }

  function startsWithRestrictedScheme(raw) {
    const lower = String(raw || '').toLowerCase();
    for (const scheme of RESTRICTED_SCHEMES) {
      if (lower.startsWith(scheme)) return true;
    }
    return false;
  }

  function isChromeWebStore(parsed) {
    if (!parsed) return false;
    const host = String(parsed.hostname || '').toLowerCase();
    if (host === 'chromewebstore.google.com' || host.endsWith('.chromewebstore.google.com')) {
      return true;
    }
    if (host === 'chrome.google.com' || host.endsWith('.chrome.google.com')) {
      const path = String(parsed.pathname || '').toLowerCase();
      return path === '/webstore' || path.startsWith('/webstore/');
    }
    return false;
  }

  function isAllowedAboutUrl(parsed) {
    if (!parsed || parsed.protocol !== 'about:') return false;
    return ALLOWED_ABOUT.has(String(parsed.pathname || '').toLowerCase());
  }

  function isRestrictedUrl(url) {
    const raw = normalizeUrl(url);
    if (!raw) return false;
    const parsed = parseUrl(raw);
    if (!parsed) return startsWithRestrictedScheme(raw);
    const protocol = String(parsed.protocol || '').toLowerCase();
    if (protocol === 'about:' && isAllowedAboutUrl(parsed)) return false;
    if (RESTRICTED_SCHEMES.has(protocol)) return true;
    if (isChromeWebStore(parsed)) return true;
    return false;
  }

  function isInjectableUrl(url) {
    return !isRestrictedUrl(url);
  }

  function errorText(err) {
    if (err == null) return '';
    if (typeof err === 'string') return err;
    const parts = [];
    if (err.message) parts.push(String(err.message));
    if (err.name && err.name !== 'Error') parts.push(String(err.name));
    return parts.join(' ') || String(err);
  }

  function isRestrictedAccessError(err) {
    const text = errorText(err);
    if (!text) return false;
    if (/cannot access a [^\s]*url/i.test(text)) return true;
    if (/cannot access contents of url/i.test(text)) return true;
    if (/extensions gallery cannot be scripted/i.test(text)) return true;
    if (/cannot access.*(?:chrome|edge|about|devtools|view-source|chrome-extension|moz-extension):/i.test(text)) {
      return true;
    }
    return false;
  }

  const api = {
    MENU_DOCUMENT_URL_PATTERNS,
    FRIENDLY_RESTRICTED_PAGE,
    isRestrictedUrl,
    isInjectableUrl,
    isRestrictedAccessError,
    isChromeWebStore
  };

  root.CITUrl = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
