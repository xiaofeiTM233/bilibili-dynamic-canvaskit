/**
 * 图片资源加载 —— 移植自 utils/General.kt
 *
 * 与原实现的差异：
 * 1. Kotlin 端经 BiliClient（Ktor）下载，此处改用 Node 内置 fetch，请求头可注入；
 * 2. 缓存沿用「先查缓存，未命中则下载」的思路，内存缓存为常驻，磁盘缓存可选；
 * 3. 返回的 Image 由 CanvasKit 解码，生命周期交给调用方（需 delete）。
 */

import type { Image as SkImage } from 'canvaskit-wasm';

import type { CK } from '../core/skia';

/** 对应 Api.kt 中的 TWEMOJI 常量 */
export const TWEMOJI_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72';

/** 对应 imgApi：B 站图片处理接口，用于请求指定尺寸的缩略图 */
export function imgApi(imgUrl: string, width: number, height: number): string {
  return `${imgUrl}@${width}w_${height}h_1e_1c.png`;
}

/** 对应 twemoji(code) */
export function twemoji(code: string): string {
  return `${TWEMOJI_BASE}/${code}.png`;
}

export interface ImageStoreOptions {
  /** 下载原图；关闭时仅使用缩略图接口，对应 cacheConfig.downloadOriginal */
  downloadOriginal?: boolean;
  /** 附加请求头，B 站图床通常需要 Referer 与 UA */
  headers?: Record<string, string>;
  /** 磁盘缓存根目录；不传则仅使用内存缓存 */
  cacheDir?: string;
  /** 自定义 fetch，便于测试或走代理 */
  fetchImpl?: typeof fetch;
}

/**
 * 图片缓存与加载。
 * 对应 getOrDownloadImage / getOrDownloadImageDefault 的语义：
 * - get：失败返回 null
 * - getOrDefault：原图 -> 缩略图 -> 占位图，三级降级，保证始终返回可用 Image
 */
export class ImageStore {
  private readonly memory = new Map<string, SkImage>();
  private readonly opts: Required<Pick<ImageStoreOptions, 'downloadOriginal' | 'headers'>> &
    ImageStoreOptions;
  private missImage: SkImage | null = null;

  constructor(
    private readonly ck: CK,
    options: ImageStoreOptions = {},
  ) {
    const defaultHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Referer: 'https://www.bilibili.com/',
    };
    // 注意：默认值必须放在 ...options 展开之后赋值，
    // 否则调用方显式传入的 undefined 会覆盖默认值（导致 downloadOriginal 失效）
    this.opts = {
      ...options,
      downloadOriginal: options.downloadOriginal ?? true,
      headers: options.headers ?? defaultHeaders,
    };
  }

  /** 获取图片，失败返回 null */
  async get(url: string): Promise<SkImage | null> {
    if (!url) return null;
    const cached = this.memory.get(url);
    if (cached) return cached;

    const bytes = await this.download(url);
    if (!bytes) return null;

    const image = this.ck.MakeImageFromEncoded(bytes);
    if (!image) return null;
    this.memory.set(url, image);
    return image;
  }

  /**
   * 将调用方已持有的图片注入缓存，后续 get/getOrDefault 直接命中。
   * 便于演示与集成场景复用预生成的图片（避免再次解码/下载）。
   * 注入的图片生命周期仍由调用方负责（dispose 时会统一释放）。
   */
  register(url: string, image: SkImage): void {
    this.memory.set(url, image);
  }

  /** 原图 -> 缩略图 -> 占位图，三级降级 */
  async getOrDefault(url: string, fallbackUrl: string): Promise<SkImage> {
    if (this.opts.downloadOriginal) {
      const original = await this.get(url);
      if (original) return original;
    }
    const fallback = await this.get(fallbackUrl);
    if (fallback) return fallback;
    return this.getMissImage();
  }

  /** 图片缺失时的占位图，对应 image/IMAGE_MISS.png */
  getMissImage(): SkImage {
    if (this.missImage) return this.missImage;
    // 生成 2x2 透明占位图，避免依赖外部资源
    const surface = this.ck.MakeSurface(2, 2);
    if (!surface) throw new Error('无法创建占位图 Surface');
    const image = surface.makeImageSnapshot();
    surface.dispose();
    this.missImage = image;
    return image;
  }

  private async download(url: string): Promise<Uint8Array | null> {
    const impl = this.opts.fetchImpl ?? fetch;
    try {
      const response = await impl(url, { headers: this.opts.headers });
      if (!response.ok) return null;
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    } catch {
      return null;
    }
  }

  /** 释放全部已缓存图片 */
  dispose(): void {
    for (const image of this.memory.values()) image.delete();
    this.memory.clear();
    if (this.missImage) {
      this.missImage.delete();
      this.missImage = null;
    }
  }
}
