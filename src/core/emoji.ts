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
  // 国旗：区域指示符成对出现，必须优先于单字符匹配
  '[\\u{1F1E6}-\\u{1F1FF}]{1,2}',
  // 键帽：数字/#/* + 可选 VS16 + U+20E3
  '[\\u0023\\u002A\\u0030-\\u0039]\\uFE0F?\\u20E3',
  // Emoji_Presentation=Yes：默认就是 emoji 呈现，无需 VS16
  '[\\u{1F300}-\\u{1F5FF}]',
  '[\\u{1F900}-\\u{1F9FF}]',
  '[\\u{1F600}-\\u{1F64F}]',
  '[\\u{1F680}-\\u{1F6FF}]',
  '[\\u{1F004}\\u{1F0CF}\\u{1F18E}\\u{1F191}-\\u{1F19A}\\u{1F1E6}-\\u{1F1FF}\\u{1F201}\\u{1F21A}\\u{1F22F}\\u{1F232}-\\u{1F236}\\u{1F238}-\\u{1F23A}\\u{1F250}-\\u{1F251}]',
  '[\\u231A-\\u231B\\u23E9-\\u23EC\\u23F0\\u23F3\\u25FD-\\u25FE\\u2614-\\u2615\\u2648-\\u2653\\u267F\\u2693\\u26A1\\u26AA-\\u26AB\\u26BD-\\u26BE\\u26C4-\\u26C5\\u26CE\\u26D4\\u26EA\\u26F2-\\u26F3\\u26F5\\u26FA\\u26FD\\u2705\\u270A-\\u270B\\u2728\\u274C\\u274E\\u2753-\\u2755\\u2757\\u2795-\\u2797\\u27B0\\u27BF\\u2B1B-\\u2B1C\\u2B50\\u2B55]',
  // Emoji=Yes 但 Emoji_Presentation=No：默认按文字呈现，必须显式带 U+FE0F 才当 emoji
  // 依据 Unicode 14.0 emoji-data.txt（Emoji 属性减去 Emoji_Presentation 属性）
  '[\\u{1F170}-\\u{1F171}\\u{1F17E}-\\u{1F17F}\\u{1F202}\\u{1F237}]\\uFE0F',
  '[\\u00A9\\u00AE\\u203C\\u2049\\u2122\\u2139\\u2194-\\u2199\\u21A9-\\u21AA\\u2328\\u23CF\\u23ED-\\u23EF\\u23F1-\\u23F2\\u23F8-\\u23FA\\u24C2\\u25AA-\\u25AB\\u25B6\\u25C0\\u25FB-\\u25FC\\u2600-\\u2604\\u260E\\u2611\\u2618\\u261D\\u2620\\u2622-\\u2623\\u2626\\u262A\\u262E-\\u262F\\u2638-\\u263A\\u2640\\u2642\\u265F-\\u2660\\u2663\\u2665-\\u2666\\u2668\\u267B\\u267E\\u2692\\u2694-\\u2697\\u2699\\u269B-\\u269C\\u26A0\\u26A7\\u26B0-\\u26B1\\u26C8\\u26CF\\u26D1\\u26D3\\u26E9\\u26F0-\\u26F1\\u26F4\\u26F7-\\u26F9\\u2702\\u2708-\\u2709\\u270C-\\u270D\\u270F\\u2712\\u2714\\u2716\\u271D\\u2721\\u2733-\\u2734\\u2744\\u2747\\u2763-\\u2764\\u27A1\\u2934-\\u2935\\u2B05-\\u2B07\\u3030\\u303D\\u3297\\u3299]\\uFE0F',
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
