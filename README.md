# 图片翻译 / Image Translate

Chrome / Edge 扩展：在网页**图片**或**选中的文字**上右键「翻译」，可选「谷歌翻译」或「必应翻译」，把简体中文直接覆盖在原文对应位置。无法覆盖时，在当前页弹出译文，全程不打开新标签。

Chrome / Edge extension: right-click an **image** or **selected text** → **翻译** → **谷歌翻译** or **必应翻译**. Simplified Chinese is overlaid in place when possible; otherwise a popup appears on the same page. No new tab is opened.

**仓库 / Repo:** https://github.com/ZhangJP-wh/chrome-image-translate  
**版本 / Version:** **0.1.7**（见 `manifest.json`）

### 一句话场景 / What it’s for

- 看到带外文的图片，不必另开翻译网站，译文直接盖在原图对应文字上  
  Overlay Chinese on a foreign-language image without leaving the page
- 选中一段文字，同样在原句位置显示简体中文；盖不住时就在当前页弹窗  
  Select text and overlay Simplified Chinese, or use an on-page popup when an overlay is not possible
- 两种翻译服务可选：上面是「谷歌翻译」，下面是「必应翻译」  
  Two engines: **谷歌翻译** first, **必应翻译** below it
- 在中国大陆，谷歌翻译往往连不上；「必应翻译」通常可直接使用，也不用申请密钥  
  In mainland China, Google Translate is often unreachable; **必应翻译** usually works and needs no API key
- 用「显示原文 / 显示译文」切换，点「关闭」去掉覆盖层或弹窗  
  Toggle **显示原文 / 显示译文**, or click **关闭** to dismiss

示例图（虚构英文句子，不是真实网页截图）：

![示例：一句待翻译的英文，可用于试用图片翻译](demo/test-en-text.png)

> 说明：README 与仓库配图只用**脱敏或虚构**的演示内容，绝不放真实浏览记录、私人网址 / 标题或真实账号数据。  
> Note: README and repo images must use **fictional or redacted** demo content only — never real browsing history, private URLs/titles, or real account data.

## 给电脑小白：一分钟安装（Mac 和 Windows 相同）

## For beginners: 1-minute install (same on Mac & Windows)

1. 打开本仓库页面 → 点绿色 **Code** → **Download ZIP**  
   Open this repo → green **Code** → **Download ZIP**
2. 解压 zip，得到文件夹（里面应直接能看到 `manifest.json`）  
   Unzip; the folder must contain `manifest.json` at the top level
3. 浏览器地址栏打开：`chrome://extensions`（Edge 用 `edge://extensions`）  
   Open `chrome://extensions` (Edge: `edge://extensions`)
4. 打开右上角 **开发者模式 / Developer mode**
5. 点 **加载已解压的扩展程序 / Load unpacked** → 选中解压后的那个文件夹  
   Click **Load unpacked** → select the unzipped folder
6. 若提示读取网站数据，点 **允许 / Allow**  
   If asked for site access, click **Allow**

装好后：

- 在网页的**图片**上右键 → **翻译** → **谷歌翻译** 或 **必应翻译**
- 或先**选中一段文字**再右键 → **翻译** → 同样可选这两种服务
- 稍等片刻，简体中文会出现在原图文字或原句上方；如果选区无法覆盖，会在当前页弹出译文
- 用右上角的 **显示原文 / 显示译文** 切换，点 **关闭** 可去掉覆盖层或弹窗
- 点工具栏上的扩展图标，可以勾选要显示的翻译服务：只开一项时，该项会出现在右键一级菜单；两项都开时，会出现「翻译」二级菜单（这是 Chrome 的限制）
- 仓库里的 `demo/test-en-text.png` 是一张虚构英文示例图，可以放到任意普通网页里用来试用图片翻译

Then:

- Right-click an **image** → **翻译** → **谷歌翻译** or **必应翻译**
- Or **select text**, then right-click → the same submenu
- Stay on the same page; Chinese covers the corresponding regions when possible, otherwise an on-page popup appears
- Toggle **显示原文 / 显示译文**, or click **关闭**
- Click the toolbar icon to choose which engines appear in the context menu, and to reread the short usage reminder
- Try image translation with `demo/test-en-text.png` (a fictional English sentence, not a real webpage screenshot)

若你是从已经解压好的文件夹加载的（例如本机迭代安装），改完文件后只需到 `chrome://extensions` 点「重新加载」，不必再下载一次。  
If it is already loaded unpacked from a local folder, click **Reload** on `chrome://extensions` after updates; you do not need to download again.

本扩展以解压加载的方式提供，暂未上架 Chrome 网上应用店。  
This extension is provided as a Load unpacked package and is not on the Chrome Web Store yet.

---

