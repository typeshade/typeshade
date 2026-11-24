import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { bannedCommentLines } from '../comment-policy.js';
import { compareCommentFiles } from '../move-purity/comment-removal.js';
import { applyRemoval, planRemoval, type Candidate } from './plan-removal.js';

export interface RemovalOptions {
  readonly keepInvariants: boolean;
}

export interface FileResult {
  readonly path: string;
  readonly bannedBefore: number;
  readonly bannedAfter: number;
  readonly removedComments: number;
  readonly candidates: Candidate[];
  readonly keptCandidates: number;
  readonly keptProtected: number;
  readonly problems: string[];
  readonly text: string;
}

export async function removeFileComments(
  root: string,
  path: string,
  text: string,
  publicKeys: Set<string>,
  options: RemovalOptions,
): Promise<FileResult> {
  const plan = planRemoval(path, text, publicKeys, options.keepInvariants);
  const full = join(root, path);
  const styled = await format(applyRemoval(text, plan), {
    ...((await resolveConfig(full)) ?? {}),
    filepath: full,
  });
  const check = compareCommentFiles(path, text, styled, publicKeys);
  return {
    path,
    bannedBefore: bannedCommentLines(path, text, publicKeys),
    bannedAfter: bannedCommentLines(path, styled, publicKeys),
    removedComments: plan.ranges.length,
    candidates: plan.candidates,
    keptCandidates: plan.keptCandidates,
    keptProtected: plan.keptProtected,
    problems: check.findings.map((f) => `${f.kind} ${f.path}:${f.line ?? 0} ${f.detail}`),
    text: check.findings.length === 0 ? styled : text,
  };
}
