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

1. Open `demo/test-en-text.png` in a normal webpage (or drag the file into a tab), right-click the image → **翻译** → **谷歌翻译** or **必应翻译**. Simplified Chinese should overlay the English sentence on the image. Use **显示原文 / 显示译文** and **关闭**.
2. On any ordinary webpage, select a short English paragraph (including one with a blank line between paragraphs) → right-click → **翻译** → either engine. The translation should overlay the original text, or appear as an on-page popup if an overlay is not possible. No new tab should open.
3. If Google Translate is unreachable (common on networks in mainland China), 「必应翻译」 should still work.