## 给 AI Agent：把下面整段复制发给你的 Agent（安装指令）

## For AI Agents: paste this block to your Agent

把下面整段（含链接）发给 Cursor / Grok / ChatGPT 等任意能操作本机的 Agent：

Copy everything below (including the URL) to any Agent that can operate the user’s computer:

```text
Please install this Chrome/Edge extension for me from:
https://github.com/ZhangJP-wh/chrome-image-translate

Goal: load the unpacked extension so I can use “图片翻译 / Image Translate”.

Steps (do them for me; Mac and Windows are the same flow):
1. Download the repo ZIP from GitHub (Code → Download ZIP), or clone the repo.
2. Unzip if needed. The folder must contain manifest.json at the top level (not nested oddly).
3. Open chrome://extensions (or edge://extensions). Enable Developer mode.
4. Click “Load unpacked” / “加载已解压的扩展程序” and select that folder.
5. If Chrome asks for site access / host permissions, allow it.
6. Confirm the extension appears as 「图片翻译」 and the toolbar icon works.

Do not rewrite the extension code unless install fails. Prefer the ZIP download path for non-technical users.
When done, tell me briefly that it is installed and how to:
- right-click an image → 翻译 → 谷歌翻译 or 必应翻译
- select text, then right-click → 翻译 → the same two options
- use 显示原文 / 显示译文 and 关闭
```

仓库里也有独立文件 [`AGENT_INSTALL.md`](./AGENT_INSTALL.md)，Agent 可直接按该文件执行。  
See also [`AGENT_INSTALL.md`](./AGENT_INSTALL.md).

---

## 功能 / Features

| 中文 | English |
|------|---------|
| 在网页**图片**上右键 → **翻译** → **谷歌翻译** 或 **必应翻译** | Right-click an **image** → **翻译** → **谷歌翻译** or **必应翻译** |
| 选中文字后右键，菜单相同，两种服务都可用 | The same submenu works for **selected text**, with both engines |
| 图片：本地识别文字位置，把简体中文覆盖在原图对应区域 | Images: local OCR, then Simplified Chinese over the matching regions |
| 选中文字：尽量把译文覆盖在原句上；无法覆盖时改为页面内弹窗 | Selection: overlay on the original sentence when possible; otherwise an on-page popup |
| 目标语言固定为简体中文，与原文是哪种语言无关 | Always translates into Simplified Chinese, regardless of the source language |
| 覆盖层可「显示原文 / 显示译文」，或点「关闭」去掉 | Overlay/popup can toggle source/translation, or be dismissed with **关闭** |
| 全程留在当前页，不打开新标签 | Stays on the current page; no new tab |
| 「必应翻译」排在「谷歌翻译」下面，面向中国大陆等谷歌可能无法访问的网络，无需申请密钥 | **必应翻译** sits below **谷歌翻译** for networks where Google is unreachable (e.g. mainland China); no API key to apply for |
| 图片识别（OCR）在本地完成，不依赖 CDN；选中文字不经过 OCR | Image OCR runs locally with no CDN; selected text skips OCR |
| 点工具栏图标可勾选显示「谷歌翻译」「必应翻译」或两项都显示。只开一项时出现在右键一级菜单；两项都开时收成「翻译」子菜单，并多一行提示可在设置里只勾选一项；点击该行会打开设置页并定位到勾选项 | In the toolbar popup, choose Google, Bing, or both. One engine appears as a top-level item; both are grouped under a **翻译** submenu, whose hint row opens the settings page and focuses the engine checkboxes |
| 菜单前的图标使用谷歌翻译产品图标（Chrome 会把扩展图标显示在右键菜单旁） | Menu uses the Google Translate product icon (Chrome shows the extension icon beside the item) |
| 自带虚构英文示例图 `demo/test-en-text.png`，方便试用图片翻译 | Ships a fictional English demo image `demo/test-en-text.png` for trying image translation |

---

## 使用说明 / How it works

扩展会在本地识别图片中的文字位置，再按你选的服务把句子译成简体中文，并按原位置覆盖上去。选中网页文字时不经过识别，直接翻译，并尽量覆盖在原句位置。无论原文是什么语言，目标语言都是简体中文。

The extension finds text regions in an image locally, translates those lines into Simplified Chinese with the engine you picked, and overlays the result. Selected page text is translated directly (no OCR) and overlaid on the original sentence when possible.

默认情况下，图片和选中文字共用同一个「翻译」菜单：点开后先是「谷歌翻译」，下面是「必应翻译」。也可以在工具栏弹出页里只勾选其中一项，这时该项会直接出现在右键一级菜单，不再经过二级菜单。前者走 Google 翻译，在中国大陆往往需要可访问 Google 的网络；后者走必应翻译的公开网页通道（通常会落到 `cn.bing.com`），在中国大陆一般可直接使用，也不需要用户自己申请密钥。

