interface Edit {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export function editedRanges(
  files: readonly string[],
  changes: readonly Edit[],
): { file: string; start: number; end: number }[] {
  const out: { file: string; start: number; end: number }[] = [];
  for (const file of files) {
    let delta = 0;
    for (const c of changes.filter((x) => x.file === file).sort((a, b) => a.start - b.start)) {
      out.push({ file, start: c.start + delta, end: c.start + delta + c.text.length });
      delta += c.text.length - (c.end - c.start);
    }
  }
  return out;
}
