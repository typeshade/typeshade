import { finding, type Finding } from './finding.js';
import type { Keyer } from './binding-keys.js';
import { refOf } from './compare-units.js';
import type { Unit } from './units.js';

const REBOUND_CAP = 5;

export function reboundFindings(
  pairs: readonly (readonly [Unit, Unit])[],
  baseKeyer: Keyer,
  headKeyer: Keyer,
): Finding[] {
  const findings: Finding[] = [];
  for (const [from, to] of pairs) {
    const before = baseKeyer.unitBindings(from);
    const after = headKeyer.unitBindings(to);
    const length = Math.max(before.keys.length, after.keys.length);
    const differing = Array.from({ length }, (_, i) => i).filter(
      (i) => before.keys[i] !== after.keys[i],
    );
    if (differing.length === 0) continue;
    const parts = differing
      .slice(0, REBOUND_CAP)
      .map(
        (i) =>
          `${before.texts[i] ?? '?'} base ${before.keys[i] ?? 'none'} head ${after.keys[i] ?? 'none'}`,
      );
    if (differing.length > REBOUND_CAP) parts.push(`and ${differing.length - REBOUND_CAP} more`);
    const ref = refOf(to);
    findings.push(
      finding(
        'rebound',
        ref.path,
        `${ref.names.join(', ') || '(unnamed)'}: ${parts.join('; ')}`,
        ref.line,
      ),
    );
  }
  return findings;
}
