// #321 control#10 and control#11: every selector fits its switch, and default occurs once.
// Verifies: Rule 12.4, Rule 12.5, Rule 12.6, Rule 12.7 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

function check(body: string) {
  const source = `"use typeshade";\n${body}`;
  const result = compile(source);
  const errors = result.diagnostics
    .filter((d) => d.category === 'error')
    .map((d) => ({ code: d.code, message: d.message }));
  const service = createTypeshadeLanguageService();
  service.openDocument('switch.shade.ts', source);
  expect(
    service
      .getDiagnostics('switch.shade.ts')
      .filter((d) => d.severity === 'error')
      .map((d) => ({ code: d.code, message: d.message })),
  ).toEqual(errors);
  return { source, result, errors };
}

const pick = (kind: string, label: string) => `export function pick(value: ${kind}): i32 {
  switch (value) {
    case ${label}: return 1;
    default: return 0;
  }
}`;

describe('switch selectors fit the selector type', () => {
  it.each([
    ['i32', '-2147483649'],
    ['i32', '2147483648'],
    ['i32', '3000000000'],
    ['u32', '-1'],
    ['u32', '4294967296'],
  ])('refuses %s case %s in the compiler and editor', (kind, label) => {
    const { result, errors } = check(pick(kind!, label!));
    expect(errors).toEqual([
      { code: 'TS8017', message: `switch case ${label} does not fit a ${kind} selector.` },
    ]);
    expect(result.diagnostics[0]?.line).toBe(4);
    expect(result.diagnostics[0]?.character).toBe(10);
  });

  it.each([
    ['const BIG: u32 = 2147483648;', 'i32', 'BIG', '2147483648'],
    ['', 'i32', '2147483647 + 1', '2147483648'],
    ['', 'u32', '4294967295 + 1', '4294967296'],
  ])('checks the folded value of %s %s case %s', (declaration, kind, label, value) => {
    expect(check(`${declaration}\n${pick(kind!, label!)}`).errors).toEqual([
      { code: 'TS8017', message: `switch case ${value} does not fit a ${kind} selector.` },
    ]);
  });

  it.each([
    ['i32', '-2147483648'],
    ['i32', '2147483647'],
    ['u32', '0'],
    ['u32', '4294967295'],
  ])('keeps the %s boundary %s valid', (kind, label) => {
    const { result, errors } = check(pick(kind!, label!));
    expect(errors).toEqual([]);
    const run = compileModule(result.module).fns.pick!;
    expect(run(Number(label))).toBe(1);
    expect(run(42)).toBe(0);
    expect(result.wgsl).toContain(`case ${label}${kind === 'u32' ? 'u' : ''}:`);
  });
});

describe('a switch has only one default', () => {
  const duplicate = 'Duplicate switch default; each switch may have only one default clause.';

  it('refuses the second default at its keyword, once in each half', () => {
    const { result } = check(`export function pick(value: i32): i32 {
  switch (value) {
    default: return 1;
    case 0: return 0;
    default: return 2;
  }
}`);
    expect(result.diagnostics.map((d) => [d.code, d.message, d.line, d.character])).toEqual([
      ['TS8017', duplicate, 6, 5],
    ]);
  });

  it('reports each repeated default, including an empty last default', () => {
    expect(
      check(`export function pick(value: i32): void {
  switch (value) {
    default: break;
    default: break;
    default:
  }
}`).errors,
    ).toEqual([
      { code: 'TS8017', message: duplicate },
      { code: 'TS8017', message: duplicate },
    ]);
  });

  it('keeps a default in each nested switch and an empty last default valid', () => {
    const { result, errors } = check(`export function pick(value: i32): i32 {
  switch (value) {
    case 0:
      switch (value) { default: return 3; }
    default:
  }
  return 4;
}`);
    expect(errors).toEqual([]);
    const run = compileModule(result.module).fns.pick!;
    expect(run(0)).toBe(3);
    expect(run(1)).toBe(4);
  });
});
