/**
 * 文本排版 —— 移植自 DynamicDraw.kt / DynamicModuleDraw.kt
 *
 * 分两套机制，与原实现保持一致：
 * 1. Paragraph：用于标题、描述、页脚等成段文字，直接调用 CanvasKit 的 Paragraph API，
 *    与 skiko 的 ParagraphBuilder/ParagraphStyle 一一对应；
 * 2. drawTextArea：用于动态正文，是原实现手写的逐 code point 换行算法，
 *    此处逐行照搬（不交给 Paragraph），以保证断行位置完全一致。
 *
 * 度量差异处理：
 * - CanvasKit 的 FontMetrics 未导出 capHeight。原实现用 TextLine.capHeight 做角标文字
 *   垂直居中，此处以 "H" 的字形上边界近似（Skia 对无 capHeight 数据的字体亦会降级，
 *   实测误差在 1px 内）。
 * - TextLine.width 由 Font.getGlyphWidths 取得；单字符场景无 shaping/kerning 影响，
 *   与原实现等价。
 */

import type { Font as SkFont, Paragraph } from 'canvaskit-wasm';

import type { ColorInt } from './color';
import { makeXYWH, type Point, type Rect } from './geometry';
import type { CK, SkFontMgr } from './skia';
import { toSkColor, toSkRect, withPaint, type SkCtx } from './canvas';
import { splitByEmoji, twemojiName } from './emoji';

