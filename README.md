# 图片翻译

在 Chrome / Edge 里给网页图片加上右键「翻译」：识别图中的文字，并把简体中文直接覆盖在原图对应位置，无需跳转或打开新标签页。

Right-click an image → **翻译**, and Simplified Chinese is overlaid on the original picture in place.

菜单项前面的图标使用谷歌翻译的产品图标（Chrome 会把扩展图标显示在右键菜单项旁边）。

**仓库 / Repo:** https://github.com/ZhangJP-wh/chrome-image-translate  
**版本 / Version:** 0.1.0（见 `manifest.json`）

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
- 稍等片刻，简体中文会出现在原图文字上方
- 用图片右上角的 **显示原文 / 显示译文** 切换，点 **关闭** 可去掉覆盖层
- 点工具栏上的扩展图标，也可以再看一遍简要用法

Then: right-click an image → **翻译**. Stay on the same page; Chinese text covers the corresponding regions.

文件夹里有一张英文示例图 `demo/test-en-text.png`（虚构句子，不是真实网页截图），可以放到任意普通网页里用来试用。

## 使用说明 / How it works

扩展会在本地识别图片中的文字位置，再把这些句子翻译成简体中文，然后按原位置覆盖上去。无论原文是什么语言，目标语言都是简体中文。

```text
网页上的图片
    │  右键 →「翻译」
    ▼
content.js                 取出这张图片
    │
    ▼
background.js              安排识别和翻译
    │                    │
    ▼                    ▼
offscreen + Tesseract.js   Google translate-pa
本地识别文字和位置          把句子译成简体中文
（图片不上传）
    │                    │
    └─────────┬──────────┘
              ▼
content.js             按原位置把译文盖在图上
                       （可切换原文，或关闭）
```

翻译请求使用的是谷歌翻译网页库里公开的 `te_lib` 客户端标识，写在 `background.js` 的 `TRANSLATE_API_KEY`。这是公开客户端标识，不是个人密钥；没有它，扩展无法翻译。文字识别在本地完成。

## 已知限制 / Limits

- 对比较清晰的印刷体或截图效果最好；手写、艺术字、很小或很糊的字可能识别不准，或提示「未识别到文字」。
- 第一次在某个浏览器配置里翻译时，可能要几秒来加载本地识别组件。
- 翻译需要联网访问 Google 翻译。识别（OCR）在本地完成，不依赖 CDN。
- 当前版本主要支持普通网页里的 `<img>` 图片（含跨域、以及 `blob:` / `data:` 图片）。复杂的画布或纯 CSS 背景图暂未专门处理。
- 预置的识别语言模型以英语为主，其他语言也可能认出一部分，但效果会差一些。

本扩展以解压加载的方式提供，暂未上架 Chrome 网上应用店。

## 许可 / License

MIT，版权 ZhangJP-wh。见 [`LICENSE`](./LICENSE)。
