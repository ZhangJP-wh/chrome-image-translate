# 图片翻译

在 Chrome / Edge 里给网页图片或选中的文字加上右键「翻译」：图片会识别其中的文字并把简体中文直接覆盖在原图对应位置；选中的文字会尽量把简体中文覆盖在原句位置，如果页面无法承载覆盖层，则在当前页弹出译文。全程无需跳转或打开新标签页。

Right-click an image or selected text → **翻译**. Simplified Chinese is overlaid in place when possible; otherwise a popup appears on the same page.

菜单项前面的图标使用谷歌翻译的产品图标（Chrome 会把扩展图标显示在右键菜单项旁边）。

**仓库 / Repo:** https://github.com/ZhangJP-wh/chrome-image-translate  
**版本 / Version:** 0.1.3（见 `manifest.json`）

## 给电脑小白：一分钟安装（Mac 和 Windows 相同）

## For beginners: 1-minute install (same on Mac & Windows)

1. 打开上面的仓库页面，点绿色 **Code** → **Download ZIP**，再解压。解压后的文件夹里应直接能看到 `manifest.json`（不要多套一层目录）  
   Open the repo → green **Code** → **Download ZIP**, then unzip. `manifest.json` must sit at the top of that folder.
2. 浏览器地址栏打开：`chrome://extensions`（Edge 用 `edge://extensions`）  
   Open `chrome://extensions` (Edge: `edge://extensions`)
3. 打开右上角 **开发者模式 / Developer mode**
4. 点 **加载已解压的扩展程序 / Load unpacked** → 选中包含 `manifest.json` 的这个文件夹  
   Click **Load unpacked** → select the folder that contains `manifest.json`
5. 若提示读取网站数据，点 **允许 / Allow**  
   If asked for site access, click **Allow**

不需要安装 Node，也不需要编译。  
No Node install and no build step.

装好后：

- 在网页的**图片**上右键 → **翻译**
- 或先**选中一段文字**再右键 → **翻译**
- 稍等片刻，简体中文会出现在原图文字或原句上方；如果选区无法覆盖，会在当前页弹出译文
- 用右上角的 **显示原文 / 显示译文** 切换，点 **关闭** 可去掉覆盖层或弹窗
- 点工具栏上的扩展图标，也可以再看一遍简要用法

Then: right-click an image or selected text → **翻译**. Stay on the same page; Chinese text covers the corresponding regions when possible.

文件夹里有一张英文示例图 `demo/test-en-text.png`（虚构句子，不是真实网页截图），可以放到任意普通网页里用来试用图片翻译。选中文字的翻译可在任意普通网页上直接试用。

## 使用说明 / How it works

扩展会在本地识别图片中的文字位置，再把这些句子翻译成简体中文，然后按原位置覆盖上去。选中网页文字时不经过识别，直接翻译成简体中文，并尽量覆盖在原句位置。无论原文是什么语言，目标语言都是简体中文。图片和选中文字共用同一个右键菜单项「翻译」。

```text
右键「翻译」（图片或选中的文字，同一个菜单项）
    │
    ├── 图片
    │     content.js 取出图片
    │         │
    │         ▼
    │     background.js
    │         │                    │
    │         ▼                    ▼
    │     offscreen + Tesseract.js  Google translate-pa
    │     本地识别文字和位置          把句子译成简体中文
    │     （图片不上传）
    │         │                    │
    │         └─────────┬──────────┘
    │                   ▼
    │     content.js 按原位置把译文盖在图上
    │
    └── 选中的文字（不经过 OCR）
          background.js → Google translate-pa（译成简体中文）
                   │
                   ▼
          尽量盖在原句上；放不下时在当前页弹出译文
                       （可切换原文，或关闭）
```

翻译请求使用的是谷歌翻译网页库里公开的 `te_lib` 客户端标识，写在 `background.js` 的 `TRANSLATE_API_KEY`。这是公开客户端标识，不是个人密钥；没有它，扩展无法翻译。图片的文字识别在本地完成。

## 已知限制 / Limits

- 对比较清晰的印刷体或截图效果最好；手写、艺术字、很小或很糊的字可能识别不准，或提示「未识别到文字」。
- 第一次在某个浏览器配置里翻译图片时，可能要几秒来加载本地识别组件。
- 翻译需要联网访问 Google 翻译。图片识别（OCR）在本地完成，不依赖 CDN；选中文字不经过 OCR。
- 当前版本的图片翻译主要支持普通网页里的 `<img>` 图片（含跨域、以及 `blob:` / `data:` 图片）。复杂的画布或纯 CSS 背景图暂未专门处理。
- 预置的识别语言模型以英语为主，其他语言也可能认出一部分，但效果会差一些。
- 选中文字会尽量覆盖在原句位置。若选区丢失、无法取得位置、位于输入框 / 文本域 / 下拉框中，或页面无法承载覆盖层，会在当前页弹出译文，而不会打开新标签。
- Chrome 内置 PDF 阅读器通常无法注入扩展脚本，因此 PDF 里的选中文字可能无法翻译。
- 选中文字里的空行不会再送给翻译接口（该接口遇到空字符串会返回 400）。引用卡片、嵌套内容里若段落之间有空行，也可以正常翻译。
- 部分网站（例如 X）会在打开右键菜单时清掉选区。扩展会在右键按下时立刻记下选中的文字和位置，因此一般仍可翻译；若页面随后大范围重绘，覆盖层可能改为就近弹窗。

本扩展以解压加载的方式提供，暂未上架 Chrome 网上应用店。

## 许可 / License

MIT，版权 ZhangJP-wh。见 [`LICENSE`](./LICENSE)。
