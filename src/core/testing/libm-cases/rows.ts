import { littleEndianBytes } from '../libm-gate.js';
import type { LibmCaseSet, LibmCase } from './types.js';

export function caseResults(c: LibmCase, set: LibmCaseSet): Float32Array | Float64Array {
  const n = set.values.length;
  const out = c.format === 'f32' ? new Float32Array(n) : new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = c.f(set.values[i]!, set.second?.[i] ?? 0);
  return out;
}

export function caseInputBytes(set: LibmCaseSet): Uint8Array {
  const first = littleEndianBytes(set.values).bytes;
  if (set.second === undefined) return first;
  let second: Uint8Array;
  if (set.second instanceof Int32Array) {
    second = new Uint8Array(set.second.length * 4);
    const view = new DataView(second.buffer);
    for (let i = 0; i < set.second.length; i++) view.setInt32(i * 4, set.second[i]!, true);
  } else {
    second = littleEndianBytes(set.second).bytes;
  }
  const out = new Uint8Array(first.length + second.length);
  out.set(first, 0);
  out.set(second, first.length);
  return out;
}

export interface LibmCaseRow {
  readonly routine: string;
  readonly set: string;
  readonly count: number;
  readonly nanResults: number;
  readonly inputsSha256: string;
  readonly resultsSha256: string;
}

export interface LibmCaseFile {
  readonly seed: string;
  readonly generator: string;
  readonly nan: string;
  readonly rows: readonly LibmCaseRow[];
}

export function caseRows(
  cases: readonly LibmCase[],
  sha256: (bytes: Uint8Array) => string,
): LibmCaseRow[] {
  const rows: LibmCaseRow[] = [];
  for (const c of cases) {
    for (const set of c.sets()) {
      const { bytes, nans } = littleEndianBytes(caseResults(c, set));
      rows.push({
        routine: c.routine,
        set: set.name,
        count: set.values.length,
        nanResults: nans,
        inputsSha256: sha256(caseInputBytes(set)),
        resultsSha256: sha256(bytes),
      });
    }
  }
  return rows;
}
