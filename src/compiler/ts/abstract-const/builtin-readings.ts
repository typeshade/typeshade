import type ts from 'typescript';
import {
  READING_STEP_LIMIT,
  READINGS_PER_NODE,
  UNKNOWN,
  UNPROVEN,
  boundedReadings,
  mergedPicks,
  type Reading,
} from './reading.js';

export function builtinReadingsOf(
  callee: string,
  args: readonly Reading[][],
  tainted: () => boolean,
  readsOnlyHere: () => boolean,
  w: { steps: number },
): Reading[] {
  const read = args.some((a) => a.some((x) => x.tree || x.unknown === true));
  if (args.some((a) => a.length === 0)) return read && tainted() ? [UNPROVEN] : [];
  const apply = (xs: readonly number[], unsigned: boolean): number => {
    const [x, y, z] = [xs[0]!, xs[1]!, xs[2]!];
    switch (callee) {
      case 'abs':
        return unsigned ? x : Math.abs(x);
      case 'sign':
        return unsigned ? (x > 0 ? 1 : 0) : Math.sign(x);
      case 'min':
        return Math.min(x, y);
      case 'max':
        return Math.max(x, y);
      default:
        return Math.min(Math.max(x, y), z);
    }
  };
  let combos: Reading[][] = [[]];
  for (const a of args) {
    combos = combos.flatMap((c) => a.map((x) => [...c, x]));
    w.steps += combos.length;
    if (combos.length > READINGS_PER_NODE * READINGS_PER_NODE || w.steps > READING_STEP_LIMIT) {
      return [UNPROVEN];
    }
  }
  const out: Reading[] = [];
  for (const c of combos) {
    let picks: (readonly [ts.Node, string])[] | undefined = [];
    for (const x of c) picks = picks === undefined ? undefined : mergedPicks(picks, x.picks);
    if (picks === undefined) {
      if (readsOnlyHere()) continue;
      picks = [];
    }
    const tree = c.some((x) => x.tree);
    const beyond = c.some((x) => x.beyond) ? { beyond: true } : {};
    if (c.some((x) => x.unknown || x.unproven || x.agreeing)) {
      out.push({ ...(tree ? UNPROVEN : UNKNOWN), picks });
    } else if (!tree) {
      const t = apply(
        c.map((x) => x.ts),
        false,
      );
      out.push({ u32: t, ts: t, tree: false, picks, ...beyond });
    } else {
      const signed = c.every((x) => x.signed === true || !x.tree);
      out.push({
        ...beyond,
        ...(signed ? { signed: true } : {}),
        u32: signed
          ? apply(
              c.map((x) => x.u32),
              false,
            ) | 0
          : apply(
              c.map((x) => x.u32 >>> 0),
              true,
            ),
        ts: apply(
          c.map((x) => x.ts),
          false,
        ),
        tree: true,
        picks,
      });
    }
  }
  return boundedReadings(out);
}
