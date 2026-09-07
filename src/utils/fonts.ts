/**
 * 默认字体自动下载 —— 对齐原插件 loadFonts() 的「目录为空时自动下载」语义
 *
 * 字体源：霞鹜文楷官方仓库 main 分支的 LXGWWenKai-Medium.ttf。
 * 官方最新版本已不提供 Bold 字重（原插件使用的 v1.235.2 旧打包才包含），
 * Medium 为当前官方可获取的最粗字重。
 */

import fs from 'node:fs';
import path from 'node:path';

/** 默认字体下载地址（霞鹜文楷官方仓库） */
export const DEFAULT_FONT_URL =
  'https://github.com/lxgw/LxgwWenKai/raw/refs/heads/main/fonts/TTF/LXGWWenKai-Medium.ttf';

export const DEFAULT_FONT_NAME = 'LXGWWenKai-Medium.ttf';

/** GitHub 加速代理前缀：官方直链传输失败时逐个回退尝试 */
export const PROXY_PREFIXES = [
  'https://ghfast.top/',
  'https://gh-proxy.com/',
  'https://ghproxy.net/',
];

export interface EnsureFontOptions {
  /** 字体目录，默认 <cwd>/font */
  fontDir?: string;
  /** 自定义 fetch，便于测试或走代理 */
  fetchImpl?: typeof fetch;
  /** 下载超时（毫秒），默认 120 秒 */
  timeoutMs?: number;
}

/**
 * 确保 font 目录中存在默认字体，返回其 Buffer；目录中已有则直接读取。
 * 下载按「官方直链 -> 加速代理」顺序逐源尝试，任一源拿到有效 TTF 即落地。
 * 全部失败返回 null（与原插件「log error 后继续」的容错一致）。
 */
export async function ensureDefaultFont(
  options: EnsureFontOptions = {},
): Promise<Buffer | null> {
  const fontDir = options.fontDir ?? path.join(process.cwd(), 'font');
  const target = path.join(fontDir, DEFAULT_FONT_NAME);

  // 目录中已有默认字体则跳过下载
  if (fs.existsSync(target)) return fs.readFileSync(target);

  fs.mkdirSync(fontDir, { recursive: true });

  const impl = options.fetchImpl ?? fetch;
  const perSourceTimeout = options.timeoutMs ?? 90_000;
  const sources = [DEFAULT_FONT_URL, ...PROXY_PREFIXES.map((p) => p + DEFAULT_FONT_URL)];

  for (const url of sources) {
    try {
      const response = await impl(url, {
        signal: AbortSignal.timeout(perSourceTimeout),
        // GitHub raw 直链会 302 到 raw.githubusercontent.com / codeload
        redirect: 'follow',
      });
      if (!response.ok) continue;
      const fontBuffer = Buffer.from(await response.arrayBuffer());
      // 简单校验：TTF 魔数 0x00010000 / 'true' / 'OTTO'，拦截失效代理返回的错误页
      if (!isTtfBuffer(fontBuffer)) continue;
      fs.writeFileSync(target, fontBuffer);
      return fontBuffer;
    } catch {
      // 尝试下一个源
    }
  }
  return null;
}

/** 读取字体目录下的全部字体文件 */
export function readFontDir(fontDir: string): Uint8Array[] {
  if (!fs.existsSync(fontDir)) return [];
  return fs
    .readdirSync(fontDir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => new Uint8Array(fs.readFileSync(path.join(fontDir, d.name))));
}

function isTtfBuffer(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const tag = buf.readUInt32BE(0);
  return tag === 0x00010000 || tag === 0x74727565 || tag === 0x4f54544f;
}
