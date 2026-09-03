/**
 * 绘制运行时 —— 对应 DynamicDraw.kt 中的顶层 lazy 属性群
 *
 * Kotlin 端借助 by lazy 在首次访问时完成「配置解析 + 字体加载 + 画笔准备」，
 * 此处收敛为显式构造的 DrawRuntime，语义一一对应。
 */

import type { Font as SkFont, Typeface as SkTypeface } from 'canvaskit-wasm';

import { DEFAULT_IMAGE_CONFIG, type ImageConfig } from '../config/imageConfig';
import { resolveQuality } from '../config/quality';
import { expandTheme, resolveTheme, type ResolvedTheme } from '../config/theme';
import { makeLTRB, type Rect } from '../core/geometry';
import { makeFont, makeFontMgr, matchTypeface, type CK, type SkFontMgr } from '../core/skia';
import type { TextEnv } from '../core/text';
import { ImageStore } from '../utils/images';

export interface RuntimeOptions {
  imageConfig?: ImageConfig;
  /** 正文字体文件；建议霞鹜文楷 Bold 或 HarmonyOS Sans SC Medium */
  fontBuffers?: Uint8Array[];
  /** 主字体族名，留空时取首个已加载字体的族名 */
  mainFontFamily?: string;
  /** emoji 字体（如 Noto Color Emoji）；不提供时 emoji 走 twemoji 贴图 */
  emojiFontBuffer?: Uint8Array | null;
  /** 粉丝卡片数字字体，对应 font/FansCard.ttf */
  fansCardFontBuffer?: Uint8Array | null;
  /** 是否下载原图，对应 cacheConfig.downloadOriginal */
  downloadOriginal?: boolean;
  /** 图片请求头 */
  headers?: Record<string, string>;
}

export interface RuntimeFonts {
  /** 正文字体，对应 Font(mainTypeface, contentFontSize) */
  main: SkFont;
  /** emoji 字体，未配置时为 null */
  emoji: SkFont | null;
  /** 粉丝卡片字体，未配置时为 null */
  fansCard: SkFont | null;
  mainTypeface: SkTypeface | null;
}

export interface DrawRuntime {
  ck: CK;
  quality: ReturnType<typeof resolveQuality>;
  theme: ReturnType<typeof expandTheme>;
  colors: ResolvedTheme;
  imageConfig: ImageConfig;
  textEnv: TextEnv;
  fonts: RuntimeFonts;
  fontMgr: SkFontMgr;
  /** 卡片外框：左=cardMargin，右=imageWidth-cardMargin，高度由内容决定 */
  cardRect: Rect;
  /** 卡片内容区：cardRect 内缩 cardPadding */
  cardContentRect: Rect;
  /** 卡片圆角 [左上, 右上, 右下, 左下] */
  cardBadgeArc: [number, number, number, number];
  store: ImageStore;
}

const inflate = (r: Rect, delta: number): Rect =>
  makeLTRB(r.left - delta, r.top - delta, r.right + delta, r.bottom + delta);

export async function createRuntime(ck: CK, options: RuntimeOptions = {}): Promise<DrawRuntime> {
  const imageConfig = options.imageConfig ?? DEFAULT_IMAGE_CONFIG;
  const badgeEnable = imageConfig.badgeEnable.left || imageConfig.badgeEnable.right;
  const quality = resolveQuality(imageConfig.quality, badgeEnable);
  const colors = expandTheme(resolveTheme(imageConfig.theme));

  // 字体集合：正文字体 + emoji 字体 + 粉丝卡片字体
  const buffers: Uint8Array[] = [...(options.fontBuffers ?? [])];
  if (options.emojiFontBuffer) buffers.push(options.emojiFontBuffer);
  if (options.fansCardFontBuffer) buffers.push(options.fansCardFontBuffer);

  if (buffers.length === 0) {
    throw new Error('至少需要提供一个字体文件，否则无法进行文本排版');
  }

  const fontMgr = makeFontMgr(ck, buffers);

  // 主字体族名：优先取配置，否则取首个已加载字体的族名
  const familyCount = fontMgr.countFamilies();
  const firstFamily = familyCount > 0 ? fontMgr.getFamilyName(0) : '';
  const mainFontFamily = options.mainFontFamily || firstFamily;
  const mainTypeface = matchTypeface(ck, fontMgr, mainFontFamily);

  // 直接从字节创建 Typeface：字体文件内部的族名不一定等于文件名，
  // 按族名匹配会静默失效（对应原实现 loadTypeface(Data) 的直接加载语义）
  // MakeFreeTypeFaceFromData 要求完整 ArrayBuffer，slice 归零 byteOffset
  const emojiTypeface = options.emojiFontBuffer
    ? ck.Typeface.MakeFreeTypeFaceFromData(options.emojiFontBuffer.slice().buffer as ArrayBuffer)
    : null;

  const fansCardTypeface = options.fansCardFontBuffer
    ? ck.Typeface.MakeFreeTypeFaceFromData(options.fansCardFontBuffer.slice().buffer as ArrayBuffer)
    : null;

  const cardRect = makeLTRB(
    quality.cardMargin,
    0,
    quality.imageWidth - quality.cardMargin,
    0,
  );

  const left = imageConfig.badgeEnable.left ? 0 : quality.cardArc;
  const right = imageConfig.badgeEnable.right ? 0 : quality.cardArc;

  return {
    ck,
    quality,
    theme: colors,
    colors,
    imageConfig,
    textEnv: { ck, fontMgr, mainFontFamily },
    fonts: {
      main: makeFont(ck, mainTypeface, quality.contentFontSize),
      emoji: emojiTypeface ? makeFont(ck, emojiTypeface, quality.contentFontSize) : null,
      fansCard: fansCardTypeface
        ? makeFont(ck, fansCardTypeface, quality.subTitleFontSize)
        : null,
      mainTypeface,
    },
    fontMgr,
    cardRect,
    cardContentRect: inflate(cardRect, -quality.cardPadding),
    cardBadgeArc: [left, right, quality.cardArc, quality.cardArc],
    store: new ImageStore(ck, {
      downloadOriginal: options.downloadOriginal,
      headers: options.headers,
    }),
  };
}

/** 释放运行时持有的资源 */
export function disposeRuntime(rt: DrawRuntime): void {
  rt.fonts.main.delete();
  if (rt.fonts.emoji) rt.fonts.emoji.delete();
  if (rt.fonts.fansCard) rt.fonts.fansCard.delete();
  rt.store.dispose();
}
