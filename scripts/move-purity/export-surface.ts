import type { Keyer } from './binding-keys.js';
import { finding, type Finding } from './finding.js';
import type { Side } from './side-program.js';

export function surfaceFindings(
  base: Side,
  head: Side,
  baseKeyer: Keyer,
  headKeyer: Keyer,
): Finding[] {
  const findings: Finding[] = [];
  const paths = [...base.texts.keys()].filter((p) => p.endsWith('.ts') && head.texts.has(p)).sort();
  for (const path of paths) {
    const before = baseKeyer.exportKeys(path);
    const after = headKeyer.exportKeys(path);
    if (!before || !after) continue;
    for (const name of new Set([...before.keys(), ...after.keys()])) {
      const was = before.get(name);
      const now = after.get(name);
      if (was !== now) {
        findings.push(
          finding('surface', path, `${name} base ${was ?? 'absent'} head ${now ?? 'absent'}`),
        );
      }
    }
  }
  return findings;
}
