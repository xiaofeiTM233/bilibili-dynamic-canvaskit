/**
 * 动态模块绘制 —— 移植自 DynamicModuleDraw.kt
 *
 * 覆盖：话题条、争议提示条、正文（ContentDesc）、附加卡片及其分发。
 * 正文换行由 text.ts 的 drawTextArea 承担（逐行对应原实现的手写算法）。
 */

import type { Image as SkImage } from 'canvaskit-wasm';

import type { ColorInt } from '../core/color';
import { makeRGB, WHITE } from '../core/color';
import {
  drawCard,
  drawImageClip,
  drawImageRRectFull,
  drawRectShadow,
  fillRRect,
  type SkCtx,
} from '../core/canvas';
import { makeXYWH, type RRect, type Rect } from '../core/geometry';
import { drawTextArea, makeParagraph, measureLineHeight, paintParagraph } from '../core/text';
import { makeSurface } from '../core/skia';
import { DEFAULT_CUT_LINE } from '../config/imageConfig';
import type { Additional, ContentDesc, DynamicModules, RichTextNode } from '../types/dynamic';
import type { DrawRuntime } from './runtime';
import { drawLabelCard } from './dynamicDraw';

/** SVG 图标加载器（icon 目录中的图标按名加载） */
export type IconLoader = (name: string) => Promise<SkImage | null>;

export interface ModuleDrawOptions {
  /** 链接类富文本节点的类型图标（WEB/VOTE/LOTTERY/BV） */
  iconLoader?: IconLoader | null;
}

/** 话题条，对应 ModuleDynamic.Topic.drawGeneral */
export async function drawTopic(
  rt: DrawRuntime,
  name: string,
  opts: ModuleDrawOptions = {},
): Promise<SkImage> {
  const { quality } = rt;
  const contentW = rt.cardContentRect.right - rt.cardContentRect.left;
  const lineCount = measureLineHeightFontWidth(rt, name) / contentW > 1 ? 2 : 1;
  const textCardHeight = (quality.contentFontSize + quality.lineSpace * 2) * lineCount;

  const textCardRect: Rect = makeXYWH(quality.cardPadding, 0, contentW, textCardHeight);

  const surface = makeSurface(rt.ck, rt.cardRect.right - rt.cardRect.left, textCardHeight);
  const ctx: SkCtx = { ck: rt.ck, canvas: surface.getCanvas() };

  let x = quality.cardPadding;
  let y = quality.contentFontSize * 0.8 + quality.lineSpace;
  try {
    const icon = opts.iconLoader ? await opts.iconLoader('TOPIC') : null;
    if (icon) {
      const iconSize = quality.contentFontSize;
      ctx.canvas.drawImage(icon, x, y - quality.contentFontSize * 0.9);
      icon.delete();
      x += iconSize + quality.lineSpace;
    }
  } catch {
    /* 图标缺失时仅绘制文本 */
  }

  await drawTextArea(ctx, name, textCardRect, x, y, rt.fonts.main, colorsOf(rt).linkColor, {
    contentFontSize: quality.contentFontSize,
    lineSpace: quality.lineSpace,
    cardPadding: quality.cardPadding,
    emojiFont: rt.fonts.emoji,
    loadEmoji: null,
  });

  const image = surface.makeImageSnapshot();
  surface.dispose();
  return image;
}

