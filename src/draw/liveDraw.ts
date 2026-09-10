/**
 * 直播卡片 —— 移植自 LiveDraw.kt
 *
 * 结构：作者区（头像 + 标题/时间 + 二维码装饰）与封面上下拼接，
 * 外层复用 assembleCard 同款的外阴影 + 角标 + 底板布局。
 */

import type { Image as SkImage } from 'canvaskit-wasm';

import {
  colorFromHex,
  generateLinearGradient,
  makeRGB,
  WHITE,
  type ColorInt,
} from '../core/color';
import {
  drawCard,
  drawImageRRectFull,
  drawRectShadow,
  drawScaleWidthImage,
  type SkCtx,
  toSkRect,
  withPaint,
} from '../core/canvas';
import { makeXYWH, Position, type RRect } from '../core/geometry';
import { makeParagraph, paintParagraph } from '../core/text';
import { makeSurface } from '../core/skia';
import { imgApi } from '../utils/images';
import { drawAvatar, drawBadge, qrCodeImage } from './dynamicDraw';
import type { DrawRuntime } from './runtime';

/** 绘制所需的直播信息 */
export interface LiveInfoDraw {
  uid: number;
  uname: string;
  roomId: number;
  title: string;
  face: string;
  cover: string;
  /** 已格式化的开播时间文本 */
  liveTimeText: string;
  /** 分区名（供 FanCard 标签，未启用） */
  area?: string | null;
}

export interface LiveDrawOptions {
  /** 直播页脚模板，支持 {name}/{uid}/{id}/{time}/{type} 占位符 */
  liveFooter?: string | null;
  badgeIcon?: SkImage | null;
}

/** 作者区，对应 LiveInfo.drawAvatar */
export async function drawLiveAvatar(
  rt: DrawRuntime,
  live: LiveInfoDraw,
  opts: LiveDrawOptions = {},
): Promise<SkImage> {
  const { quality, colors } = rt;
  const surface = makeSurface(rt.ck, rectW(rt.cardRect), Math.trunc(quality.faceSize + quality.cardPadding * 2));
  const ctx: SkCtx = { ck: rt.ck, canvas: surface.getCanvas() };

  await drawAvatar(rt, ctx, live.face, null, null, quality.faceSize, quality.verifyIconSize);

  const w =
    rectW(rt.cardContentRect) -
    quality.pendantSize -
    (rt.imageConfig.cardOrnament === 'QrCode' ? quality.ornamentHeight : 0);

  const titleParagraph = makeParagraph(
    rt.textEnv,
    { textStyle: { fontSize: quality.nameFontSize, color: colors.titleColor }, maxLines: 1, ellipsis: '...' },
    live.title,
    w,
  );
  const timeParagraph = makeParagraph(
    rt.textEnv,
    { textStyle: { fontSize: quality.subTitleFontSize, color: colors.descColor }, maxLines: 1, ellipsis: '...' },
    `${live.uname}  ${live.liveTimeText}`,
    w,
  );

  const x = quality.faceSize + quality.cardPadding * 3;
  const space = (quality.pendantSize - quality.nameFontSize - quality.subTitleFontSize) / 3;
  let y = space * 1.25;

  paintParagraph(ctx, titleParagraph, x, y);
  y += quality.nameFontSize + space * 0.5;
  paintParagraph(ctx, timeParagraph, x, y);

  titleParagraph.delete();
  timeParagraph.delete();

  // 二维码装饰
  if (rt.imageConfig.cardOrnament === 'QrCode') {
    const qr = await qrCodeImage(rt.ck, `https://live.bilibili.com/${live.roomId}`, Math.round(quality.ornamentHeight), themeColorOf(rt));
    const qy = (quality.faceSize - qr.height() + quality.contentSpace) / 2;
    const tar = makeXYWH(rectW(rt.cardRect) - qr.width() - Math.abs(qy), qy + quality.cardPadding, qr.width(), qr.height());
    withPaint(rt.ck, (p) => {
      p.setAntiAlias(true);
      ctx.canvas.drawImageRectOptions(
        qr,
        toSkRect(makeXYWH(0, 0, qr.width(), qr.height())),
        toSkRect(tar),
        rt.ck.FilterMode.Linear,
        rt.ck.MipmapMode.None,
      );
    });
    qr.delete();
  }

  const image = surface.makeImageSnapshot();
  surface.delete();
  return image;
}

