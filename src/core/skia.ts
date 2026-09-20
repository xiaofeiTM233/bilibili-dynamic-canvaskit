/**
 * CanvasKit 初始化与环境适配
 *
 * 选型说明：原实现基于 skiko（Skia 的 Kotlin/JVM 绑定），卡片上所有标题与描述
 * 均由 Skia Paragraph 排版。CanvasKit 是 Skia 官方的 WASM 构建，与 skiko 同源，
 * 且完整暴露 Paragraph API，是 Node 环境下唯一能逐行对齐原实现的渲染后端。
 *
 * 与 JVM 端的重要差异：
 * 1. Embind 对象不受 GC 管理，需显式释放，否则 WASM 堆会持续增长；
 * 2. FontMetrics 未导出 capHeight，需另行推导（见 text.ts）；
 * 3. 不带 ICU 的构建无法自行完成 CJK/Emoji 断行，启动时需检测。
 *
 * 释放方式分两类（写错就是内存泄漏）：
 * - Paint / Font / Image / Paragraph 等：调用 delete()；
 * - Surface：必须调用 dispose()。CanvasKit 的 MakeSurface 是自己 _malloc 一块
 *   W*H*4 的像素缓冲再 makeRasterDirect，缓冲指针挂在 surface.Ve 上，
 *   只有 dispose() 会 _free(Ve)；delete() 仅销毁 embind 外壳，像素缓冲会一直留在
 *   WASM 堆里（1000x2284 一张卡约 9MB），累计几十张后 MakeSurface 直接返回 null，
 *   报「创建 Surface 失败」。详见 canvaskit-wasm 类型定义中 Surface.dispose 的注释。
 */

import type {
  CanvasKit as CanvasKitType,
  Font as FontType,
  FontMgr as FontMgrType,
  Surface as SurfaceType,
  Typeface as TypefaceType,
} from 'canvaskit-wasm';

export type CK = CanvasKitType;
export type SkSurface = SurfaceType;
export type SkFont = FontType;
export type SkTypeface = TypefaceType;
export type SkFontMgr = FontMgrType;

let instance: CK | null = null;

/** 定位 canvaskit.wasm；利用包自身的 exports 映射，避免硬编码 node_modules 路径 */
function resolveWasm(file: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require.resolve(`canvaskit-wasm/bin/${file}`);
}

export async function initCanvasKit(): Promise<CK> {
  if (instance) return instance;

  // 动态 require：canvaskit-wasm 的加载器为 UMD，需在运行时引入
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const CanvasKitInit = require('canvaskit-wasm/bin/canvaskit.js') as (opts: {
    locateFile: (file: string) => string;
  }) => Promise<CK>;

  const ck = await CanvasKitInit({ locateFile: resolveWasm });
  instance = ck;

  // 无 ICU 构建需要调用方自行提供断行/字素边界（见官方 paragraphs.html 的 WithoutICU 分支）
  if (ck.ParagraphBuilder.RequiresClientICU()) {
    console.warn(
      '[bilibili-dynamic-canvaskit] 当前 CanvasKit 构建不含 ICU，CJK/Emoji 断行将无法自动处理。' +
        '请改用带 ICU 的 canvaskit-wasm 构建。',
    );
  }

  return ck;
}

export function requireCanvasKit(): CK {
  if (!instance) {
    throw new Error('CanvasKit 尚未初始化，请先调用 initCanvasKit()');
  }
  return instance;
}

/**
 * 对应 Surface.makeRasterN32Premul(w, h)
 *
 * 注意：返回的 Surface 必须用 dispose() 释放，不能用 delete()——见文件头部说明，
 * CanvasKit 把 MakeSurface 自行分配的像素缓冲挂在 surface.Ve 上，只有 dispose() 会释放它。
 */
export function makeSurface(ck: CK, width: number, height: number): SkSurface {
  const surface = ck.MakeSurface(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  if (!surface) throw new Error(`创建 Surface 失败: ${width}x${height}`);
  return surface;
}

/**
 * 从字体文件构建 FontMgr，对应 FontUtils 中的 TypefaceFontProvider + FontCollection。
 * @param buffers 字体文件的二进制内容（ttf / otf）
 */
export function makeFontMgr(ck: CK, buffers: ArrayBuffer[] | Uint8Array[]): SkFontMgr {
  const mgr = ck.FontMgr.FromData(...(buffers as ArrayBuffer[]));
  if (!mgr) throw new Error('构建 FontMgr 失败');
  return mgr;
}

/**
 * 按字体名匹配 Typeface，对应 matchFamily(name).matchStyle(FontStyle.NORMAL)。
 * 匹配失败时返回 null，由调用方决定降级策略。
 */
export function matchTypeface(
  ck: CK,
  mgr: SkFontMgr,
  familyName: string,
  bold = false,
): SkTypeface | null {
  const style = bold
    ? { weight: ck.FontWeight.Bold, slant: ck.FontSlant.Upright, width: ck.FontWidth.Normal }
    : { weight: ck.FontWeight.Normal, slant: ck.FontSlant.Upright, width: ck.FontWidth.Normal };
  const face = mgr.matchFamilyStyle(familyName, style);
  return face ?? null;
}

/** 对应 Font(typeface, size) */
export function makeFont(ck: CK, typeface: SkTypeface | null, size: number): SkFont {
  return new ck.Font(typeface, size);
}

/** 对应 font.makeWithSize(size)：返回新的 Font 实例，避免改动原对象 */
export function fontWithSize(ck: CK, font: SkFont, size: number): SkFont {
  return new ck.Font(font.getTypeface(), size);
}
