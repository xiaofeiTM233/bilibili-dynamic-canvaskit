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

/**
 * 渲染完整动态卡片并输出 PNG。
 * 对应 makeDrawDynamic：先组装卡片，再合成渐变背景。
 */
export async function renderDynamicCard(opts: RenderDynamicOptions): Promise<Uint8Array> {
  const ck = await initCanvasKit();
  const rt: DrawRuntime = await createRuntime(ck, opts);

  try {
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
  } finally {
    disposeRuntime(rt);
  }
}
