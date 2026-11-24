import { checkCommentRemoval, SURFACE_PATH, type CommentReport } from './check-comments.js';
import {
  commitCount,
  diffEntries,
  diffPaths,
  mergeBase,
  readTexts,
  trackedPaths,
} from './git-range.js';
import { isCoveragePath } from './line-citations.js';
import { COMMENT_BASELINE } from './outside-move.js';

export interface CommentRangeResult {
  readonly report: CommentReport;
  readonly commits: number;
}

export function checkCommentRange(
  root: string,
  baseRef: string,
  headRef: string,
): CommentRangeResult {
  const base = mergeBase(root, baseRef, headRef);
  const paths = diffPaths(root, base, headRef);
  const wanted = [
    ...paths,
    ...trackedPaths(root, headRef).filter(isCoveragePath),
    SURFACE_PATH,
    COMMENT_BASELINE,
  ];
  const report = checkCommentRemoval(
    readTexts(root, base, wanted),
    readTexts(root, headRef, wanted),
    { paths, entries: diffEntries(root, base, headRef) },
  );
  return { report, commits: commitCount(root, base, headRef) };
}
