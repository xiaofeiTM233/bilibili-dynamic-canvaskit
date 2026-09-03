/**
 * 几何类型 —— 对应 Skia 的 Rect / RRect / Point
 *
 * 采用与原实现一致的 left/top/right/bottom 表示（而非 x/y/width/height），
 * 便于逐行照搬坐标计算逻辑，避免换算引入偏差。
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 圆角半径：统一值，或 [左上, 右上, 右下, 左下]（与 Canvas2D roundRect 顺序一致） */
export type Radii = number | [number, number, number, number];

export interface RRect extends Rect {
  radii: Radii;
}

/** 角标/标签挂载位置 */
export enum Position {
  TOP_LEFT = 'TOP_LEFT',
  TOP_RIGHT = 'TOP_RIGHT',
  BOTTOM_LEFT = 'BOTTOM_LEFT',
  BOTTOM_RIGHT = 'BOTTOM_RIGHT',
}

export const makeXYWH = (left: number, top: number, width: number, height: number): Rect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

export const makeLTRB = (left: number, top: number, right: number, bottom: number): Rect => ({
  left,
  top,
  right,
  bottom,
});

export const rectWidth = (r: Rect): number => r.right - r.left;
export const rectHeight = (r: Rect): number => r.bottom - r.top;

/** 各边向外（delta 为负则向内）扩展 */
export const inflate = (r: Rect, delta: number): Rect =>
  makeLTRB(r.left - delta, r.top - delta, r.right + delta, r.bottom + delta);

export const offsetRect = (r: Rect, dx: number, dy: number): Rect =>
  makeLTRB(r.left + dx, r.top + dy, r.right + dx, r.bottom + dy);

export const isEmpty = (r: Rect): boolean => r.left >= r.right || r.top >= r.bottom;

export const rectToRRect = (r: Rect, radii: Radii): RRect => ({ ...r, radii });

export const makeRRectXYWH = (
  left: number,
  top: number,
  width: number,
  height: number,
  radii: Radii,
): RRect => ({ ...makeXYWH(left, top, width, height), radii });

/** 平移 RRect，保留原有圆角（对应 RRect.offsetR） */
export const offsetRRect = (r: RRect, dx: number, dy: number): RRect => ({
  ...offsetRect(r, dx, dy),
  radii: r.radii,
});

/** 将 Radii 归一为 Canvas2D roundRect 所需的四元组 */
export const normalizeRadii = (radii: Radii): [number, number, number, number] =>
  typeof radii === 'number' ? [radii, radii, radii, radii] : radii;