/** 直播卡片主体，对应 LiveInfo.drawLive */
export async function drawLive(
  rt: DrawRuntime,
  live: LiveInfoDraw,
  opts: LiveDrawOptions = {},
): Promise<SkImage> {
  const { quality, colors } = rt;
  const margin = quality.cardMargin * 2;

  const avatar = await drawLiveAvatar(rt, live, opts);

  const fw = rectW(rt.cardRect) - quality.cardOutlineWidth / 2;
  const fallbackUrl = imgApi(live.cover, Math.trunc(fw), Math.trunc(fw * 0.625));
  const cover = await rt.store.getOrDefault(live.cover, fallbackUrl);

  const height = Math.trunc(
    avatar.height() + quality.contentSpace + (cover.height() * rectW(rt.cardRect)) / cover.width(),
  );

  const footerText = opts.liveFooter?.replace('{name}', live.uname)
    .replace('{uid}', String(live.uid))
    .replace('{id}', String(live.roomId))
    .replace('{time}', live.liveTimeText)
    .replace('{type}', '直播');
  const footer = footerText
    ? makeParagraph(
        rt.textEnv,
        { textStyle: { fontSize: quality.footerFontSize, color: colors.footerColor }, maxLines: 2, ellipsis: '...' },
        footerText,
        rectW(rt.cardRect),
      )
    : null;

  const surface = makeSurface(
    rt.ck,
    rectW(rt.cardRect) + margin,
    height + quality.badgeHeight + margin + (footer ? Math.trunc(footer.getHeight()) : 0),
  );
  const ctx: SkCtx = { ck: rt.ck, canvas: surface.getCanvas() };

  const rrect: RRect = {
    ...makeXYWH(margin / 2, quality.badgeHeight + margin / 2, rectW(rt.cardRect), height),
    radii: rt.cardBadgeArc,
  };

  drawRectShadow(ctx, inflateR(rrect, 1), colors.cardShadow);

  if (rt.imageConfig.badgeEnable.left) {
    drawBadge(
      rt, ctx, '直播',
      colors.mainLeftBadge.fontColor, colors.mainLeftBadge.bgColor,
      rrect, Position.TOP_LEFT,
      opts.badgeIcon ?? null,
    );
  }
  if (rt.imageConfig.badgeEnable.right) {
    drawBadge(
      rt, ctx, String(live.roomId),
      WHITE, makeRGB(72, 199, 240),
      rrect, Position.TOP_RIGHT,
    );
  }

  drawCard(ctx, rrect, {
    bgColor: colors.cardBgColor,
    outlineColors: colors.cardOutlineColors,
    outlineWidth: quality.cardOutlineWidth,
  });

  let top = quality.cardMargin + quality.badgeHeight;
  drawScaleWidthImage(ctx, avatar, rectW(rt.cardRect), quality.cardMargin, top);
  top += avatar.height() + quality.contentSpace;

  const dst: RRect = {
    ...makeXYWH(
      quality.cardMargin,
      top,
      rectW(rt.cardRect) - quality.cardOutlineWidth / 2,
      (rectW(rt.cardRect) * cover.height()) / cover.width() - quality.cardOutlineWidth / 2,
    ),
    radii: quality.cardArc,
  };
  drawImageRRectFull(ctx, cover, dst);

  if (footer) {
    paintParagraph(ctx, footer, rt.cardRect.left, rrect.bottom + quality.cardMargin / 2);
    footer.delete();
  }

  avatar.delete();

  const image = surface.makeImageSnapshot();
  surface.delete();
  return image;
}

/** 直播卡片渐变底图合成，对应 LiveInfo.makeDrawLive */
export function composeLiveCard(rt: DrawRuntime, card: SkImage, colors: ColorInt[]): SkImage {
  const width = rt.quality.imageWidth;
  const height = card.height();
  const surface = makeSurface(rt.ck, width, height);
  const ctx: SkCtx = { ck: rt.ck, canvas: surface.getCanvas() };

  const gradient = generateLinearGradient(colors, rt.imageConfig.colorGenerator);
  withPaint(rt.ck, (p) => {
    p.setStyle(rt.ck.PaintStyle.Fill);
    p.setShader(
      rt.ck.Shader.MakeLinearGradient(
        [0, 0],
        [width, height],
        gradient.map((c) =>
          rt.ck.Color4f(
            ((c >>> 16) & 0xff) / 255,
            ((c >>> 8) & 0xff) / 255,
            (c & 0xff) / 255,
            ((c >>> 24) & 0xff) / 255,
          ),
        ),
        null,
        rt.ck.TileMode.Clamp,
      ),
    );
    ctx.canvas.drawRect(new Float32Array([0, 0, width, height]), p);
  });

  ctx.canvas.drawImage(card, 0, 0);
  const image = surface.makeImageSnapshot();
  surface.delete();
  return image;
}

/* ------------------------------------------------------------------ */
/* 内部工具                                                             */
/* ------------------------------------------------------------------ */

function rectW(r: { right: number; left: number }): number {
  return r.right - r.left;
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

function themeColorOf(rt: DrawRuntime): ColorInt {
  return colorFromHex(rt.imageConfig.defaultColor.split(';')[0]);
}
