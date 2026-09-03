/**
 * 图片分辨率/布局参数 —— 移植自 data/DynamicImageQuality.kt
 *
 * 数值与 Kotlin 端逐项对齐，不做任何取整或单位换算。
 */

export interface Quality {
  imageWidth: number;
  cardMargin: number;
  cardPadding: number;
  cardArc: number;

  nameFontSize: number;
  titleFontSize: number;
  subTitleFontSize: number;
  descFontSize: number;
  contentFontSize: number;
  footerFontSize: number;

  cardOutlineWidth: number;
  drawOutlineWidth: number;

  faceSize: number;
  noPendantFaceInflate: number;
  pendantSize: number;
  verifyIconSize: number;
  ornamentHeight: number;

  badgeHeight: number;
  badgePadding: number;
  badgeArc: number;

  lineSpace: number;
  drawSpace: number;
  contentSpace: number;

  smallCardHeight: number;
  additionalCardHeight: number;
}

export const QUALITY_PRESETS: Record<string, Quality> = {
  '800w': {
    imageWidth: 800,
    cardMargin: 20,
    cardPadding: 20,
    cardArc: 10,

    nameFontSize: 30,
    titleFontSize: 26,
    subTitleFontSize: 22,
    descFontSize: 20,
    contentFontSize: 26,
    footerFontSize: 22,

    cardOutlineWidth: 2,
    drawOutlineWidth: 2,

    faceSize: 64,
    noPendantFaceInflate: 5,
    pendantSize: 112,
    verifyIconSize: 20,
    ornamentHeight: 90,

    badgeHeight: 36,
    badgePadding: 5,
    badgeArc: 5,

    lineSpace: 8,
    drawSpace: 10,
    contentSpace: 10,

    smallCardHeight: 160,
    additionalCardHeight: 90,
  },
  '1000w': {
    imageWidth: 1000,
    cardMargin: 30,
    cardPadding: 30,
    cardArc: 15,

    nameFontSize: 36,
    titleFontSize: 32,
    subTitleFontSize: 28,
    descFontSize: 26,
    contentFontSize: 32,
    footerFontSize: 28,

    cardOutlineWidth: 3,
    drawOutlineWidth: 3,

    faceSize: 80,
    noPendantFaceInflate: 10,
    pendantSize: 140,
    verifyIconSize: 30,
    ornamentHeight: 125,

    badgeHeight: 45,
    badgePadding: 8,
    badgeArc: 8,

    lineSpace: 11,
    drawSpace: 15,
    contentSpace: 12,

    smallCardHeight: 200,
    additionalCardHeight: 130,
  },
  '1200w': {
    imageWidth: 1200,
    cardMargin: 40,
    cardPadding: 40,
    cardArc: 20,

    nameFontSize: 42,
    titleFontSize: 38,
    subTitleFontSize: 34,
    descFontSize: 32,
    contentFontSize: 38,
    footerFontSize: 34,

    cardOutlineWidth: 4,
    drawOutlineWidth: 4,

    faceSize: 95,
    noPendantFaceInflate: 13,
    pendantSize: 170,
    verifyIconSize: 40,
    ornamentHeight: 140,

    badgeHeight: 55,
    badgePadding: 11,
    badgeArc: 11,

    lineSpace: 14,
    drawSpace: 20,
    contentSpace: 17,

    smallCardHeight: 240,
    additionalCardHeight: 160,
  },
  '1500w': {
    imageWidth: 1500,
    cardMargin: 50,
    cardPadding: 50,
    cardArc: 30,

    nameFontSize: 51,
    titleFontSize: 46,
    subTitleFontSize: 43,
    descFontSize: 40,
    contentFontSize: 47,
    footerFontSize: 43,

    cardOutlineWidth: 6,
    drawOutlineWidth: 6,

    faceSize: 100,
    noPendantFaceInflate: 18,
    pendantSize: 190,
    verifyIconSize: 50,
    ornamentHeight: 150,

    badgeHeight: 72,
    badgePadding: 15,
    badgeArc: 16,

    lineSpace: 20,
    drawSpace: 25,
    contentSpace: 20,

    smallCardHeight: 300,
    additionalCardHeight: 205,
  },
};

/**
 * 取用分辨率配置。
 * 注意：Kotlin 端在 badgeEnable.enable 为 false 时会将 badgeHeight 置 0，
 * 该副作用在此处一并还原。
 */
export function resolveQuality(key: string, badgeEnable: boolean): Quality {
  const base = QUALITY_PRESETS[key] ?? QUALITY_PRESETS['800w'];
  return { ...base, badgeHeight: badgeEnable ? base.badgeHeight : 0 };
}
