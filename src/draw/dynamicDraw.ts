/**
 * 动态卡片组装 —— 移植自 DynamicDraw.kt / QrCodeDraw.kt
 *
 * 覆盖：角标（drawBadge）、标签卡片（drawLabelCard）、头像区（drawAvatar）、
 * 卡片装饰（drawOrnament：粉丝卡片 / 二维码）、专属动态占位（drawBlockedDefault）、
 * 整卡组装（assembleCard）与渐变底图合成（对应 makeCardBg）。
 *
 * 分层说明：原实现的模块层（正文/九宫格等）各自产出 Image 后由 assembleCard 拼贴，
 * 本文件提供组装层与作者区绘制；动态数据解析属业务层，由调用方完成。
 */

import QRCode from 'qrcode';
import type { Font as SkFontType, Image as SkImage } from 'canvaskit-wasm';

import type { ColorInt } from '../core/color';
import { generateLinearGradient, getRGB, hsb2rgb, makeRGB, rgb2hsb } from '../core/color';
import {
  drawCard,
  drawImageClip,
  drawImageRRectFull,
  drawRectShadow,
  drawScaleWidthImage,
  fillRRect,
  type SkCtx,
  toSkRect,
  withPaint,
} from '../core/canvas';
import { makeXYWH, Position, type RRect, type Rect } from '../core/geometry';
import {
  makeParagraph,
  measureCapHeight,
  measureLineHeight,
  measureTextWidth,
  paintParagraph,
} from '../core/text';
import { makeSurface } from '../core/skia';
import type { DrawRuntime } from './runtime';

/* ------------------------------------------------------------------ */
/* 作者区                                                               */
/* ------------------------------------------------------------------ */

/** 绘制所需的作者最小信息集 */
export interface AuthorInfo {
  name: string;
  mid: number;
  face?: string | null;
  pendant?: string | null;
  verifyType?: number | null;
  /** 粉丝卡片（decorate.cardUrl） */
  fanCardUrl?: string | null;
  fanType?: number;
  fanNumStr?: string;
  /** 粉丝数字颜色（ARGB int） */
  fanColor?: number;
  /** 挂件角标（iconBadge.renderImg） */
  iconBadge?: { renderImg: string } | null;
}

/**
 * 头像 / 挂件 / 认证角标，对应 Canvas.drawAvatar。
 * @param verifyIcon 认证角标图片（PERSONAL/OFFICIAL_OFFICIAL_VERIFY.svg 预渲染结果）
 */
export async function drawAvatar(
  rt: DrawRuntime,
  ctx: SkCtx,
  face: string | null | undefined,
  pendant: string | null | undefined,
  verifyType: number | null | undefined,
  faceSize: number,
  verifyIconSize: number,
  isForward = false,
  verifyIcon?: SkImage | null,
): Promise<void> {
  const { quality, colors } = rt;
  const faceImg = face ? await rt.store.get(face) : null;
  const hasPendant = !!pendant;

  let tarFaceRect: RRect = {
    ...makeXYWH(
      quality.cardPadding * (isForward ? 1.5 : 1.8),
      quality.cardPadding * (isForward ? 1 : 1.2),
      faceSize,
      faceSize,
    ),
    radii: faceSize / 2,
  };

  if (!hasPendant) {
    const inflated = inflateRRect(tarFaceRect, quality.noPendantFaceInflate);
    tarFaceRect = inflated;
    // 无挂件时绘制头像描边圆
    withPaint(rt.ck, (p) => {
      p.setColor(skColor(rt, colors.faceOutlineColor));
      p.setStyle(rt.ck.PaintStyle.Fill);
      p.setAntiAlias(true);
      ctx.canvas.drawCircle(
        tarFaceRect.left + rectW(tarFaceRect) / 2,
        tarFaceRect.top + rectW(tarFaceRect) / 2,
        rectW(tarFaceRect) / 2 + quality.noPendantFaceInflate / 2,
        p,
      );
    });
  }

  if (faceImg) drawImageRRectFull(ctx, faceImg, tarFaceRect);

  if (hasPendant && pendant) {
    const pendantImg = await rt.store.get(pendant);
    if (pendantImg) {
      const tarPendantRect = makeXYWH(
        tarFaceRect.left + rectW(tarFaceRect) / 2 - quality.pendantSize / 2,
        tarFaceRect.top + rectH(tarFaceRect) / 2 - quality.pendantSize / 2,
        quality.pendantSize,
        quality.pendantSize,
      );
      withPaint(rt.ck, (p) => {
        p.setAntiAlias(true);
        ctx.canvas.drawImageRectOptions(
          pendantImg,
          toSkRect(makeXYWH(0, 0, pendantImg.width(), pendantImg.height())),
          toSkRect(tarPendantRect),
          rt.ck.FilterMode.Linear,
          rt.ck.MipmapMode.None,
        );
      });
    }
  }

  const verifyName =
    verifyType === 0
      ? 'PERSONAL_OFFICIAL_VERIFY'
      : verifyType === 1
        ? 'ORGANIZATION_OFFICIAL_VERIFY'
        : '';

  if (verifyName && verifyIcon) {
    const size = hasPendant
      ? verifyIconSize - quality.noPendantFaceInflate / 2
      : verifyIconSize;
    ctx.canvas.drawImage(verifyIcon, tarFaceRect.right - size, tarFaceRect.bottom - size);
  }
}

