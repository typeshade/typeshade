export const INVARIANT_PATTERNS: readonly RegExp[] = [
  /\bmust\b/i,
  /\bnever\b/i,
  /\balways\b/i,
  /\binvariants?\b/i,
  /\bassum(?:e|es|ed|ing|ption|ptions)\b/i,
  /\bguarantee[sd]?\b/i,
  /\bensure[sd]?\b/i,
  /\bonly if\b/i,
  /\bunless\b/i,
  /\botherwise\b/i,
  /\bcannot\b/i,
  /\bcan not\b/i,
  /\bcan't\b/i,
  /\bdo not\b/i,
  /\bdon't\b/i,
  /\bhas to\b/i,
  /\brequired?\b/i,
  /\bNOTE\b/,
  /\bXXX\b/,
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bHACK\b/,
  /\b(?:un)?safe\b/i,
  /\border matters\b/i,
  /(?:^|[.!?]\s+)(?:before|after)\b/i,
];

export function commentWords(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/^\/\/+|^\/\*+|\*+\/$/g, '')
        .replace(/^\*+/, '')
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join(' ');
}

export const isReviewCandidate = (text: string): boolean => {
  const words = commentWords(text);
  return INVARIANT_PATTERNS.some((pattern) => pattern.test(words));
};