/** 文本环境：字体集合与主字体族名 */
export interface TextEnv {
  ck: CK;
  fontMgr: SkFontMgr;
  mainFontFamily: string;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TextStyleSpec {
  fontSize: number;
  color: ColorInt;
  fontFamilies?: string[];
  bold?: boolean;
}

export interface ParagraphSpec {
  textStyle: TextStyleSpec;
  maxLines?: number;
  ellipsis?: string;
  textAlign?: TextAlign;
}

const toSkTextAlign = (ck: CK, align: TextAlign) =>
  align === 'center' ? ck.TextAlign.Center : align === 'right' ? ck.TextAlign.Right : ck.TextAlign.Left;

/**
 * 构建并排版段落，对应：
 *   ParagraphBuilder(style, FontUtils.fonts).addText(text).build().layout(width)
 * 返回的 Paragraph 由调用方负责 delete()。
 */
export function makeParagraph(
  env: TextEnv,
  spec: ParagraphSpec,
  text: string,
  width: number,
): Paragraph {
  const { ck } = env;
  const paraStyle = new ck.ParagraphStyle({
    textStyle: {
      fontSize: spec.textStyle.fontSize,
      color: toSkColor(ck, spec.textStyle.color),
      fontFamilies: spec.textStyle.fontFamilies ?? [env.mainFontFamily],
      fontStyle: spec.textStyle.bold
        ? { weight: ck.FontWeight.Bold, slant: ck.FontSlant.Upright, width: ck.FontWidth.Normal }
        : { weight: ck.FontWeight.Normal, slant: ck.FontSlant.Upright, width: ck.FontWidth.Normal },
    },
    textAlign: toSkTextAlign(ck, spec.textAlign ?? 'left'),
    ...(spec.maxLines !== undefined ? { maxLines: spec.maxLines } : {}),
    ...(spec.ellipsis !== undefined ? { ellipsis: spec.ellipsis } : {}),
  });

  const builder = ck.ParagraphBuilder.Make(paraStyle, env.fontMgr);
  try {
    builder.addText(text);
    const paragraph = builder.build();
    paragraph.layout(width);
    return paragraph;
  } finally {
    builder.delete();
  }
}

/** 绘制段落，对应 paragraph.paint(canvas, x, y) */
export function paintParagraph(ctx: SkCtx, paragraph: Paragraph, x: number, y: number): void {
  ctx.canvas.drawParagraph(paragraph, x, y);
}

/* ------------------------------------------------------------------ */
/* 度量                                                                 */
/* ------------------------------------------------------------------ */

/**
 * capHeight 近似值。
 * 以大写字母 H 的字形上边界（相对基线）作为 capHeight。
 */
export function measureCapHeight(ck: CK, font: SkFont): number {
  return withPaint(ck, (p) => {
    p.setAntiAlias(true);
    const glyphs = font.getGlyphIDs('H');
    if (!glyphs || glyphs.length === 0) return font.getSize();
    const bounds = font.getGlyphBounds(glyphs, p);
    // 字形边界为 [left, top, right, bottom]，top 以基线为 0 且向上为负
    const top = bounds[1];
    return Number.isFinite(top) && top < 0 ? -top : font.getSize();
  });
}

/** 对应 TextLine.height，即 descent - ascent */
export function measureLineHeight(font: SkFont): number {
  const m = font.getMetrics();
  return m.descent - m.ascent;
}

/** 对应 TextLine.make(c, font).width */
export function measureCharWidth(font: SkFont, ch: string): number {
  const glyphs = font.getGlyphIDs(ch);
  if (!glyphs || glyphs.length === 0) return 0;
  const widths = font.getGlyphWidths(glyphs);
  return widths.length > 0 ? widths[0] : 0;
}

/** 对应 TextLine.make(text, font).width：按字形 advance 逐个累加 */
export function measureTextWidth(font: SkFont, text: string): number {
  const glyphs = font.getGlyphIDs(text);
  if (!glyphs || glyphs.length === 0) return 0;
  const widths = font.getGlyphWidths(glyphs);
  let sum = 0;
  for (let i = 0; i < widths.length; i++) sum += widths[i];
  return sum;
}

/** 绘制单个字符，对应 drawTextLine(charLine, x, y, paint) */
export function drawChar(
  ctx: SkCtx,
  ch: string,
  x: number,
  y: number,
  font: SkFont,
  color: ColorInt,
  paint?: import('canvaskit-wasm').Paint,
): void {
  const draw = (p: import('canvaskit-wasm').Paint) => {
    p.setColor(toSkColor(ctx.ck, color));
    p.setAntiAlias(true);
    p.setStyle(ctx.ck.PaintStyle.Fill);
    ctx.canvas.drawText(ch, x, y, p, font);
  };
  if (paint) draw(paint);
  else withPaint(ctx.ck, draw);
}

/* ------------------------------------------------------------------ */
/* 正文排版（逐字符手写换行）                                            */
/* ------------------------------------------------------------------ */

export interface DrawTextAreaOptions {
  /** 正文字号 */
  contentFontSize: number;
  /** 行间距 */
  lineSpace: number;
  /** 卡片内边距，用于折行后回到行首 */
  cardPadding: number;
  /** 存在 emoji 字体时用于绘制 emoji 文本 */
  emojiFont?: SkFont | null;
  /** emoji 图片加载器；传入 null 表示走字体绘制分支 */
  loadEmoji?: ((name: string) => Promise<SkImageLike | null>) | null;
}

/** 最小图片契约，便于上层注入自己的加载/缓存实现 */
export interface SkImageLike {
  width(): number;
  height(): number;
}

/**
 * 正文文本绘制与换行，逐行对应 Kotlin 的 Canvas.drawTextArea。
 *
 * 折行规则（与原实现一致）：
 *   逐 code point 累加宽度，一旦 x + 字符宽度 > rect.right 即回到 rect.left 并下移一行。
 * 该规则由原实现手写，不经过 Paragraph，故此处同样不使用 Paragraph。
 */
export async function drawTextArea(
  ctx: SkCtx,
  text: string,
  rect: Rect,
  textX: number,
  textY: number,
  font: SkFont,
  color: ColorInt,
  options: DrawTextAreaOptions,
): Promise<Point> {
  let x = textX;
  let y = textY;

  const nodes = splitByEmoji(text);
  const emojiHeight = measureLineHeight(font);

  // 整个绘制过程复用同一 Paint：正文字符与 emoji 贴图需在同一事务内完成
  const paint = new ctx.ck.Paint();
  paint.setColor(toSkColor(ctx.ck, color));
  paint.setAntiAlias(true);
  paint.setStyle(ctx.ck.PaintStyle.Fill);

  try {
    for (const node of nodes) {
      if (node.kind === 'text') {
        // Kotlin: node.value.codePoints() —— 按 code point 迭代，兼容代理对
        for (const c of Array.from(node.value)) {
          if (c === '\n') {
            x = rect.left;
            y += options.contentFontSize + options.lineSpace;
            continue;
          }
          const charWidth = measureCharWidth(font, c);
          if (x + charWidth > rect.right) {
            x = rect.left;
            y += options.contentFontSize + options.lineSpace;
          }
          ctx.canvas.drawText(c, x, y, paint, font);
          x += charWidth;
        }
        continue;
      }

      // Emoji 分支
      if (options.emojiFont) {
        const w = measureEmojiWidth(ctx.ck, options.emojiFont, node.value);
        if (x + w > rect.right) {
          x = rect.left;
          y += measureLineHeight(options.emojiFont) + options.lineSpace;
        }
        ctx.canvas.drawText(node.value, x, y, paint, options.emojiFont);
        x += w;
        continue;
      }

      const name = twemojiName(node.value);
      const emojiImg = options.loadEmoji ? await options.loadEmoji(name) : null;

      if (x + emojiHeight > rect.right) {
        x = rect.left;
        y += emojiHeight + options.lineSpace;
      }
      if (emojiImg) {
        const src = makeXYWH(0, 0, emojiImg.width(), emojiImg.height());
        const dst = makeXYWH(x, y - emojiHeight * 0.8, emojiHeight * 0.9, emojiHeight * 0.9);
        paint.setAlphaf(1);
        ctx.canvas.drawImageRectOptions(
          emojiImg as never,
          toSkRect(src),
          toSkRect(dst),
          ctx.ck.FilterMode.Linear,
          ctx.ck.MipmapMode.None,
        );
      }
      x += emojiHeight;
    }
  } finally {
    paint.delete();
  }

  return { x, y };
}

function measureEmojiWidth(ck: CK, font: SkFont, emoji: string): number {
  const glyphs = font.getGlyphIDs(emoji);
  if (!glyphs || glyphs.length === 0) return 0;
  return withPaint(ck, (p) => {
    const widths = font.getGlyphWidths(glyphs, p);
    return widths.length > 0 ? widths[0] : 0;
  });
}