/** 作者区（普通动态），对应 ModuleAuthor.drawGeneral */
export async function drawAuthorGeneral(
  rt: DrawRuntime,
  author: AuthorInfo,
  time: string,
  link: string,
  themeColor: ColorInt,
  verifyIcon?: SkImage | null,
): Promise<SkImage> {
  const { quality, colors } = rt;
  const surface = makeSurface(rt.ck, quality.imageWidth - quality.cardMargin * 2, quality.pendantSize);
  const ctx: SkCtx = { ck: rt.ck, canvas: surface.getCanvas() };

  await drawAvatar(
    rt,
    ctx,
    author.face,
    author.pendant,
    author.verifyType,
    quality.faceSize,
    quality.verifyIconSize,
    false,
    verifyIcon,
  );

  let x = quality.faceSize + quality.cardPadding * 3.2;
  const space = (quality.pendantSize - quality.nameFontSize - quality.subTitleFontSize) / 3;
  let y = quality.nameFontSize + space * 1.25;

  drawText(rt, ctx, author.name, x, y, quality.nameFontSize, colors.nameColor);
  y += quality.subTitleFontSize + space * 0.5;
  drawText(rt, ctx, time, x, y, quality.subTitleFontSize, colors.subTitleColor);

  // 挂件角标（iconBadge），对应原实现中的 iconBadge?.let { ... }
  if (author.iconBadge?.renderImg) {
    const img = await rt.store.get(author.iconBadge.renderImg);
    if (img) {
      const iconHeight = quality.subTitleFontSize;
      const iconWidth = (img.width() / img.height()) * iconHeight;
      // textLineTime 的宽度需以 subTitleFontSize 字号测量
      const timeFont = new rt.ck.Font(rt.fonts.mainTypeface, quality.subTitleFontSize);
      const timeWidth = measureTextWidth(timeFont, time);
      const timeLineHeight = measureLineHeight(timeFont);
      timeFont.delete();
      x += timeWidth + quality.subTitleFontSize * 0.5;
      y -= timeLineHeight - iconHeight / 2;
      drawImageRRectFull(ctx, img, { ...makeXYWH(x, y, iconWidth, iconHeight), radii: 0 });
    }
  }

  drawOrnament(rt, ctx, author, link, themeColor);

  const image = surface.makeImageSnapshot();
  surface.delete();
  return image;
}

