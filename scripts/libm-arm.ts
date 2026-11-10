// ═══ The libm arm of the differential gate: the engines agree (change 0042, milestone 1a) ═══
//
// The libm promises the same bits on every engine that a gate runs. The repository holds one
// file for that, `src/core/libm/trig.gate.json`: for each routine and each set of seeded inputs,
// the hash of the inputs and the hash of the libm's results (`src/core/testing/libm-gate.ts`).
//
// This arm runs the JavaScript form on the engine that runs the script and holds it to the
// file. `bun run gate:differential` runs it under Bun (JavaScriptCore). The unit test
// `src/core/libm/libm.test.ts` holds the same form to the same file in Node (V8). So the two
// engines agree when both pass. The WebAssembly form joins the file with its encoder
// (milestone 1e).
//
// A NaN is hashed as the canonical NaN, as an input and as a result, until milestone 1b makes
// the stored NaN canonical (`src/core/testing/libm-gate.ts`).
//
// `bun scripts/libm-arm.ts` runs the arm alone. `--write` writes the file from this engine's
// results; run it only after a deliberate change of a routine or of the inputs.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIBM } from '../src/core/cpu-runtime.js';
import {
  LIBM_GATE_SEED,
  libmFunctions,
  libmGateRows,
  type LibmGateFile,
  type LibmGateRow,
  type LibmRoutine,
} from '../src/core/testing/libm-gate.js';
import {
  caseRows,
  explogCases,
  invtrigCases,
  hyperCases,
  type LibmCase,
  type LibmCaseFile,
} from '../src/core/testing/libm-cases.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const LIBM_GATE_FILE = 'src/core/libm/trig.gate.json';

/** The families after `trig`, each with its gate file `src/core/libm/<family>.gate.json`. */
const CASE_FAMILIES: readonly (readonly [string, (libm: typeof LIBM) => LibmCase[]])[] = [
  ['explog', (libm) => explogCases(libm)],
  ['invtrig', (libm) => invtrigCases(libm)],
  ['hyper', (libm) => hyperCases(libm)],
];

/** `LIBM` with a result of the routine `name` changed in its last bit, once in every 50,000
 *  finite, non-zero results, so that each case of the routine meets one. The rounding of an
 *  `f32` case hides the bit; the `f64` case must report it. The instrument of a family plants
 *  it and requires a report. */
function withOneBitChanged(name: keyof typeof LIBM): typeof LIBM {
  let seen = 0;
  const routine = LIBM[name] as (x: number, n: number) => number;
  return {
    ...LIBM,
    [name]: (x: number, n: number): number => {
      const r = routine(x, n);
      if (!Number.isFinite(r) || r === 0 || Math.abs(r) < 1e-300) return r;
      return seen++ % 50_000 === 1000 ? r + r * 2 ** -52 : r;
    },
  };
}
/** The routine of each family whose result the instrument changes. */
const PLANTED: Readonly<Record<string, keyof typeof LIBM>> = {
  explog: 'logF64',
  invtrig: 'atan2F64',
  hyper: 'acoshF64',
};
const caseFile = (family: string): string => `src/core/libm/${family}.gate.json`;

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const engine = (): string => {
  const v = process.versions as Record<string, string | undefined>;
  return v['bun'] !== undefined ? `Bun ${v['bun']}` : `Node ${v['node'] ?? '?'}`;
};

/** The rows on which `actual` differs from `expected`, as sentences. */
function differences(
  actual: readonly (LibmGateRow | LibmCaseFile['rows'][number])[],
  expected: readonly (LibmGateRow | LibmCaseFile['rows'][number])[],
): string[] {
  const out: string[] = [];
  if (actual.length !== expected.length)
    out.push(`${String(actual.length)} rows computed, ${String(expected.length)} in the file`);
  for (const [i, a] of actual.entries()) {
    const e = expected[i];
    if (e === undefined) continue;
    const key = `${a.routine} ${a.set}`;
    if (a.routine !== e.routine || a.set !== e.set || a.count !== e.count)
      out.push(`${key}: the file's row is ${e.routine} ${e.set} of ${String(e.count)}`);
    else if (a.inputsSha256 !== e.inputsSha256) out.push(`${key}: the inputs differ`);
    else if (a.resultsSha256 !== e.resultsSha256) out.push(`${key}: the results differ`);
    else if (a.nanResults !== e.nanResults) out.push(`${key}: the count of NaN results differs`);
  }
  return out;
}

