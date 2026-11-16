// WebGL2 kernel lowering over the shared kernel IR operations.
import { isGlslReserved } from '../backends/glsl-sanitize.js';
import type { BindingDecl, Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js';
import type { ShaderType } from '../ir/types.js';
import { u32T } from '../ir/types.js';
import { mapStmtExpr } from '../ir/visit.js';
import { KERNEL_WORKGROUP } from '../kernel-tree.js';
import {
  boolT,
  declaredNames,
  forEachChild,
  isRuntimeArray,
  iterationOf,
  kRef,
  mapStmt,
  rangeOf,
  spellArrayBindings,
  writesThroughCall,
  type LoopCtx,
} from './kernel-lower-ir.js';
import { deviceRangeLoops, storeAfterLoops } from './kernel-stores.js';
import { mapExpr } from './opt/ir-transform.js';
import { type KernelProof } from './parallel-loop.js';

// ─── the WebGL2 tier (Rule 11.8) ─────────────────────────────────────────────────────────────

/** One loop of a kernel function as the WebGL2 tier runs it: a fragment program over an `R32UI`
 *  target, one texel per iteration (`lowerComputeToFragment`, `backends/glsl.ts`). */
export interface KernelGlLoopPlan {
  /** The module of the loop's portable `@compute` entry, which the GLSL writer lowers. */
  readonly module: ModuleDecl;
  /** The array the loop writes, at exactly `i`, and its element's scalar. */
  readonly out: string;
  readonly outScalar: 'f32' | 'i32' | 'u32';
  /** The arrays the loop reads: each by its parameter and by the sampler the program names it. */
  readonly reads: readonly { readonly param: string; readonly name: string }[];
  /** The loose uniforms: scalar parameters, `_start`, and the array lengths the body reads. */
  readonly uniforms: readonly {
    readonly name: string;
    readonly type: ShaderType;
    /** The authored array parameter whose checked element count supplies this uniform. */
    readonly lengthOf?: string;
  }[];
}

/** The binding that carries the dispatch: `.x` the iteration count, `.y` the grid's width. */
export const GL_DISPATCH = '_dispatch';

/** The `R32UI` target the loop's writes land in. */
export const GL_OUT = '_out';

/** `st` with each store the front end guarded by its array's length (`kernel-stores.ts`) in place
 *  of its guard, at any depth. */
function unguarded(st: Stmt, arrays: ReadonlySet<string>): Stmt {
  const found = storeAfterLoops(st, arrays);
  if (found !== undefined) return found.store;
  return mapStmtExpr(
    st,
    (e) => e,
    (b) => unguarded(b, arrays),
  );
}

export function lowerKernelGl(
  f: FuncDecl,
  m: ModuleDecl,
  proof: KernelProof,
): { readonly loops: readonly KernelGlLoopPlan[] } | { readonly noWebgl2: string } {
  if (proof.shape !== undefined) return { noWebgl2: "its body is not the kernel call's shape" };
  // WebGL2 has no atomics to build a Map or a Set with (change 0080).
  const collection = f.params.find((p) => p.type.kind === 'collection');
  if (collection !== undefined)
    return {
      noWebgl2: `it takes the Map or Set "${collection.name}", which the WebGL2 tier does not run (change 0080)`,
    };
  const scalars = f.params.filter((p) => !isRuntimeArray(p.type));
  const arrays = f.params.filter((p) => isRuntimeArray(p.type));
  // Rule 3.4: the WebGL2 program names each array's sampler, so a GLSL reserved word gets a
  // fresh spelling here, and the host keeps the authored name.
  const glNames = spellArrayBindings(
    arrays.map((p) => p.name),
    declaredNames(m),
    isGlslReserved,
  );
  for (const p of scalars) {
    const t = p.type;
    const s = t.kind === 'scalar' ? t.scalar : t.kind === 'vec' ? t.elem : undefined;
    if (s !== 'f32' && s !== 'i32' && s !== 'u32')
      return {
        noWebgl2: `parameter "${p.name}" is not a number or a vector, which a uniform holds`,
      };
  }
  const device = deviceRangeLoops(f);
  const arraySet = new Set(arrays.map((p) => p.name));
  const argsStruct = `${f.name}_GlArgs`;
  const argsBinding = `${f.name}_glargs`;
  const plans: KernelGlLoopPlan[] = [];
  const prelude: Stmt[] = [];
  let j = 0;
  for (const st of f.body) {
    if (st.s !== 'for') {
      if (st.s !== 'return') prelude.push(st);
      continue;
    }
    const v = proof.loops[j];
    const loopNo = ++j;
    if (v === undefined || !v.ok) return { noWebgl2: `loop ${loopNo} runs on the CPU` };
    if (v.reductions.length > 0)
      return { noWebgl2: `loop ${loopNo} reduces, which WebGL2 has no workgroup memory for` };
    const w = v.writes[0];
    if (v.writes.length !== 1 || w === undefined)
      return { noWebgl2: `loop ${loopNo} writes more than one array, and WebGL2 draws one` };
    if (w.kind !== 'affine' || w.a !== 1 || w.c.length !== 1 || w.c[0] !== 0)
      return { noWebgl2: `loop ${loopNo} writes "${w.name}" other than at i` };
    const outParam = arrays.find((p) => p.name === w.name);
    const elem = (outParam?.type as { elem?: ShaderType } | undefined)?.elem;
    const outScalar = elem?.kind === 'scalar' ? elem.scalar : undefined;
    if (
      outParam === undefined ||
      (outScalar !== 'f32' && outScalar !== 'i32' && outScalar !== 'u32')
    )
      return {
        noWebgl2: `loop ${loopNo} writes "${w.name}", whose element is not one f32, i32 or u32`,
      };
    // The invocation's texel is the loop's one ASSIGNMENT to the array (`toTexel` below); a
    // write a call makes through a reference to it (Rule 8.25) is no assignment to take.
    if (writesThroughCall(st, w.name, m))
      return {
        noWebgl2: `loop ${loopNo} writes "${w.name}" through a reference a call takes, and WebGL2 writes its texel by an assignment`,
      };
    const header = rangeOf(st);
    if (header === undefined) return { noWebgl2: `loop ${loopNo} compares its counter oddly` };
    const uniforms: KernelGlLoopPlan['uniforms'][number][] = [
      ...scalars.map((p) => ({ name: p.name, type: p.type })),
      { name: '_start', type: header.type },
    ];
    const c: LoopCtx = {
      f,
      // WebGL2 has no workgroup, so the size of the function is not read here (proposal 0067).
      wg: KERNEL_WORKGROUP,
      // The writes of a loop whose range the device holds keep the guard of their array's end
      // (change 0094, decision D2) on every other tier. WebGL2 writes the one array at `i`, and
      // the call draws only the iterations whose `i` is inside it, so the program drops the guard.
      loop: device.has(loopNo - 1)
        ? { ...st, body: st.body.map((b) => unguarded(b, arraySet)) }
        : st,
      j: loopNo - 1,
      counter: st.counted!.name,
      counterType: header.type,
      step: st.counted!.step,
      prelude: [...prelude],
      scalars: scalars.map((p) => p.name),
      arrays: arrays.map((p) => p.name),
      argsBinding,
      argsStruct,
      scatter: new Set(),
      // The program keeps its early return (change 0096, decision D3): no lane is masked.
      skip: false,
      bindingNames: glNames,
    };
    const vec3uT: ShaderType = { kind: 'vec', n: 3, elem: 'u32' };
    const gidParam: Expr = { op: 'param', type: vec3uT, name: '_gid' };
    const gidX: Expr = { op: 'member', type: u32T, base: gidParam, field: 'x' };
    const dispatchT: ShaderType = { kind: 'vec', n: 4, elem: 'u32' };
    const count: Expr = {
      op: 'member',
      type: u32T,
      base: { op: 'varref', type: dispatchT, name: GL_DISPATCH },
      field: 'x',
    };
    const outT: ShaderType = { kind: 'array', elem: u32T };
    const bits = (e: Expr): Expr =>
      outScalar === 'u32'
        ? e
        : outScalar === 'f32'
          ? { op: 'call', type: u32T, fn: 'bitcastU32', args: [e] }
          : { op: 'call', type: u32T, fn: 'u32', args: [e] };
    // The loop's one write, at `i`, is the invocation's texel.
    const outName = glNames.get(w.name) ?? w.name;
    const toTexel = (s: Stmt): Stmt => {
      const inner = mapStmtExpr(s, (e) => e, toTexel);
      if (inner.s !== 'assign') return inner;
      let root: Expr = inner.target;
      while (root.op === 'index' || root.op === 'member') root = root.base;
      if (!((root.op === 'varref' || root.op === 'param') && root.name === outName)) return inner;
      return {
        s: 'assign',
        target: {
          op: 'index',
          type: u32T,
          base: { op: 'varref', type: outT, name: GL_OUT },
          idx: gidX,
        },
        expr: bits(inner.expr),
        ...(inner.span !== undefined ? { span: inner.span } : {}),
      };
    };
    // Lengths are host-known element counts, not texture dimensions (a padded texture and
    // an array of vectors need not have one texel per element). Rewrite before collecting
    // element reads so an array measured only by length needs no texture upload (#689).
    const arrayOf = new Map(arrays.map((p) => [glNames.get(p.name) ?? p.name, p.name]));
    const lengthNames = new Map<string, string>();
    const taken = new Set([
      ...declaredNames(m),
      ...glNames.values(),
      argsStruct,
      argsBinding,
      '_start',
      GL_DISPATCH,
      GL_OUT,
    ]);
    const lengthUniform = (e: Expr): Expr => {
      if (
        e.op !== 'call' ||
        e.fn !== 'arrayLength' ||
        e.declRef !== undefined ||
        e.args.length !== 1
      )
        return e;
      const array = e.args[0]!;
      const param = array.op === 'varref' ? arrayOf.get(array.name) : undefined;
      if (param === undefined) return e;
      let name = lengthNames.get(param);
      if (name === undefined) {
        let suffix = 0;
        do {
          name = `_length${suffix++}`;
        } while (taken.has(name));
        taken.add(name);
        lengthNames.set(param, name);
        uniforms.push({ name, type: u32T, lengthOf: param });
      }
      return {
        op: 'member',
        type: u32T,
        base: { op: 'varref', type: { kind: 'struct', name: argsStruct }, name: argsBinding },
        field: name,
      };
    };
    const body = (
      [
        { s: 'let', name: '_k', expr: gidX },
        {
          s: 'if',
          arms: [
            {
              cond: { op: 'compare', type: boolT, cop: '>=', a: kRef, b: count },
              body: [{ s: 'return' }],
            },
          ],
        },
        ...iterationOf(c, undefined, []).map(toTexel),
      ] satisfies Stmt[]
    ).map((s) => mapStmt(s, (e) => mapExpr(e, lengthUniform)));
    // What the body reads of the arrays: each is a data texture of its name.
    const read = new Set<string>();
    const names = new Set(arrays.map((p) => glNames.get(p.name) ?? p.name));
    const see = (e: Expr): void => {
      if (e.op === 'varref' && names.has(e.name)) read.add(e.name);
      forEachChild(e, see);
    };
    body.forEach((s) =>
      mapStmt(s, (e) => {
        see(e);
        return e;
      }),
    );
    const entry: FuncDecl = {
      name: `${f.name}_gl${loopNo - 1}`,
      params: [{ name: '_gid', type: vec3uT, builtin: 'global_invocation_id' }],
      ret: { kind: 'void' },
      body,
      stage: 'compute',
      portable: true,
      workgroupSize: KERNEL_WORKGROUP,
      attrs: [`@compute @workgroup_size(${KERNEL_WORKGROUP})`],
    };
    const module: ModuleDecl = {
      consts: m.consts,
      structs: [...m.structs, { name: argsStruct, fields: uniforms }],
      bindings: [
        { group: 0, binding: 0, name: GL_DISPATCH, space: 'uniform', type: dispatchT },
        {
          group: 0,
          binding: 1,
          name: argsBinding,
          space: 'uniform',
          type: { kind: 'struct', name: argsStruct },
          owner: 'host',
          glsl: 'loose',
        },
        ...[...read].map((name, k): BindingDecl => ({
          group: 0,
          binding: 2 + k,
          name,
          space: 'storage',
          access: 'read',
          type: arrays.find((p) => (glNames.get(p.name) ?? p.name) === name)!.type,
        })),
        {
          group: 0,
          binding: 2 + read.size,
          name: GL_OUT,
          space: 'storage',
          access: 'read_write',
          type: outT,
        },
      ],
      funcs: [...m.funcs.filter((x) => x.kernel !== true && x.stage === undefined), entry],
      overrides: m.overrides ?? [],
      vars: (m.vars ?? []).filter((x) => x.space !== 'workgroup'),
    };
    const param = (name: string): string =>
      arrays.find((p) => (glNames.get(p.name) ?? p.name) === name)!.name;
    plans.push({
      module,
      out: w.name,
      outScalar,
      reads: [...read].map((name) => ({ param: param(name), name })),
      uniforms,
    });
  }
  if (plans.length === 0) return { noWebgl2: 'it has no loop to draw' };
  return { loops: plans };
}