/** 作者区（转发动态），对应 ModuleAuthor.drawForward */
export async function drawAuthorForward(
  rt: DrawRuntime,
  author: AuthorInfo,
  time: string,
  verifyIcon?: SkImage | null,
): Promise<SkImage> {
  const { quality, colors } = rt;
  const surface = makeSurface(
    rt.ck,
    quality.imageWidth - quality.cardMargin * 2,
    quality.faceSize + quality.cardPadding,
  );
  const ctx: SkCtx = { ck: rt.ck, canvas: surface.getCanvas() };

  const faceSize = quality.faceSize * 0.6;
  await drawAvatar(
    rt,
    ctx,
    author.face,
    null,
    author.verifyType,
    faceSize,
    quality.verifyIconSize * 0.8,
    true,
    verifyIcon,
  );

  const nameWidth = measureTextWidth(rt.fonts.main, author.name);

  let x = faceSize + quality.cardPadding * 2.5;
  let y = (faceSize - quality.nameFontSize) / 2 + quality.nameFontSize + quality.cardPadding;

  drawText(rt, ctx, author.name, x, y, quality.nameFontSize, colors.nameColor);

  y -= (quality.nameFontSize - quality.subTitleFontSize) / 2;
  x += nameWidth + quality.cardPadding;
  drawText(rt, ctx, time, x, y, quality.subTitleFontSize, colors.subTitleColor);

  const image = surface.makeImageSnapshot();
  surface.delete();
  return image;
}

/* ------------------------------------------------------------------ */
/* 卡片装饰                                                             */
/* ------------------------------------------------------------------ */

/** 粉丝卡片 / 二维码装饰，对应 Canvas.drawOrnament */
export async function drawOrnament(
  rt: DrawRuntime,
  ctx: SkCtx,
  author: AuthorInfo,
  link: string,
  themeColor: ColorInt,
): Promise<void> {
  const { quality, colors } = rt;
  const ornament = rt.imageConfig.cardOrnament;

  if (ornament === 'FanCard') {
    if (!author.fanCardUrl) return;
    const fanImg = await rt.store.get(author.fanCardUrl);
    if (!fanImg) return;

    const cardHeight =
      author.fanType === 1 || author.fanType === 2
        ? quality.ornamentHeight * 0.6
        : quality.ornamentHeight;
    const cardWidth = (fanImg.width() * cardHeight) / fanImg.height();

    const y = (quality.faceSize - cardHeight + quality.contentSpace) / 2;
    const tarFRect = makeXYWH(
      rt.cardContentRect.right - cardWidth - Math.abs(y),
      y + quality.cardPadding,
      cardWidth,
      cardHeight,
    );

    withPaint(rt.ck, (p) => {
      p.setAntiAlias(true);
      ctx.canvas.drawImageRectOptions(
        fanImg,
        toSkRect(makeXYWH(0, 0, fanImg.width(), fanImg.height())),
        toSkRect(tarFRect),
        rt.ck.FilterMode.Linear,
        rt.ck.MipmapMode.None,
      );
    });

    if (author.fanType === 3 && author.fanNumStr && rt.fonts.fansCard) {
      const font = rt.fonts.fansCard;
      const fanWidth = measureTextWidth(font, author.fanNumStr);
      const fanColor = author.fanColor ?? 0xffffffff;
      withPaint(rt.ck, (p) => {
        p.setColor(skColor(rt, fanColor));
        p.setAntiAlias(true);
        ctx.canvas.drawText(
          author.fanNumStr!,
          tarFRect.right - fanWidth * 2,
          tarFRect.bottom - (cardHeight - font.getSize()) / 2,
          p,
          font,
        );
      });
    }
    return;
  }

  if (ornament === 'QrCode') {
    const qrCodeImg = await qrCodeImage(rt.ck, link, Math.round(quality.ornamentHeight), themeColor);
    const y = (quality.faceSize - qrCodeImg.height() + quality.contentSpace) / 2;
    const tarFRect = makeXYWH(
      rt.cardContentRect.right - qrCodeImg.width() - Math.abs(y),
      y + quality.cardPadding,
      qrCodeImg.width(),
      qrCodeImg.height(),
    );
    withPaint(rt.ck, (p) => {
      p.setAntiAlias(true);
      ctx.canvas.drawImageRectOptions(
        qrCodeImg,
        toSkRect(makeXYWH(0, 0, qrCodeImg.width(), qrCodeImg.height())),
        toSkRect(tarFRect),
        rt.ck.FilterMode.Linear,
        rt.ck.MipmapMode.None,
      );
    });
    qrCodeImg.delete();
  }
}

