/**
 * Search uses case-insensitive word-prefix matching, indexed; mid-word substring
 * is intentionally not matched. Query words are ANDed; Unicode letters/numbers
 * define words, so punctuation (including regex syntax) is a separator. Only
 * normalized words enter anchored regexes, never raw user input. Limits keep
 * pathological requests bounded; a blank/punctuation-only query means no filter.
 */
const MAX_QUERY_LENGTH = 200;
const MAX_QUERY_WORDS = 8;

export function searchTokens(...values: unknown[]): string[] {
  const tokens = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    for (const token of value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) tokens.add(token);
  }
  return [...tokens];
}

export function searchQueryPatterns(value: unknown): RegExp[] | null {
  if (typeof value !== "string") return [];
  if (value.length > MAX_QUERY_LENGTH) return null;
  const words = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length > MAX_QUERY_WORDS) return null;
  return [...new Set(words)].map((word) => new RegExp(`^${word}`));
}
