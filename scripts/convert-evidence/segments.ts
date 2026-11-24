// The same grammar as `checkEvidence` in scripts/bake-capability-coverage.ts.
export const SEGMENT_SEPARATOR = '; ';
const SEGMENT_PATH = /^[\w@./-]+/;
const LINE_LIST = /^:(\d+(?:-\d+)?(?:, \d+(?:-\d+)?)*)/;
const COMMENT = /^ \([^()]*\)/;

export interface LineRange {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export interface LineCitation {
  readonly path: string;
  readonly ranges: readonly LineRange[];
  readonly comment: string;
}

export function parseLineCitation(segment: string): LineCitation | undefined {
  const path = SEGMENT_PATH.exec(segment)?.[0];
  if (path === undefined) return undefined;
  let rest = segment.slice(path.length);
  const listed = LINE_LIST.exec(rest);
  if (!listed) return undefined;
  rest = rest.slice(listed[0].length);
  const comment = COMMENT.exec(rest)?.[0] ?? '';
  if (rest !== comment) return undefined;
  const ranges = listed[1]!.split(', ').map((part) => {
    const [from, to = from] = part.split('-').map(Number) as [number, number?];
    return { from, to, text: part };
  });
  return { path, ranges, comment };
}