/** 争议提示条，对应 ModuleDispute.drawGeneral */
export async function drawDispute(
  rt: DrawRuntime,
  title: string,
  opts: ModuleDrawOptions = {},
): Promise<SkImage> {
  const { quality } = rt;
  const contentW = rt.cardContentRect.right - rt.cardContentRect.left;
  const lineCount = measureLineHeightFontWidth(rt, title) / contentW > 1 ? 2 : 1;
  const textCardHeight = (quality.contentFontSize + quality.lineSpace * 2) * lineCount;

  const textCardRect: Rect = makeXYWH(quality.cardPadding, 0, contentW, textCardHeight);

  const surface = makeSurface(rt.ck, rt.cardRect.right - rt.cardRect.left, textCardHeight);
  const ctx: SkCtx = { ck: rt.ck, canvas: surface.getCanvas() };

  fillRRect(ctx, { ...textCardRect, radii: 5 }, makeRGB(255, 241, 211));

  let x = quality.cardPadding + 10;
  let y = quality.contentFontSize * 0.8 + quality.lineSpace;
  try {
    const icon = opts.iconLoader ? await opts.iconLoader('DISPUTE') : null;
    if (icon) {
      const iconSize = quality.contentFontSize;
      ctx.canvas.drawImage(icon, x, y - quality.contentFontSize * 0.9);
      icon.delete();
      x += iconSize + quality.lineSpace;
    }
  } catch {
    /* 同上 */
  }

  await drawTextArea(ctx, title, textCardRect, x, y, rt.fonts.main, makeRGB(231, 139, 31), {
    contentFontSize: quality.contentFontSize,
    lineSpace: quality.lineSpace,
    cardPadding: quality.cardPadding,
    emojiFont: rt.fonts.emoji,
    loadEmoji: null,
  });

  const image = surface.makeImageSnapshot();
  surface.dispose();
  return image;
}

/**
 * 动态正文，对应 ModuleDynamic.ContentDesc.drawGeneral。
 * Paragraph 仅用于按原实现估算画布高度（取行数），实际绘制走 drawTextArea。
 * @param translation 译文（翻译功能开启时由调用方提供）
 */
export async function drawContentDesc(
  rt: DrawRuntime,
  desc: ContentDesc,
  opts: ModuleDrawOptions & { translation?: string | null; cutLine?: string } = {},
): Promise<SkImage> {
  const { quality } = rt;
  const nodes = buildContentDescRenderNodes(desc.richTextNodes, opts.translation, opts.cutLine ?? DEFAULT_CUT_LINE);

  // 对应 ParagraphBuilder(...).layout(cardContentRect.width).lineNumber
  const measure = makeParagraph(
    rt.textEnv,
    { textStyle: { fontSize: quality.titleFontSize, color: colorsOf(rt).titleColor } },
    nodes.map((n) => n.text).join(''),
    rt.cardContentRect.right - rt.cardContentRect.left,
  );
  const lineNumber = measure.getLineMetrics().length;
  measure.delete();

  const textCardHeight = (quality.contentFontSize + quality.lineSpace * 2) * (lineNumber + 2);
  const textCardRect: Rect = makeXYWH(
    quality.cardPadding,
    0,
    rt.cardContentRect.right - rt.cardContentRect.left,
    textCardHeight,
  );

  let x = textCardRect.left;
  let y = quality.contentFontSize + quality.lineSpace;

  const surface = makeSurface(rt.ck, rt.cardRect.right - rt.cardRect.left, textCardHeight);
  const ctx: SkCtx = { ck: rt.ck, canvas: surface.getCanvas() };

  for (const node of nodes) {
    switch (node.type) {
      case 'RICH_TEXT_NODE_TYPE_TEXT': {
        const text = node.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const point = await drawTextArea(
          ctx, text, textCardRect, x, y, rt.fonts.main, colorsOf(rt).contentColor,
          {
            contentFontSize: quality.contentFontSize,
            lineSpace: quality.lineSpace,
            cardPadding: quality.cardPadding,
            emojiFont: rt.fonts.emoji,
            loadEmoji: async (name) => {
              // twemoji 贴图分支，对应 getOrDownloadImage(twemoji(et), EMOJI)
              const { TWEMOJI_BASE } = await import('../utils/images');
              return rt.store.get(`${TWEMOJI_BASE}/${name}.png`);
            },
          },
        );
        x = point.x;
        y = point.y;
        break;
      }

      case 'RICH_TEXT_NODE_TYPE_EMOJI': {
        if (!node.emoji?.iconUrl) break;
        const img = await rt.store.get(node.emoji.iconUrl);
        if (!img) break;
        const emojiSize = measureLineHeight(rt.fonts.main);
        if (x + emojiSize > textCardRect.right) {
          x = textCardRect.left;
          y += emojiSize + quality.lineSpace;
        }
        withTempPaint(rt, ctx, (p) => {
          ctx.canvas.drawImageRectOptions(
            img,
            new Float32Array([0, 0, img.width(), img.height()]),
            new Float32Array([x, y - emojiSize * 0.8, x + emojiSize, y - emojiSize * 0.8 + emojiSize]),
            rt.ck.FilterMode.Linear,
            rt.ck.MipmapMode.None,
          );
        });
        x += emojiSize;
        break;
      }

      case 'RICH_TEXT_NODE_TYPE_WEB':
      case 'RICH_TEXT_NODE_TYPE_VOTE':
      case 'RICH_TEXT_NODE_TYPE_LOTTERY':
      case 'RICH_TEXT_NODE_TYPE_BV': {
        try {
          const icon = opts.iconLoader ? await opts.iconLoader(node.type) : null;
          if (icon) {
            const iconSize = quality.contentFontSize;
            ctx.canvas.drawImage(icon, x, y - quality.contentFontSize * 0.9);
            icon.delete();
            x += iconSize;
          }
        } catch {
          /* 图标缺失 */
        }
        const point = await drawTextArea(
          ctx, node.text, textCardRect, x, y, rt.fonts.main, colorsOf(rt).linkColor,
          {
            contentFontSize: quality.contentFontSize,
            lineSpace: quality.lineSpace,
            cardPadding: quality.cardPadding,
            emojiFont: rt.fonts.emoji,
            loadEmoji: null,
          },
        );
        x = point.x;
        y = point.y;
        break;
      }

      default: {
        const point = await drawTextArea(
          ctx, node.text, textCardRect, x, y, rt.fonts.main, colorsOf(rt).linkColor,
          {
            contentFontSize: quality.contentFontSize,
            lineSpace: quality.lineSpace,
            cardPadding: quality.cardPadding,
            emojiFont: rt.fonts.emoji,
            loadEmoji: null,
          },
        );
        x = point.x;
        y = point.y;
      }
    }
  }

  // 按实际绘制高度裁剪快照，对应 makeImageSnapshot(IRect)
  const snapshotHeight = Math.ceil(y + quality.lineSpace * 2);
  const cropped = surface.makeImageSnapshot(
    new Int32Array([0, 0, Math.round(rt.cardRect.right - rt.cardRect.left), snapshotHeight]),
  );
  surface.dispose();
  return cropped;
}