/**
 * 生成二维码图片，对应 QrCodeDraw.qrCode。
 * margin=0；前景色过亮（RGB 分量和 > 382）时提升饱和度 0.25；背景完全透明。
 */
export async function qrCodeImage(
  ck: DrawRuntime['ck'],
  url: string,
  width: number,
  color: ColorInt,
): Promise<SkImage> {
  const [r, g, b] = getRGB(color);
  let fg = color;
  if (r + g + b > 382) {
    const hsb = rgb2hsb(r, g, b);
    hsb[1] = hsb[1] + 0.25 > 1 ? 1 : hsb[1] + 0.25;
    const rgb = hsb2rgb(hsb[0], hsb[1], hsb[2]);
    fg = makeRGB(rgb[0], rgb[1], rgb[2]);
  }

  const hex = (n: number) => n.toString(16).padStart(2, '0');
  const buffer = await QRCode.toBuffer(url, {
    width,
    margin: 0,
    color: {
      dark: `#${hex((fg >>> 16) & 0xff)}${hex((fg >>> 8) & 0xff)}${hex(fg & 0xff)}ff`,
      light: '#ffffff00',
    },
  });

  const image = ck.MakeImageFromEncoded(new Uint8Array(buffer));
  if (!image) throw new Error('二维码解码失败');
  return image;
}

/* ------------------------------------------------------------------ */
/* 角标与标签                                                           */
/* ------------------------------------------------------------------ */

/** 顶部角标，对应 Canvas.drawBadge。radii 顺序：左上/右上/右下/左下 */
export function drawBadge(
  rt: DrawRuntime,
  ctx: SkCtx,
  text: string,
  fontColor: ColorInt,
  bgColor: ColorInt,
  cardRect: Rect,
  position: Position,
  icon?: SkImage | null,
): void {
  const { quality, colors } = rt;
  const font = rt.fonts.main;
  const textWidth = measureTextWidth(font, text);
  const capHeight = measureCapHeight(rt.ck, font);
  const iconWidth = icon ? icon.width() : 0;
  const badgeWidth = textWidth + quality.badgePadding * 8 + iconWidth;

  const tl = position === Position.TOP_LEFT || position === Position.TOP_RIGHT ? quality.badgeArc : 0;
  const bl = position === Position.BOTTOM_LEFT || position === Position.BOTTOM_RIGHT ? quality.badgeArc : 0;
  const radii: [number, number, number, number] = [tl, tl, bl, bl];

  const left = position === Position.TOP_RIGHT || position === Position.BOTTOM_RIGHT
    ? cardRect.right - badgeWidth
    : cardRect.left;
  const top = position === Position.TOP_LEFT || position === Position.TOP_RIGHT
    ? cardRect.top - quality.badgeHeight
    : cardRect.bottom + quality.badgeHeight;

  const rrect: RRect = { ...makeXYWH(left, top, badgeWidth, quality.badgeHeight), radii };

  drawRectShadow(ctx, inflateRRect(rrect, 1), colors.smallCardShadow);
  drawCard(ctx, rrect, {
    bgColor,
    outlineColors: colors.cardOutlineColors,
    outlineWidth: quality.cardOutlineWidth,
  });

  let x = rrect.left + quality.badgePadding * 4;
  if (icon) {
    x -= quality.badgePadding;
    ctx.canvas.drawImage(icon, x, rrect.top + (quality.badgeHeight - icon.height()) / 2);
    x += iconWidth + quality.badgePadding * 2;
  }

  withPaint(rt.ck, (p) => {
    p.setColor(skColor(rt, fontColor));
    p.setAntiAlias(true);
    ctx.canvas.drawText(
      text,
      x,
      rrect.bottom - (quality.badgeHeight - capHeight) / 2,
      p,
      font,
    );
  });
}

