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
import { ensureDefaultFont } from '../utils/fonts';

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
  /**
   * 字体目录；未提供 fontBuffers 时，若该目录中无默认字体
   * （LXGWWenKai-Bold.ttf）则自动下载，默认 <cwd>/font
   */
  fontDir?: string;
  /** 是否下载原图，对应 cacheConfig.downloadOriginal */
  downloadOriginal?: boolean;
  /** 图片请求头 */
  headers?: Record<string, string>;
  /** 自定义 fetch（图片/表情下载入口），不传时使用全局 fetch；之前该参数被静默忽略 */
  fetchImpl?: typeof fetch;
  /** 图片下载/解码失败的重试次数（不含首次），默认 2 */
  imageRetries?: number;
  /** 图片磁盘缓存根目录；传入后下载的图片按分类落盘（images/emoji/user/other），命中后不再联网 */
  cacheDir?: string;
}

export interface RuntimeFonts {
  /** 正文字体，对应 Font(mainTypeface, contentFontSize) */
  main: SkFont;
  /** emoji 字体，未配置时为 null */
  emoji: SkFont | null;
  /** 粉丝卡片字体，未配置时为 null */
  fansCard: SkFont | null;
  mainTypeface: SkTypeface | null;
  /** emoji Typeface，由 MakeFreeTypeFaceFromData 创建，需随运行时释放 */
  emojiTypeface: SkTypeface | null;
  /** 粉丝卡片 Typeface，由 MakeFreeTypeFaceFromData 创建，需随运行时释放 */
  fansCardTypeface: SkTypeface | null;
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
  // 与默认配置浅合并：调用方只传部分字段（如只改 cardOrnament）时，
  // 其余字段（colorGenerator 等）不至于缺失而在绘制中段崩溃
  const imageConfig: ImageConfig = { ...DEFAULT_IMAGE_CONFIG, ...options.imageConfig };
  const badgeEnable = imageConfig.badgeEnable.left || imageConfig.badgeEnable.right;
  const quality = resolveQuality(imageConfig.quality, badgeEnable);
  const colors = expandTheme(resolveTheme(imageConfig.theme));

  // 字体集合：正文字体 + emoji 字体 + 粉丝卡片字体
  const buffers: Uint8Array[] = [...(options.fontBuffers ?? [])];
  if (options.emojiFontBuffer) buffers.push(options.emojiFontBuffer);
  if (options.fansCardFontBuffer) buffers.push(options.fansCardFontBuffer);

  if (buffers.length === 0) {
    // 对应 loadFonts：font 目录为空时自动下载默认字体 LXGWWenKai-Medium.ttf
    const autoFont = await ensureDefaultFont({ fontDir: options.fontDir });
    if (autoFont) {
      buffers.push(new Uint8Array(autoFont));
    } else {
      throw new Error('未提供字体且默认字体下载失败，请手动放置字体文件到 font 目录，或通过 fontBuffers 传入');
    }
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
      emojiTypeface,
      fansCardTypeface,
    },
    fontMgr,
    cardRect,
    cardContentRect: inflate(cardRect, -quality.cardPadding),
    cardBadgeArc: [left, right, quality.cardArc, quality.cardArc],
    store: new ImageStore(ck, {
      downloadOriginal: options.downloadOriginal,
      headers: options.headers,
      fetchImpl: options.fetchImpl,
      retries: options.imageRetries,
      cacheDir: options.cacheDir,
    }),
  };
}

/**
 * 释放运行时持有的资源
 *
 * 释放顺序：先 Font（持有 Typeface 引用）-> 再 Typeface -> 最后 FontMgr。
 * 这四类都是 Embind 对象，不释放的话每次 createRuntime 都会把字体数据（默认字体约 20MB）
 * 永久留在 WASM 堆里，反复重建运行时的调用方（如直接使用 renderDynamicCard）会把堆吃光。
 */
export function disposeRuntime(rt: DrawRuntime): void {
  rt.fonts.main.delete();
  if (rt.fonts.emoji) rt.fonts.emoji.delete();
  if (rt.fonts.fansCard) rt.fonts.fansCard.delete();
  rt.fonts.mainTypeface?.delete();
  rt.fonts.emojiTypeface?.delete();
  rt.fonts.fansCardTypeface?.delete();
  rt.fontMgr.delete();
  rt.store.dispose();
}
