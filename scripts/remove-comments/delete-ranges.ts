export interface TextRange {
  readonly pos: number;
  readonly end: number;
}

const blank = (text: string): boolean => text.trim().length === 0;

function deleteOne(text: string, range: TextRange): string {
  const lineStart = text.lastIndexOf('\n', range.pos - 1) + 1;
  const newline = text.indexOf('\n', range.end);
  const lineEnd = newline < 0 ? text.length : newline;
  const before = text.slice(lineStart, range.pos);
  const after = text.slice(range.end, lineEnd);
  if (blank(before) && blank(after)) {
    const cutEnd = newline < 0 ? text.length : newline + 1;
    return text.slice(0, lineStart) + text.slice(cutEnd);
  }
  if (blank(after)) {
    const keep = lineStart + before.trimEnd().length;
    return text.slice(0, keep) + text.slice(range.end);
  }
  const glue = before.length > 0 && !blank(before.slice(-1)) && !blank(after.slice(0, 1));
  return text.slice(0, range.pos) + (glue ? ' ' : '') + text.slice(range.end);
}

export function deleteRanges(text: string, ranges: readonly TextRange[]): string {
  return [...ranges]
    .sort((a, b) => b.pos - a.pos)
    .reduce((current, range) => deleteOne(current, range), text);
}
