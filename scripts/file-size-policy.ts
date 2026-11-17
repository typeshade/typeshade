import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { policedFiles } from './comment-policy.js';

export const LINE_LIMIT = 400;
export const SIZE_BASELINE_PATH = 'scripts/file-size-baseline.json';

export function lineCount(text: string): number {
  if (text.length === 0) return 0;
  const lines = text.split('\n').length;
  return text.endsWith('\n') ? lines - 1 : lines;
}

export function oversizeFiles(root: string): Record<string, number> {
  const sizes: Record<string, number> = {};
  for (const path of policedFiles(root)) {
    const lines = lineCount(readFileSync(join(root, path), 'utf8'));
    if (lines > LINE_LIMIT) sizes[path] = lines;
  }
  return sizes;
}

export function readSizeBaseline(root: string): Record<string, number> {
  return JSON.parse(readFileSync(join(root, SIZE_BASELINE_PATH), 'utf8')) as Record<string, number>;
}