/** 小型标签卡片，对应 Canvas.drawLabelCard */
export function drawLabelCard(
  rt: DrawRuntime,
  ctx: SkCtx,
  text: string,
  x: number,
  y: number,
  fontColor: ColorInt,
  bgColor: ColorInt,
  fontSize?: number,
): void {
  const { quality } = rt;
  const font = fontSize ? withFont(rt, fontSize) : rt.fonts.main;
  const textWidth = measureTextWidth(font, text);
  const lineHeight = measureLineHeight(font);
  const capHeight = measureCapHeight(rt.ck, font);

  const rrect: RRect = {
    ...makeXYWH(x, y, textWidth + quality.badgePadding * 4, lineHeight + quality.badgePadding / 2),
    radii: quality.badgeArc,
  };

  fillRRect(ctx, rrect, bgColor);

  withPaint(rt.ck, (p) => {
    p.setColor(skColor(rt, fontColor));
    p.setAntiAlias(true);
    ctx.canvas.drawText(
      text,
      rrect.left + quality.badgePadding * 2,
      rrect.bottom - (rrect.bottom - rrect.top - capHeight) / 2,
      p,
      font,
    );
  });

  if (fontSize) font.delete();
}

/* ------------------------------------------------------------------ */
/* 占位与组装                                                           */
/* ------------------------------------------------------------------ */

/** 专属动态占位图，对应 drawBlockedDefault。bgImage 由调用方传入 */
export function drawBlockedDefault(rt: DrawRuntime, bgImage: SkImage): SkImage {
  const { quality } = rt;
  const bgWidth = rectW(rt.cardContentRect) - 2 * quality.cardPadding;
  const bgHeight = (bgImage.height() / bgImage.width()) * bgWidth;

  const paragraph = makeParagraph(
    rt.textEnv,
    {
      textStyle: { fontSize: quality.titleFontSize, color: 0xffffffff },
      maxLines: 2,
      ellipsis: '...',
      textAlign: 'center',
    },
    '此动态为专属动态\n请自行查看详情内容',
    bgWidth,
  );

  const surface = makeSurface(
    rt.ck,
    rectW(rt.cardContentRect),
    bgHeight + 3 * quality.cardPadding,
  );
  const ctx: SkCtx = { ck: rt.ck, canvas: surface.getCanvas() };

  const x = quality.cardPadding;
  let y = quality.cardPadding;
  drawImageClip(ctx, bgImage, { ...makeXYWH(x, y, bgWidth, bgHeight), radii: quality.cardArc });

  y += (bgHeight - paragraph.getHeight()) / 2;
  paintParagraph(ctx, paragraph, x, y);
  paragraph.delete();

  const image = surface.makeImageSnapshot();
  surface.delete();
  return image;
}

export interface AssembleOptions {
  /** 动态 id，显示于右侧角标 */
  id?: string;
  footer?: string | null;
  plusHeight?: number;
  isForward?: boolean;
  tag?: string | null;
  /** 主角标图标（BILIBILI_LOGO / FORWARD 的预渲染结果） */
  badgeIcon?: SkImage | null;
}

/**
 * 整卡组装，对应 List<Image>.assembleCard。
 * 结构：外阴影 -> 左右角标 -> 卡片底板 -> 模块图片自上而下拼贴 -> 页脚。
 */
