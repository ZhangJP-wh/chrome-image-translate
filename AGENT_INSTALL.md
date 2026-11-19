# Agent install instructions / Agent 安装说明

If a user pastes https://github.com/ZhangJP-wh/chrome-image-translate and asks you to install this extension, follow this file.

若用户把上述仓库链接发给你并要求安装本扩展，请按本文件执行。

## Success criteria / 成功标准

- Extension loaded via “Load unpacked” / 「加载已解压的扩展程序」
- The extension named 「图片翻译」 appears in `chrome://extensions` (or `edge://extensions`)
- Toolbar icon visible (Google Translate product icon)
- Right-click a webpage **image** shows 「翻译」, which opens a submenu: 「谷歌翻译」 then 「必应翻译」
- Selecting text and right-clicking shows the same 「翻译」 submenu
- Site access / host permissions allowed if prompted
- Language rule: Simplified Chinese → English; anything else (including Japanese, Korean, Traditional Chinese, English) → Simplified Chinese

## Procedure / 步骤

1. Download ZIP from GitHub (**Code → Download ZIP**) or `git clone https://github.com/ZhangJP-wh/chrome-image-translate.git`
2. Unzip. Ensure `manifest.json` is at the **root** of the folder you will select (not inside an extra nested folder only).
3. Open `chrome://extensions` (Edge: `edge://extensions`). Enable **Developer mode**.
4. **Load unpacked** → select that folder.
5. Allow site access if Chrome asks.
6. Report done in the user’s language (Chinese or English).

## Constraints / 约束

- Same steps for macOS and Windows.
- Do **not** rewrite extension code unless install fails.
- Prefer ZIP download for non-technical users.
- Do **not** promise a new tab, a Chrome Web Store listing, or per-item context-menu icons (Chrome shows the extension icon beside the menu, and two engines appear as a submenu under 「翻译」).
- Do **not** put API keys, tokens, or secrets in chat, files, or the README. Users do not need to apply for a key to use 「谷歌翻译」 or 「必应翻译」.
- README / repo screenshots must use **fictional or redacted** demo content only — never real browsing history, private URLs/titles, or real account data.

## Optional smoke test / 可选冒烟

1. Open `demo/test-en-text.png` in a normal webpage (or drag the file into a tab), right-click the image → **翻译** → **谷歌翻译** or **必应翻译**. A draggable floating window should show the Simplified Chinese translation, sized to the content, without a fixed short box. Use **关闭** to dismiss it. Selecting Simplified Chinese text should translate it into English in the same kind of window.
2. On any ordinary webpage, select a short English paragraph (including one with a blank line between paragraphs) → right-click → **翻译** → either engine. A draggable floating window should appear next to the selection (not at the top of the browser window), show the Simplified Chinese translation, keep the original paragraph breaks and blank lines, and grow or shrink with the text, without covering the original or opening a new tab. Try more than one selection, including a longer passage; the window should stay next to the text and keep the line breaks each time. Selecting a Simplified Chinese sentence should translate it into English in the same window.
3. Open an image of a single-column letter or email (for example in a lightbox), translate it, and check that the window lines up with the text column: left-aligned lines stay left, headings are larger, bullets show as a list, and the window sits beside the image or in an empty area without covering the text. Scroll the page: the window should move with the content. Refresh the page, navigate away, close the image viewer, or press Esc: the window should close.
4. If Google Translate is unreachable (common on networks in mainland China), 「必应翻译」 should still work.
5. A Japanese (or other non-Simplified-Chinese) image should translate into Simplified Chinese, not English. A Simplified Chinese selection should still translate into English. The first image OCR in a profile may take several seconds, because the extension also loads Japanese and Korean packs and runs a short language probe.
