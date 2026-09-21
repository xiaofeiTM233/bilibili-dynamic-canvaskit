/**
 * 动态主体绘制 —— 移植自 DynamicMajorDraw.kt
 *
 * 覆盖：视频稿（Archive）、图文（Opus）、九宫格（Draw）、专栏（Article）、
 * 音乐（Music）、直播（Live/LiveRcmd）、番剧（Pgc）、合集（UGC_SEASON）、
 * 通用卡片（Common）、充电专属（Blocked）、未知类型提示（drawInfoText）。
 * 标题/描述段落均由 Paragraph 排版，参数（maxLines/ellipsis/字号）逐项对齐。
 */
import type { Image as SkImage } from 'canvaskit-wasm';
import type { ColorInt } from '../core/color';
import { BLACK, makeRGB } from '../core/color';
import {
  drawCard,
  drawImageClip,
  drawImageRRectFull,
  drawRectShadow,
  fillRRect,
  type SkCtx,
  toSkRect,
  withPaint,
} from '../core/canvas';
import { makeParagraph, measureLineHeight, paintParagraph } from '../core/text';
import { makeXYWH, Position, rectHeight, rectWidth, type RRect } from '../core/geometry';
import { drawBadge, drawLabelCard } from './dynamicDraw';
import { makeSurface } from '../core/skia';
import { drawContentDesc, type ModuleDrawOptions } from './moduleDraw';
import type { ContentDesc, Major, MajorDrawItem } from '../types/dynamic';
import type { DrawRuntime } from './runtime';
/** 分发入口，对应 ModuleDynamic.Major.makeGeneral */
export async function drawMajor(
  rt: DrawRuntime,
  major: Major,
  opts: ModuleDrawOptions & { isForward?: boolean } = {},
): Promise<SkImage> {
  const isForward = opts.isForward ?? false;
  switch (major.type) {
    case 'MAJOR_TYPE_ARCHIVE': {
      const a = major.archive!;
      return isForward
        ? drawSmallCardFor(rt, {
            title: a.title,
            desc: a.desc ?? '',
            cover: a.cover,
            lbadge: a.badge.text,
            rbadge: `av${a.aid}`,
            duration: a.durationText,
          })
        : drawArchive(rt, a);
    }
    case 'MAJOR_TYPE_BLOCKED':
      return drawBlockedMajor(rt, major.blocked!);
    case 'MAJOR_TYPE_DRAW':
      return drawNineGrid(rt, major.draw!.items);
    case 'MAJOR_TYPE_ARTICLE':
      return drawArticle(rt, major.article!);
    case 'MAJOR_TYPE_MUSIC':
      return drawMusic(rt, major.music!);
    case 'MAJOR_TYPE_LIVE':
      return drawSmallCardFor(rt, {
        title: major.live!.title,
        desc: `${major.live!.descFirst ?? ''} ${major.live!.descSecond ?? ''}`,
        cover: major.live!.cover,
        lbadge: major.live!.badge.text,
        rbadge: `${major.live!.id}`,
        duration: null,
      });
    case 'MAJOR_TYPE_LIVE_RCMD': {
      const info = major.liveRcmd!.liveInfo.livePlayInfo;
      return drawSmallCardFor(rt, {
        title: info.title,
        desc: `${info.parentAreaName} · ${info.areaName}`,
        cover: info.cover,
        lbadge: info.liveStatus === 0 ? '未开播' : info.liveStatus === 1 ? '直播中' : info.liveStatus === 2 ? '轮播中' : '直播',
        rbadge: `${info.roomId}`,
        duration: null,
      });
    }
    case 'MAJOR_TYPE_PGC': {
      const p = major.pgc!;
      return drawSmallCardFor(rt, {
        title: p.title,
        desc: `播放: ${p.stat.play}  弹幕: ${p.stat.danmaku}`,
        cover: p.cover,
        lbadge: p.badge.text,
        rbadge: `ep${p.epid}`,
        duration: null,
      });
    }
    case 'MAJOR_TYPE_UGC_SEASON':
      return drawSmallCardFor(rt, {
        title: major.ugcSeason!.title,
        desc: major.ugcSeason!.desc ?? '',
        cover: major.ugcSeason!.cover,
        lbadge: major.ugcSeason!.badge.text,
        rbadge: `av${major.ugcSeason!.aid}`,
        duration: major.ugcSeason!.durationText,
      });
    case 'MAJOR_TYPE_COMMON':
      return drawCommon(rt, major.common!);
    case 'MAJOR_TYPE_OPUS':
      return drawOpus(rt, major.opus!, opts);
    case 'MAJOR_TYPE_NONE':
      return drawInfoText(rt, major.none!.tips);
    default:
      return drawInfoText(rt, `无法绘制类型为 [${major.type}] 的动态类型, 请把动态链接反馈给开发者`);
  }
}
/* ------------------------------------------------------------------ */
/* 小卡片（右侧封面 + 右侧文本）                                         */
/* ------------------------------------------------------------------ */
export interface SmallCardSpec {
  title: string;
  desc: string | null;
  cover: string;
  lbadge: string;
  rbadge: string;
  duration: string | null;
}
function drawSmallCardFor(rt: DrawRuntime, spec: SmallCardSpec, _ignored?: string): Promise<SkImage> {
  return drawSmallCard(rt, spec);
}
/** 对应 drawSmallCard：封面宽 = 内容区宽 40%，右侧标题/描述 */
export async function drawSmallCard(rt: DrawRuntime, spec: SmallCardSpec): Promise<SkImage> {
  const { quality, colors } = rt;
  const contentW = rectWidth(rt.cardContentRect);
  const desiredCoverWidth = contentW * 0.4;
  const { imgApi } = await import('../utils/images');
  const fallbackUrl = imgApi(spec.cover, Math.trunc(desiredCoverWidth), 100);
  const coverImg = await rt.store.getOrDefault(spec.cover, fallbackUrl, 'other');
  const scale = desiredCoverWidth / coverImg.width();
  const scaledCoverHeight = coverImg.height() * scale;
  const textAreaWidth = contentW - quality.cardPadding - desiredCoverWidth;
  const titleParagraph = makeParagraph(
    rt.textEnv,
    { textStyle: { fontSize: quality.titleFontSize, color: colors.titleColor }, maxLines: 2, ellipsis: '...' },
    spec.title,
    textAreaWidth,
  );
  const titleLines = titleParagraph.getLineMetrics().length;
  const descParagraph = makeParagraph(
    rt.textEnv,
    {
      textStyle: { fontSize: quality.descFontSize, color: colors.descColor },
      maxLines: titleLines === 1 ? 3 : 2,
      ellipsis: '...',
    },
    spec.desc ?? '',
    textAreaWidth,
  );
  const cardHeight = quality.badgeHeight + scaledCoverHeight + quality.cardPadding;
  const surface = makeSurface(rt.ck, rectWidth(rt.cardRect), cardHeight);
  const ctx: SkCtx = { ck: rt.ck, canvas: surface.getCanvas() };
  const videoCardRect: RRect = {
    ...makeXYWH(
      quality.cardPadding,
      quality.badgeHeight + 1,
      contentW,
      cardHeight - (quality.badgeHeight + quality.cardPadding),
    ),
    radii: rt.cardBadgeArc,
  };
  drawCard(ctx, videoCardRect, {
    bgColor: colors.cardBgColor,
    outlineColors: colors.cardOutlineColors,
    outlineWidth: quality.cardOutlineWidth,
  });
  drawRectShadow(ctx, inflateRR(videoCardRect, 1), colors.smallCardShadow);
  if (rt.imageConfig.badgeEnable.left) {
    drawBadge(rt, ctx, spec.lbadge, colors.subLeftBadge.fontColor, colors.subLeftBadge.bgColor, videoCardRect, Position.TOP_LEFT);
  }
  if (rt.imageConfig.badgeEnable.right) {
    drawBadge(rt, ctx, spec.rbadge, colors.subRightBadge.fontColor, colors.subRightBadge.bgColor, videoCardRect, Position.TOP_RIGHT);
  }
  const coverRRect = insetRR(
    { ...makeXYWH(videoCardRect.left, videoCardRect.top, desiredCoverWidth, scaledCoverHeight), radii: rt.cardBadgeArc },
    1,
  );
  drawImageRRectFull(ctx, coverImg, coverRRect);
  const textX = coverRRect.right + quality.cardPadding;
  const totalTextHeight = titleParagraph.getHeight() + descParagraph.getHeight();
  const space = (scaledCoverHeight - totalTextHeight) / 3;
  const startY = videoCardRect.top + space;
  paintParagraph(ctx, titleParagraph, textX, startY);
  paintParagraph(ctx, descParagraph, textX, startY + titleParagraph.getHeight() + space);
  if (spec.duration != null) {
    const durationFont = new rt.ck.Font(rt.fonts.mainTypeface, quality.subTitleFontSize);
    durationFont.delete();
    drawLabelCard(
      rt, ctx, spec.duration,
      coverRRect.left + quality.badgePadding * 2,
      coverRRect.bottom - measureLineHeight(rt.fonts.main) - quality.badgePadding * 2,
      WHITE_C, withAlpha(BLACK, 130),
      quality.subTitleFontSize,
    );
  }
  titleParagraph.delete();
  descParagraph.delete();
  const image = surface.makeImageSnapshot();
  surface.dispose();
  return image;
}
/* ------------------------------------------------------------------ */
/* 视频稿（大卡片）                                                     */
/* ------------------------------------------------------------------ */
export interface ArchiveSpec {
  title: string;
  desc?: string | null;
  cover: string;
  badge: { text: string; color?: string | number; bgColor?: string | number };
  aid: number;
  bvid: string;
  durationText: string;
  stat: { play: string | number; danmaku: string | number };
  showStat?: boolean;
}
/** 对应 ModuleDynamic.Major.Archive.drawGeneral */
export async function drawArchive(rt: DrawRuntime, a: ArchiveSpec): Promise<SkImage> {
  const { quality, colors } = rt;
  const contentW = rectWidth(rt.cardContentRect);
  const paragraphWidth = contentW - quality.cardPadding;
  const titleParagraph = makeParagraph(
    rt.textEnv,
    { textStyle: { fontSize: quality.titleFontSize, color: colors.titleColor }, maxLines: 2, ellipsis: '...' },
    a.title,
    paragraphWidth,
  );
  const descParagraph = makeParagraph(
    rt.textEnv,
    { textStyle: { fontSize: quality.descFontSize, color: colors.descColor }, maxLines: 3, ellipsis: '...' },
    (a.desc ?? '').replace(/\r\n/g, ' ').replace(/\n/g, ' '),
    paragraphWidth,
  );
  const { imgApi } = await import('../utils/images');
  const fallbackUrl = imgApi(a.cover, Math.trunc(contentW), Math.trunc(contentW * 0.625));
  const coverImg = await rt.store.getOrDefault(a.cover, fallbackUrl, 'images');
  const videoCoverHeight = (contentW * coverImg.height()) / coverImg.width();
  const videoCardHeight = videoCoverHeight + titleParagraph.getHeight() + descParagraph.getHeight() + quality.cardPadding;
  const videoCardRect: RRect = {
    ...makeXYWH(quality.cardPadding, quality.badgeHeight + 1, contentW, videoCardHeight),
    radii: rt.cardBadgeArc,
  };
  const surface = makeSurface(
    rt.ck,
    rectWidth(rt.cardRect),
    Math.trunc(videoCardHeight) + quality.badgeHeight + quality.cardPadding,
  );
  const ctx: SkCtx = { ck: rt.ck, canvas: surface.getCanvas() };
  drawCard(ctx, videoCardRect, {
    bgColor: colors.cardBgColor,
    outlineColors: colors.cardOutlineColors,
    outlineWidth: quality.cardOutlineWidth,
  });
  drawRectShadow(ctx, inflateRR(videoCardRect, 1), colors.smallCardShadow);
  const coverRRect = insetRR(
    { ...makeXYWH(videoCardRect.left, videoCardRect.top, contentW, videoCoverHeight), radii: rt.cardBadgeArc },
    1,
  );
  drawImageRRectFull(ctx, coverImg, coverRRect);
  if (rt.imageConfig.badgeEnable.left) {
    drawBadge(rt, ctx, a.badge.text, colors.subLeftBadge.fontColor, colors.subLeftBadge.bgColor, videoCardRect, Position.TOP_LEFT);
  } else {
    drawLabelCard(
      rt, ctx, a.badge.text,
      videoCardRect.right - measureTextW(rt, a.badge.text) - quality.badgePadding * 4 - quality.cardPadding * 1.3,
      videoCardRect.top + quality.cardPadding,
      parseColor(rt, a.badge.color), parseColor(rt, a.badge.bgColor),
      quality.subTitleFontSize,
    );
  }
  if (rt.imageConfig.badgeEnable.right) {
    drawBadge(rt, ctx, `av${a.aid}  |  ${a.bvid}`, colors.subRightBadge.fontColor, colors.subRightBadge.bgColor, videoCardRect, Position.TOP_RIGHT);
  }
  // 封面底部遮罩：自下而上的黑->透明渐变，Paint alpha 120
  const maskRRect: RRect = {
    left: coverRRect.left,
    top: coverRRect.bottom - videoCoverHeight * 0.2,
    right: coverRRect.right,
    bottom: coverRRect.bottom,
    radii: rt.cardBadgeArc,
  };
  withPaint(rt.ck, (p) => {
    p.setAntiAlias(true);
    p.setAlphaf(120 / 255);
    p.setShader(
      rt.ck.Shader.MakeLinearGradient(
        [maskRRect.left, maskRRect.bottom],
        [maskRRect.left, maskRRect.top],
        [rt.ck.Color4f(0, 0, 0, 1), rt.ck.Color4f(0, 0, 0, 0)],
        null,
        rt.ck.TileMode.Clamp,
      ),
    );
    ctx.canvas.drawRRect(skRRect(rt, maskRRect), p);
  });
  // 时长标签
  const durationWidth = measureTextW(rt, a.durationText);
  const textX = maskRRect.left + quality.cardPadding * 1.3;
  const textY = coverRRect.bottom - measureLineHeight(rt.fonts.main) - quality.cardPadding;
  drawLabelCard(rt, ctx, a.durationText, textX, textY, WHITE_C, withAlpha(BLACK, 140));
  // 播放信息
  const play = parseInt(String(a.stat.play), 10);
  if (a.showStat && Number.isFinite(play)) {
    const playStr = play > 10000 ? (play / 10000).toFixed(1) + '万' : String(play);
    drawLabelCard(
      rt, ctx, `${playStr}观看 ${a.stat.danmaku}弹幕`,
      textX + durationWidth + quality.badgePadding * 4,
      textY,
      WHITE_C, withAlpha(BLACK, 0),
    );
  }
  paintParagraph(ctx, titleParagraph, quality.cardPadding * 1.5, quality.badgeHeight + videoCoverHeight + quality.cardPadding / 2);
  paintParagraph(ctx, descParagraph, quality.cardPadding * 1.5, quality.badgeHeight + videoCoverHeight + quality.cardPadding / 2 + titleParagraph.getHeight());
  titleParagraph.delete();
  descParagraph.delete();
  const image = surface.makeImageSnapshot();
  surface.dispose();
  return image;
}
/* ------------------------------------------------------------------ */
/* 九宫格                                                               */
/* ------------------------------------------------------------------ */
/** 对应 ModuleDynamic.Major.Draw.drawGeneral */
export async function drawNineGrid(rt: DrawRuntime, items: MajorDrawItem[]): Promise<SkImage> {
  const { quality, colors } = rt;
  const contentW = rectWidth(rt.cardContentRect);
  let drawItemWidth = 0;
  let drawItemHeight = 0;
  let drawItemSpace = quality.drawSpace * 2;
  let drawItemNum = 1;
  const size = items.length;
  if (size === 1) {
    drawItemWidth = items[0].width > contentW / 2 ? contentW : items[0].width * 2;
    const drawHeight = (items[0].height / items[0].width) * drawItemWidth;
    drawItemHeight = drawHeight > drawItemWidth * 2 ? drawItemWidth * 2 : drawHeight;
  } else if (size === 2 || size === 4) {
    drawItemWidth = (contentW - quality.drawSpace) / 2;
    drawItemHeight = drawItemWidth;
    if (size >= 3) drawItemSpace += quality.drawSpace;
    drawItemNum = 2;
  } else if (size === 3 || (size >= 5 && size <= 30)) {
    drawItemWidth = (contentW - quality.drawSpace * 2) / 3;
    drawItemHeight = drawItemWidth;
    drawItemSpace += quality.drawSpace * Math.ceil(size / 3) - 1;
    drawItemNum = 3;
  }
  const totalH = drawItemHeight * Math.ceil(size / drawItemNum) + drawItemSpace;
  const surface = makeSurface(rt.ck, rectWidth(rt.cardRect), Math.trunc(totalH));
  const ctx: SkCtx = { ck: rt.ck, canvas: surface.getCanvas() };
  let x = quality.cardPadding;
  let y = quality.drawSpace;
  for (let index = 0; index < size; index++) {
    const drawItem = items[index];
    const { imgApi } = await import('../utils/images');
    const fallbackUrl = imgApi(drawItem.src, Math.trunc(drawItemWidth), Math.trunc(drawItemHeight));
    const img = await rt.store.getOrDefault(drawItem.src, fallbackUrl, 'images');
    const dstRect: RRect = { ...makeXYWH(x, y, drawItemWidth, drawItemHeight), radii: quality.cardArc };
    // 底衬（半透明白）
    fillRRect(ctx, dstRect, withAlpha(WHITE_C, 160));
    // 长图顶部裁剪，其余居中裁剪
    const topClipMode = drawItem.height > drawItem.width * 2;
    drawImageClip(ctx, img, dstRect, topClipMode);
    // 动图/长图标签
    let label: string | null = null;
    if (drawItem.src.endsWith('.gif')) label = '动图';
    else if (topClipMode) label = '长图';
    if (label) {
      drawLabelCard(
        rt, ctx, label,
        dstRect.right - measureTextW(rt, label) - quality.badgePadding * 4 - quality.cardPadding / 2,
        dstRect.bottom - measureLineHeight(rt.fonts.main) - quality.badgePadding - quality.cardPadding / 2,
        WHITE_C, withAlpha(BLACK, 130),
        quality.subTitleFontSize,
      );
    }
    // 描边
    withPaint(rt.ck, (p) => {
      p.setColor(rt.ck.Color4f(
        ((colors.drawOutlineColor >>> 16) & 0xff) / 255,
        ((colors.drawOutlineColor >>> 8) & 0xff) / 255,
        (colors.drawOutlineColor & 0xff) / 255,
        ((colors.drawOutlineColor >>> 24) & 0xff) / 255,
      ));
      p.setStyle(rt.ck.PaintStyle.Stroke);
      p.setStrokeWidth(quality.drawOutlineWidth);
      p.setAntiAlias(true);
      ctx.canvas.drawRRect(skRRect(rt, dstRect), p);
    });
    x += drawItemWidth + quality.drawSpace;
    if ((index + 1) % drawItemNum === 0) {
      x = quality.cardPadding;
      y += drawItemHeight + quality.drawSpace;
    }
  }
  const image = surface.makeImageSnapshot();
  surface.dispose();
  return image;
}
/* ------------------------------------------------------------------ */
/* 图文 / 通用 / 专栏 / 音乐 / 专属 / 提示                               */
/* ------------------------------------------------------------------ */
/** 对应 ModuleDynamic.Major.Opus.drawGeneral */
export async function drawOpus(
  rt: DrawRuntime,
  opus: { title?: string | null; summary: ContentDesc; pics: MajorDrawItem[] },
  opts: ModuleDrawOptions = {},
): Promise<SkImage> {
  const { quality } = rt;
  const desc = await drawContentDesc(rt, opus.summary, opts);
  const draw = opus.pics.length > 0 ? await drawNineGrid(rt, opus.pics) : null;
  let h = 0;
  let titleParagraph: ReturnType<typeof makeParagraph> | null = null;
  if (opus.title) {
    titleParagraph = makeParagraph(
      rt.textEnv,
      { textStyle: { fontSize: quality.titleFontSize + 3, color: rt.colors.titleColor, bold: true } },
      opus.title,
      rectWidth(rt.cardContentRect),
    );
    h = titleParagraph.getLineMetrics().length * Math.trunc(quality.contentFontSize) + quality.cardPadding;
  }
  const surface = makeSurface(
    rt.ck,
    rectWidth(rt.cardRect),
    desc.height() + (draw ? draw.height() : 0) + h,
  );
  const ctx: SkCtx = { ck: rt.ck, canvas: surface.getCanvas() };
  if (titleParagraph) paintParagraph(ctx, titleParagraph, quality.cardPadding, 0);
  ctx.canvas.drawImage(desc, 0, h);
  if (draw) ctx.canvas.drawImage(draw, 0, h + desc.height());
  titleParagraph?.delete();
  desc.delete();
  draw?.delete();
  const image = surface.makeImageSnapshot();
  surface.dispose();
  return image;
}
/** 对应 ModuleDynamic.Major.Common.drawGeneral */
export async function drawCommon(
  rt: DrawRuntime,
  c: { cover?: string | null; title: string; desc: string; label: string; badge: { text: string; color?: string | number; bgColor?: string | number } },
): Promise<SkImage> {
  const { quality, colors } = rt;
  const contentW = rectWidth(rt.cardContentRect);
  const height = quality.additionalCardHeight;
  const commonCardRect: RRect = { ...makeXYWH(quality.cardPadding, 1, contentW, height), radii: quality.cardArc };
  const surface = makeSurface(rt.ck, rectWidth(rt.cardRect), Math.trunc(height + quality.cardPadding));
  const ctx: SkCtx = { ck: rt.ck, canvas: surface.getCanvas() };
  drawCard(ctx, commonCardRect, {
    bgColor: colors.cardBgColor,
    outlineColors: colors.cardOutlineColors,
    outlineWidth: quality.cardOutlineWidth,
  });
  drawRectShadow(ctx, inflateRR(commonCardRect, 1), colors.smallCardShadow);
  if (c.badge.text.trim() !== '') {
    drawLabelCard(
      rt, ctx, c.badge.text,
      commonCardRect.right - measureTextW(rt, c.badge.text) - quality.badgePadding * 4 - quality.cardPadding,
      1 + (height - measureLineHeight(rt.fonts.main)) / 2,
      parseColor(rt, c.badge.color), parseColor(rt, c.badge.bgColor),
      quality.subTitleFontSize,
    );
  }
  let x = quality.cardPadding;
  if (c.cover) {
    const img = await rt.store.get(c.cover, 'other');
    if (img) {
      const imgRect = insetRR(
        { ...makeXYWH(quality.cardPadding, 1, (quality.additionalCardHeight * img.width()) / img.height(), quality.additionalCardHeight), radii: quality.cardArc },
        1,
      );
      drawImageRRectFull(ctx, img, imgRect);
      x += rectWidth(imgRect) + quality.cardPadding;
    }
  }
  const availW = contentW - x;
  const titleParagraph = makeParagraph(
    rt.textEnv,
    { textStyle: { fontSize: quality.titleFontSize * 0.8, color: colors.titleColor }, maxLines: 1, ellipsis: '...' },
    c.title,
    availW,
  );
  const desc1Paragraph = makeParagraph(
    rt.textEnv,
    { textStyle: { fontSize: quality.subTitleFontSize * 0.8, color: colors.descColor }, maxLines: 1, ellipsis: '...' },
    c.desc,
    availW,
  );
  const desc2Paragraph = c.label.trim() !== ''
    ? makeParagraph(
        rt.textEnv,
        { textStyle: { fontSize: quality.subTitleFontSize * 0.8, color: colors.descColor }, maxLines: 1, ellipsis: '...' },
        c.label,
        availW,
      )
    : null;
  const top = (height - titleParagraph.getHeight() * 3) / 2;
  let y = commonCardRect.top + top + (c.label.trim() === '' ? titleParagraph.getHeight() / 4 : 0);
  paintParagraph(ctx, titleParagraph, x, y);
  y += titleParagraph.getHeight() + (c.label.trim() === '' ? titleParagraph.getHeight() / 2 : 0);
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
/** 对应 ModuleDynamic.Major.Article.drawGeneral */
export async function drawArticle(
  rt: DrawRuntime,
  article: { title: string; desc?: string | null; covers: string[]; id: number },
): Promise<SkImage> {
  const { quality, colors } = rt;
  const contentW = rectWidth(rt.cardContentRect);
  const paragraphWidth = contentW - quality.cardPadding;
  const titleParagraph = makeParagraph(
    rt.textEnv,
    { textStyle: { fontSize: quality.titleFontSize, color: colors.titleColor }, maxLines: 2, ellipsis: '...' },
    article.title,
    paragraphWidth,
  );
  const descParagraph = makeParagraph(
    rt.textEnv,
    { textStyle: { fontSize: quality.descFontSize, color: colors.descColor }, maxLines: 3, ellipsis: '...' },
    article.desc ?? '',
    paragraphWidth,
  );
  const articleCoverHeight = contentW * (article.covers.length === 1 ? 0.35 : 0.23166);
  const articleCardHeight = articleCoverHeight + titleParagraph.getHeight() + descParagraph.getHeight() + quality.cardPadding;
  const articleCardRect: RRect = {
    ...makeXYWH(quality.cardPadding, quality.badgeHeight + 1, contentW, articleCardHeight),
    radii: rt.cardBadgeArc,
  };
  const surface = makeSurface(
    rt.ck,
    rectWidth(rt.cardRect),
    Math.trunc(articleCardHeight) + quality.badgeHeight + quality.cardPadding,
  );
  const ctx: SkCtx = { ck: rt.ck, canvas: surface.getCanvas() };
  drawCard(ctx, articleCardRect, {
    bgColor: colors.cardBgColor,
    outlineColors: colors.cardOutlineColors,
    outlineWidth: quality.cardOutlineWidth,
  });
  drawRectShadow(ctx, inflateRR(articleCardRect, 1), colors.smallCardShadow);
  const coverRRect = insetRR(
    { ...makeXYWH(articleCardRect.left, articleCardRect.top, contentW, articleCoverHeight), radii: rt.cardBadgeArc },
    1,
  );
  const { imgApi } = await import('../utils/images');
  if (article.covers.length === 1) {
    const fallbackUrl = imgApi(article.covers[0], Math.trunc(rectWidth(articleCardRect)), Math.trunc(articleCoverHeight));
    const coverImg = await rt.store.getOrDefault(article.covers[0], fallbackUrl, 'images');
    drawImageRRectFull(ctx, coverImg, coverRRect);
  } else {
    let imgX = articleCardRect.left;
    const imgW = rectWidth(articleCardRect) / 3 - 4;
    ctx.canvas.save();
    ctx.canvas.clipRRect(skRRect(rt, coverRRect), rt.ck.ClipOp.Intersect, true);
    for (const cover of article.covers) {
      const fallbackUrl = imgApi(cover, Math.trunc(imgW), Math.trunc(articleCoverHeight));
      const img = await rt.store.getOrDefault(cover, fallbackUrl, 'images');
      drawImageClip(ctx, img, { ...makeXYWH(imgX, articleCardRect.top, imgW, articleCoverHeight), radii: 0 }, true);
      imgX += rectWidth(articleCardRect) / 3 + 2;
    }
    ctx.canvas.restore();
  }
  if (rt.imageConfig.badgeEnable.left) {
    drawBadge(rt, ctx, '专栏', colors.subLeftBadge.fontColor, colors.subLeftBadge.bgColor, articleCardRect, Position.TOP_LEFT);
  } else {
    drawLabelCard(
      rt, ctx, '专栏',
      articleCardRect.right - measureTextW(rt, '专栏') - quality.badgePadding * 4 - quality.cardPadding,
      articleCardRect.top + quality.cardPadding * 0.8,
      WHITE_C, makeRGB(251, 114, 153),
      quality.subTitleFontSize,
    );
  }
  if (rt.imageConfig.badgeEnable.right) {
    drawBadge(rt, ctx, `cv${article.id}`, colors.subRightBadge.fontColor, colors.subRightBadge.bgColor, articleCardRect, Position.TOP_RIGHT);
  }
  paintParagraph(ctx, titleParagraph, quality.cardPadding * 1.5, quality.badgeHeight + articleCoverHeight + quality.cardPadding / 2);
  paintParagraph(ctx, descParagraph, quality.cardPadding * 1.5, quality.badgeHeight + articleCoverHeight + quality.cardPadding / 2 + titleParagraph.getHeight());
  titleParagraph.delete();
  descParagraph.delete();
  const image = surface.makeImageSnapshot();
  surface.dispose();
  return image;
}
/** 对应 ModuleDynamic.Major.Music.drawGeneral */
export async function drawMusic(
  rt: DrawRuntime,
  music: { title: string; label: string; cover: string; id: number },
): Promise<SkImage> {
  const { quality, colors } = rt;
  const contentW = rectWidth(rt.cardContentRect);
  const musicCardHeight = contentW * 0.19;
  const paragraphWidth = contentW - quality.cardPadding * 2 - musicCardHeight;
  const titleParagraph = makeParagraph(
    rt.textEnv,
    { textStyle: { fontSize: quality.titleFontSize, color: colors.titleColor }, maxLines: 2, ellipsis: '...' },
    music.title,
    paragraphWidth,
  );
  const descParagraph = makeParagraph(
    rt.textEnv,
    { textStyle: { fontSize: quality.descFontSize, color: colors.descColor }, maxLines: 2, ellipsis: '...' },
    music.label,
    paragraphWidth,
  );
  const musicCardRect: RRect = {
    ...makeXYWH(quality.cardPadding, quality.badgeHeight + 1, contentW, musicCardHeight),
    radii: rt.cardBadgeArc,
  };
  const surface = makeSurface(
    rt.ck,
    rectWidth(rt.cardRect),
    Math.trunc(musicCardHeight) + quality.badgeHeight + quality.cardPadding,
  );
  const ctx: SkCtx = { ck: rt.ck, canvas: surface.getCanvas() };
  drawCard(ctx, musicCardRect, {
    bgColor: colors.cardBgColor,
    outlineColors: colors.cardOutlineColors,
    outlineWidth: quality.cardOutlineWidth,
  });
  drawRectShadow(ctx, inflateRR(musicCardRect, 1), colors.smallCardShadow);
  if (rt.imageConfig.badgeEnable.left) {
    drawBadge(rt, ctx, '音乐', colors.subLeftBadge.fontColor, colors.subLeftBadge.bgColor, musicCardRect, Position.TOP_LEFT);
  }
  if (rt.imageConfig.badgeEnable.right) {
    drawBadge(rt, ctx, `au${music.id}`, colors.subRightBadge.fontColor, colors.subRightBadge.bgColor, musicCardRect, Position.TOP_RIGHT);
  }
  const { imgApi } = await import('../utils/images');
  const fallbackUrl = imgApi(music.cover, Math.trunc(musicCardHeight), Math.trunc(musicCardHeight));
  const coverImg = await rt.store.getOrDefault(music.cover, fallbackUrl, 'images');
  const coverRRect = insetRR(
    { ...makeXYWH(musicCardRect.left, musicCardRect.top, musicCardHeight, musicCardHeight), radii: rt.cardBadgeArc },
    1,
  );
  drawImageRRectFull(ctx, coverImg, coverRRect);
  const space = (musicCardHeight - titleParagraph.getHeight() - descParagraph.getHeight()) / 3;
  const y = musicCardRect.top + space;
  paintParagraph(ctx, titleParagraph, musicCardHeight + quality.cardMargin * 2, y);
  paintParagraph(ctx, descParagraph, musicCardHeight + quality.cardMargin * 2, y + space + titleParagraph.getHeight());
  titleParagraph.delete();
  descParagraph.delete();
  const image = surface.makeImageSnapshot();
  surface.dispose();
  return image;
}
/** 对应 ModuleDynamic.Major.Blocked.drawGeneral */
export async function drawBlockedMajor(
  rt: DrawRuntime,
  blocked: { bgImg: { imgDay: string }; icon: { imgDay: string } },
): Promise<SkImage> {
  const { quality } = rt;
  const bgImage = (await rt.store.get(blocked.bgImg.imgDay, 'images'))!;
  const lockIcon = (await rt.store.get(blocked.icon.imgDay, 'images'))!;
  const hintParagraph = makeParagraph(
    rt.textEnv,
    {
      textStyle: { fontSize: quality.titleFontSize, color: 0xffffffff },
      maxLines: 2,
      ellipsis: '...',
      textAlign: 'center',
    },
    '包月充电专属动态',
    rectWidth(rt.cardContentRect) - quality.cardPadding * 2,
  );
  const bgWidth = rectWidth(rt.cardContentRect) - quality.cardPadding * 2;
  const bgHeight = (bgWidth / bgImage.width()) * bgImage.height();
  const lockWidth = bgWidth / 7;
  const lockHeight = (lockWidth / lockIcon.width()) * lockIcon.height();
  const surface = makeSurface(
    rt.ck,
    Math.trunc(rectWidth(rt.cardContentRect)),
    Math.trunc(bgHeight + quality.cardPadding * 2),
  );
  const ctx: SkCtx = { ck: rt.ck, canvas: surface.getCanvas() };
  let x = quality.cardPadding;
  let y = 0;
  drawImageClip(ctx, bgImage, { ...makeXYWH(x, y, bgWidth, bgHeight), radii: quality.cardArc });
  x += (bgWidth - lockWidth) / 2;
  y += bgHeight / 3;
  drawImageClip(ctx, lockIcon, { ...makeXYWH(x, y, lockWidth, lockHeight), radii: quality.cardArc });
  x = quality.cardPadding;
  y += lockHeight + quality.drawSpace;
  hintParagraph.layout(bgWidth);
  paintParagraph(ctx, hintParagraph, x, y);
  hintParagraph.delete();
  const image = surface.makeImageSnapshot();
  surface.dispose();
  return image;
}
/** 对应 drawInfoText：未知类型的提示条 */
export function drawInfoText(rt: DrawRuntime, text: string): SkImage {
  const { quality } = rt;
  const contentW = rectWidth(rt.cardContentRect);
  const lineCount = measureTextW(rt, text) / contentW > 1 ? 2 : 1;
  const height = Math.trunc(quality.contentFontSize) * lineCount + quality.badgeHeight + quality.cardPadding;
  const paragraph = makeParagraph(
    rt.textEnv,
    { textStyle: { fontSize: quality.contentFontSize, color: rt.colors.contentColor } },
    text,
    contentW,
  );
  const surface = makeSurface(rt.ck, rectWidth(rt.cardRect), height);
  const ctx: SkCtx = { ck: rt.ck, canvas: surface.getCanvas() };
  paintParagraph(ctx, paragraph, quality.cardPadding, quality.contentFontSize + quality.cardPadding / 2);
  paragraph.delete();
  const image = surface.makeImageSnapshot();
  surface.dispose();
  return image;
}
/* ------------------------------------------------------------------ */
/* 内部工具                                                             */
/* ------------------------------------------------------------------ */
export const WHITE_C = 0xffffffff;
export function withAlpha(color: ColorInt, alpha: number): ColorInt {
  return ((Math.round(alpha) & 0xff) << 24) | (color & 0xffffff) >>> 0;
}
export function parseColor(rt: DrawRuntime, value: string | number | undefined): ColorInt {
  if (value === undefined) return 0xffffffff;
  if (typeof value === 'number') return value >>> 0;
  try {
    // 支持 #RRGGBB / #AARRGGBB
    const hex = value.startsWith('#') ? value : `#${value}`;
    const a = hex.length === 9 ? parseInt(hex.slice(1, 3), 16) : 255;
    const r = parseInt(hex.slice(hex.length - 6, hex.length - 4), 16);
    const g = parseInt(hex.slice(hex.length - 4, hex.length - 2), 16);
    const b = parseInt(hex.slice(hex.length - 2), 16);
    return (((a & 0xff) << 24) | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)) >>> 0;
  } catch {
    return 0xffffffff;
  }
}
export function measureTextW(rt: DrawRuntime, text: string): number {
  const glyphs = rt.fonts.main.getGlyphIDs(text);
  if (!glyphs || glyphs.length === 0) return 0;
  const widths = rt.fonts.main.getGlyphWidths(glyphs);
  let sum = 0;
  for (let i = 0; i < widths.length; i++) sum += widths[i];
  return sum;
}
export function skRRect(rt: DrawRuntime, r: RRect): Float32Array {
  const radii = typeof r.radii === 'number' ? [r.radii, r.radii, r.radii, r.radii] : r.radii;
  return new Float32Array([
    r.left, r.top, r.right, r.bottom,
    radii[0], radii[0], radii[1], radii[1], radii[2], radii[2], radii[3], radii[3],
  ]);
}
export function inflateRR(r: RRect, delta: number): RRect {
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
export function insetRR(r: RRect, delta: number): RRect {
  return inflateRR(r, -delta);
}
