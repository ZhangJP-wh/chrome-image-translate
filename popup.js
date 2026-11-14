'use strict';

const DEFAULT_ENGINES = { google: true, bing: true };

async function loadEngines() {
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

function updateHint(engines) {
  const hint = document.getElementById('menu-hint');
  if (!hint) return;
  if (engines.google && engines.bing) {
    hint.textContent = '两项都开时，右键会出现「翻译」二级菜单（这是 Chrome 的限制）。';
  } else if (engines.google) {
    hint.textContent = '当前只开谷歌翻译，它会直接出现在右键一级菜单里。';
  } else {
    hint.textContent = '当前只开必应翻译，它会直接出现在右键一级菜单里。';
  }
}

async function saveEngines(engines) {
  await chrome.storage.local.set({ engines });
  updateHint(engines);
}

document.addEventListener('DOMContentLoaded', async () => {
  const googleBox = document.getElementById('engine-google');
  const bingBox = document.getElementById('engine-bing');
  const engines = await loadEngines();
  googleBox.checked = engines.google;
  bingBox.checked = engines.bing;
  updateHint(engines);

  const onChange = async (event) => {
    const next = {
      google: googleBox.checked,
      bing: bingBox.checked
    };
    if (!next.google && !next.bing) {
      event.target.checked = true;
      return;
    }
    await saveEngines(next);
  };

  googleBox.addEventListener('change', onChange);
  bingBox.addEventListener('change', onChange);
  await maybeFocusSettings();
});

async function takeFocusFlag() {
  const areas = [];
  if (chrome.storage.session) areas.push(chrome.storage.session);
  areas.push(chrome.storage.local);
  for (const area of areas) {
    try {
      const data = await area.get('focusEngines');
      if (data && data.focusEngines) {
        await area.set({ focusEngines: false });
        return true;
      }
    } catch (_err) {
      // Try the next storage area.
    }
  }
  return location.hash === '#engines';
}

async function maybeFocusSettings() {
  const section = document.getElementById('engine-settings');
  if (!section) return;
  const shouldFocus = await takeFocusFlag();
  if (!shouldFocus) return;
  section.classList.add('focus-target');
  section.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const first = document.getElementById('engine-google');
  if (first) first.focus();
  setTimeout(() => section.classList.remove('focus-target'), 2400);
}

if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === 'session' || area === 'local') && changes.focusEngines && changes.focusEngines.newValue) {
      maybeFocusSettings();
    }
  });
}
