/**
 * Lightweight fuzzy search. Pure logic (no Electron/Node deps) so it can run in
 * either process — currently used in the renderer to filter the app list live.
 */

/**
 * Score how well `query` fuzzy-matches `text` (both expected lowercase).
 * Returns 0 when not all query characters appear in order.
 */
function fuzzyScore(query: string, text: string): number {
  let qi = 0;
  let score = 0;
  let consecutive = 0;
  let prevMatch = -2;

  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] === query[qi]) {
      let s = 1;
      if (prevMatch === ti - 1) {
        consecutive++;
        s += consecutive * 2; // reward runs of adjacent matches
      } else {
        consecutive = 0;
      }
      const prev = text[ti - 1];
      if (ti === 0 || prev === " " || prev === "-" || prev === "_") {
        s += 3; // reward matches at word boundaries
      }
      score += s;
      prevMatch = ti;
      qi++;
    }
  }

  if (qi < query.length) return 0; // query not fully consumed → no match
  score += Math.max(0, 10 - text.length / 5); // mild preference for shorter names
  return score;
}

export class SearchEngine {
  /**
   * Filter and rank `items` by fuzzy match against their `name` and any extra
   * `keywords` (space/comma separated — matched token by token, best score
   * wins). When `opts.usePinyin` is set, each item's precomputed `pinyin`
   * (full + initials) is matched too, so "weixin"/"wx" find 微信. An empty
   * query returns the items unchanged.
   */
  search<T extends { name: string; keywords?: string; pinyin?: string }>(
    query: string,
    items: T[],
    opts?: { usePinyin?: boolean },
  ): T[] {
    const q = query.trim().toLowerCase();
    if (!q) return items;

    const scored: Array<{ item: T; score: number }> = [];
    for (const item of items) {
      const name = item.name.toLowerCase();
      let score = fuzzyScore(q, name);
      // Substring ("left-right fuzzy") match anywhere in the name ranks high,
      // even when the subsequence scorer would rate it weakly.
      if (name.includes(q)) score += 50;
      // Extra keywords, and (when enabled) pinyin, share the same token scorer.
      const extra = opts?.usePinyin
        ? `${item.keywords ?? ""} ${item.pinyin ?? ""}`
        : item.keywords;
      if (extra) {
        for (const kw of extra.toLowerCase().split(/[\s,，、]+/)) {
          if (!kw) continue;
          score = Math.max(score, fuzzyScore(q, kw));
          if (kw.includes(q)) score = Math.max(score, 50);
        }
      }
      if (score > 0) scored.push({ item, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.item);
  }
}
