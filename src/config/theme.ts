/**
 * 图片主题 —— 移植自 data/DynamicImageTheme.kt
 *
 * 颜色以 #RRGGBB / #AARRGGBB 字符串保存，运行时解析为 ColorInt。
 * cardOutlineColorHex 支持以分号分隔的多色（用于描边渐变）。
 */

import { colorFromHex, type ColorInt } from '../core/color';

export interface Shadow {
  shadowColorHex: string;
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
}

export interface BadgeColor {
  fontColorHex: string;
  bgColorHex: string;
}

export interface Theme {
  cardBgColorHex: string;

  cardOutlineColorHex: string;
  faceOutlineColorHex: string;
  drawOutlineColorHex: string;

  nameColorHex: string;
  titleColorHex: string;
  subTitleColorHex: string;
  descColorHex: string;
  contentColorHex: string;
  linkColorHex: string;
  footerColorHex: string;

  cardShadow: Shadow;
  smallCardShadow: Shadow;

  mainLeftBadge: BadgeColor;
  mainRightBadge: BadgeColor;
  subLeftBadge: BadgeColor;
  subRightBadge: BadgeColor;
}

const shadow = (
  shadowColorHex: string,
  offsetX: number,
  offsetY: number,
  blur: number,
  spread = 0,
): Shadow => ({ shadowColorHex, offsetX, offsetY, blur, spread });

const badge = (fontColorHex: string, bgColorHex: string): BadgeColor => ({
  fontColorHex,
  bgColorHex,
});

export const THEME_PRESETS: Record<string, Theme> = {
  v3: {
    cardBgColorHex: '#B4FFFFFF',

    cardOutlineColorHex: '#FFFFFF',
    faceOutlineColorHex: '#A0FFFFFF',
    drawOutlineColorHex: '#FFFFFF',

    nameColorHex: '#FB7299',
    titleColorHex: '#313131',
    subTitleColorHex: '#9C9C9C',
    descColorHex: '#666666',
    contentColorHex: '#222222',
    linkColorHex: '#178BCF',
    footerColorHex: '#9C9C9C',

    cardShadow: shadow('#46000000', 6, 6, 25, 0),
    smallCardShadow: shadow('#1E000000', 5, 5, 15, 0),

    mainLeftBadge: badge('#00CBFF', '#B4FFFFFF'),
    mainRightBadge: badge('#FFFFFF', '#48C7F0'),
    subLeftBadge: badge('#FFFFFF', '#FB7299'),
    subRightBadge: badge('#FFFFFF', '#48C7F0'),
  },

  v3RainbowOutline: {
    cardBgColorHex: '#B4FFFFFF',

    cardOutlineColorHex: '#ff0000;#ff00ff;#0000ff;#00ffff;#00ff00;#ffff00;#ff0000',
    faceOutlineColorHex: '#A0FFFFFF',
    drawOutlineColorHex: '#FFFFFF',

    nameColorHex: '#FB7299',
    titleColorHex: '#313131',
    subTitleColorHex: '#9C9C9C',
    descColorHex: '#666666',
    contentColorHex: '#222222',
    linkColorHex: '#178BCF',
    footerColorHex: '#9C9C9C',

    cardShadow: shadow('#46000000', 6, 6, 25, 0),
    smallCardShadow: shadow('#1E000000', 5, 5, 15, 0),

    mainLeftBadge: badge('#00CBFF', '#B4FFFFFF'),
    mainRightBadge: badge('#FFFFFF', '#48C7F0'),
    subLeftBadge: badge('#FFFFFF', '#FB7299'),
    subRightBadge: badge('#FFFFFF', '#48C7F0'),
  },

  v2: {
    cardBgColorHex: '#C8FFFFFF',

    cardOutlineColorHex: '#FFFFFF',
    faceOutlineColorHex: '#A0FFFFFF',
    drawOutlineColorHex: '#FFFFFF',

    nameColorHex: '#FB7299',
    titleColorHex: '#313131',
    subTitleColorHex: '#9C9C9C',
    descColorHex: '#666666',
    contentColorHex: '#222222',
    linkColorHex: '#178BCF',
    footerColorHex: '#9C9C9C',

    cardShadow: shadow('#00000000', 0, 0, 0, 0),
    smallCardShadow: shadow('#00000000', 0, 0, 0, 0),

    mainLeftBadge: badge('#00CBFF', '#C8FFFFFF'),
    mainRightBadge: badge('#FFFFFF', '#48C7F0'),
    subLeftBadge: badge('#FFFFFF', '#FB7299'),
    subRightBadge: badge('#FFFFFF', '#48C7F0'),
  },
};

export function resolveTheme(key: string): Theme {
  return THEME_PRESETS[key] ?? THEME_PRESETS['v3'];
}

/** 主题派生值，对应 Kotlin 中的 get() 属性 */
export interface ResolvedTheme {
  cardBgColor: ColorInt;
  cardOutlineColors: ColorInt[];
  faceOutlineColor: ColorInt;
  drawOutlineColor: ColorInt;

  nameColor: ColorInt;
  titleColor: ColorInt;
  subTitleColor: ColorInt;
  descColor: ColorInt;
  contentColor: ColorInt;
  linkColor: ColorInt;
  footerColor: ColorInt;

  cardShadow: Shadow & { shadowColor: ColorInt };
  smallCardShadow: Shadow & { shadowColor: ColorInt };

  mainLeftBadge: BadgeColor & { fontColor: ColorInt; bgColor: ColorInt };
  mainRightBadge: BadgeColor & { fontColor: ColorInt; bgColor: ColorInt };
  subLeftBadge: BadgeColor & { fontColor: ColorInt; bgColor: ColorInt };
  subRightBadge: BadgeColor & { fontColor: ColorInt; bgColor: ColorInt };
}

export function expandTheme(theme: Theme): ResolvedTheme {
  const withShadow = (s: Shadow) => ({ ...s, shadowColor: colorFromHex(s.shadowColorHex) });
  const withBadge = (b: BadgeColor) => ({
    ...b,
    fontColor: colorFromHex(b.fontColorHex),
    bgColor: colorFromHex(b.bgColorHex),
  });

  return {
    cardBgColor: colorFromHex(theme.cardBgColorHex),
    cardOutlineColors: theme.cardOutlineColorHex.split(';').map(colorFromHex),
    faceOutlineColor: colorFromHex(theme.faceOutlineColorHex),
    drawOutlineColor: colorFromHex(theme.drawOutlineColorHex),

    nameColor: colorFromHex(theme.nameColorHex),
    titleColor: colorFromHex(theme.titleColorHex),
    subTitleColor: colorFromHex(theme.subTitleColorHex),
    descColor: colorFromHex(theme.descColorHex),
    contentColor: colorFromHex(theme.contentColorHex),
    linkColor: colorFromHex(theme.linkColorHex),
    footerColor: colorFromHex(theme.footerColorHex),

    cardShadow: withShadow(theme.cardShadow),
    smallCardShadow: withShadow(theme.smallCardShadow),

    mainLeftBadge: withBadge(theme.mainLeftBadge),
    mainRightBadge: withBadge(theme.mainRightBadge),
    subLeftBadge: withBadge(theme.subLeftBadge),
    subRightBadge: withBadge(theme.subRightBadge),
  };
}
