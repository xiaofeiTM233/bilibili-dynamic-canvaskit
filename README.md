# bilibili-dynamic-canvaskit

bilibili-dynamic-canvaskit 是一个渲染 B 站动态卡片的库。引擎基于 Skia 官方 WASM 构建的 CanvasKit：标题与描述由 Skia Paragraph 排版，正文采用逐字符换行算法，Emoji 支持 twemoji 贴图或彩色字体混排。覆盖全部动态主体——九宫格、视频、专栏、音乐、番剧、直播预约等，以及扫描渐变描边、粉丝卡片与二维码装饰。纯 CPU 渲染，单张卡片毫秒级出图；分辨率、主题色、字体、角标均可配置，适合机器人推送、消息卡片生成等高频场景。

本项目移植自 [`bilibili-dynamic-mirai-plugin`](https://github.com/Colter23/bilibili-dynamic-mirai-plugin) v3 绘图层（Kotlin + skiko）：选用同引擎的 CanvasKit，排版与字体栅格化行为和原版一致，绘制逻辑逐行对齐，以保证断行位置与卡片视觉逼近原插件输出。

## 安装

```bash
npm install
npx tsc        # 编译到 dist/
```

依赖：

| 包 | 用途 |
| --- | --- |
| `canvaskit-wasm` | Skia 渲染引擎（含 Paragraph），自带 ICU，CJK/Emoji 自动断行 |
| `@resvg/resvg-js` | SVG 图标渲染（对应原实现的 SVGDOM） |
| `qrcode` | 动态链接二维码装饰 |

## 快速开始

```typescript
import {
  initCanvasKit, createRuntime,
  drawAuthorGeneral, drawModuleDynamic,
  assembleCard, composeDynamicCard, colorFromHex,
} from 'bilibili-dynamic-canvaskit';

const ck = await initCanvasKit();

// 1. 创建运行时（字体必须显式提供，见下文「字体配置」）
const rt = await createRuntime(ck, {
  fontBuffers: [fs.readFileSync('assets/font/LXGWWenKai-Bold.ttf')],
});

// 2. 绘制作者区
const authorImg = await drawAuthorGeneral(
  rt,
  { name: 'UP主', mid: 2, face: 'https://i0.hdslb.com/xxx.jpg', pendant: null, verifyType: null },
  '2026-09-03 22:00',                       // 格式化时间
  'https://t.bilibili.com/123',             // 动态链接（二维码装饰用）
  colorFromHex('#d3edfa'),                  // 主题色
  verifyIcon ?? null,                       // 认证角标图（可选）
);

// 3. 绘制模块（正文 / 话题 / 九宫格 / 视频卡 / 附加卡片，按传入结构自动编排）
const moduleImages = await drawModuleDynamic(rt, {
  desc: { text: '动态正文……', richTextNodes: [{ type: 'RICH_TEXT_NODE_TYPE_TEXT', text: '动态正文……' }] },
  major: { type: 'MAJOR_TYPE_DRAW', draw: { items: [{ width: 800, height: 800, src: 'https://...' }] } },
});

// 4. 组装卡片 + 渐变底图，输出 PNG
const card = assembleCard(rt, [authorImg, ...moduleImages], { id: '123' });
const final = composeDynamicCard(rt, card, [colorFromHex('#d3edfa')]);
fs.writeFileSync('card.png', final.encodeToBytes());
```

快捷封装（作者区 + 模块 + 组装一步完成）：`renderDynamicCard(options)`，见 `src/index.ts`。

---

## 字体配置

字体通过 `createRuntime(ck, options)` 的 `RuntimeOptions` 传入。**未提供 `fontBuffers` 时自动下载默认字体**：检测字体目录（默认 `<cwd>/font`，可用 `fontDir` 指定）中是否存在 `LXGWWenKai-Medium.ttf`，不存在则按「霞鹜文楷官方仓库直链 → GitHub 加速代理」顺序逐源下载，已有则直接使用；全部失败时报错并提示手动放置。

```typescript
const rt = await createRuntime(ck, {
  // [必填其一] 正文字体文件，作用于正文 / 标题 / 描述 / 角标全部文本
  fontBuffers: [readFileSync('xxx.ttf')],      // Uint8Array[]，支持多个字体文件
  // [可选] 主字体族名；不传时取 fontBuffers 中第一个字体的族名
  mainFontFamily: 'LXGW WenKai',
  // [可选] Emoji 字体（如 Noto Color Emoji.ttf）
  // 提供 → emoji 用该字体绘制；不提供 → emoji 走 twemoji CDN 贴图（默认行为，推荐）
  emojiFontBuffer: null,
  // [可选] 粉丝卡片数字字体；不提供则粉丝数字不绘制
  // 项目 assets/font/FansCard.ttf 即原插件内置的同款字体，直接读取使用即可
  fansCardFontBuffer: readFileSync('assets/font/FansCard.ttf'),
});
```

**字体选择建议**：

| 字体 | 说明 |
| --- | --- |
| 霞鹜文楷 (LXGW WenKai) | 默认自动下载 `LXGWWenKai-Medium.ttf`（官方当前最粗字重；Bold 仅存在于旧版打包，官方已不再提供） |
| HarmonyOS Sans SC | 有 Bold 字重，HarmonyOS Design 资源页下载 |
| SimHei（黑体） | Windows 系统自带 `C:\Windows\Fonts\simhei.ttf`，零成本可用 |

注意事项：

1. 正文字体必须包含 CJK 字形，否则中文显示为方框；
2. emoji 贴图走 `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/`；离线环境请提供 `emojiFontBuffer`；
3. `fansCardFontBuffer` / `emojiFontBuffer` 直接从字节创建 Typeface，**不要求字体文件内部族名与文件名一致**；`mainFontFamily` 则是按族名匹配，留空即可（自动取第一个字体）。

## 绘图配置 ImageConfig

对应原插件 `BiliConfig.yml → imageConfig`，传入 `createRuntime(ck, { imageConfig })`：

```typescript
{
  quality: '1000w',        // 图片宽度档位：800w | 1000w | 1200w | 1500w
  theme: 'v3',             // 主题：v3 | v3RainbowOutline | v2
  defaultColor: '#d3edfa', // 主题色。支持分号分隔多色自定义渐变，如 '#ff0000;#0000ff'
                           // 单值时按 colorGenerator 自动生成三阶渐变（与原插件一致）
  cardOrnament: 'FanCard', // 卡片装饰：FanCard(粉丝卡片) | QrCode(动态链接二维码) | None
  colorGenerator: {
    hueStep: 30,           // 渐变色相步长（度）
    lockSB: true,          // 锁定饱和度/亮度
    saturation: 0.25,
    brightness: 1,
  },
  badgeEnable: { left: true, right: false },  // 卡片顶部角标开关
}
```

说明：原配置中的 `font` 字段在 CanvasKit 版中由 `RuntimeOptions.fontBuffers` 承担，`ImageConfig.font` 不再生效。

## 分辨率配置 Quality

四档内置参数与原插件 `ImageQuality.yml` 逐项一致（卡片边距、各层级字号、头像/挂件尺寸、行距等 25 项），见 `src/config/quality.ts` 的 `QUALITY_PRESETS`。

自定义分辨率：修改 `QUALITY_PRESETS` 后调用 `resolveQuality(key, badgeEnable)`，或直接以对象传入运行时相关函数。注意：原插件在角标关闭时会把 `badgeHeight` 置 0，`resolveQuality` 已还原该副作用。

## 主题配置 Theme

三套内置主题见 `src/config/theme.ts` 的 `THEME_PRESETS`（v3 为新版默认）。自定义主题示例：

```typescript
import { THEME_PRESETS } from 'bilibili-dynamic-canvaskit';

THEME_PRESETS['myTheme'] = {
  cardBgColorHex: '#B4FFFFFF',       // 卡片半透明白底
  cardOutlineColorHex: '#FFFFFF',    // 描边色，支持 '#f00;#0f0;#00f' 多色扫描渐变
  faceOutlineColorHex: '#A0FFFFFF',  // 头像描边
  drawOutlineColorHex: '#FFFFFF',    // 九宫格描边
  nameColorHex: '#FB7299',           // UP主名
  titleColorHex: '#313131',          // 标题
  subTitleColorHex: '#9C9C9C',
  descColorHex: '#666666',
  contentColorHex: '#222222',        // 正文
  linkColorHex: '#178BCF',           // 链接/话题
  footerColorHex: '#9C9C9C',
  cardShadow: { shadowColorHex: '#46000000', offsetX: 6, offsetY: 6, blur: 25, spread: 0 },
  smallCardShadow: { shadowColorHex: '#1E000000', offsetX: 5, offsetY: 5, blur: 15, spread: 0 },
  mainLeftBadge: { fontColorHex: '#00CBFF', bgColorHex: '#B4FFFFFF' },
  mainRightBadge: { fontColorHex: '#FFFFFF', bgColorHex: '#48C7F0' },
  subLeftBadge: { fontColorHex: '#FFFFFF', bgColorHex: '#FB7299' },
  subRightBadge: { fontColorHex: '#FFFFFF', bgColorHex: '#48C7F0' },
};
// 使用：imageConfig.theme = 'myTheme'
```

颜色格式统一为 `#RRGGBB` 或 `#AARRGGBB`。

## 图片加载

`ImageStore` 负责头像/封面/Emoji 等远程图片的下载与内存缓存，三级降级：原图 → `imgApi` 缩略图 → 占位图。

```typescript
// 通过 RuntimeOptions 配置
{
  downloadOriginal: true,   // 是否请求原图（对应原插件 cacheConfig.downloadOriginal）
  headers: {                // B 站图床需要 Referer，默认已内置 UA + Referer
    Referer: 'https://www.bilibili.com/',
  },
}
```

其他能力：`store.get(url)`（失败返回 null）、`store.register(url, image)`（注入已持有的图片，用于离线/演示）、`store.dispose()`（释放全部缓存；注意缓存中的图片不可手动 delete）。

## API 一览

| 函数 | 说明 | 对应原实现 |
| --- | --- | --- |
| `initCanvasKit()` | 初始化 WASM 引擎（进程内一次） | — |
| `createRuntime(ck, opts)` | 字体/配置/画笔/卡片矩形 | 顶层 lazy 属性群 |
| `renderDynamicCard(opts)` | 动态卡片一步出 PNG | `makeDrawDynamic` |
| `drawAuthorGeneral / drawAuthorForward` | 作者区（含头像、挂件、认证角标、iconBadge、粉丝卡片/二维码装饰） | `ModuleAuthor.drawGeneral / drawForward` |
| `drawModuleDynamic(rt, modules)` | 模块编排：话题/争议/正文/主体/附加卡 | `ModuleDynamic.makeGeneral` |
| `drawMajor(rt, major)` | 8 种主体分发（视频/九宫格/图文/专栏/音乐/直播/番剧/合集/通用/充电） | `Major.makeGeneral` |
| `assembleCard(rt, images, opts)` | 整卡拼贴（阴影/角标/底板/页脚） | `assembleCard` |
| `composeDynamicCard(rt, card, colors)` | 渐变底图合成 | `makeCardBg` |
| `drawLive / composeLiveCard` | 直播卡片 | `LiveInfo.drawLive / makeDrawLive` |
| `drawTextArea` | 正文逐字符换行 + Emoji 混排 | `Canvas.drawTextArea` |
| `makeParagraph / paintParagraph` | 段落排版（标题/描述/页脚） | `ParagraphBuilder` |

数据结构（`src/types/dynamic.ts`）只声明绘制层实际消费的字段，由调用方从 B 站 API 响应装配。

## 与原插件的已知差异

1. **卡片阴影**：原实现的 `drawRectShadowNoclip` 位于外部插件 `mirai-skia-plugin`，此处按 Skia 惯例推断（sigma = blur/2 + spread 外扩），代码内已标注，待与原产物比对校准；
2. **capHeight**：CanvasKit 未导出该字体度量，以 “H” 字形上边界近似（影响角标文字垂直居中，误差 < 1px）；
3. **字体不自动下载**：需调用方显式提供字体文件；
4. **业务层不在范围内**：动态数据获取、缓存落盘（`cacheImage`）、翻译（百度 API）等由调用方实现，本库只负责「数据 → 图片」的渲染管线。

## 测试脚本（examples/）

| 脚本 | 内容 |
| --- | --- |
| `smoke.js` | CanvasKit 加载 / ICU / 字体 / Paragraph 冒烟 |
| `integration.js` | 完整管线（作者区 + 正文 + 组装 + 渐变）→ `integration.png` |
| `renderAllTest.js` | 全类型回归（8 种主体 + 直播 + 模块组合，占位图无网络依赖） |
| `demoVideo.js` | 程序生成封面渲染视频/九宫格动态 → `demo-video.png` / `demo-grid.png` |
| `checkPixels.js` / `verifyVideo.js` | 采样像素验证视觉元素 |

## 📚 说明

本 README 文档由 AI 辅助生成。如有问题，请提交 Issue 或[与我联系](https://github.com/xiaofeiTM233)！
