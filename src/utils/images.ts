/**
 * 图片资源加载 —— 移植自 utils/General.kt
 *
 * 与原实现的差异：
 * 1. Kotlin 端经 BiliClient（Ktor）下载，此处改用 Node 内置 fetch，请求头可注入；
 * 2. 缓存分两级：内存常驻 + 磁盘（cacheDir 开启，目录结构对应 CacheType：images/emoji/user/other）；
 * 3. 返回的 Image 由 CanvasKit 解码，生命周期交给调用方（需 delete）。
 */

import fs from 'node:fs';
import path from 'node:path';

import type { Image as SkImage } from 'canvaskit-wasm';

import type { CK } from '../core/skia';

/** 磁盘缓存分类，对应 mirai CacheType（draw 系列由调用方 cacheImage 自行写入） */
export type CacheType = 'images' | 'emoji' | 'user' | 'other';

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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface ImageStoreOptions {
  /** 下载原图；关闭时仅使用缩略图接口，对应 cacheConfig.downloadOriginal */
  downloadOriginal?: boolean;
  /** 附加请求头，B 站图床通常需要 Referer 与 UA */
  headers?: Record<string, string>;
  /** 磁盘缓存根目录；不传则仅使用内存缓存 */
  cacheDir?: string;
  /** 自定义 fetch，便于测试或走代理 */
  fetchImpl?: typeof fetch;
  /** 下载/解码失败后的重试次数（不含首次），默认 2；403/404/410 不重试 */
  retries?: number;
}

/**
 * 图片缓存与加载。
 * 对应 getOrDownloadImage / getOrDownloadImageDefault 的语义：
 * - get：失败返回 null
 * - getOrDefault：原图 -> 缩略图 -> 占位图，三级降级，保证始终返回可用 Image
 */
export class ImageStore {
  private readonly memory = new Map<string, SkImage>();
  private readonly opts: Required<
    Pick<ImageStoreOptions, 'downloadOriginal' | 'headers' | 'retries'>
  > &
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
      retries: options.retries ?? 2,
    };
  }

  /** 同一 URL 的失败只告警一次，避免刷屏 */
  private readonly warned = new Set<string>();

  private warnOnce(url: string, reason: string): void {
    if (this.warned.has(url)) return;
    this.warned.add(url);
    console.warn(`[bilibili-dynamic-canvaskit] 图片加载失败（${reason}）: ${url}`);
  }

  /**
   * 磁盘缓存文件路径，对应 mirai getOrDownload 的命名规则：
   * 去掉 ?query、去掉 @处理后缀、取路径最后一段。
   * 如 https://i0.hdslb.com/.../xxx.jpg@940w_587h_1e_1c.png -> xxx.jpg
   * 这样原图与缩略图共享同一份磁盘缓存。
   */
  private cacheFile(url: string, cacheType: CacheType): string | null {
    if (!this.opts.cacheDir) return null;
    const name = url.split('?')[0].split('@')[0].split('/').pop() ?? '';
    if (!name) return null;
    return path.join(this.opts.cacheDir, cacheType, name);
  }

  /** 获取图片，失败返回 null；磁盘缓存命中直接读文件，未命中下载后落盘；下载/解码失败自动重试 */
  async get(url: string, cacheType: CacheType = 'other'): Promise<SkImage | null> {
    if (!url) return null;
    if (url.startsWith('cache/')) return null; // 本地缓存路径哨兵，对应 mirai
    const cached = this.memory.get(url);
    if (cached) return cached;

    const file = this.cacheFile(url, cacheType);
    if (file && fs.existsSync(file)) {
      try {
        const image = this.ck.MakeImageFromEncoded(new Uint8Array(fs.readFileSync(file)));
        if (image) {
          fs.utimesSync(file, new Date(), new Date()); // 命中即续期，供按天清理
          this.memory.set(url, image);
          return image;
        }
        // 缓存文件损坏：删掉后走下载
        fs.unlinkSync(file);
      } catch {
        /* 缓存读取失败，走下载 */
      }
    }

    const attempts = 1 + Math.max(0, this.opts.retries);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const { bytes, permanent } = await this.download(url);
      if (bytes) {
        if (file) {
          try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, bytes);
          } catch {
            /* 磁盘缓存写失败不影响渲染 */
          }
        }
        const image = this.ck.MakeImageFromEncoded(bytes);
        if (image) {
          this.memory.set(url, image);
          return image;
        }
        // 字节有效但解码失败：可能是响应被截断，重试重新下载
      }
      if (permanent || attempt === attempts) break;
      await sleep(250 * attempt);
    }
    this.warnOnce(url, `下载/解码失败（已尝试 ${attempts} 次）`);
    return null;
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
  async getOrDefault(url: string, fallbackUrl: string, cacheType: CacheType = 'other'): Promise<SkImage> {
    if (this.opts.downloadOriginal) {
      const original = await this.get(url, cacheType);
      if (original) return original;
    }
    const fallback = await this.get(fallbackUrl, cacheType);
    if (fallback) return fallback;
    return this.getMissImage();
  }

  /**
   * 图片缺失时的占位图，对应 image/IMAGE_MISS.png（粉色「!!! 图片资源缺失 !!!」）。
   * 资源随包附带；万一缺失则退化为 2x2 透明占位图。
   */
  getMissImage(): SkImage {
    if (this.missImage) return this.missImage;
    const missPng = path.resolve(__dirname, '..', '..', 'assets', 'image', 'IMAGE_MISS.png');
    if (fs.existsSync(missPng)) {
      const image = this.ck.MakeImageFromEncoded(new Uint8Array(fs.readFileSync(missPng)));
      if (image) {
        this.missImage = image;
        return image;
      }
    }
    // 生成 2x2 透明占位图，避免依赖外部资源
    const surface = this.ck.MakeSurface(2, 2);
    if (!surface) throw new Error('无法创建占位图 Surface');
    const image = surface.makeImageSnapshot();
    surface.dispose();
    this.missImage = image;
    return image;
  }

  /**
   * 下载图片。permanent=true 表示 403/404/410 这类确定性失败，重试也不会成功。
   */
  private async download(url: string): Promise<{ bytes: Uint8Array | null; permanent: boolean }> {
    const impl = this.opts.fetchImpl ?? fetch;
    try {
      const response = await impl(url, { headers: this.opts.headers });
      if (!response.ok) {
        return { bytes: null, permanent: [403, 404, 410].includes(response.status) };
      }
      const buffer = await response.arrayBuffer();
      return { bytes: new Uint8Array(buffer), permanent: false };
    } catch {
      return { bytes: null, permanent: false };
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