/** Run the arm. Returns the number of failures. */
export function libmArm(): number {
  const file = JSON.parse(readFileSync(join(ROOT, LIBM_GATE_FILE), 'utf8')) as LibmGateFile;
  // The instrument first (AGENTS.md#gate-discipline): one result of one routine with its last
  // bit changed must be reported, or a match below says nothing.
  let calls = 0;
  const libm = libmFunctions(LIBM);
  const flipped: Record<LibmRoutine, (x: number) => number> = {
    ...libm,
    sinF64: (x) => {
      const r = libm.sinF64(x);
      return calls++ === 1000 ? r + r * 2 ** -52 : r;
    },
  };
  const planted = differences(libmGateRows(flipped, sha256), file.rows);
  if (planted.length === 0) {
    console.log('FAIL  libm arm: a result with one bit changed was not reported');
    return 1;
  }
  console.log(`instrument: a libm result with one bit changed was REPORTED (${planted[0]!})`);
  // The same for `tan`, whose rows the file holds after those of `sin` and `cos`.
  let tanCalls = 0;
  const tanFlipped: Record<LibmRoutine, (x: number) => number> = {
    ...libm,
    tanF64: (x) => {
      const r = libm.tanF64(x);
      return tanCalls++ === 1000 ? r + r * 2 ** -52 : r;
    },
  };
  const tanPlanted = differences(libmGateRows(tanFlipped, sha256), file.rows);
  if (!tanPlanted.some((d) => d.startsWith('tanF64 '))) {
    console.log('FAIL  libm arm: a result of tan with one bit changed was not reported');
    return 1;
  }
  console.log(
    `instrument: a result of tan with one bit changed was REPORTED (${tanPlanted.find((d) => d.startsWith('tanF64 '))!})`,
  );
  const rows = libmGateRows(libm, sha256);
  const failures = differences(rows, file.rows);
  for (const f of failures) console.log(`FAIL  libm ${f}`);
  const total = rows.reduce((n, r) => n + r.count, 0);
  const nans = rows.reduce((n, r) => n + r.nanResults, 0);
  console.log(
    `libm differential: ${engine()} · ${String(rows.length)} sets of sin, cos and tan, for an f32 and an f64 operand, ` +
      `${String(total)} results held to ${LIBM_GATE_FILE} by hash (${String(nans)} NaN results hashed as the canonical NaN) · failures: ${String(failures.length)}`,
  );
  let failed = failures.length;
  for (const [family, cases] of CASE_FAMILIES) {
    const expected = JSON.parse(readFileSync(join(ROOT, caseFile(family)), 'utf8')) as LibmCaseFile;
    // The instrument of this family: one changed bit of one routine's result must be reported.
    const routine = PLANTED[family]!;
    const reported = differences(
      caseRows(cases(withOneBitChanged(routine)), sha256),
      expected.rows,
    );
    if (reported.length === 0) {
      console.log(
        `FAIL  libm ${family}: a result of ${routine} with one bit changed was not reported`,
      );
      failed += 1;
      continue;
    }
    console.log(
      `instrument: a result of ${routine} with one bit changed was REPORTED (${reported[0]!})`,
    );
    const computed = caseRows(cases(LIBM), sha256);
    const wrong = differences(computed, expected.rows);
    for (const f of wrong) console.log(`FAIL  libm ${family} ${f}`);
    console.log(
      `libm differential: ${engine()} · ${family}: ${String(computed.length)} sets of ${String(new Set(computed.map((r) => r.routine)).size)} cases, ` +
        `${String(computed.reduce((n, r) => n + r.count, 0))} results held to ${caseFile(family)} by hash (${String(computed.reduce((n, r) => n + r.nanResults, 0))} NaN results hashed as the canonical NaN) · failures: ${String(wrong.length)}`,
    );
    failed += wrong.length;
  }
  return failed;
}

if (import.meta.main) {
  if (process.argv.includes('--write')) {
    const file: LibmGateFile = {
      seed: `0x${LIBM_GATE_SEED.toString(16).padStart(8, '0')}`,
      generator: 'mulberry32; src/core/testing/libm-gate.ts',
      nan: 'A NaN is hashed as the canonical NaN of its format, as an input and as a result, until milestone 1b of change 0042.',
      rows: libmGateRows(libmFunctions(LIBM), sha256),
    };
    writeFileSync(join(ROOT, LIBM_GATE_FILE), `${JSON.stringify(file, null, 2)}\n`);
    console.log(`wrote ${LIBM_GATE_FILE} on ${engine()}`);
    for (const [family, cases] of CASE_FAMILIES) {
      const next: LibmCaseFile = {
        seed: file.seed,
        generator: 'mulberry32; src/core/testing/libm-cases.ts',
        nan: file.nan,
        rows: caseRows(cases(LIBM), sha256),
      };
      writeFileSync(join(ROOT, caseFile(family)), `${JSON.stringify(next, null, 2)}\n`);
      console.log(`wrote ${caseFile(family)} on ${engine()}`);
    }
  } else {
    process.exitCode = libmArm() === 0 ? 0 : 1;
  }
}
