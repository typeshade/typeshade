import ts from 'typescript';

export interface Reading {
  readonly u32: number;
  readonly ts: number;
  readonly tree: boolean;
  readonly unknown?: boolean;
  readonly unproven?: boolean;
  readonly congruent?: boolean;
  readonly agreeing?: boolean;
  readonly picks: readonly (readonly [ts.Node, string])[];
}

export const UNKNOWN: Reading = { u32: NaN, ts: NaN, tree: false, unknown: true, picks: [] };
export const UNPROVEN: Reading = { u32: NaN, ts: NaN, tree: true, unproven: true, picks: [] };
export const CONGRUENT: Reading = { ...UNPROVEN, congruent: true };
export const AGREEING: Reading = { u32: NaN, ts: NaN, tree: true, agreeing: true, picks: [] };

export const provenDiffering = (x: Reading): boolean =>
  x.tree && x.unproven !== true && x.agreeing !== true && x.u32 !== x.ts;
export const plainUnproven = (x: Reading): boolean => x.unproven === true && x.congruent !== true;

export const READINGS_PER_NODE = 32;
export const READING_ROUNDS = 24;
export const READING_DEPTH = 400;
export const READING_STEP_LIMIT = 100000;

export function readingValue(x: Reading): string {
  if (x.congruent === true) return 'c';
  if (x.agreeing === true) return 'a';
  return x.unknown ? '?' : x.unproven ? '!' : `${String(x.u32)}:${String(x.ts)}:${x.tree ? 1 : 0}`;
}

export function readingKey(x: Reading): string {
  return `${readingValue(x)}|${x.picks.map(([d, v]) => `${String(d.pos)}.${String(d.end)}=${v}`).join(',')}`;
}

export function boundedReadings(xs: readonly Reading[]): Reading[] {
  const ordered = [...xs.filter(provenDiffering), ...xs.filter((x) => !provenDiffering(x))];
  const keys = new Set<string>();
  const out: Reading[] = [];
  let over = false;
  for (const x of ordered) {
    const key = readingKey(x);
    if (keys.has(key)) continue;
    keys.add(key);
    if (out.length >= READINGS_PER_NODE) {
      over = true;
      continue;
    }
    out.push(x);
  }
  if (over) out.push(xs.some((x) => x.tree) ? UNPROVEN : UNKNOWN);
  return out;
}

export function sameReadings(a: readonly Reading[], b: readonly Reading[]): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map(readingKey));
  return b.every((x) => keys.has(readingKey(x)));
}

export function mergedPicks(
  a: readonly (readonly [ts.Node, string])[],
  b: readonly (readonly [ts.Node, string])[],
): (readonly [ts.Node, string])[] | undefined {
  const out = [...a];
  for (const [d, v] of b) {
    const at = out.find(([e]) => e === d);
    if (at === undefined) out.push([d, v]);
    else if (at[1] !== v) return undefined;
  }
  return out;
}

export function heldByTreeVariable(xs: readonly Reading[], pulled = false): readonly Reading[] {
  if (!pulled && !xs.some((x) => x.tree)) return xs;
  return xs.map((x) => {
    if (x.tree) return x;
    const holdsBits =
      !x.unknown && Number.isInteger(x.u32) && x.u32 >= -2147483648 && x.u32 <= 4294967295;
    return holdsBits ? { ...x, u32: x.u32 >>> 0, tree: true } : { ...UNPROVEN, picks: x.picks };
  });
}
