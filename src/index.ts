/**
 * bilibili-dynamic-canvaskit 入口
 *
 * 渲染管线（与原插件一致）：
 *   模块层（正文/九宫格等，调用方组装） -> 作者区 -> assembleCard 拼贴 -> 渐变底图合成 -> PNG
 */

import { colorFromHex, type ColorInt } from './core/color';
import { initCanvasKit } from './core/skia';
import type { Image as SkImage } from 'canvaskit-wasm';
import {
  assembleCard,
  composeDynamicCard,
  drawAuthorForward,
  drawAuthorGeneral,
  type AuthorInfo,
} from './draw/dynamicDraw';
import {
  createRuntime,
  disposeRuntime,
  type DrawRuntime,
  type RuntimeOptions,
} from './draw/runtime';

export { initCanvasKit } from './core/skia';
export { createRuntime, disposeRuntime } from './draw/runtime';
export type { DrawRuntime, RuntimeOptions } from './draw/runtime';
export {
  assembleCard,
  composeDynamicCard,
  drawAuthorForward,
  drawAuthorGeneral,
  drawAvatar,
  drawBadge,
  drawBlockedDefault,
  drawLabelCard,
  drawOrnament,
  qrCodeImage,
  type AuthorInfo,
} from './draw/dynamicDraw';
export { drawTextArea, makeParagraph, paintParagraph } from './core/text';
export type { DrawTextAreaOptions, ParagraphSpec, TextStyleSpec } from './core/text';
export {
  drawModuleDynamic,
  drawTopic,
  drawDispute,
  drawContentDesc,
  drawAdditional,
  drawAdditionalCard,
  buildContentDescRenderNodes,
} from './draw/moduleDraw';
export type { ModuleDrawOptions, IconLoader } from './draw/moduleDraw';
export {
  drawMajor,
  drawInfoText,
  drawNineGrid,
  drawArchive,
  drawArticle,
  drawMusic,
  drawOpus,
  drawCommon,
  drawSmallCard,
} from './draw/majorDraw';
export type { SmallCardSpec, ArchiveSpec } from './draw/majorDraw';
export {
  drawLive,
  drawLiveAvatar,
  composeLiveCard,
} from './draw/liveDraw';
export type { LiveInfoDraw, LiveDrawOptions } from './draw/liveDraw';
export { EMOJI_REGEX, splitByEmoji, twemojiName } from './core/emoji';
export {
  colorFromHex,
  generateLinearGradient,
  hsb2rgb,
  makeRGB,
  rgb2hsb,
} from './core/color';
export { makeSurface } from './core/skia';
export { QUALITY_PRESETS, resolveQuality } from './config/quality';
export type { Quality } from './config/quality';
export { THEME_PRESETS, expandTheme, resolveTheme } from './config/theme';
export {
  DEFAULT_IMAGE_CONFIG,
  createDrawContext,
  DEFAULT_CUT_LINE,
} from './config/imageConfig';
export type { ImageConfig } from './config/imageConfig';
export { ImageStore, imgApi, TWEMOJI_BASE, twemoji } from './utils/images';

export interface RenderDynamicOptions extends RuntimeOptions {
  author: AuthorInfo;
  /** 格式化后的时间文本 */
  time: string;
  /** 动态链接（用于二维码装饰） */
  link: string;
  /** 动态 id，显示于右侧角标 */
  id: string;
  /** 模块图片列表：正文、九宫格、附加卡片等，顺序即拼贴顺序 */
  moduleImages: SkImage[];
  /** 主题色（hex，支持分号分隔多色渐变）；默认取配置的 defaultColor */
  themeColorHex?: string;
  footer?: string | null;
  isForward?: boolean;
  tag?: string | null;
  /** 角标 logo（BILIBILI_LOGO / FORWARD 的预渲染图） */
  badgeIcon?: SkImage | null;
  /** 认证角标 */
  verifyIcon?: SkImage | null;
}

/* ------------------------------------------------------------------ */
/* 运行时缓存                                                          */
/* ------------------------------------------------------------------ */

