/**
 * 绘图原语 —— 移植自 General.kt / DynamicDraw.kt，基于 CanvasKit 原生 API
 *
 * 相比 Canvas2D 路线的优势：
 * 1. 原生支持 ClipOp.Difference，可直接对应 Skia 的 ClipMode.DIFFERENCE（阴影挖空）；
 * 2. 原生支持 MaskFilter.MakeBlur，与 Skia 的模糊语义一致；
 * 3. 原生支持 Shader.MakeSweepGradient，对应卡片描边的扫描渐变。
 *
 * 内存约定：CanvasKit 的 Paint / Image 等 Embind 对象需显式 delete()，
 * 本模块内的临时 Paint 由 withPaint 统一回收；调用方持有的 Image 生命周期由调用方负责。
 * Surface 例外：MakeSurface 自行分配的像素缓冲只能由 dispose() 释放，必须用 dispose() 而非 delete()
 * （见 core/skia.ts 头部说明）。
 */

import type { Canvas, Image as SkImage, Paint } from 'canvaskit-wasm';

import { getA, getB, getG, getR, type ColorInt } from './color';
import {
  inflate,
  isEmpty,
  makeXYWH,
  rectHeight,
  rectWidth,
  type RRect,
  type Rect,
} from './geometry';
import type { CK } from './skia';

/** 绘制上下文，承载 CanvasKit 实例与当前 Canvas */
export interface SkCtx {
  ck: CK;
  canvas: Canvas;
}

/* ------------------------------------------------------------------ */
/* 类型转换                                                             */
/* ------------------------------------------------------------------ */

/** Rect -> CanvasKit 的 [left, top, right, bottom] */
export const toSkRect = (r: Rect): Float32Array =>
  new Float32Array([r.left, r.top, r.right, r.bottom]);

/**
 * RRect -> CanvasKit 的 12 元素数组。
 * Skia RRect 内存布局：rect(4) + 四角半径(8)，角序为 左上/右上/右下/左下。
 */
export function toSkRRect(r: RRect): Float32Array {
  const [tl, tr, br, bl] =
    typeof r.radii === 'number' ? [r.radii, r.radii, r.radii, r.radii] : r.radii;
  return new Float32Array([
    r.left, r.top, r.right, r.bottom,
    tl, tl, tr, tr, br, br, bl, bl,
  ]);
}

/** ColorInt -> CanvasKit 颜色（非预乘，各分量 0-1） */
export function toSkColor(ck: CK, color: ColorInt): Float32Array {
  return ck.Color4f(getR(color) / 255, getG(color) / 255, getB(color) / 255, getA(color) / 255);
}

/** 临时 Paint 的统一回收 */
export function withPaint<T>(ck: CK, fn: (p: Paint) => T): T {
  const paint = new ck.Paint();
  try {
    return fn(paint);
  } finally {
    paint.delete();
  }
}

/* ------------------------------------------------------------------ */
/* 基础绘制                                                             */
/* ------------------------------------------------------------------ */

export function fillRRect(ctx: SkCtx, r: RRect, color: ColorInt): void {
  withPaint(ctx.ck, (p) => {
    p.setColor(toSkColor(ctx.ck, color));
    p.setStyle(ctx.ck.PaintStyle.Fill);
    p.setAntiAlias(true);
    ctx.canvas.drawRRect(toSkRRect(r), p);
  });
}

export function strokeRRect(
  ctx: SkCtx,
  r: RRect,
  color: ColorInt,
  strokeWidth: number,
): void {
  withPaint(ctx.ck, (p) => {
    p.setColor(toSkColor(ctx.ck, color));
    p.setStyle(ctx.ck.PaintStyle.Stroke);
    p.setStrokeWidth(strokeWidth);
    p.setAntiAlias(true);
    ctx.canvas.drawRRect(toSkRRect(r), p);
  });
}

/**
 * 卡片底板：填充背景 + 扫描渐变描边。
 * 对应 drawCard(rrect, bgColor)。
 */
export function drawCard(
  ctx: SkCtx,
  rrect: RRect,
  opts: { bgColor: ColorInt; outlineColors: ColorInt[]; outlineWidth: number },
): void {
  fillRRect(ctx, rrect, opts.bgColor);

  withPaint(ctx.ck, (p) => {
    p.setColor(toSkColor(ctx.ck, opts.outlineColors[0]));
    p.setStyle(ctx.ck.PaintStyle.Stroke);
    p.setStrokeWidth(opts.outlineWidth);
    p.setAntiAlias(true);
    // 对应 Shader.makeSweepGradient(centerX, centerY, colors)
    p.setShader(
      ctx.ck.Shader.MakeSweepGradient(
        rrect.left + rectWidth(rrect) / 2,
        rrect.top + rectHeight(rrect) / 2,
        opts.outlineColors.map((c) => toSkColor(ctx.ck, c)),
        null,
        ctx.ck.TileMode.Clamp,
        0,
        360,
      ),
    );
    ctx.canvas.drawRRect(toSkRRect(rrect), p);
  });
}