By default, images and selected text share one **翻译** submenu: **谷歌翻译** first, then **必应翻译**. In the toolbar popup you can enable only one engine, which then appears as a top-level context-menu item with no submenu. Google Translate usually needs a network that can reach Google. Bing uses the public translator page (often `cn.bing.com`) and typically works in mainland China without an API key.

部分网站（例如 X）会在打开右键菜单时清掉选区。扩展会在右键按下时立刻记下选中的文字和位置，因此一般仍可翻译。输入框、文本域和下拉框里的选中文字会以弹窗显示译文，而不是改写输入框本身。

Some sites (such as X) clear the selection when the context menu opens. The extension snapshots the selected text and its position on right-click, so translation still usually works. Text selected inside an input, textarea, or dropdown is shown in an on-page popup rather than overwriting the control.

---

## 已知限制 / Limits

- 对比较清晰的印刷体或截图效果最好；手写、艺术字、很小或很糊的字可能识别不准，或提示「未识别到文字」。  
  Works best on clear print or screenshots. Handwriting, stylized, tiny, or blurry text may be missed or misread.
- 第一次在某个浏览器配置里翻译图片时，可能要几秒来加载本地识别组件。  
  The first image translation in a browser profile may take a few seconds to load the local OCR engine.
- 翻译需要联网。「谷歌翻译」会访问 Google 翻译，在中国大陆通常不可用。「必应翻译」走必应的公开翻译页面，在中国大陆一般可直接使用；这不是微软官方开放的长期 API，若对方改页面，此选项可能暂时失效，需要更新扩展。  
  Translation needs a network. **谷歌翻译** is usually unavailable in mainland China. **必应翻译** uses Bing’s public translator page and typically works there, but it is not a guaranteed official long-term API; if Microsoft changes the page, this option may break until the extension is updated.
- 当前版本的图片翻译主要支持普通网页里的 `<img>` 图片（含跨域，以及 `blob:` / `data:` 图片）。复杂的画布或纯 CSS 背景图暂未专门处理。  
  Image translation currently targets ordinary `<img>` elements (including cross-origin, `blob:`, and `data:` images). Canvas and pure CSS background images are not specially handled yet.
- 预置的识别语言模型以英语为主，其他语言也可能认出一部分，但效果会差一些。  
  The bundled OCR language pack is mainly English; other languages may be partially recognized, with lower accuracy.
- 选中文字会尽量覆盖在原句位置。若选区丢失、无法取得位置、位于输入框 / 文本域 / 下拉框中，或页面无法承载覆盖层，会在当前页弹出译文，而不会打开新标签。  
  Selection overlay falls back to an on-page popup when the selection is lost, has no usable position, is inside an input / textarea / dropdown, or the page cannot host an overlay. It will not open a new tab.
- Chrome 内置 PDF 阅读器通常无法注入扩展脚本，因此 PDF 里的选中文字可能无法翻译。  
  Chrome’s built-in PDF viewer usually cannot run the content script, so selected text in a PDF may not translate.
- 选中文字里的空行不会再送给会因此报错的翻译接口。引用卡片、嵌套内容里若段落之间有空行，也可以正常翻译。  
  Blank lines in a selection are not sent to engines that reject empty strings, so quoted or nested cards with paragraph breaks still translate.
- 若页面在右键之后大范围重绘，覆盖层可能改为就近弹窗。  
  If the page heavily redraws after the right-click, the overlay may become a nearby popup.
- Chrome 不能给同一个扩展同时放两个一级右键项：只要两项都开，就会被收成「翻译」子菜单。只开其中一项时，该项可以直接出现在一级菜单。  
  Chrome will not show two top-level context-menu items from one extension at once, so enabling both engines creates a **翻译** submenu. Enabling only one places that item at the top level.
- Chrome 不能给右键菜单的每一项单独设图标，菜单旁显示的是扩展图标。  
  Chrome cannot set a distinct icon on each context-menu item; it shows the extension icon beside the item.
- 百度、有道等官方翻译接口需要用户自己申请密钥，因此没有写进这个公开项目。  
  Official APIs such as Baidu or Youdao require a user-issued key, so they are not bundled in this public project.

---

## 系统要求 / Requirements

- Google Chrome 或 Microsoft Edge（Chromium）最新稳定版  
  Latest stable Chrome or Edge (Chromium)
- macOS、Windows、Linux 均可（同一套文件）  
  Works on macOS, Windows, and Linux (same files)
- 「谷歌翻译」需要能访问 Google 的网络；「必应翻译」在中国大陆一般可直接使用  
  **谷歌翻译** needs a network that can reach Google; **必应翻译** usually works in mainland China