/**
 * Kotlin 端 createRuntime 对应的是顶层 by lazy 属性，整个进程只初始化一次。
 * 这里按「影响运行时构造的配置」缓存运行时，原因有二：
 * 1. 每次重建都要重新读盘并加载字体（默认字体 15MB+），开销极大；
 * 2. CanvasKit 在做过一次字形宽度测量（getGlyphWidths）之后，
 *    字体数据会被 Skia 的全局缓存持有，即使随后 fontMgr.delete() 也不会真正释放，
 *    于是「渲染一次 -> 重建运行时」的用法会让 WASM 堆按字体大小持续增长
 *    （见 examples/leak-check.js 的最小复现）。
 * 配置变化时自建新的运行时并释放旧的，语义与「重新调用 createRuntime」一致。
 */
let sharedRuntime: DrawRuntime | null = null;
let sharedRuntimeKey = '';

const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;
const objectId = (value: object): number => {
  let id = objectIds.get(value);
  if (id === undefined) {
    id = nextObjectId++;
    objectIds.set(value, id);
  }
  return id;
};

/** 结构化配置 -> 稳定字符串；函数与二进制缓冲按引用身份参与，避免误命中或产出巨型字符串 */
function runtimeKeyOf(opts: RenderDynamicOptions): string {
  const picked: RuntimeOptions = {
    imageConfig: opts.imageConfig,
    fontBuffers: opts.fontBuffers,
    mainFontFamily: opts.mainFontFamily,
    emojiFontBuffer: opts.emojiFontBuffer,
    fansCardFontBuffer: opts.fansCardFontBuffer,
    fontDir: opts.fontDir,
    downloadOriginal: opts.downloadOriginal,
    headers: opts.headers,
  };
  return JSON.stringify(picked, (_key, value) => {
    if (typeof value === 'function') return `fn#${objectId(value as object)}`;
    if (ArrayBuffer.isView(value)) return `buf#${objectId(value as object)}`;
    if (value instanceof ArrayBuffer) return `buf#${objectId(value)}`;
    return value;
  });
}

async function acquireRuntime(opts: RenderDynamicOptions): Promise<DrawRuntime> {
  const key = runtimeKeyOf(opts);
  if (sharedRuntime && key === sharedRuntimeKey) return sharedRuntime;
  if (sharedRuntime) {
    disposeRuntime(sharedRuntime);
    sharedRuntime = null;
  }
  const ck = await initCanvasKit();
  sharedRuntime = await createRuntime(ck, opts);
  sharedRuntimeKey = key;
  return sharedRuntime;
}

/**
 * 渲染完整动态卡片并输出 PNG。
 * 对应 makeDrawDynamic：先组装卡片，再合成渐变背景。
 *
 * 运行时按配置缓存（对应 Kotlin 端的 lazy），不会每次调用都重新加载字体。
 */
export async function renderDynamicCard(opts: RenderDynamicOptions): Promise<Uint8Array> {
  const rt: DrawRuntime = await acquireRuntime(opts);

  const themeColors: ColorInt[] = (opts.themeColorHex ?? rt.imageConfig.defaultColor)
    .split(';')
    .map(colorFromHex);

  const authorImage = opts.isForward
    ? await drawAuthorForward(rt, opts.author, opts.time, opts.verifyIcon)
    : await drawAuthorGeneral(rt, opts.author, opts.time, opts.link, themeColors[0], opts.verifyIcon);

  const card = assembleCard(rt, [authorImage, ...opts.moduleImages], {
    id: opts.id,
    footer: opts.footer ?? null,
    isForward: opts.isForward,
    tag: opts.tag ?? null,
    badgeIcon: opts.badgeIcon ?? null,
  });
  authorImage.delete();

  const final = composeDynamicCard(rt, card, themeColors);
  card.delete();

  const png = final.encodeToBytes();
  final.delete();
  if (!png) throw new Error('PNG 编码失败');
  return png;
}
