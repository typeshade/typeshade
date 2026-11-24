import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { encodeLiteral, type EvidenceLiteral } from './literals.js';
import { SEGMENT_SEPARATOR } from './segments.js';
import type { SegmentResult } from './types.js';
import type { Verify } from './verify.js';

export interface WriteOutcome {
  readonly files: readonly string[];
  readonly segments: number;
  readonly problems: readonly string[];
}

export function rewriteLiteral(literal: EvidenceLiteral, changes: ReadonlyMap<number, string>) {
  const segments = literal.value.split(SEGMENT_SEPARATOR);
  for (const [at, text] of changes) segments[at] = text;
  return encodeLiteral(segments.join(SEGMENT_SEPARATOR), literal.quote ?? "'");
}

export function rewriteText(
  text: string,
  results: readonly SegmentResult[],
): { text: string; count: number } {
  const byLiteral = new Map<EvidenceLiteral, Map<number, string>>();
  for (const result of results) {
    const changes = byLiteral.get(result.literal) ?? new Map<number, string>();
    changes.set(result.index, result.proposed!);
    byLiteral.set(result.literal, changes);
  }
  let out = text;
  const ordered = [...byLiteral].sort(([a], [b]) => b.start - a.start);
  for (const [literal, changes] of ordered) {
    out = out.slice(0, literal.start) + rewriteLiteral(literal, changes) + out.slice(literal.end);
  }
  return { text: out, count: results.length };
}

export async function applyWrite(
  root: string,
  eligible: readonly SegmentResult[],
  verify: Verify,
): Promise<WriteOutcome> {
  if (eligible.length === 0) return { files: [], segments: 0, problems: [] };
  const before = verify(root);
  if (before.length > 0) {
    return {
      files: [],
      segments: 0,
      problems: [`the evidence has ${before.length} defects before the write`, ...before],
    };
  }
  const byFile = new Map<string, SegmentResult[]>();
  for (const result of eligible) {
    byFile.set(result.literal.file, [...(byFile.get(result.literal.file) ?? []), result]);
  }
  const originals = new Map<string, string>();
  try {
    for (const [file, results] of byFile) {
      const full = join(root, file);
      const original = readFileSync(full, 'utf8');
      originals.set(file, original);
      const rewritten = rewriteText(original, results).text;
      const config = (await resolveConfig(full)) ?? {};
      writeFileSync(full, await format(rewritten, { ...config, filepath: full }));
    }
    const after = verify(root);
    if (after.length > 0) throw new Error(after.join('\n'));
  } catch (error) {
    for (const [file, original] of originals) writeFileSync(join(root, file), original);
    return {
      files: [],
      segments: 0,
      problems: ['the write was undone', String(error instanceof Error ? error.message : error)],
    };
  }
  return { files: [...byFile.keys()], segments: eligible.length, problems: [] };
}
