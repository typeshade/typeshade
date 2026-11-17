import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SIZE_BASELINE_PATH, oversizeFiles, readSizeBaseline } from './file-size-policy.js';

const root = process.cwd();
const found = oversizeFiles(root);
const known = existsSync(join(root, SIZE_BASELINE_PATH)) ? readSizeBaseline(root) : found;

const grown = Object.entries(found).filter(([path, lines]) => lines > (known[path] ?? 0));
if (grown.length > 0) {
  for (const [path, lines] of grown) {
    console.error(`${path}: ${lines} lines, the baseline records ${known[path] ?? 'no entry'}`);
  }
  console.error('The baseline only goes down. Split the file.');
  process.exit(1);
}

const next: Record<string, number> = {};
for (const path of Object.keys(found).sort()) next[path] = found[path]!;
writeFileSync(join(root, SIZE_BASELINE_PATH), `${JSON.stringify(next, null, 2)}\n`);
const total = Object.values(next).reduce((a, b) => a + b, 0);
console.log(`${SIZE_BASELINE_PATH}: ${Object.keys(next).length} files, ${total} lines.`);
