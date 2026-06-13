import { pinyin } from "pinyin-pro";

/**
 * Precompute a name's searchable pinyin: full pinyin + initials, space
 * separated (e.g. 微信 → "weixin wx"). Names with no Chinese characters yield
 * "". Cached by name — a name's pinyin never changes, so each is computed once
 * per process and reused across rescans.
 *
 * Lives in main (not the renderer) so pinyin-pro's dictionary stays out of the
 * renderer bundle; the result rides along on AppEntry over IPC.
 */
const cache = new Map<string, string>();

/** Whether the string contains at least one CJK ideograph worth romanizing. */
function hasChinese(s: string): boolean {
  return /[一-鿿]/.test(s);
}

export function pinyinForName(name: string): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  let value = "";
  if (hasChinese(name)) {
    const full = pinyin(name, { toneType: "none", type: "array" }).join("");
    const initials = pinyin(name, {
      pattern: "first",
      toneType: "none",
      type: "array",
    }).join("");
    value = `${full} ${initials}`.trim();
  }
  cache.set(name, value);
  return value;
}