不需要编译、不需要 Node、不需要命令行，也不需要自己申请翻译密钥。  
No build, no Node, no command line, and no translation API key to apply for.

---

## 手动开发加载（给会改代码的人）

## Dev load (for people who edit code)

```bash
git clone https://github.com/ZhangJP-wh/chrome-image-translate.git
```

然后在 `chrome://extensions` → 开发者模式 → 加载已解压 → 选仓库根目录（能直接看到 `manifest.json`）。  
Then Load unpacked → select the repo root (the folder that contains `manifest.json`).

改完代码后点 **重新加载**。  
After edits, click **Reload**.

---

## 隐私 / Privacy

本扩展不要求登录，也不收集分析数据。图片文字识别在本地完成；选中的文字或识别出的句子会发送到你所选的翻译服务（Google 或必应）以获取译文。扩展本身不会把这些内容上传到本仓库作者的服务器。你在弹出页勾选的翻译服务选项只保存在本机 `chrome.storage.local`。

The extension does not require an account and does not collect analytics. Image OCR runs on your computer. Selected text or recognized lines are sent to the translation service you choose (Google or Bing) to obtain a translation. This project does not upload that content to a server run by the repo author. The engine checkboxes in the popup are stored only in local `chrome.storage.local`.

README / 仓库配图勿使用真实浏览记录、私人网址或真实账号数据；演示图须脱敏或虚构。仓库中的 `demo/test-en-text.png` 是一句虚构英文，仅供试用。

Do not use real browsing history, private URLs, or real account data in README/repo screenshots; demos must be redacted or fictional. `demo/test-en-text.png` is a made-up English sentence for trying the feature.

---

## 变更 / Changelog

### v0.1.7

- 点击二级菜单里的提示行，会打开扩展设置页并高亮「右键菜单里显示」的勾选项  
  Clicking the submenu hint opens the extension settings page and highlights the engine checkboxes

### v0.1.6

- 两项都开、出现「翻译」二级菜单时，第三行会提示：可在扩展设置里只勾选一项来去掉二级菜单；点击该行会打开设置页并定位到勾选项  
  When both engines are on and the **翻译** submenu appears, a third row explains that enabling only one engine in settings removes the submenu. Clicking the row opens the settings page and focuses those checkboxes

### v0.1.5

- 可在工具栏弹出页勾选要显示的翻译服务。只开「谷歌翻译」或只开「必应翻译」时，该项会出现在右键一级菜单，没有二级菜单；两项都开时仍是「翻译」子菜单（Chrome 限制）  
  The toolbar popup can show Google, Bing, or both. A single engine appears as a top-level context-menu item; enabling both still uses a **翻译** submenu (a Chrome limit)

### v0.1.4

- 右键「翻译」展开为子菜单：上面是「谷歌翻译」，下面新增「必应翻译」。图片翻译和选中文字翻译都可以选用  
  The **翻译** menu is now a submenu: **谷歌翻译** first, then **必应翻译**. Both image and selected-text translation can use either engine
- 「必应翻译」走必应公开翻译页面（`https://www.bing.com/translator`，必要时回退到 `https://cn.bing.com/translator`），在中国大陆通常可直接使用，无需申请密钥  
  **必应翻译** uses the public Bing Translator page (`https://www.bing.com/translator`, falling back to `https://cn.bing.com/translator`); it usually works in mainland China and needs no API key

### v0.1.3

- 修复选中多段文字（含空行）时出现「翻译服务暂时不可用（400）」：空行不再送给会因此报错的接口，段落之间的空行仍会保留  
  Fixed 「翻译服务暂时不可用（400）」 on multi-paragraph selections with blank lines. Empty lines are not sent to the engine that rejected them; paragraph breaks are preserved
- 加强选中文字的采集，引用卡片、嵌套内容里的选区更容易被记住  
  Hardened selection capture so quoted / nested content is more reliably remembered

### v0.1.2

- 支持选中文字后右键「翻译」：尽量把简体中文覆盖在原句位置；无法覆盖时在当前页弹窗，不打开新标签  
  Added right-click **翻译** for selected text: overlay Simplified Chinese in place when possible, otherwise an on-page popup, no new tab

### v0.1.1

- 修复部分页面（例如 X 的图片查看器）提示「无法解码图片」  
  Fixed 「无法解码图片」 on some pages (for example X’s photo viewer)

### v0.1.0

- 第一版：在网页图片上右键「翻译」，本地识别文字后把简体中文覆盖在原图对应位置，可切换原文 / 译文或关闭  
  First release: right-click **翻译** on a webpage image, run local OCR, and overlay Simplified Chinese on the matching regions, with source/translation toggle and dismiss

---

## License

MIT
