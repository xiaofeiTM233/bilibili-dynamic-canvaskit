/**
 * 颜色与渐变算法 —— 移植自 General.kt
 *
 * 移植原则：忠实还原 Kotlin 实现的数值语义，包括浮点截断与 NaN 传播行为。
 * 原实现对纯灰/纯白存在除零产生 NaN 的情形（hsbH = 0 * 60 / 0），该行为被刻意保留，
 * 以保证两端输出一致；Kotlin 的 Double.toInt() 对 NaN 返回 0，JS 中对应 (x | 0)。
 */

/** Skia ColorInt：0xAARRGGBB，以无符号 32 位整数表示 */
export type ColorInt = number;

export const WHITE: ColorInt = 0xffffffff;
export const BLACK: ColorInt = 0xff000000;
export const BLUE: ColorInt = 0xff2196f3;
export const GREEN: ColorInt = 0xff4caf50;

export const makeRGB = (r: number, g: number, b: number): ColorInt =>
  (((255 << 24) | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)) >>> 0);

export const makeARGB = (a: number, r: number, g: number, b: number): ColorInt =>
  ((((a & 0xff) << 24) | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)) >>> 0);

export const getA = (color: ColorInt): number => (color >>> 24) & 0xff;
export const getR = (color: ColorInt): number => (color >>> 16) & 0xff;
export const getG = (color: ColorInt): number => (color >>> 8) & 0xff;
export const getB = (color: ColorInt): number => color & 0xff;

export const getRGB = (color: ColorInt): [number, number, number] => [
  getR(color),
  getG(color),
  getB(color),
];

/** 解析 #RRGGBB 或 #AARRGGBB */
export function colorFromHex(hex: string): ColorInt {
  if (!hex.startsWith('#')) throw new Error('Hex format error: ' + hex);
  if (hex.length !== 7 && hex.length !== 9) {
    throw new Error('Hex length error: ' + hex);
  }
  if (hex.length === 7) {
    return makeRGB(
      parseInt(hex.substring(1, 3), 16),
      parseInt(hex.substring(3, 5), 16),
      parseInt(hex.substring(5), 16),
    );
  }
  return makeARGB(
    parseInt(hex.substring(1, 3), 16),
    parseInt(hex.substring(3, 5), 16),
    parseInt(hex.substring(5, 7), 16),
    parseInt(hex.substring(7), 16),
  );
}

/** ColorInt -> CSS rgba() 字符串，供 Canvas2D 使用 */
export function toCssColor(color: ColorInt): string {
  const a = getA(color);
  if (a === 255) return `rgb(${getR(color)},${getG(color)},${getB(color)})`;
  const alpha = Math.round((a / 255) * 1000) / 1000;
  return `rgba(${getR(color)},${getG(color)},${getB(color)},${alpha})`;
}

/** RGB -> HSB，返回 [h, s, b]，h 单位为度 */
export function rgb2hsb(rgbR: number, rgbG: number, rgbB: number): [number, number, number] {
  const rgb = [rgbR, rgbG, rgbB].sort((a, b) => a - b);
  const max = rgb[2];
  const min = rgb[0];
  const hsbB = max / 255.0;
  const hsbS: number = max === 0 ? 0 : (max - min) / max;
  let hsbH = 0;

  if (max === rgbR && rgbG >= rgbB) {
    hsbH = ((rgbG - rgbB) * 60) / (max - min) + 0;
  } else if (max === rgbR && rgbG < rgbB) {
    hsbH = ((rgbG - rgbB) * 60) / (max - min) + 360;
  } else if (max === rgbG) {
    hsbH = ((rgbB - rgbR) * 60) / (max - min) + 120;
  } else if (max === rgbB) {
    hsbH = ((rgbR - rgbG) * 60) / (max - min) + 240;
  }
  return [hsbH, hsbS, hsbB];
}

/** HSB -> RGB，返回 [r, g, b]，各分量 0-255 */
export function hsb2rgb(h: number, s: number, v: number): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  // Kotlin: (h / 60 % 6).toInt() —— 截断向零，NaN 时输出 0
  const i = (((h / 60) % 6) | 0) as number;
  const f = h / 60 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
    default:
      break;
  }
  // Kotlin: (x * 255.0).toInt() —— NaN 归零
  return [((r * 255.0) | 0), ((g * 255.0) | 0), ((b * 255.0) | 0)];
}

/** 渐变生成器配置，对应 BiliConfig.imageConfig.colorGenerator */
export interface ColorGeneratorConfig {
  /** 锁定饱和度与亮度 */
  lockSB: boolean;
  /** 饱和度 */
  saturation: number;
  /** 亮度 */
  brightness: number;
  /** 色相步长（度） */
  hueStep: number;
}

/**
 * 生成线性渐变色数组。
 * - 单色：依据 hueStep 向两侧推导共 3 阶色
 * - 多色：直接使用给定色序列
 */
export function generateLinearGradient(
  colors: ColorInt[],
  colorGenerator: ColorGeneratorConfig,
): ColorInt[] {
  if (colors.length === 1) {
    const hsb = rgb2hsb(getR(colors[0]), getG(colors[0]), getB(colors[0]));
    if (colorGenerator.lockSB) {
      hsb[1] = colorGenerator.saturation;
      hsb[2] = colorGenerator.brightness;
    }
    const linearLayerCount = 3;
    const linearLayerStep = colorGenerator.hueStep;
    const llc = linearLayerCount % 2 === 0 ? linearLayerCount + 1 : linearLayerCount;
    const ia: ColorInt[] = new Array(llc);
    // Kotlin 整数除法：3 / 2 === 1
    hsb[0] = (hsb[0] + ((linearLayerCount / 2) | 0) * linearLayerStep) % 360;
    for (let it = 0; it < llc; it++) {
      const c = hsb2rgb(hsb[0], hsb[1], hsb[2]);
      ia[it] = makeRGB(c[0], c[1], c[2]);
      hsb[0] = hsb[0] - linearLayerStep < 0 ? hsb[0] + 360 - linearLayerStep : hsb[0] - linearLayerStep;
    }
    return ia;
  }

  const llc = colors.length;
  const ia: ColorInt[] = new Array(llc);
  for (let it = 0; it < llc; it++) {
    const hsb = rgb2hsb(getR(colors[it]), getG(colors[it]), getB(colors[it]));
    if (colorGenerator.lockSB) {
      hsb[1] = colorGenerator.saturation;
      hsb[2] = colorGenerator.brightness;
    }
    const c = hsb2rgb(hsb[0], hsb[1], hsb[2]);
    ia[it] = makeRGB(c[0], c[1], c[2]);
  }
  return ia;
}
