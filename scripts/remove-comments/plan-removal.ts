import { classifyComments } from '../comment-policy.js';
import { isProtectedComment } from '../move-purity/protected-comments.js';
import { deleteRanges, type TextRange } from './delete-ranges.js';
import { commentWords, isReviewCandidate } from './invariant-words.js';

export interface Candidate {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface RemovalPlan {
  readonly ranges: TextRange[];
  readonly candidates: Candidate[];
  readonly keptCandidates: number;
  readonly keptProtected: number;
}

interface Banned extends TextRange {
  readonly text: string;
  readonly lineComment: boolean;
}

const lineOf = (text: string, pos: number): number => text.slice(0, pos).split('\n').length;

function groupsOf(text: string, comments: readonly Banned[]): Banned[][] {
  const groups: Banned[][] = [];
  for (const comment of comments) {
    const last = groups[groups.length - 1];
    const previous = last?.[last.length - 1];
    const adjacent =
      previous !== undefined &&
      previous.lineComment &&
      comment.lineComment &&
      /^\r?\n[ \t]*$/.test(text.slice(previous.end, comment.pos));
    if (adjacent) last!.push(comment);
    else groups.push([comment]);
  }
  return groups;
}

export function planRemoval(
  path: string,
  text: string,
  publicKeys: Set<string>,
  keepInvariants: boolean,
): RemovalPlan {
  const banned = classifyComments(path, text, publicKeys)
    .filter((comment) => comment.kind === 'banned')
    .sort((a, b) => a.pos - b.pos)
    .map((comment) => {
      const body = text.slice(comment.pos, comment.end);
      return { pos: comment.pos, end: comment.end, text: body, lineComment: body.startsWith('//') };
    });
  const removable = banned.filter((comment) => !isProtectedComment(comment.text));
  const ranges: TextRange[] = [];
  const candidates: Candidate[] = [];
  let keptCandidates = 0;
  for (const group of groupsOf(text, removable)) {
    const body = group.map((comment) => comment.text).join('\n');
    if (isReviewCandidate(body)) {
      candidates.push({ path, line: lineOf(text, group[0]!.pos), text: commentWords(body) });
      if (keepInvariants) {
        keptCandidates += 1;
        continue;
      }
    }
    ranges.push(...group.map(({ pos, end }) => ({ pos, end })));
  }
  return {
    ranges,
    candidates,
    keptCandidates,
    keptProtected: banned.length - removable.length,
  };
}

export const applyRemoval = (text: string, plan: RemovalPlan): string =>
  deleteRanges(text, plan.ranges);