/** 译文拼接，对应 buildContentDescRenderNodes */
export function buildContentDescRenderNodes(
  richTextNodes: RichTextNode[],
  translation: string | null | undefined,
  cutLine: string,
): RichTextNode[] {
  if (!translation || translation.trim() === '') return richTextNodes;
  return [
    ...richTextNodes,
    { type: 'RICH_TEXT_NODE_TYPE_TEXT', origText: cutLine, text: cutLine },
    { type: 'RICH_TEXT_NODE_TYPE_TEXT', origText: translation, text: translation },
  ];
}

/** 附加卡片，对应 drawAdditionalCard */
export async function drawAdditionalCard(
  rt: DrawRuntime,
  label: string,
  cover: string | null | undefined,
  title: string,
  desc1: string,
  desc2: string | null | undefined,
): Promise<SkImage> {
  const { quality, colors } = rt;
  const titleSize = quality.titleFontSize * 0.8;
  const descSize = quality.subTitleFontSize * 0.8;

  const height =
    cover != null || desc2 != null ? quality.additionalCardHeight : quality.additionalCardHeight * 0.7;

  const additionalCardRect: RRect = {
    ...makeXYWH(
      quality.cardPadding,
      quality.subTitleFontSize + quality.cardPadding + 1,
      rt.cardContentRect.right - rt.cardContentRect.left,
      height,
    ),
    radii: quality.cardArc,
  };

  const surface = makeSurface(
    rt.ck,
    rt.cardRect.right - rt.cardRect.left,
    height + quality.subTitleFontSize + quality.cardPadding * 2,
  );
  const ctx: SkCtx = { ck: rt.ck, canvas: surface.getCanvas() };

  drawCard(ctx, additionalCardRect, {
    bgColor: colors.cardBgColor,
    outlineColors: colors.cardOutlineColors,
    outlineWidth: quality.cardOutlineWidth,
  });
  drawRectShadow(ctx, inflateR(additionalCardRect, 1), colors.smallCardShadow);

  const labelText = label;
  drawTextSized(rt, ctx, labelText, additionalCardRect.left + 8, quality.subTitleFontSize, quality.subTitleFontSize, colors.subTitleColor);

  let x = quality.cardPadding;

  if (cover) {
    const img = await rt.store.get(cover);
    if (img) {
      const imgRect: RRect = {
        ...makeXYWH(
          quality.cardPadding,
          quality.subTitleFontSize + quality.cardPadding + 1,
          (quality.additionalCardHeight * img.width()) / img.height(),
          quality.additionalCardHeight,
        ),
        radii: quality.cardArc,
      };
      // 对应 .inflate(-1f)
      const inset = insetRRect(imgRect, 1);
      drawImageRRectFull(ctx, img, inset);
      x += inset.right - inset.left;
    }
  }

  x += quality.cardPadding;

  const availW = (rt.cardContentRect.right - rt.cardContentRect.left) - x;
  const titleParagraph = makeParagraph(
    rt.textEnv,
    { textStyle: { fontSize: titleSize, color: colors.titleColor }, maxLines: 1, ellipsis: '...' },
    title,
    availW,
  );
  const desc1Paragraph = makeParagraph(
    rt.textEnv,
    { textStyle: { fontSize: descSize, color: colors.descColor }, maxLines: 1, ellipsis: '...' },
    desc1,
    availW,
  );
  const desc2Paragraph = desc2
    ? makeParagraph(
        rt.textEnv,
        { textStyle: { fontSize: descSize, color: colors.descColor }, maxLines: 1, ellipsis: '...' },
        desc2,
        availW,
      )
    : null;

  const top = ((additionalCardRect.bottom - additionalCardRect.top) -
    titleParagraph.getHeight() * (desc2 == null ? 2 : 3)) / 2;

  let y = additionalCardRect.top + top;
  paintParagraph(ctx, titleParagraph, x, y);
  y += titleParagraph.getHeight();
  paintParagraph(ctx, desc1Paragraph, x, y);
  if (desc2Paragraph) {
    y += titleParagraph.getHeight();
    paintParagraph(ctx, desc2Paragraph, x, y);
  }

  titleParagraph.delete();
  desc1Paragraph.delete();
  desc2Paragraph?.delete();

  const image = surface.makeImageSnapshot();
  surface.dispose();
  return image;
}

