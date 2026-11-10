// Verifies: Rule 8.9, Rule 8.21 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { lowerEmptyStructs } from './empty-struct.js';
import { lowerForBackend } from '../emit.js';
import { wgslBackend } from '../backends/wgsl.js';
import { glslEs300Backend } from '../backends/glsl.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
import type { Expr, Stmt } from '../ir/nodes.js';

describe('GPU carrier for fieldless classes', () => {
  it('rewrites all constructions while keeping authored fields and CPU objects empty', () => {
    const r = compile(`"use typeshade";
class Empty {}
const E: Empty = {};
let shared: Empty = {};
export function build(): Empty { return new Empty(); }
export function read(): Empty { return shared; }`);
    expect(r.diagnostics).toEqual([]);
    const lowered = lowerEmptyStructs(r.module);
    expect(r.module.structs[0]!.fields).toEqual([]);
    expect(lowered.structs[0]!.fields).toEqual([
      { name: '_empty', type: { kind: 'scalar', scalar: 'u32' } },
    ]);
    const check = (e: Expr): void => {
      if (e.op === 'construct' && e.type.kind === 'struct' && e.type.name === 'Empty') {
        expect(e.args).toHaveLength(1);
        expect(e.args[0]).toMatchObject({ op: 'lit', value: 0 });
      }
    };
    const stmt = (s: Stmt): void => eachStmtExpr(s, (e) => eachExpr(e, check), stmt);
    for (const f of lowered.funcs) for (const s of f.body) stmt(s);
    eachExpr(lowered.consts[0]!.valueExpr!, check);
    eachExpr(lowered.vars![0]!.init!, check);
    expect(lowerEmptyStructs(lowered)).toBe(lowered);
    expect(r.eval('build')).toEqual({});
    expect(r.eval('read')).toEqual({});
  });

  it('keeps profiled lowering equal for nested uniform fields and arrays', () => {
    const r = compile(`"use typeshade";
class Empty {}
class Uniforms { before: f32; item: Empty; items: array<Empty, 2>; after: f32; }
declare const u: uniform<Uniforms>;
@fragment export function fs(): vec4 { return vec4(u.before + u.after); }`);
    expect(r.diagnostics).toEqual([]);
    for (const backend of [wgslBackend, glslEs300Backend]) {
      const stages: string[] = [];
      const normal = lowerForBackend(r.module, backend, 'O0');
      const timed = lowerForBackend(r.module, backend, 'O0', undefined, (name) =>
        stages.push(name),
      );
      expect(timed).toEqual(normal);
      expect(stages).toContain('lowerEmptyStructs');
    }
    expect(r.wgsl).toContain('@align(16) @size(16) item: Empty');
  });
});
