import ts from 'typescript';

export interface Reading {
  readonly u32: number;
  readonly ts: number;
  readonly tree: boolean;
  readonly unknown?: boolean;
  readonly unproven?: boolean;
  readonly congruent?: boolean;
  readonly signed?: boolean;
  readonly agreeing?: boolean;
  readonly bound?: number;
  readonly looped?: boolean;
  readonly picks: readonly (readonly [ts.Node, string])[];
}

export const UNKNOWN: Reading = { u32: NaN, ts: NaN, tree: false, unknown: true, picks: [] };
export const UNPROVEN: Reading = { u32: NaN, ts: NaN, tree: true, unproven: true, picks: [] };
export const CONGRUENT: Reading = { ...UNPROVEN, congruent: true };
export const AGREEING: Reading = { u32: NaN, ts: NaN, tree: true, agreeing: true, picks: [] };

export const exactSigned = (x: Reading): boolean => x.signed === true && x.u32 === x.ts;

export const signedPair = (a: Reading, b: Reading): boolean =>
  (a.signed === true || !a.tree) && (b.signed === true || !b.tree) && (a.tree || b.tree);

export function signedReading(ts: number, picks: Reading['picks'] = []): Reading {
  return { u32: ts | 0, ts, tree: true, signed: true, picks };
}

export const provenDiffering = (x: Reading): boolean =>
  x.tree && x.unproven !== true && x.agreeing !== true && x.u32 !== x.ts;
export const pastInt32 = (x: Reading): boolean =>
  x.congruent === true || (provenDiffering(x) && x.ts !== (x.u32 | 0));
export const plainUnproven = (x: Reading): boolean => x.unproven === true && x.congruent !== true;

export const READINGS_PER_NODE = 32;
export const READING_ROUNDS = 24;
export const READING_DEPTH = 400;
export const READING_STEP_LIMIT = 100000;

export function readingValue(x: Reading): string {
  if (x.congruent === true) return 'c';
  if (x.agreeing === true) return `a${String(x.bound ?? '')}`;
  const kind = x.signed === true ? 's' : x.tree ? 1 : 0;
  return x.unknown ? '?' : x.unproven ? '!' : `${String(x.u32)}:${String(x.ts)}:${kind}`;
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

export function heldByTreeVariable(
  xs: readonly Reading[],
  pulled: 'u32' | 'i32' | false = false,
): readonly Reading[] {
  if (!pulled && !xs.some((x) => x.tree)) return xs;
  const signed =
    pulled === 'i32' ||
    (pulled !== 'u32' &&
      xs.some((x) => x.signed === true) &&
      xs.every((x) => !x.tree || x.signed === true || x.unproven || x.agreeing));
  return xs.map((x) => {
    if (x.tree || (x.unknown && !xs.some((y) => y.tree))) return x;
    if (signed && !x.unknown && Number.isInteger(x.u32) && Math.abs(x.u32) <= 2147483648) {
      return { ...x, u32: x.u32 | 0, tree: true, signed: true };
    }
    const holdsBits =
      !x.unknown && Number.isInteger(x.u32) && x.u32 >= -2147483648 && x.u32 <= 4294967295;
    if (signed && x.unknown) return x;
    return holdsBits ? { ...x, u32: x.u32 >>> 0, tree: true } : { ...UNPROVEN, picks: x.picks };
  });
}

const MOST = 0x7fffffff;
const boundOf = (x: Reading): number | undefined =>
  x.agreeing === true
    ? x.bound
    : !x.tree && !x.unknown && Number.isInteger(x.u32) && x.u32 >= 0 && x.u32 <= MOST
      ? x.u32
      : undefined;
const bitsBelow = (n: number): number => (n === 0 ? 0 : 2 ** Math.ceil(Math.log2(n + 1)) - 1);

export function agreeingBound(k: ts.SyntaxKind, a: Reading, b: Reading): Reading | undefined {
  const [x, y] = [boundOf(a), boundOf(b)];
  if (k === ts.SyntaxKind.AmpersandToken && (a.congruent === true || b.congruent === true)) {
    const mask = a.congruent === true ? (b.tree ? undefined : y) : a.tree ? undefined : x;
    return mask === undefined ? undefined : { ...AGREEING, bound: mask };
  }
  if (x === undefined || y === undefined || a.unproven || b.unproven) return undefined;
  const bound =
    k === ts.SyntaxKind.PlusToken
      ? x + y
      : k === ts.SyntaxKind.AsteriskToken
        ? x * y
        : k === ts.SyntaxKind.AmpersandToken
          ? Math.min(x, y)
          : k === ts.SyntaxKind.BarToken || k === ts.SyntaxKind.CaretToken
            ? bitsBelow(Math.max(x, y))
            : k === ts.SyntaxKind.LessThanLessThanToken && b.agreeing !== true && y < 31
              ? x * 2 ** y
              : k === ts.SyntaxKind.GreaterThanGreaterThanToken && b.agreeing !== true
                ? x
                : undefined;
  return bound !== undefined && bound <= MOST ? { ...AGREEING, bound } : undefined;
}

export function markLooped(xs: readonly Reading[], looped: boolean): Reading[] {
  return looped ? xs.map((x) => ({ ...x, looped: true })) : [...xs];
}
