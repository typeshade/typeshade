import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { compileModule } from '../../core/oracle.js';

describe('JavaScript Console API in use typeshade', () => {
  it('lowers console.log and preserves a source span', () => {
    const result = compileTsSource(`"use typeshade";
export function main(x: f32): void {
  console.log(x);
}`);
    expect(result.diagnostics).toEqual([]);
    expect(result.funcs[0]!.body[0]!.s).toBe('call');
    const stmt = result.funcs[0]!.body[0]!;
    if (stmt.s !== 'call' || stmt.expr.op !== 'call') throw new Error('expected console call');
    expect(stmt.expr.fn).toBe('console.log');
    expect(stmt.expr.type.kind).toBe('void');
    expect(stmt.expr.span?.file).toBe('typeshade-input.ts');
    expect(stmt.expr.span?.length).toBeGreaterThan(0);
  });

  it('routes CPU execution to the host sink', () => {
    const result = compileTsSource(`"use typeshade";
export function main(x: f32): void {
  console.warn(x);
}`);
    expect(result.diagnostics).toEqual([]);
    const events: unknown[] = [];
    const cpu = compileModule(
      {
        consts: [...result.consts],
        structs: result.structs.map((s) => s.decl),
        bindings: [...result.bindings],
        funcs: [...result.funcs],
        overrides: [...result.overrides],
        vars: [...result.vars],
      },
      { consoleSink: (event) => events.push(event) },
    );
    cpu.fns.main(3);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ method: 'warn', args: [3] });
  });

  it('rejects unsupported console methods without inventing a TypeShade API', () => {
    const result = compileTsSource(`"use typeshade";
export function main(): void {
  console.table();
}`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain('console.table() is not supported');
  });
});