export function assembleCard(
  rt: DrawRuntime,
  images: SkImage[],
  opts: AssembleOptions = {},
): SkImage {
  const { quality, colors } = rt;
  const cardW = rectW(rt.cardRect);

  let height = 0;
  for (const img of images) {
    height += img.width() > cardW
      ? Math.trunc((cardW * img.height()) / img.width() + quality.contentSpace)
      : img.height() + quality.contentSpace;
  }
  height += opts.plusHeight ?? 0;

  const footer = opts.footer
    ? makeParagraph(
        rt.textEnv,
        {
          textStyle: { fontSize: quality.footerFontSize, color: colors.footerColor },
          maxLines: 2,
          ellipsis: '...',
        },
        opts.footer,
        cardW,
      )
    : null;

  const margin = opts.isForward ? quality.cardPadding * 2 : quality.cardMargin * 2;

  const surface = makeSurface(
    rt.ck,
    cardW + margin,
    height + quality.badgeHeight + margin + (footer ? Math.trunc(footer.getHeight()) : 0),
  );
  const ctx: SkCtx = { ck: rt.ck, canvas: surface.getCanvas() };

  const rrect: RRect = {
    ...makeXYWH(margin / 2, quality.badgeHeight + margin / 2, cardW, height),
    radii: rt.cardBadgeArc,
  };

  drawRectShadow(ctx, inflateRRect(rrect, 1), opts.isForward ? colors.smallCardShadow : colors.cardShadow);

  if (rt.imageConfig.badgeEnable.left) {
    drawBadge(
      rt,
      ctx,
      opts.tag ?? (opts.isForward ? '转发动态' : '动态'),
      colors.mainLeftBadge.fontColor,
      colors.mainLeftBadge.bgColor,
      rrect,
      Position.TOP_LEFT,
      opts.badgeIcon,
    );
  }
  if (rt.imageConfig.badgeEnable.right && opts.id) {
    drawBadge(
      rt,
      ctx,
      opts.id,
      colors.mainRightBadge.fontColor,
      colors.mainRightBadge.bgColor,
      rrect,
      Position.TOP_RIGHT,
    );
  }

  drawCard(ctx, rrect, {
    bgColor: colors.cardBgColor,
    outlineColors: colors.cardOutlineColors,
    outlineWidth: quality.cardOutlineWidth,
  });

  let top = quality.cardMargin + quality.badgeHeight;
  for (const img of images) {
    drawScaleWidthImage(ctx, img, cardW, quality.cardMargin, top);
    top += img.width() > cardW
      ? Math.trunc((cardW * img.height()) / img.width() + quality.contentSpace)
      : img.height() + quality.contentSpace;
  }

  if (footer) {
    paintParagraph(ctx, footer, rt.cardRect.left, rrect.bottom + quality.cardMargin / 2);
    footer.delete();
  }

  const image = surface.makeImageSnapshot();
  surface.delete();
  return image;
}

/** 渐变底图合成，对应 makeDrawDynamic 中的 makeCardBg */
export function composeDynamicCard(
  rt: DrawRuntime,
  cardImage: SkImage,
  colors: ColorInt[],
): SkImage {
  const width = rt.quality.imageWidth;
  const height = cardImage.height();
  const surface = makeSurface(rt.ck, width, height);
  const ctx: SkCtx = { ck: rt.ck, canvas: surface.getCanvas() };

  const gradient = generateLinearGradient(colors, rt.imageConfig.colorGenerator);
  withPaint(rt.ck, (p) => {
    p.setStyle(rt.ck.PaintStyle.Fill);
    p.setShader(
      rt.ck.Shader.MakeLinearGradient(
        [0, 0],
        [width, height],
        gradient.map((c) => skColor(rt, c)),
        null,
        rt.ck.TileMode.Clamp,
      ),
    );
    ctx.canvas.drawRect(new Float32Array([0, 0, width, height]), p);
  });

  ctx.canvas.drawImage(cardImage, 0, 0);

  const image = surface.makeImageSnapshot();
  surface.delete();
  return image;
}

/* ------------------------------------------------------------------ */
/* 内部工具                                                             */
/* ------------------------------------------------------------------ */

function skColor(rt: DrawRuntime, color: ColorInt): Float32Array {
  const a = ((color >>> 24) & 0xff) / 255;
  const r = ((color >>> 16) & 0xff) / 255;
  const g = ((color >>> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  return rt.ck.Color4f(r, g, b, a);
}

function rectW(r: Rect | RRect): number {
  return r.right - r.left;
}

function rectH(r: Rect | RRect): number {
  return r.bottom - r.top;
}

function inflateRRect(r: RRect, delta: number): RRect {
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

function withFont(rt: DrawRuntime, size: number): SkFontType {
  return new rt.ck.Font(rt.fonts.mainTypeface, size);
}

/** 供上层绘制文本的便捷封装 */
export function drawText(
  rt: DrawRuntime,
  ctx: SkCtx,
  text: string,
  x: number,
  y: number,
  size: number,
  color: ColorInt,
): void {
  const font = size === rt.quality.contentFontSize
    ? rt.fonts.main
    : new rt.ck.Font(rt.fonts.mainTypeface, size);
  withPaint(rt.ck, (p) => {
    p.setColor(skColor(rt, color));
    p.setAntiAlias(true);
    ctx.canvas.drawText(text, x, y, p, font);
  });
  if (font !== rt.fonts.main) font.delete();
}
