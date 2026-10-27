// A storage binding whose element is an array with no size (#793, probe Q49 of
// typeshade/typecv#259). It compiled with no diagnostic to `var<storage, read> cells:
// array<array<u32>>;`, which WGSL forbids: an array's element must have a creation-fixed
// footprint. The front end now refuses it with TS8002 and names the offsets-and-values form.
//
// Measured against Tint once (Rule 13.3) on 2026-10-27, through `createShaderModule` and
// `getCompilationInfo` in Chromium 153.0.8010.12 (chrome-headless-shell, the compile gate's
// browser, with the gate's software flags):
// - `var<storage, read> cells: array<array<u32>>;` is refused at 1:55, "an array element type
//   cannot contain a runtime-sized array".
// - `var<storage, read> cells: array<array<u32, 4>>;` is accepted.
// - The offsets-and-values pair, `values[offsets[gid.x] + 0u]`, is accepted.
// Each program is read by both halves (CLAUDE.md, "A test reads both halves").
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const program = (decl: string, read: string): string => `"use typeshade";
${decl}
declare const out: storage<array<u32>, "read_write">;
@compute([64])
export function first(@builtin("global_invocation_id") gid: vec3u): void {
  out[gid.x] = ${read};
}
`;

const compilerOf = (source: string): string[] =>
  compile(source)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

function editorOf(source: string): string[] {
  const service = createTypeshadeLanguageService();
  service.openDocument('/jagged/a.ts', source);
  return service
    .getDiagnostics('/jagged/a.ts')
    .filter((d) => d.severity === 'error')
    .map((d) => `${String(d.code)} ${d.message}`);
}

const REMEDY = (row: string): string =>
  `a list of lists of no fixed length, and an array's element has a fixed size (WGSL). Hold ` +
  `the rows flat: the values in one array<${row}> and each row's first index in an array<u32> ` +
  `of offsets, read as "values[offsets[r] + k]".`;

describe('a storage binding of arrays with no size is refused (#793)', () => {
  const REFUSED: readonly (readonly [string, string, string, string])[] = [
    [
      'the probe, storage<array<array<u32>>>',
      'declare const cells: storage<array<array<u32>>>;',
      'cells[gid.x][0]',
      `TS8002 "array<array<u32>>" is ${REMEDY('u32')}`,
    ],
    [
      'the call form, storage<array<array<f32>>>()',
      'const cells = storage<array<array<f32>>>();',
      'u32(cells[gid.x][0])',
      `TS8002 "array<array<f32>>" is ${REMEDY('f32')}`,
    ],
    [
      "a struct's last field",
      'class Grid { n: u32; rows: array<array<u32>>; }\ndeclare const cells: storage<Grid>;',
      'cells.rows[gid.x][0]',
      `TS8002 "Grid" holds "rows: array<array<u32>>", ${REMEDY('u32')}`,
    ],
  ];
  for (const [name, decl, read, sentence] of REFUSED) {
    it(`${name}, in both halves`, () => {
      const source = program(decl, read);
      expect(compilerOf(source)).toEqual([sentence]);
      expect(editorOf(source)).toEqual([sentence]);
    });
  }

  it('the neighbours Tint accepts compile, in both halves', () => {
    const fixed = program('declare const cells: storage<array<array<u32, 4>>>;', 'cells[gid.x][0]');
    const r = compile(fixed);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.wgsl).toContain('var<storage, read> cells: array<array<u32, 4>>;');
    expect(editorOf(fixed)).toEqual([]);
    const flat = program(
      'declare const values: storage<array<u32>>;\ndeclare const offsets: storage<array<u32>>;',
      'values[offsets[gid.x] + 0]',
    );
    expect(compilerOf(flat)).toEqual([]);
    expect(editorOf(flat)).toEqual([]);
  });
});
