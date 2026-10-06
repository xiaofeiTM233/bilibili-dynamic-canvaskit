/**
 * 图片资源加载 —— 移植自 utils/General.kt
 *
 * 与原实现的差异：
 * 1. Kotlin 端经 BiliClient（Ktor）下载，此处改用 Node 内置 fetch，请求头可注入；
 * 2. 缓存分两级：磁盘为主（cacheDir 开启，目录结构对应 CacheType：images/emoji/user/other），
 *    内存只做「一次渲染内」的短时复用，空闲超过 memoryIdleMs（默认 60 秒）即释放，下次从磁盘重读；
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
  /**
   * 内存缓存条目上限（张数），默认 50。空闲淘汰之外的兜底，
   * 防止单次渲染批量加载（九宫格等）时瞬时解码位图过多。
   */
  maxMemoryImages?: number;
  /**
   * 内存缓存空闲存活时间（毫秒），默认 60000。
   * 内存不长期驻留：超过该时间没有被再次取用的图片会被释放，
   * 下次需要时从磁盘缓存重新读取（cacheDir 未开启时则重新下载）。
   */
  memoryIdleMs?: number;
}

/**
 * 图片缓存与加载。
 * 对应 getOrDownloadImage / getOrDownloadImageDefault 的语义：
 * - get：失败返回 null
 * - getOrDefault：原图 -> 缩略图 -> 占位图，三级降级，保证始终返回可用 Image
 */
export class ImageStore {
  private readonly memory = new Map<string, SkImage>();
  /** url -> 最后取用时间（毫秒），用于空闲淘汰与 LRU 兜底 */
  private readonly lastUsed = new Map<string, number>();
  private readonly opts: Required<
    Pick<
      ImageStoreOptions,
      'downloadOriginal' | 'headers' | 'retries' | 'maxMemoryImages' | 'memoryIdleMs'
    >
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
      maxMemoryImages: options.maxMemoryImages ?? 50,
      memoryIdleMs: options.memoryIdleMs ?? 60_000,
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
    this.pruneIdle(); // 先回收空闲超过 memoryIdleMs 的条目
    const cached = this.memory.get(url);
    if (cached) {
      this.lastUsed.set(url, Date.now());
      return cached;
    }

    const file = this.cacheFile(url, cacheType);
    if (file && fs.existsSync(file)) {
      try {
        const image = this.ck.MakeImageFromEncoded(new Uint8Array(fs.readFileSync(file)));
        if (image) {
          fs.utimesSync(file, new Date(), new Date()); // 命中即续期，供按天清理
          this.remember(url, image);
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
          this.remember(url, image);
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

  /** 记入内存缓存（含最后取用时间），并按条目上限兜底淘汰最久未用 */
  private remember(url: string, image: SkImage): void {
    this.lastUsed.set(url, Date.now());
    this.memory.set(url, image);
    while (this.memory.size > this.opts.maxMemoryImages) {
      const oldest = this.oldestKey();
      if (oldest === undefined) break;
      this.release(oldest);
    }
  }

  /** 最近最少使用的 url */
  private oldestKey(): string | undefined {
    let oldest: string | undefined;
    let at = Number.POSITIVE_INFINITY;
    for (const [url, time] of this.lastUsed) {
      if (time < at) {
        at = time;
        oldest = url;
      }
    }
    return oldest;
  }

  /** 从内存缓存移除并释放解码位图 */
  private release(url: string): void {
    const image = this.memory.get(url);
    this.memory.delete(url);
    this.lastUsed.delete(url);
    image?.delete();
  }

  /**
   * 释放空闲超过 ttlMs 的内存缓存，返回释放张数；每次 get 前自动调用一次。
   *
   * 内存只承担「一次渲染内」的复用（同一张图在一次渲染里可能被取用多次）；
   * 之后一律回到磁盘缓存重读，避免长驻进程里解码位图越积越多。
   * ttlMs 传 0 表示立即清空内存缓存（仅保留已释放过的占位图）。
   */
  pruneIdle(ttlMs: number = this.opts.memoryIdleMs): number {
    const deadline = Date.now() - ttlMs;
    let released = 0;
    for (const [url, at] of [...this.lastUsed]) {
      if (at > deadline) continue;
      this.release(url);
      released++;
    }
    return released;
  }

  /**
   * 将调用方已持有的图片注入缓存，后续 get/getOrDefault 直接命中。
   * 便于演示与集成场景复用预生成的图片（避免再次解码/下载）。
   * 注入的图片生命周期仍由调用方负责（dispose 时会统一释放）。
   */
  register(url: string, image: SkImage): void {
    this.remember(url, image);
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
    this.lastUsed.clear();
    if (this.missImage) {
      this.missImage.delete();
      this.missImage = null;
    }
  }
}
