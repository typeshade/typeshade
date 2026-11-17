import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASELINE_PATH, countComments, readBaseline } from './comment-policy.js';

const root = process.cwd();
const found = countComments(root);
const first = !existsSync(join(root, BASELINE_PATH));
const known = first ? found : readBaseline(root);

const grown = Object.entries(found).filter(([path, lines]) => lines > (known[path] ?? 0));
if (grown.length > 0) {
  for (const [path, lines] of grown) {
    console.error(`${path}: ${lines} comment lines, the baseline records ${known[path] ?? 0}`);
  }
  console.error('The baseline only goes down. Remove the new comments.');
  process.exit(1);
}

const next: Record<string, number> = {};
for (const path of Object.keys(found).sort()) next[path] = found[path]!;
writeFileSync(join(root, BASELINE_PATH), `${JSON.stringify(next, null, 2)}\n`);
const total = Object.values(next).reduce((a, b) => a + b, 0);
console.log(`${BASELINE_PATH}: ${Object.keys(next).length} files, ${total} comment lines.`);