/** 附加卡片分发，对应 ModuleDynamic.Additional.makeGeneral */
export async function drawAdditional(rt: DrawRuntime, a: Additional): Promise<SkImage | null> {
  switch (a.type) {
    case 'ADDITIONAL_TYPE_COMMON': {
      const c = a.common!;
      return drawAdditionalCard(rt, c.headText, c.cover ?? null, c.title, c.desc1, c.desc2 ?? null);
    }
    case 'ADDITIONAL_TYPE_RESERVE': {
      const r = a.reserve!;
      const label = r.stype === 1 ? '视频预约' : r.stype === 2 ? '直播预约' : r.stype === 4 ? '首映预告' : '预约';
      return drawAdditionalCard(
        rt,
        label,
        r.premiere?.cover ?? null,
        r.title,
        `${r.desc1.text}  ${r.desc2.text}`,
        r.desc3?.text ?? null,
      );
    }
    case 'ADDITIONAL_TYPE_VOTE': {
      const v = a.vote!;
      return drawAdditionalCard(rt, '投票', null, v.desc, `结束时间 ${v.endTimeText}`, null);
    }
    case 'ADDITIONAL_TYPE_UGC': {
      const u = a.ugc!;
      return drawAdditionalCard(rt, u.headText, u.cover, u.title, `时长 ${u.duration}  ${u.descSecond}`, null);
    }
    case 'ADDITIONAL_TYPE_GOODS': {
      const g = a.goods!;
      return drawAdditionalCard(rt, g.headText ?? '商品', g.items[0].cover ?? null, g.items[0].name, `${g.items[0].price} 起`, null);
    }
    case 'ADDITIONAL_TYPE_UPOWER_LOTTERY': {
      const l = a.lottery!;
      return drawAdditionalCard(rt, '充电抽奖', null, l.title, l.desc.text, null);
    }
    default:
      return null;
  }
}

