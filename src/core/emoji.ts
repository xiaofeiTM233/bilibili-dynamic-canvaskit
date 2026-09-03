/**
 * Emoji 识别与文本切分 —— 移植自 General.kt
 *
 * 语义转换说明（移植中最易出错的一环）：
 * 原正则以代理对形式书写，如 [\uD83C\uDF00-\uD83D\uDDFF]。Java 正则引擎在解析
 * \uXXXX 时会自动合并代理对，因此其真实含义是 code point 区间 [U+1F300-U+1F5FF]，
 * 而非四个孤立代理项。JS 若照抄字面量，语义会完全退化。
 * 故此处统一改写为 u 标志下的 \u{...} code point 区间形式。
 *
 * 索引语义：Kotlin 的 MatchResult.range 与 JS 的 match.index 同为 UTF-16 码元索引，
 * 因此切分逻辑可直接照搬，无需换算。
 */

/** 单个 emoji 单元（含可选修饰符） */
const EMOJI_CHARACTER = [
  '[\\u{1F300}-\\u{1F5FF}]',
  '[\\u{1F900}-\\u{1F9FF}]',
  '[\\u{1F600}-\\u{1F64F}]',
  '[\\u{1F680}-\\u{1F6FF}]',
  '[\\u2600-\\u26FF]\\uFE0F?',
  '[\\u2700-\\u27BF]\\uFE0F?',
  '\\u24C2\\uFE0F?',
  '[\\u{1F1E6}-\\u{1F1FF}]{1,2}',
  '[\\u{1F170}\\u{1F171}\\u{1F17E}\\u{1F17F}\\u{1F18E}\\u{1F191}-\\u{1F19A}]\\uFE0F?',
  '[\\u0023\\u002A\\u0030-\\u0039]\\uFE0F?\\u20E3',
  '[\\u2194-\\u2199\\u21A9-\\u21AA]\\uFE0F?',
  '[\\u2B05-\\u2B07\\u2B1B\\u2B1C\\u2B50\\u2B55]\\uFE0F?',
  '[\\u2934\\u2935]\\uFE0F?',
  '[\\u3030\\u303D]\\uFE0F?',
  '[\\u3297\\u3299]\\uFE0F?',
  '[\\u{1F201}\\u{1F202}\\u{1F21A}\\u{1F22F}\\u{1F232}-\\u{1F23A}\\u{1F250}\\u{1F251}]\\uFE0F?',
  '[\\u203C\\u2049]\\uFE0F?',
  '[\\u25AA\\u25AB\\u25B6\\u25C0\\u25FB-\\u25FE]\\uFE0F?',
  '[\\u00A9\\u00AE]\\uFE0F?',
  '[\\u2122\\u2139]\\uFE0F?',
  '\\u{1F004}\\uFE0F?',
  '\\u{1F0CF}\\uFE0F?',
  '[\\u231A\\u231B\\u2328\\u23CF\\u23E9-\\u23F3\\u23F8-\\u23FA]\\uFE0F?',
].join('|');

/** 肤色/发色修饰符 */
const EMOJI_MODIFIER = '(?:[\\u{1F3FB}-\\u{1F3FF}]|[\\u{1F9B0}-\\u{1F9B3}])?';

/** 支持 ZWJ（U+200D）连接的组合 emoji，如家庭、职业类表情 */
export const EMOJI_REGEX = new RegExp(
  `(?:${EMOJI_CHARACTER})${EMOJI_MODIFIER}(?:\\u200D(?:${EMOJI_CHARACTER})${EMOJI_MODIFIER})*`,
  'gu',
);

export type RichTextNode =
  | { kind: 'text'; value: string }
  | { kind: 'emoji'; value: string };

/**
 * 按 emoji 切分文本，保留原始顺序与相邻普通文本。
 * 对应 Kotlin 中 emojiRegex.findAll + RichText 分段逻辑。
 */
export function splitByEmoji(text: string): RichTextNode[] {
  const nodes: RichTextNode[] = [];
  let index = 0;

  // matchAll 需重置 lastIndex，正则对象为模块级共享
  EMOJI_REGEX.lastIndex = 0;
  for (const match of text.matchAll(EMOJI_REGEX)) {
    const start = match.index ?? 0;
    if (index !== start) {
      nodes.push({ kind: 'text', value: text.substring(index, start) });
    }
    nodes.push({ kind: 'emoji', value: match[0] });
    index = start + match[0].length;
  }

  if (index !== text.length) {
    nodes.push({ kind: 'text', value: text.substring(index, text.length) });
  }
  return nodes;
}

/**
 * 由 emoji 生成 twemoji 资源名。
 * 对应 Kotlin：codePoints -> 16 进制以 '-' 连接，并在非 ZWJ 组合时去掉尾部 fe0f。
 */
export function twemojiName(emoji: string): string {
  const parts = Array.from(emoji)
    .flatMap((ch) => {
      const cp = ch.codePointAt(0);
      if (cp === undefined) return [];
      return [cp];
    })
    .map((cp) => cp.toString(16))
    .join('-');

  let segments = parts.split('-');
  if (segments[segments.length - 1] === 'fe0f' && !segments.includes('200d')) {
    segments = segments.slice(0, -1);
  }
  return segments.join('-');
}
