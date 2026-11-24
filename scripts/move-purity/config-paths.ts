import { unitsOfPath } from './compare-units.js';
import { finding, type Finding } from './finding.js';
import { COMMENT_BASELINE, SIZE_BASELINE } from './outside-move.js';
import type { Side } from './side-program.js';

const CONFIG_NAMES = new Set(['eslint.config.mjs', 'vitest.config.ts', 'package.json']);

export function isPathKeyedConfig(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (CONFIG_NAMES.has(name) || /^tsconfig.*\.json$/.test(name)) return true;
  return /^scripts\/[^/]+\.json$/.test(path) && path !== SIZE_BASELINE && path !== COMMENT_BASELINE;
}

const unitSet = (side: Side, path: string): string =>
  unitsOfPath(side, path)
    .map((unit) => unit.hash)
    .sort()
    .join(',');

export function configPathFindings(base: Side, head: Side, sources: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  const configs: { name: string; text: string }[] = [];
  for (const side of [base, head]) {
    for (const [name, text] of side.texts) {
      if (isPathKeyedConfig(name)) configs.push({ name, text });
    }
  }
  for (const path of sources) {
    const inBase = base.sourceOf(path) !== undefined;
    const inHead = head.sourceOf(path) !== undefined;
    const changesUnits = inBase !== inHead || unitSet(base, path) !== unitSet(head, path);
    if (!changesUnits) continue;
    const naming = [...new Set(configs.filter((c) => c.text.includes(path)).map((c) => c.name))];
    for (const name of naming) findings.push(finding(`path is named in ${name}`, path, ''));
  }
  return findings;
}