/* ------------------------------------------------------------------ */
/* 阴影                                                                 */
/* ------------------------------------------------------------------ */

export interface ShadowConfig {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  shadowColor: ColorInt;
}

const isRRect = (r: Rect | RRect): r is RRect => 'radii' in (r as RRect);

/**
 * Rect/RRect 通用的 inflate。
 * RRect 时 radii 随矩形同步缩放并 clamp 到短边一半（SkRRect::outset 语义，
 * skiko 的 RRect.inflate 即基于此），这是头像外扩后仍为正圆的关键。
 */
function inflateSkShape(r: Rect | RRect, delta: number): Rect | RRect {
  if (!isRRect(r)) return inflate(r, delta);
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

/**
 * 绘制矩形阴影（不裁剪内部）。
 *
 * 注意：原实现中的 drawRectShadowNoclip 定义于外部依赖 mirai-skia-plugin，
 * 本仓库源码中仅有调用。此处按 Skia 惯例实现：
 *   矩形按 spread 外扩 -> MaskFilter 高斯模糊（sigma = blur / 2）-> 按 (dx, dy) 偏移绘制。
 * 该推断待与原插件产物比对校准。
 */
function drawRectShadowNoclip(
  ctx: SkCtx,
  r: Rect | RRect,
  dx: number,
  dy: number,
  blur: number,
  spread: number,
  color: ColorInt,
): void {
  const target = inflateSkShape(r, spread);
  withPaint(ctx.ck, (p) => {
    p.setColor(toSkColor(ctx.ck, color));
    p.setStyle(ctx.ck.PaintStyle.Fill);
    p.setAntiAlias(true);
    p.setMaskFilter(ctx.ck.MaskFilter.MakeBlur(ctx.ck.BlurStyle.Normal, blur / 2, true));
    ctx.canvas.save();
    ctx.canvas.translate(dx, dy);
    if (isRRect(target)) ctx.canvas.drawRRect(toSkRRect(target), p);
    else ctx.canvas.drawRect(toSkRect(target), p);
    ctx.canvas.restore();
  });
}

/**
 * 仅绘制矩形外部阴影：先以 Difference 挖空内部，再绘制阴影，从而避免出现内部灰边。
 * 对应 drawRectShadowAntiAlias。RRect 入参时内外裁剪均保持圆角
 * （skiko 中 RRect extends Rect，Kotlin 端 `insides is RRect` 分支即此语义）。
 */
export function drawRectShadowAntiAlias(
  ctx: SkCtx,
  r: Rect | RRect,
  dx: number,
  dy: number,
  blur: number,
  spread: number,
  color: ColorInt,
): void {
  const insides = inflateSkShape(r, -1);
  if (isEmpty(insides as Rect)) {
    drawRectShadowNoclip(ctx, r, dx, dy, blur, spread, color);
    return;
  }

  ctx.canvas.save();
  // Skia: if (insides is RRect) clipRRect(insides, ClipMode.DIFFERENCE, true) else clipRect(...)
  if (isRRect(insides)) {
    ctx.canvas.clipRRect(toSkRRect(insides), ctx.ck.ClipOp.Difference, true);
  } else {
    ctx.canvas.clipRect(toSkRect(insides), ctx.ck.ClipOp.Difference, true);
  }
  drawRectShadowNoclip(ctx, r, dx, dy, blur, spread, color);
  ctx.canvas.restore();
}

export function drawRectShadow(ctx: SkCtx, r: Rect | RRect, shadow: ShadowConfig): void {
  drawRectShadowAntiAlias(
    ctx,
    r,
    shadow.offsetX,
    shadow.offsetY,
    shadow.blur,
    shadow.spread,
    shadow.shadowColor,
  );
}

/* ------------------------------------------------------------------ */
/* 图片绘制                                                             */
/* ------------------------------------------------------------------ */

/**
 * 将图片按源矩形绘制到圆角矩形内（自动圆角裁剪）。
 * 对应 drawImageRRect(image, srcRect, rRect, paint)。
 */
export function drawImageRRect(
  ctx: SkCtx,
  image: SkImage,
  srcRect: Rect,
  rRect: RRect,
  alpha = 1,
): void {
  withPaint(ctx.ck, (p) => {
    p.setAntiAlias(true);
    p.setAlphaf(alpha);
    // 对应 FilterMipmap(FilterMode.LINEAR, MipmapMode.NEAREST)：显式双线性采样，
    // CanvasKit drawImageRect 的默认采样偏锐，必须显式对齐原实现的柔和语义
    ctx.canvas.save();
    ctx.canvas.clipRRect(toSkRRect(rRect), ctx.ck.ClipOp.Intersect, true);
    ctx.canvas.drawImageRectOptions(
      image,
      toSkRect(srcRect),
      toSkRect({ left: rRect.left, top: rRect.top, right: rRect.right, bottom: rRect.bottom }),
      ctx.ck.FilterMode.Linear,
      ctx.ck.MipmapMode.None,
    );
    ctx.canvas.restore();
  });
}

/** 整图绘制到圆角矩形 */
export function drawImageRRectFull(
  ctx: SkCtx,
  image: SkImage,
  rRect: RRect,
  alpha = 1,
): void {
  drawImageRRect(ctx, image, makeXYWH(0, 0, image.width(), image.height()), rRect, alpha);
}

/** 按宽度等比缩放绘制，对应 drawScaleWidthImage */
export function drawScaleWidthImage(
  ctx: SkCtx,
  image: SkImage,
  width: number,
  x: number,
  y: number,
  alpha = 1,
): void {
  const src = makeXYWH(0, 0, image.width(), image.height());
  const dst = makeXYWH(x, y, width, (width * image.height()) / image.width());
  withPaint(ctx.ck, (p) => {
    p.setAntiAlias(true);
    p.setAlphaf(alpha);
    // 对应 FilterMipmap(FilterMode.LINEAR, MipmapMode.NEAREST)，见 drawImageRRect 注释
    ctx.canvas.drawImageRectOptions(
      image,
      toSkRect(src),
      toSkRect(dst),
      ctx.ck.FilterMode.Linear,
      ctx.ck.MipmapMode.None,
    );
  });
}

/** 按宽度缩放并描边（转发动态的外框标识），对应 drawScaleWidthImageOutline */
export function drawScaleWidthImageOutline(
  ctx: SkCtx,
  image: SkImage,
  width: number,
  x: number,
  y: number,
  outlineColor: ColorInt,
  strokeWidth = 2,
): void {
  drawScaleWidthImage(ctx, image, width, x, y);
  const dst = makeXYWH(x, y, width, (width * image.height()) / image.width());
  strokeRRect(ctx, { ...dst, radii: 0 }, outlineColor, strokeWidth);
}

/**
 * 等比裁剪填充到目标圆角矩形（类似 object-fit: cover）。
 * topClipMode 为 true 时自顶部裁剪，否则垂直居中裁剪。
 */
export function drawImageClip(
  ctx: SkCtx,
  image: SkImage,
  dstRect: RRect,
  topClipMode = false,
  alpha = 1,
): void {
  const iw = image.width();
  const ih = image.height();
  const ratio = iw / ih;
  let srcRect: Rect;

  if (rectWidth(dstRect) / ratio < rectHeight(dstRect)) {
    const imgW = (rectWidth(dstRect) * ih) / rectHeight(dstRect);
    const offsetX = (iw - imgW) / 2;
    srcRect = makeXYWH(offsetX, 0, imgW, ih);
  } else {
    const imgH = (rectHeight(dstRect) * iw) / rectWidth(dstRect);
    const offsetY = topClipMode ? 0 : (ih - imgH) / 2;
    srcRect = makeXYWH(0, offsetY, iw, imgH);
  }

  drawImageRRect(ctx, image, srcRect, dstRect, alpha);
}

/**
 * 生成整卡渐变背景，对应 makeCardBg。
 * 线性渐变自左上至右下，色序由 generateLinearGradient 产出。
 */
export function drawCardBg(
  ctx: SkCtx,
  width: number,
  height: number,
  colors: ColorInt[],
): void {
  const rect = makeXYWH(0, 0, width, height);
  withPaint(ctx.ck, (p) => {
    p.setStyle(ctx.ck.PaintStyle.Fill);
    p.setShader(
      ctx.ck.Shader.MakeLinearGradient(
        [rect.left, rect.top],
        [rect.right, rect.bottom],
        colors.map((c) => toSkColor(ctx.ck, c)),
        null,
        ctx.ck.TileMode.Clamp,
      ),
    );
    ctx.canvas.drawRect(toSkRect(rect), p);
  });
}