/** 模块编排，对应 ModuleDynamic.makeGeneral（不含作者区） */
export async function drawModuleDynamic(
  rt: DrawRuntime,
  modules: DynamicModules,
  opts: ModuleDrawOptions & { isForward?: boolean; translation?: string | null } = {},
): Promise<SkImage[]> {
  const images: SkImage[] = [];
  if (modules.topic) images.push(await drawTopic(rt, modules.topic.name, opts));
  if (modules.dispute) images.push(await drawDispute(rt, modules.dispute.title, opts));
  if (modules.desc) images.push(await drawContentDesc(rt, modules.desc, opts));
  if (modules.major) {
    const { drawMajor } = await import('./majorDraw');
    images.push(await drawMajor(rt, modules.major, opts));
  }
  if (modules.additional) {
    const img = await drawAdditional(rt, modules.additional);
    if (img) images.push(img);
  }
  return images;
}

/* ------------------------------------------------------------------ */
/* 内部工具                                                             */
/* ------------------------------------------------------------------ */

function colorsOf(rt: DrawRuntime) {
  return rt.colors;
}

function measureLineHeightFontWidth(rt: DrawRuntime, text: string): number {
  // 对应 TextLine.make(text, font).width
  const glyphs = rt.ck.Font ? rt.fonts.main.getGlyphIDs(text) : null;
  if (!glyphs || glyphs.length === 0) return 0;
  const widths = rt.fonts.main.getGlyphWidths(glyphs);
  let sum = 0;
  for (let i = 0; i < widths.length; i++) sum += widths[i];
  return sum;
}

function withTempPaint(
  rt: DrawRuntime,
  _ctx: SkCtx,
  fn: (p: import('canvaskit-wasm').Paint) => void,
): void {
  const p = new rt.ck.Paint();
  try {
    p.setAntiAlias(true);
    fn(p);
  } finally {
    p.delete();
  }
}

function drawTextSized(
  rt: DrawRuntime,
  ctx: SkCtx,
  text: string,
  x: number,
  y: number,
  size: number,
  color: ColorInt,
): void {
  const font = new rt.ck.Font(rt.fonts.mainTypeface, size);
  const p = new rt.ck.Paint();
  try {
    p.setColor(rt.ck.Color4f(
      ((color >>> 16) & 0xff) / 255,
      ((color >>> 8) & 0xff) / 255,
      (color & 0xff) / 255,
      ((color >>> 24) & 0xff) / 255,
    ));
    p.setAntiAlias(true);
    ctx.canvas.drawText(text, x, y, p, font);
  } finally {
    p.delete();
    font.delete();
  }
}

function inflateR(r: RRect, delta: number): RRect {
  // skiko 的 RRect.inflate 基于 SkRRect::outset：radii 随矩形同步缩放（clamp 到短边一半）
  const w = r.right - r.left;
  const h = r.bottom - r.top;
  const maxR = Math.min(w, h) / 2;
  const adj = (v: number) => Math.max(0, Math.min(v + delta, maxR));
  return {
    left: r.left - delta,
    top: r.top - delta,
    right: r.right + delta,
    bottom: r.bottom + delta,
    radii: typeof r.radii === 'number' ? adj(r.radii) : (r.radii.map(adj) as [number, number, number, number]),
  };
}

function insetRRect(r: RRect, delta: number): RRect {
  return inflateR(r, -delta);
}

export { WHITE };
