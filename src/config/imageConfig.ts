/**
 * 绘图总配置 —— 移植自 BiliConfig.kt（仅取与绘图相关的部分）
 *
 * Kotlin 端大量使用 Mirai Console 的 ReadOnlyPluginConfig 与 by lazy 委托，
 * 此处改为显式构造 + 缓存，语义保持一致。
 */

import { colorFromHex, type ColorInt } from '../core/color';
import { resolveQuality, type Quality } from './quality';
import { expandTheme, resolveTheme, type ResolvedTheme, type Theme } from './theme';

export interface ColorGeneratorConfig {
  hueStep: number;
  lockSB: boolean;
  saturation: number;
  brightness: number;
}

export interface BadgeEnableConfig {
  left: boolean;
  right: boolean;
}

export interface ImageConfig {
  quality: string | Quality;
  theme: string | Theme;
  font: string;
  defaultColor: string;
  cardOrnament: 'FanCard' | 'QrCode' | 'None';
  colorGenerator: ColorGeneratorConfig;
  badgeEnable: BadgeEnableConfig;
}

export const DEFAULT_IMAGE_CONFIG: ImageConfig = {
  quality: '1000w',
  theme: 'v3',
  font: '',
  defaultColor: '#d3edfa',
  cardOrnament: 'FanCard',
  colorGenerator: {
    hueStep: 30,
    lockSB: true,
    saturation: 0.25,
    brightness: 1,
  },
  badgeEnable: {
    left: true,
    right: false,
  },
};

export const DEFAULT_CUT_LINE = '\n\n〓〓〓 翻译 〓〓〓\n';

/** 一次解析出绘图所需的全部常量，对应 Kotlin 端的 lazy 属性群 */
export interface DrawContext {
  quality: Quality;
  theme: Theme;
  colors: ResolvedTheme;
  imageConfig: ImageConfig;
  /** 默认主题色（用于渐变生成） */
  defaultColors: ColorInt[];
  /** 卡片圆角数组 [左上, 右上, 右下, 左下]，关闭的角标位置取 cardArc */
  cardBadgeArc: [number, number, number, number];
}

export function createDrawContext(imageConfig: ImageConfig = DEFAULT_IMAGE_CONFIG): DrawContext {
  const badgeEnable = imageConfig.badgeEnable.left || imageConfig.badgeEnable.right;
  const quality = resolveQuality(imageConfig.quality, badgeEnable);
  const theme = resolveTheme(imageConfig.theme);

  const left = imageConfig.badgeEnable.left ? 0 : quality.cardArc;
  const right = imageConfig.badgeEnable.right ? 0 : quality.cardArc;

  return {
    quality,
    theme,
    colors: expandTheme(theme),
    imageConfig,
    defaultColors: imageConfig.defaultColor.split(';').map(colorFromHex),
    cardBadgeArc: [left, right, quality.cardArc, quality.cardArc],
  };
}
