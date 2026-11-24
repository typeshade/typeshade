// Implements: Rule 8.22, a kernel function's accepted loops lowered to compute entries (docs/language-design.md; traced in reqs/).

import type {
  BindingDecl,
  Expr,
  FuncDecl,
  ModuleDecl,
  ModuleVarDecl,
  Stmt,
  StructDecl,
} from '../ir/nodes.js';
import type { ShaderType } from '../ir/types.js';
import { u32T } from '../ir/types.js';
import { eachExpr, eachStmtExpr, mapChildren, mapStmtExpr } from '../ir/visit.js';
import { KERNEL_TREE, KERNEL_WORKGROUP, treeIdentity } from '../kernel-tree.js';
import {
  bin,
  invocationIndex,
  kernelWorkgroups,
  nwg,
  u,
  vec3u,
  x,
  y,
} from '../kernel-workgroup.js';
import { eachOperand, isAtomicAccess } from './access.js';
import { fnReads, fnWrites } from './effects.js';
import {
  argsOf,
  ATOMIC_OF,
  atomicArray,
  boolT,
  declaredNames,
  entryRewrite,
  forEachChild,
  isRuntimeArray,
  iterationOf,
  kRef,
  liveRef,
  mapStmt,
  placeRoot,
  rangeOf,
  spellArrayBindings,
  SUBGROUP_FOLD_OF,
  tripWord,
  typeKey,
  writesThroughCall,
  type ForStmt,
  type KernelCollection,
  type KernelLookup,
  type KernelLoopPlan,
  type KernelPlan,
  type LoopCtx,
  type LowerOptions,
  type PushWord,
} from './kernel-lower-ir.js';
import { computeEntry, kcRef, laneScaffold } from './kernel-push/entry.js';
import { pushEntries } from './kernel-push/push-entries.js';
import { deviceRangeLoops, lastLoopOf, readsElements, storeAfterLoops } from './kernel-stores.js';
import { mapExpr } from './opt/ir-transform.js';
import { proveKernels, type KernelProof, type LoopReduction } from './parallel-loop.js';
// Why: Rule 11.8 keeps the WebGL2 lowering entry point exported here; kernel-lower-gl.ts owns its implementation. Rule 8.23 passes an array parameter to a loop's entry as a storage binding, read-write as the body uses it.
export { GL_DISPATCH, GL_OUT, lowerKernelGl, type KernelGlLoopPlan } from './kernel-lower-gl.js';
export {
  type KernelCollection,
  type KernelLookup,
  type KernelLoopPlan,
  type KernelPlan,
  type LowerOptions,
  type PushWord,
} from './kernel-lower-ir.js';

import { WGSL_RESERVED } from '../reserved-words.js';
import {
  pushGap,
  earlyPushCount,
  pushCountsBetween,
  pushCountsIn,
  addsPerRun,
} from './kernel-lower/push-counts.js';

export { KERNEL_WORKGROUP };

export function lowerKernel(
  f: FuncDecl,
  m: ModuleDecl,
  proof: KernelProof,
  options: LowerOptions = {},
): KernelPlan | { readonly noGpu: string } {
  if (proof.shape !== undefined)
    return { noGpu: "its body is not the kernel call's shape (TS8070)" };
  const arrayNames = new Set(f.params.filter((p) => isRuntimeArray(p.type)).map((p) => p.name));
  const lastLoop = lastLoopOf(f.body);
  const stores = f.body.flatMap((st, i) => {
    const found = i > lastLoop ? storeAfterLoops(st, arrayNames) : undefined;
    return found !== undefined ? [found] : [];
  });
  const collection = f.params.find((p) => p.type.kind === 'collection');
  if (collection !== undefined && stores.length > 0)
    return {
      noGpu: `it takes the ${collection.type.kind === 'collection' && collection.type.value === undefined ? 'Set' : 'Map'} "${collection.name}" and stores into an array after its loops`,
    };
  const device = deviceRangeLoops(f);
  if (collection !== undefined && device.size > 0)
    return {
      noGpu: `it takes the ${collection.type.kind === 'collection' && collection.type.value === undefined ? 'Set' : 'Map'} "${collection.name}", and loop ${[...device][0]! + 1} reads its trip count from an array`,
    };
  if (collection !== undefined) return lowerCollections(f, m);
  const loops = f.body.filter((s): s is ForStmt => s.s === 'for');
  if (loops.length === 0 && stores.length === 0) return { noGpu: 'it has no loop to dispatch' };
  for (const v of proof.loops) {
    if (!v.ok) return { noGpu: 'a loop of it runs on the CPU (TS8070)' };
    for (const r of v.reductions) {
      const why = notReducible(r.type);
      if (why !== undefined) return { noGpu: `it reduces "${r.name}", ${why}` };
    }
  }
  for (const [j, v] of proof.loops.entries()) {
    const why = v.ok ? pushGap(v, j) : undefined;
    if (why !== undefined) return { noGpu: why };
  }
  const pushers = new Map<string, number[]>();
  for (const [j, v] of proof.loops.entries())
    for (const w of v.ok ? v.writes : [])
      if (w.kind === 'append') pushers.set(w.name, [...(pushers.get(w.name) ?? []), j]);
  if (earlyPushCount(f.body, pushers))
    return {
      noGpu:
        'it reads the length of an array it pushes onto before its result, which the call knows once the loop has run',
    };
  const textures = f.params.filter((p) => isTextureParam(p.type));
  const scalars = f.params.filter((p) => !isRuntimeArray(p.type) && !isTextureParam(p.type));
  const arrays = f.params.filter((p) => isRuntimeArray(p.type));
  for (const p of textures)
    if (
      !(p.type.kind === 'texture' && p.type.dim === '2d' && p.type.elem === 'f32') &&
      !(p.type.kind === 'storage-texture' && p.type.dim === '2d')
    )
      return {
        noGpu: `parameter "${p.name}" is a texture a kernel call does not bind: it binds a texture_2d<f32> and a 2D storage texture`,
      };
  const textureNames = new Set(textures.map((p) => p.name));
  const scatter = new Set<string>();
  for (const v of proof.loops)
    if (v.ok)
      for (const w of v.writes)
        if (w.kind === 'scatter') {
          if (ATOMIC_OF[w.op] === undefined)
            return { noGpu: `it scatters into "${w.name}" with ${w.op}, which no atomic does` };
          if (!arrays.some((p) => p.name === w.name))
            return { noGpu: `it scatters into "${w.name}", which is not a parameter` };
          scatter.add(w.name);
        }
  for (const v of proof.loops)
    if (v.ok)
      for (const w of v.writes)
        if (w.kind !== 'scatter' && scatter.has(w.name))
          return {
            noGpu: `a loop writes "${w.name}" in place, and another scatters into it`,
          };
  for (const p of scalars) {
    const why = notUniform(p.type, m);
    if (why !== undefined) return { noGpu: `parameter "${p.name}" is ${why}` };
  }
  for (const p of arrays) {
    const why = notStorage((p.type as { elem: ShaderType }).elem, m);
    if (why !== undefined) return { noGpu: `parameter "${p.name}" holds ${why}` };
  }
  const reads = fnReads(m);
  const writes = fnWrites(m);
  const moduleNames = new Set([
    ...m.bindings.map((b) => b.name),
    ...(m.vars ?? []).map((v) => v.name),
  ]);
  for (const n of [...(reads.get(f.name) ?? []), ...(writes.get(f.name) ?? [])])
    if (moduleNames.has(n)) return { noGpu: `it reaches "${n}", which the call does not pass` };

  const argsStruct = `${f.name}_Args`;
  const argsBinding = `${f.name}_args`;
  const taken = new Set([
    ...m.funcs.map((x) => x.name),
    ...m.structs.map((s) => s.name),
    ...m.bindings.map((b) => b.name),
  ]);
  if (taken.has(argsStruct) || taken.has(argsBinding))
    return {
      noGpu: `the module already declares "${argsBinding}", the name the call's uniform takes`,
    };
  const afterLoops = f.body.slice(lastLoop + 1).filter((st) => st.s !== 'return');
  const lengthsRead = new Set([
    ...(stores.length > 0 ? pushCountsIn(afterLoops) : []),
    ...pushCountsBetween(f.body),
  ]);
  const declared = declaredNames(m);
  const words: PushWord[] = [];
  const wordOf = new Map<string, PushWord>();
  for (const [k, name] of arrays
    .map((p) => p.name)
    .filter((n) => pushers.has(n))
    .entries()) {
    const loops = pushers.get(name)!;
    if (options.held !== true && loops.length < 2 && !lengthsRead.has(name)) continue;
    const binding = `${f.name}_len${String(k)}`;
    if (taken.has(binding) || declared.has(binding))
      return {
        noGpu: `the module already declares "${binding}", the name of the length word of "${name}"`,
      };
    const word: PushWord = { param: name, binding, field: `_off${String(k)}`, loops };
    words.push(word);
    wordOf.set(name, word);
  }

  let trips: { readonly write: string; readonly read: string } | undefined;
  if (device.size > 0) {
    trips = { write: `${f.name}_trips`, read: `${f.name}_tripsIn` };
    for (const n of [trips.write, trips.read])
      if (taken.has(n) || declared.has(n))
        return { noGpu: `the module already declares "${n}", the name of the call's trip buffer` };
  }

  // Why: Rule 3.3. A storage binding is the WGSL name of an array parameter, and WGSL reserves some
  // of the names an author may give one. Only the emitted spelling changes: the face, the
  // loops' facts and the errors keep the authored name.
  const bindingNames = spellArrayBindings(
    [...arrays, ...textures].map((p) => p.name),
    new Set([
      ...declared,
      ...words.map((w) => w.binding),
      ...(trips !== undefined ? [trips.write, trips.read] : []),
    ]),
    (name) => WGSL_RESERVED.has(name),
  );
  const plans: KernelLoopPlan[] = [];
  const entries: FuncDecl[] = [];
  const variantOf = new Map<FuncDecl, FuncDecl>();
  const ranges: FuncDecl[] = [];
  const extraStructs: StructDecl[] = [];
  const extraVars: ModuleVarDecl[] = [];
  const partBindings: { name: string; type: ShaderType }[] = [];
  const prelude: Stmt[] = [];
  let loopIndex = 0;
  let counterType: ShaderType | undefined;
  const reduced = new Set<string>();
  let readsReduced: string | undefined;
  for (const st of f.body) {
    if (st.s !== 'for') {
      if (st.s === 'return') continue;
      if (readsReduced === undefined) readsReduced = firstName([st], reduced);
      prelude.push(st);
      continue;
    }
    const j = loopIndex++;
    if (readsReduced !== undefined)
      return {
        noGpu: `a statement before loop ${j + 1} reads "${readsReduced}", which an earlier loop reduces`,
      };
    const counted = st.counted!;
    const header = rangeOf(st);
    if (header === undefined)
      return { noGpu: `loop ${j + 1} compares its counter in a way the call cannot count` };
    if (counterType !== undefined && typeKey(counterType) !== typeKey(header.type))
      return { noGpu: 'its loops count with counters of two types' };
    counterType = header.type;
    const onDevice = device.has(j);
    const before = firstName(
      [
        ...prelude,
        { s: 'call', expr: header.start } as Stmt,
        { s: 'call', expr: header.bound } as Stmt,
      ],
      textureNames,
    );
    if (before !== undefined)
      return {
        noGpu: `the statements before loop ${j + 1} read the texture "${before}", which the call runs before it dispatches`,
      };
    const range: FuncDecl = {
      name: `${f.name}__range${j}`,
      params: f.params,
      ret: {
        kind: 'vec',
        n: 2,
        elem: header.type.kind === 'scalar' ? (header.type.scalar as 'i32') : 'i32',
      },
      body: [
        ...prelude,
        {
          s: 'return',
          expr: {
            op: 'construct',
            type: { kind: 'vec', n: 2, elem: (header.type as { scalar: 'i32' }).scalar },
            args: [header.start, header.bound],
          },
        },
      ],
      kernel: true,
    };
    ranges.push(range);
    const v = proof.loops[j]!;
    if (onDevice && v.ok) {
      const why = deviceGap(v, j, st, prelude, m);
      if (why !== undefined) return { noGpu: why };
    }
    const written = new Set<string>();
    if (v.ok) for (const w of v.writes) written.add(w.name);
    const checks: KernelLoopPlan['checks'][number][] = [];
    if (v.ok && !onDevice)
      for (const w of v.writes)
        if (w.kind === 'affine' && arrays.some((p) => p.name === w.name))
          for (const c of w.c) checks.push({ param: w.name, a: w.a, c });
    const texels: NonNullable<KernelLoopPlan['texels']>[number][] = [];
    if (v.ok)
      for (const w of v.writes) {
        if (w.kind !== 'texel' || !textureNames.has(w.name)) continue;
        const reads = firstName([...prelude, { s: 'call', expr: w.width } as Stmt], textureNames);
        if (reads !== undefined)
          return {
            noGpu: `the row width loop ${j + 1} stores "${w.name}" at reads the texture "${reads}"`,
          };
        const width: FuncDecl = {
          name: `${f.name}__texel${j}_${texels.length}`,
          params: f.params,
          ret: w.width.type,
          body: [...prelude, { s: 'return', expr: w.width }],
          kernel: true,
        };
        ranges.push(width);
        texels.push({ param: w.name, width: width.name });
      }
    const strides: NonNullable<KernelLoopPlan['strides']>[number][] = [];
    const rows: NonNullable<KernelLoopPlan['rows']>[number][] = [];
    const rangeFn = (suffix: string, e: Expr): FuncDecl => {
      const fn: FuncDecl = {
        name: `${f.name}__${suffix}${j}_${strides.length + rows.length}`,
        params: f.params,
        ret: e.type,
        body: [...prelude, { s: 'return', expr: e }],
        kernel: true,
      };
      ranges.push(fn);
      return fn;
    };
    if (v.ok && !onDevice)
      for (const w of v.writes) {
        if (!arrays.some((p) => p.name === w.name)) continue;
        if (w.kind === 'scaled') {
          const atZero = mapExpr(w.index, (x) =>
            x.op === 'varref' && x.name === counted.name
              ? { op: 'lit', type: header.type, value: 0 }
              : x,
          );
          const coefficient = rangeFn('stride', w.coefficient).name;
          const base = rangeFn('base', atZero).name;
          strides.push({ param: w.name, coefficient, base });
        } else if (w.kind === 'row-major') {
          rows.push({ param: w.name, width: rangeFn('row', w.width).name });
        }
      }
    if (v.ok && !onDevice) {
      const arrayNames = new Set(arrays.map((p) => p.name));
      let guardCount = 0;
      for (const r of v.reads) {
        if (!arrayNames.has(r.name)) continue;
        for (const form of r.forms) {
          const guards: NonNullable<KernelLoopPlan['checks'][number]['guards']>[number][] = [];
          for (const g of form.guards ?? []) {
            const asStmt = [{ s: 'call', expr: g.bound } as Stmt];
            if (readsElements(asStmt, arrayNames) || firstName(asStmt, textureNames) !== undefined)
              continue;
            const fn: FuncDecl = {
              name: `${f.name}__guard${j}_${guardCount++}`,
              params: f.params,
              ret: g.bound.type,
              body: [...prelude, { s: 'return', expr: g.bound }],
              kernel: true,
            };
            ranges.push(fn);
            guards.push({ cop: g.cop, fn: fn.name });
          }
          checks.push({
            param: r.name,
            a: form.a,
            c: form.c,
            read: true,
            ...(guards.length > 0 ? { guards } : {}),
          });
        }
      }
    }
    const reductions = v.ok ? v.reductions : [];
    for (const r of reductions) reduced.add(r.name);
    const loopCtx: LoopCtx = {
      bindingNames,
      f,
      wg: kernelWorkgroups.get(f) ?? KERNEL_WORKGROUP,
      loop: st,
      j,
      counter: counted.name,
      counterType: header.type,
      step: counted.step,
      prelude,
      scalars: scalars.map((p) => p.name),
      arrays: [...arrays, ...textures].map((p) => p.name),
      argsBinding,
      argsStruct,
      scatter,
      skip: v.ok && laneSkips(v, st.body, new Set(arrays.map((p) => p.name))),
      words: wordOf,
      ...(onDevice ? { trips: { binding: trips!.read, at: TRIP_WORDS * j } } : {}),
    };
    let rangeEntry: FuncDecl | undefined;
    if (onDevice) {
      rangeEntry = rangeEntryFor(loopCtx, header, trips!.write);
      entries.push(rangeEntry);
    }
    const common = {
      range: range.name,
      cop: header.cop,
      step: counted.step,
      writes: [...written].filter((n) => arrays.some((p) => p.name === n)),
      checks,
      ...(texels.length > 0 ? { texels } : {}),
      ...(strides.length > 0 ? { strides } : {}),
      ...(rows.length > 0 ? { rows } : {}),
      ...(rangeEntry !== undefined
        ? { device: { entry: rangeEntry.name, at: TRIP_WORDS * j } }
        : {}),
    };
    const continues = hasOwnContinue(st.body);
    const pushedOnto = v.ok ? v.writes.find((w) => w.kind === 'append')?.name : undefined;
    if (pushedOnto !== undefined) {
      const lowered = pushEntries(
        loopCtx,
        pushedOnto,
        new Set(arrays.map((p) => p.name)),
        wordOf.get(pushedOnto),
        options.exactTotal === true,
      );
      entries.push(...lowered.funcs);
      extraVars.push(lowered.workgroup);
      partBindings.push({ name: lowered.binding, type: u32T });
      plans.push({
        ...common,
        entry: lowered.store,
        wg: loopCtx.wg,
        push: { count: lowered.count, scan: lowered.scan, binding: lowered.binding },
        iterates: lowered.store,
        iteration: lowered.iteration,
        continues,
      });
      continue;
    }
    if (reductions.length === 0) {
      const { entry, iteration } = entryFor(loopCtx);
      entries.push(entry);
      const folds =
        loopCtx.scatter.size > 0 && !continues && scattersAtMostOnce(st.body, loopCtx.scatter);
      if (folds) variantOf.set(entry, entryFor({ ...loopCtx, subgroupScatter: true }).entry);
      plans.push({
        ...common,
        entry: entry.name,
        wg: loopCtx.wg,
        iterates: entry.name,
        iteration,
        continues,
        ...(folds ? { subgroupFold: true } : {}),
      });
      continue;
    }
    const lowered = reductionEntries(loopCtx, reductions);
    entries.push(...lowered.funcs);
    const folds = reductions.every(subgroupFoldable);
    if (folds) {
      const variant = reductionEntries({ ...loopCtx, subgroup: true }, reductions);
      lowered.funcs.forEach((e, i) => variantOf.set(e, variant.funcs[i]!));
    }
    extraStructs.push(lowered.struct);
    extraVars.push(...lowered.workgroup);
    partBindings.push(...lowered.vars.map((r) => ({ name: r.binding, type: r.type })));
    plans.push({
      ...common,
      entry: lowered.entry,
      wg: KERNEL_TREE,
      reduce: { entry: lowered.reduceEntry, vars: lowered.vars },
      iterates: lowered.iterate,
      iteration: 0,
      continues,
      ...(folds ? { subgroupFold: true } : {}),
    });
  }

  let tail: FuncDecl | undefined;
  if (f.ret.kind !== 'void') {
    const folded: { name: string; type: ShaderType }[] = [];
    const pushCounts = new Map<string, string>();
    let k = 0;
    const body: Stmt[] = [];
    for (const st of f.body) {
      if (st.s !== 'for') {
        if (storeAfterLoops(st, arrayNames) === undefined) body.push(st);
        continue;
      }
      const v = proof.loops[k++]!;
      for (const r of v.ok ? v.reductions : []) {
        const t = { name: `_t${k - 1}_${r.name}`, type: r.type };
        folded.push(t);
        body.push(combineInto(r, { op: 'param', type: r.type, name: t.name }));
      }
      const pushed = v.ok ? v.writes.find((w) => w.kind === 'append')?.name : undefined;
      if (pushed !== undefined) {
        const t = { name: `_t${k - 1}_push_${pushed}`, type: u32T };
        folded.push(t);
        pushCounts.set(pushed, t.name);
      }
    }
    const counted = (e: Expr): Expr => {
      const x = mapChildren(e, counted);
      const p = x.op === 'call' && x.fn === 'pushCount' ? x.args[0] : undefined;
      const t = p?.op === 'param' ? pushCounts.get(p.name) : undefined;
      return t === undefined ? x : { op: 'param', type: u32T, name: t };
    };
    body.splice(0, body.length, ...body.map((st) => mapStmt(st, counted)));
    if (
      !readsArraysByLengthOnly(
        body,
        arrays.map((p) => p.name),
      )
    )
      return {
        noGpu: "its result reads an array's elements, which the call computes on the CPU tier",
      };
    const named = firstName(body, textureNames);
    if (named !== undefined)
      return {
        noGpu: `its result reads the texture "${named}", which the call computes on the CPU tier`,
      };
    tail = {
      name: `${f.name}__tail`,
      params: [...f.params, ...folded],
      ret: f.ret,
      body,
      kernel: true,
    };
    ranges.push(tail);
  }

  let finish: KernelPlan['finish'];
  const atFields: { name: string; type: ShaderType }[] = [];
  if (stores.length > 0) {
    const replayed = f.body.filter((st) => st.s !== 'for' && st.s !== 'return');
    const atomic = firstName(replayed, scatter);
    if (atomic !== undefined)
      return {
        noGpu: `a statement after its loops reaches "${atomic}", which a loop scatters into: an atomic is read and written only by an atomic`,
      };
    const texture = firstName(replayed, textureNames);
    if (texture !== undefined)
      return { noGpu: `a statement after its loops reads the texture "${texture}"` };
    const args: Expr = {
      op: 'varref',
      type: { kind: 'struct', name: argsStruct },
      name: argsBinding,
    };
    const field = (name: string, type: ShaderType): Expr => ({
      op: 'member',
      type,
      base: args,
      field: name,
    });
    const scalarSet = new Set(scalars.map((p) => p.name));
    const arraySet = new Set(arrays.map((p) => p.name));
    const rewrite = (e: Expr): Expr => {
      if (e.op === 'param' && scalarSet.has(e.name)) return field(e.name, e.type);
      if (e.op === 'param' && arraySet.has(e.name))
        return { op: 'varref', type: e.type, name: bindingNames.get(e.name) ?? e.name };
      const pushed = e.op === 'call' && e.fn === 'pushCount' ? e.args[0] : undefined;
      if (pushed?.op === 'param') {
        const word = wordOf.get(pushed.name)!;
        return {
          op: 'index',
          type: u32T,
          base: { op: 'varref', type: { kind: 'array', elem: u32T }, name: word.binding },
          idx: field(word.field, u32T),
        };
      }
      return mapChildren(e, rewrite);
    };
    const gpuBody: Stmt[] = [];
    const cpuBody: Stmt[] = [];
    const folded: { name: string; type: ShaderType }[] = [];
    let j = 0;
    for (const st of f.body) {
      if (st.s === 'return') continue;
      if (st.s !== 'for') {
        gpuBody.push(mapStmt(st, rewrite));
        cpuBody.push(st);
        continue;
      }
      const v = proof.loops[j]!;
      const vars = plans[j]!.reduce?.vars ?? [];
      const at = field(`_at${String(j)}`, u32T);
      if (vars.length > 0) atFields.push({ name: `_at${String(j)}`, type: u32T });
      for (const [i, r] of (v.ok ? v.reductions : []).entries()) {
        const local = `_f${String(j)}_${r.name}`;
        const part: Expr = {
          op: 'index',
          type: r.type,
          base: { op: 'varref', type: { kind: 'array', elem: r.type }, name: vars[i]!.binding },
          idx: at,
        };
        gpuBody.push(
          { s: 'var', name: local, type: r.type, init: identityOf(r) },
          {
            s: 'if',
            arms: [
              {
                cond: { op: 'compare', type: boolT, cop: '!=', a: at, b: u(0xffffffff) },
                body: [
                  { s: 'assign', target: { op: 'varref', type: r.type, name: local }, expr: part },
                ],
              },
            ],
          },
          combineInto(r, { op: 'varref', type: r.type, name: local }),
        );
        const t = { name: `_t${String(j)}_${r.name}`, type: r.type };
        folded.push(t);
        cpuBody.push(combineInto(r, { op: 'param', type: r.type, name: t.name }));
      }
      j++;
    }
    const entry = computeEntry(`${f.name}_finish`, gpuBody, false, 1);
    entries.push(entry);
    const fn: FuncDecl = {
      name: `${f.name}__finish`,
      params: [...f.params, ...folded],
      ret: { kind: 'void' },
      body: cpuBody,
      kernel: true,
    };
    ranges.push(fn);
    finish = {
      entry: entry.name,
      fn: fn.name,
      writes: [...new Set(stores.map((s) => s.array))],
    };
  }

  const argsDecl: StructDecl = {
    name: argsStruct,
    fields: [
      ...scalars.map((p) => ({ name: p.name, type: p.type })),
      { name: '_start', type: counterType ?? u32T },
      { name: '_n', type: u32T },
      ...(partBindings.length > 0
        ? [
            { name: '_in', type: u32T },
            { name: '_out', type: u32T },
          ]
        : []),
      ...atFields,
      ...words.map((w) => ({ name: w.field, type: u32T })),
    ],
  };
  const writtenArrays = writes.get(f.name) ?? new Set<string>();
  const bindings: BindingDecl[] = [
    {
      group: 0,
      binding: 0,
      name: argsBinding,
      space: 'uniform',
      type: { kind: 'struct', name: argsStruct },
    },
    ...arrays.map((p, k): BindingDecl => ({
      group: 0,
      binding: k + 1,
      name: bindingNames.get(p.name) ?? p.name,
      space: 'storage',
      access: writtenArrays.has(p.name) ? 'read_write' : 'read',
      type: scatter.has(p.name) ? atomicArray(p.type) : p.type,
    })),
    ...partBindings.map((p, k): BindingDecl => ({
      group: 0,
      binding: arrays.length + 1 + k,
      name: p.name,
      space: 'storage',
      access: 'read_write',
      type: { kind: 'array', elem: p.type },
    })),
    ...textures.map((p, k): BindingDecl => ({
      group: 0,
      binding: arrays.length + 1 + partBindings.length + k,
      name: bindingNames.get(p.name) ?? p.name,
      space: 'uniform',
      type: p.type,
    })),
    ...(trips !== undefined
      ? [
          {
            group: 0,
            binding: arrays.length + 1 + partBindings.length + textures.length,
            name: trips.write,
            space: 'storage',
            access: 'read_write',
            type: { kind: 'array', elem: u32T },
          } satisfies BindingDecl,
          {
            group: 0,
            binding: arrays.length + 2 + partBindings.length + textures.length,
            name: trips.read,
            space: 'storage',
            access: 'read',
            type: { kind: 'array', elem: u32T },
          } satisfies BindingDecl,
        ]
      : []),
    ...words.map((w, k): BindingDecl => ({
      group: 0,
      binding:
        arrays.length +
        1 +
        partBindings.length +
        textures.length +
        (trips !== undefined ? 2 : 0) +
        k,
      name: w.binding,
      space: 'storage',
      access: 'read_write',
      type: { kind: 'array', elem: u32T },
    })),
  ];
  const module: ModuleDecl = {
    consts: m.consts,
    structs: [...m.structs, argsDecl, ...extraStructs],
    bindings,
    funcs: [...m.funcs.filter((x) => x.kernel !== true && x.stage === undefined), ...entries],
    overrides: m.overrides ?? [],
    vars: [...(m.vars ?? []).filter((x) => x.space !== 'workgroup'), ...extraVars],
    ...(m.enables !== undefined ? { enables: m.enables } : {}),
  };
  const every = [...entries, ...variantOf.values()];
  for (const name of scatter) {
    if (every.some((e) => readsOutsideAtomics(e.body, bindingNames.get(name) ?? name)))
      return {
        noGpu: `a loop reads "${name}", which a loop scatters into: an atomic is read only by an atomic`,
      };
    if (every.some((e) => stillPlain(e.body, bindingNames.get(name) ?? name)))
      return { noGpu: `it scatters into "${name}" at a place other than an element` };
  }
  const subgroupModule: ModuleDecl | undefined =
    variantOf.size === 0
      ? undefined
      : { ...module, funcs: module.funcs.map((x) => variantOf.get(x) ?? x) };
  return {
    module,
    ...(subgroupModule !== undefined ? { subgroupModule } : {}),
    argsBinding,
    argsStruct,
    loops: plans,
    ranges,
    bindingNames,
    ...(tail !== undefined ? { tail: tail.name } : {}),
    ...(finish !== undefined ? { finish } : {}),
    ...(words.length > 0 ? { words } : {}),
    ...(trips !== undefined ? { trips } : {}),
  };
}

export const TRIP_WORDS = 8;

function deviceGap(
  v: Extract<KernelProof['loops'][number], { ok: true }>,
  j: number,
  loop: ForStmt,
  prelude: readonly Stmt[],
  m: ModuleDecl,
): string | undefined {
  const at = `loop ${j + 1}`;
  const over = 'over a trip count it reads from an array';
  const pushed = v.writes.find((w) => w.kind === 'append');
  if (pushed !== undefined)
    return `${at} pushes onto "${pushed.name}" ${over}, and the call sizes the counts of a push from a trip count the host knows`;
  if (v.reductions.length > 0)
    return `${at} reduces "${v.reductions[0]!.name}" ${over}, and the call sizes the partials of a reduction from a trip count the host knows`;
  for (const w of v.writes) {
    if (w.kind === 'texel')
      return `${at} stores into the texture "${w.name}" ${over}, and the call checks a texture's rows against a trip count the host knows`;
    if (writesThroughCall(loop, w.name, m))
      return `${at} writes "${w.name}" through a reference a call takes, ${over}, and the GPU runs only an assignment over such a count`;
    if (readsElements(prelude, new Set([w.name])))
      return `${at} writes "${w.name}", which the statements before it read, and each of its invocations runs those statements again`;
  }
  return undefined;
}

function rangeEntryFor(
  c: LoopCtx,
  header: { start: Expr; bound: Expr; cop: KernelLoopPlan['cop']; type: ShaderType },
  out: string,
): FuncDecl {
  const at = c.trips!.at;
  const rewrite = entryRewrite(c);
  const t = header.type;
  const isU = t.kind === 'scalar' && t.scalar === 'u32';
  const ref = (name: string, type: ShaderType): Expr => ({ op: 'varref', type, name });
  const asU = (e: Expr): Expr => (isU ? e : { op: 'call', type: u32T, fn: 'u32', args: [e] });
  const sub = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: u32T, bop: '-', a, b });
  const div = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: u32T, bop: '/', a, b });
  const ceilDiv = (target: string, a: Expr, by: number): Stmt[] => [
    { s: 'assign', target: ref(target, u32T), expr: div(a, u(by)) },
    {
      s: 'if',
      arms: [
        {
          cond: {
            op: 'compare',
            type: boolT,
            cop: '!=',
            a: { op: 'binop', type: u32T, bop: '%', a, b: u(by) },
            b: u(0),
          },
          body: [
            {
              s: 'assign',
              target: ref(target, u32T),
              expr: bin('+', ref(target, u32T), u(1)),
            },
          ],
        },
      ],
    },
  ];
  const s = ref('_rs', t);
  const b = ref('_rb', t);
  const up = header.cop === '<' || header.cop === '<=';
  const inclusive = header.cop === '<=' || header.cop === '>=';
  const span0 = up ? sub(asU(b), asU(s)) : sub(asU(s), asU(b));
  const span = inclusive ? bin('+', span0, u(1)) : span0;
  const store = (k: number, e: Expr): Stmt => ({
    s: 'assign',
    target: {
      op: 'index',
      type: u32T,
      base: ref(out, { kind: 'array', elem: u32T }),
      idx: u(at + k),
    },
    expr: e,
  });
  const body: Stmt[] = [
    ...c.prelude.map((st) => mapStmt(st, rewrite)),
    { s: 'let', name: '_rs', expr: rewrite(header.start) },
    { s: 'let', name: '_rb', expr: rewrite(header.bound) },
    { s: 'var', name: '_rn', type: u32T, init: u(0) },
    {
      s: 'if',
      arms: [
        {
          cond: { op: 'compare', type: boolT, cop: header.cop, a: s, b },
          body: [
            { s: 'let', name: '_span', expr: span },
            ...ceilDiv('_rn', ref('_span', u32T), Math.abs(c.step)),
          ],
        },
      ],
    },
    { s: 'var', name: '_rg', type: u32T, init: u(0) },
    ...ceilDiv('_rg', ref('_rn', u32T), c.wg),
    {
      s: 'let',
      name: '_rx',
      expr: {
        op: 'call',
        type: u32T,
        fn: 'max',
        args: [u(1), { op: 'call', type: u32T, fn: 'min', args: [ref('_rg', u32T), u(65535)] }],
      },
    },
    {
      s: 'let',
      name: '_ry',
      expr: div(sub(bin('+', ref('_rg', u32T), ref('_rx', u32T)), u(1)), ref('_rx', u32T)),
    },
    store(0, asU(s)),
    store(1, ref('_rn', u32T)),
    store(2, ref('_rx', u32T)),
    store(3, ref('_ry', u32T)),
    store(4, u(1)),
  ];
  return computeEntry(`${c.f.name}_range${c.j}`, body, false, 1);
}

function laneSkips(
  v: Extract<KernelProof['loops'][number], { ok: true }>,
  body: readonly Stmt[],
  arrays: ReadonlySet<string>,
): boolean {
  if (v.stores.some((st) => st.readBack)) return true;
  const stored = new Set(v.writes.filter((w) => w.kind === 'texel').map((w) => w.name));
  let found = false;
  const see = (e: Expr): void =>
    eachExpr(e, (x) => {
      if (x.op !== 'call') return;
      const first = x.args[0];
      if (x.fn === 'textureLoad' && first?.op === 'param' && stored.has(first.name)) found = true;
      x.declRef?.params.forEach((p, i) => {
        const a = x.args[i];
        if (p.mode !== 'inout' || a === undefined) return;
        const root = placeRoot(a);
        if (root.op === 'param' && arrays.has(root.name)) found = true;
      });
    });
  const visit = (st: Stmt): void => eachStmtExpr(st, see, visit);
  body.forEach(visit);
  return found;
}

function entryFor(c: LoopCtx): { entry: FuncDecl; iteration: number } {
  const n = c.trips === undefined ? argsOf(c)('_n', u32T) : tripWord(c, 1);
  const scaffold = laneScaffold(c.wg, n);
  const body: Stmt[] = [
    ...scaffold,
    ...iterationOf(c, undefined, [], { k: kcRef, mask: liveRef, skip: c.skip }),
  ];
  return {
    entry: computeEntry(
      `${c.f.name}_loop${c.j}`,
      body,
      false,
      c.wg,
      c.subgroupScatter === true ? 'scatter' : undefined,
    ),
    iteration: scaffold.length,
  };
}

function reductionEntries(
  c: LoopCtx,
  reductions: readonly LoopReduction[],
): {
  funcs: FuncDecl[];
  struct: StructDecl;
  workgroup: ModuleVarDecl[];
  vars: (LoopReduction & { binding: string })[];
  entry: string;
  reduceEntry: string;
  iterate: string;
} {
  const base = `${c.f.name}_loop${c.j}`;
  const field = argsOf(c);
  const struct: StructDecl = {
    name: `${base}_Sums`,
    fields: reductions.map((r) => ({ name: r.name, type: r.type })),
  };
  const structT: ShaderType = { kind: 'struct', name: struct.name };
  const vars = reductions.map((r) => ({ ...r, binding: `${base}_${r.name}` }));
  const shared = (r: LoopReduction): string => `${base}_tree_${r.name}`;
  const workgroup: ModuleVarDecl[] = reductions.map((r) => ({
    name: shared(r),
    space: 'workgroup',
    type: { kind: 'array', elem: r.type, size: KERNEL_TREE },
  }));
  const sums: Expr = {
    op: 'construct',
    type: structT,
    args: reductions.map((r) => ({ op: 'varref', type: r.type, name: r.name })),
  };
  const liveParam: Expr = { op: 'param', type: boolT, name: '_live' };
  const iterate = iterationOf(
    c,
    sums,
    reductions.map((r): Stmt => ({
      s: 'assign',
      target: { op: 'varref', type: r.type, name: r.name },
      expr: identityOf(r),
    })),
    { k: kRef, mask: liveParam, skip: false },
  );
  const asParam = (e: Expr): Expr =>
    e.op === 'varref' && e.name === '_k'
      ? { op: 'param', type: u32T, name: '_k' }
      : mapChildren(e, asParam);
  const helper: FuncDecl = {
    name: `${base}_iteration`,
    params: [
      { name: '_k', type: u32T },
      { name: '_live', type: boolT },
    ],
    ret: structT,
    body: iterate.map((st) => mapStmt(st, asParam)),
  };
  const lid: Expr = { op: 'param', type: u32T, name: '_lid' };
  const wid: Expr = { op: 'param', type: vec3u, name: '_wid' };
  const slot = (r: LoopReduction, at: Expr): Expr => ({
    op: 'index',
    type: r.type,
    base: {
      op: 'varref',
      type: { kind: 'array', elem: r.type, size: KERNEL_TREE },
      name: shared(r),
    },
    idx: at,
  });
  const part = (r: LoopReduction & { binding: string }, at: Expr): Expr => ({
    op: 'index',
    type: r.type,
    base: { op: 'varref', type: { kind: 'array', elem: r.type }, name: r.binding },
    idx: at,
  });
  const barrier: Stmt = {
    s: 'call',
    expr: { op: 'call', type: { kind: 'void' }, fn: 'workgroupBarrier', args: [] },
  };
  const inRange: Expr = { op: 'compare', type: boolT, cop: '<', a: kRef, b: field('_n', u32T) };
  const tree: Stmt[] = [barrier];
  for (let stride = KERNEL_TREE >> 1; stride > 0; stride >>= 1) {
    tree.push({
      s: 'if',
      arms: [
        {
          cond: { op: 'compare', type: boolT, cop: '<', a: lid, b: u(stride) },
          body: reductions.map((r): Stmt => ({
            s: 'assign',
            target: slot(r, lid),
            expr: combineOf(r, slot(r, lid), slot(r, bin('+', lid, u(stride)))),
          })),
        },
      ],
    });
    if (stride > 1) tree.push(barrier);
  }
  const group = bin('+', x(wid), bin('*', y(wid), x(nwg)));
  const store = (at: Expr): Stmt => ({
    s: 'if',
    arms: [
      {
        cond: { op: 'compare', type: boolT, cop: '==', a: lid, b: u(0) },
        body: vars.map((r): Stmt => ({ s: 'assign', target: part(r, at), expr: slot(r, u(0)) })),
      },
    ],
  });
  const sumsRef: Expr = { op: 'varref', type: structT, name: '_sums' };
  const n = field('_n', u32T);
  const runOf = (k: Expr): Expr => ({
    op: 'call',
    type: structT,
    fn: helper.name,
    args: [k, liveRef],
    declRef: helper,
  });
  const ranRef: Expr = { op: 'varref', type: structT, name: '_ran' };
  const iteration: Stmt[] = c.skip
    ? [
        {
          s: 'if',
          arms: [{ cond: liveRef, body: [{ s: 'assign', target: sumsRef, expr: runOf(kRef) }] }],
        },
      ]
    : [
        { s: 'let', name: '_ran', expr: runOf(kcRef) },
        {
          s: 'if',
          arms: [{ cond: liveRef, body: [{ s: 'assign', target: sumsRef, expr: ranRef }] }],
        },
      ];
  const subgroupFold = (value: (r: LoopReduction) => Expr): Stmt[] => {
    const sgi: Expr = { op: 'param', type: u32T, name: '_sgi' };
    const sgid: Expr = { op: 'param', type: u32T, name: '_sgid' };
    const nsg: Expr = { op: 'param', type: u32T, name: '_nsg' };
    const fold = (r: LoopReduction): Expr => ({
      op: 'varref',
      type: r.type,
      name: `_sg_${r.name}`,
    });
    const acc = (r: LoopReduction): Expr => ({
      op: 'varref',
      type: r.type,
      name: `_acc_${r.name}`,
    });
    const j: Expr = { op: 'varref', type: u32T, name: '_sgj' };
    return [
      ...reductions.map((r): Stmt => ({
        s: 'let',
        name: `_sg_${r.name}`,
        expr: { op: 'call', type: r.type, fn: SUBGROUP_FOLD_OF[r.op], args: [value(r)] },
      })),
      {
        s: 'if',
        arms: [
          {
            cond: { op: 'compare', type: boolT, cop: '==', a: sgi, b: u(0) },
            body: reductions.map((r): Stmt => ({
              s: 'assign',
              target: slot(r, sgid),
              expr: fold(r),
            })),
          },
        ],
      },
      barrier,
      {
        s: 'if',
        arms: [
          {
            cond: { op: 'compare', type: boolT, cop: '==', a: lid, b: u(0) },
            body: [
              ...reductions.map((r): Stmt => ({
                s: 'var',
                name: `_acc_${r.name}`,
                type: r.type,
                init: identityOf(r),
              })),
              {
                s: 'for',
                init: { s: 'var', name: '_sgj', type: u32T, init: u(0) },
                cond: { op: 'compare', type: boolT, cop: '<', a: j, b: nsg },
                update: { s: 'assign', target: j, expr: bin('+', j, u(1)) },
                body: reductions.map((r): Stmt => ({
                  s: 'assign',
                  target: acc(r),
                  expr: combineOf(r, acc(r), slot(r, j)),
                })),
              },
              ...reductions.map((r): Stmt => ({
                s: 'assign',
                target: slot(r, u(0)),
                expr: acc(r),
              })),
            ],
          },
        ],
      },
    ];
  };
  const subgroup = c.subgroup === true;
  const loopEntry = computeEntry(
    base,
    [
      ...laneScaffold(KERNEL_TREE, n),
      {
        s: 'var',
        name: '_sums',
        type: structT,
        init: { op: 'construct', type: structT, args: reductions.map(identityOf) },
      },
      ...iteration,
      ...(subgroup
        ? subgroupFold((r) => ({ op: 'member', type: r.type, base: sumsRef, field: r.name }))
        : [
            ...reductions.map((r): Stmt => ({
              s: 'assign',
              target: slot(r, lid),
              expr: { op: 'member', type: r.type, base: sumsRef, field: r.name },
            })),
            ...tree,
          ]),
      store(group),
    ],
    true,
    undefined,
    subgroup ? 'reduce' : undefined,
  );
  const reduceEntry = computeEntry(
    `${base}_fold`,
    [
      invocationIndex(KERNEL_TREE),
      ...vars.flatMap((r): Stmt[] => [
        { s: 'var', name: `_v_${r.name}`, type: r.type, init: identityOf(r) },
        {
          s: 'if',
          arms: [
            {
              cond: inRange,
              body: [
                {
                  s: 'assign',
                  target: { op: 'varref', type: r.type, name: `_v_${r.name}` },
                  expr: part(r, bin('+', field('_in', u32T), kRef)),
                },
              ],
            },
          ],
        },
        ...(subgroup
          ? []
          : [
              {
                s: 'assign',
                target: slot(r, lid),
                expr: { op: 'varref', type: r.type, name: `_v_${r.name}` },
              } as Stmt,
            ]),
      ]),
      ...(subgroup
        ? subgroupFold((r) => ({ op: 'varref', type: r.type, name: `_v_${r.name}` }))
        : tree),
      store(bin('+', field('_out', u32T), group)),
    ],
    true,
    undefined,
    subgroup ? 'reduce' : undefined,
  );
  return {
    funcs: [helper, loopEntry, reduceEntry],
    struct,
    workgroup,
    vars,
    entry: loopEntry.name,
    reduceEntry: reduceEntry.name,
    iterate: helper.name,
  };
}

function subgroupFoldable(r: LoopReduction): boolean {
  const t = r.type;
  const elem = t.kind === 'scalar' ? t.scalar : t.kind === 'vec' ? t.elem : undefined;
  if (elem === 'u32' || elem === 'i32') return true;
  if (elem === 'f32') return r.op === 'min' || r.op === 'max';
  return false;
}

function scattersAtMostOnce(body: readonly Stmt[], scatter: ReadonlySet<string>): boolean {
  const writesInto = (sts: readonly Stmt[]): boolean => {
    let found = false;
    for (const st of sts)
      eachStmtExpr(
        st,
        () => undefined,
        (inner) => {
          if (
            (inner.s === 'assign' || inner.s === 'assignOp') &&
            inner.target.op === 'index' &&
            inner.target.base.op === 'param' &&
            scatter.has(inner.target.base.name)
          )
            found = true;
        },
      );
    return found;
  };
  let ok = true;
  const visit = (st: Stmt): void => {
    if (st.s === 'for') {
      if (writesInto([st])) ok = false;
      return;
    }
    mapStmtExpr(
      st,
      (e) => e,
      (b) => {
        visit(b);
        return b;
      },
    );
  };
  body.forEach(visit);
  return ok;
}

function combineOf(r: LoopReduction, a: Expr, b: Expr): Expr {
  return r.op === 'min' || r.op === 'max'
    ? { op: 'call', type: r.type, fn: r.op, args: [a, b] }
    : { op: 'binop', type: r.type, bop: r.op, a, b };
}

function combineInto(r: LoopReduction, t: Expr): Stmt {
  const target: Expr = { op: 'varref', type: r.type, name: r.name };
  return { s: 'assign', target, expr: combineOf(r, target, t) };
}

function identityOf(r: LoopReduction): Expr {
  const t = r.type;
  if (t.kind === 'f64' || t.kind === 'vec64') {
    // Why: an infinity is no literal Tint takes, so the `min` and `max` of an emulated double start
    // from the largest finite f32, as an `f32` one does.
    const one = treeIdentity(r.op, 'f64') as number;
    const value = Number.isFinite(one) ? one : one > 0 ? F32_MAX_VALUE : -F32_MAX_VALUE;
    const e: Expr = { op: 'lit', type: { kind: 'f64' }, value };
    return t.kind === 'vec64'
      ? { op: 'construct', type: t, args: new Array<Expr>(t.n).fill(e) }
      : e;
  }
  const scalar = (t.kind === 'vec' ? t.elem : (t as { scalar: string }).scalar) as 'f32';
  const one = treeIdentity(r.op, scalar) as number;
  const st: ShaderType = { kind: 'scalar', scalar };
  let e: Expr;
  if (scalar === 'f32' && (Object.is(one, -0) || Math.abs(one) > 1e38)) {
    const bits = Object.is(one, -0) ? 0x80000000 : one > 0 ? 0x7f7fffff : 0xff7fffff;
    e = { op: 'call', type: st, fn: 'bitcastF32', args: [u(bits)] };
  } else e = { op: 'lit', type: st, value: one };
  return t.kind === 'vec' ? { op: 'construct', type: t, args: new Array<Expr>(t.n).fill(e) } : e;
}

const F32_MAX_VALUE = 3.4028234663852886e38;

function notReducible(t: ShaderType): string | undefined {
  if (t.kind === 'f64' || t.kind === 'vec64') return undefined;
  const scalar = t.kind === 'scalar' ? t.scalar : t.kind === 'vec' ? t.elem : undefined;
  if (scalar === undefined) return `a ${t.kind}, which the GPU does not fold`;
  if (scalar === 'f32' || scalar === 'i32' || scalar === 'u32') return undefined;
  if (scalar === 'bool') return 'a bool, which no buffer holds';
  return `an ${scalar}, which the call does not fold on the GPU`;
}

function firstName(sts: readonly Stmt[], names: ReadonlySet<string>): string | undefined {
  if (names.size === 0) return undefined;
  let found: string | undefined;
  const visit = (e: Expr): void => {
    if (found !== undefined) return;
    if ((e.op === 'varref' || e.op === 'param') && names.has(e.name)) {
      found = e.name;
      return;
    }
    forEachChild(e, visit);
  };
  for (const st of sts)
    mapStmt(st, (e) => {
      visit(e);
      return e;
    });
  return found;
}

function hasOwnContinue(body: readonly Stmt[]): boolean {
  return body.some((st) => {
    switch (st.s) {
      case 'continue':
        return true;
      case 'if':
        return (
          st.arms.some((a) => hasOwnContinue(a.body)) ||
          (st.elseBody !== undefined && hasOwnContinue(st.elseBody))
        );
      case 'switch':
        return (
          st.cases.some((c) => hasOwnContinue(c.body)) ||
          (st.defaultBody !== undefined && hasOwnContinue(st.defaultBody))
        );
      default:
        return false;
    }
  });
}

function readsOutsideAtomics(sts: readonly Stmt[], name: string): boolean {
  let found = false;
  const visit = (e: Expr): void => {
    if (found) return;
    if ((e.op === 'varref' || e.op === 'param') && e.name === name) {
      found = true;
      return;
    }
    eachOperand(e, (c, access) => {
      if (access === 'value') visit(c);
      else if (isAtomicAccess(access)) {
        for (let b = c; b.op === 'index' || b.op === 'member'; b = b.base)
          if (b.op === 'index') visit(b.idx);
      }
    });
  };
  for (const st of sts)
    mapStmt(st, (e) => {
      if (st.s === 'assign' || st.s === 'assignOp') {
        if (e === st.target) return e;
      }
      visit(e);
      return e;
    });
  return found;
}

function stillPlain(sts: readonly Stmt[], name: string): boolean {
  let found = false;
  const walk = (st: Stmt): void => {
    if ((st.s === 'assign' || st.s === 'assignOp') && rootOf(st.target) === name) found = true;
    mapStmtExpr(
      st,
      (e) => e,
      (b) => {
        walk(b);
        return b;
      },
    );
  };
  sts.forEach(walk);
  return found;
}

function rootOf(e: Expr): string | undefined {
  const b = placeRoot(e);
  return b.op === 'varref' || b.op === 'param' ? b.name : undefined;
}

function isTextureParam(t: ShaderType): boolean {
  return t.kind === 'texture' || t.kind === 'storage-texture';
}

function readsArraysByLengthOnly(sts: readonly Stmt[], names: readonly string[]): boolean {
  const set = new Set(names);
  let ok = true;
  const visit = (e: Expr): void => {
    if (!ok) return;
    if ((e.op === 'param' || e.op === 'varref') && set.has(e.name)) {
      ok = false;
      return;
    }
    eachOperand(e, (c, access) => {
      if (access !== 'length') visit(c);
    });
  };
  const walk = (st: Stmt): void => {
    mapStmt(st, (e) => {
      visit(e);
      return e;
    });
  };
  sts.forEach(walk);
  return ok;
}

function notUniform(t: ShaderType, m: ModuleDecl): string | undefined {
  return notShareable(t, m, new Set());
}

function notStorage(t: ShaderType, m: ModuleDecl): string | undefined {
  return notShareable(t, m, new Set());
}

function notShareable(t: ShaderType, m: ModuleDecl, seen: Set<string>): string | undefined {
  switch (t.kind) {
    case 'scalar':
      return t.scalar === 'bool' ? 'a bool, which no buffer holds' : undefined;
    case 'vec':
      return t.elem === 'bool' ? 'a bool vector, which no buffer holds' : undefined;
    case 'mat':
      return t.elem === 'f64' ? 'a matrix of f64, which has no host value yet' : undefined;
    case 'f64':
    case 'vec64':
      return undefined;
    case 'array':
      return t.size === undefined ? 'an array with no size' : notShareable(t.elem, m, seen);
    case 'struct': {
      if (seen.has(t.name)) return undefined;
      seen.add(t.name);
      const s = m.structs.find((x) => x.name === t.name);
      if (s === undefined) return `struct ${t.name}, which is not declared`;
      for (const fl of s.fields) {
        const why = notShareable(fl.type, m, seen);
        if (why !== undefined) return why;
      }
      return undefined;
    }
    default:
      return `a ${t.kind}, which the call does not pack yet`;
  }
}

function readsCollection(sts: readonly Stmt[], name: string): boolean {
  let found = false;
  const visit = (e: Expr): void =>
    eachExpr(e, (x) => {
      if (
        x.op === 'call' &&
        (x.fn === 'collectionHas' || x.fn === 'collectionGet' || x.fn === 'collectionSize') &&
        x.args[0]?.op === 'param' &&
        x.args[0].name === name
      )
        found = true;
    });
  const walk = (st: Stmt): void => eachStmtExpr(st, visit, walk);
  sts.forEach(walk);
  return found;
}

function lowerCollections(f: FuncDecl, m: ModuleDecl): KernelPlan | { readonly noGpu: string } {
  const loops = f.body.filter((st): st is ForStmt => st.s === 'for');
  const taken = declaredNames(m);
  const structs: StructDecl[] = [];
  const params: FuncDecl['params'][number][] = [];
  const collections: KernelCollection[] = [];
  const lookups: KernelLookup[] = [];
  const helpers: FuncDecl[] = [];
  const finders = new Map<
    string,
    { find: FuncDecl; keys: string; values: string | undefined; value: ShaderType | undefined }
  >();
  for (const p of f.params) {
    const t = p.type;
    if (t.kind !== 'collection') continue;
    const what = `the ${t.value === undefined ? 'Set' : 'Map'} "${p.name}"`;
    const adding = loops.flatMap((l, j) => (addsPerRun(l.body, p.name) !== 0 ? [j] : []));
    const reading = loops.flatMap((l, j) => (readsCollection(l.body, p.name) ? [j] : []));
    if (reading.length > 0 && adding.some((a) => a >= reading[0]!))
      return {
        noGpu: `loop ${adding.find((a) => a >= reading[0]!)! + 1} adds to ${what}, which loop ${reading[0]! + 1} reads before it, and the call uploads a collection once`,
      };
    if (reading.length > 0) {
      const fresh = (base: string): string => {
        let name = base;
        while (taken.has(name)) name = `_${name}`;
        taken.add(name);
        return name;
      };
      const keys = fresh(`_${p.name}_keys`);
      params.push({ name: keys, type: { kind: 'array', elem: u32T } });
      const values = t.value !== undefined ? fresh(`_${p.name}_values`) : undefined;
      if (values !== undefined)
        params.push({ name: values, type: { kind: 'array', elem: t.value! } });
      const find = findFunction(fresh(`${f.name}_${p.name}_find`), keys, t.key);
      helpers.push(find);
      lookups.push({
        param: p.name,
        keys,
        ...(values !== undefined ? { values } : {}),
        loop: reading[0]!,
      });
      finders.set(p.name, { find, keys, values, value: t.value });
      if (adding.length === 0) continue;
    }
    if (adding.length === 0) continue;
    if (adding.length > 1)
      return {
        noGpu: `loops ${adding[0]! + 1} and ${adding[1]! + 1} both add to ${what}, and the second adds after the first`,
      };
    const j = adding[0]!;
    const perIteration = addsPerRun(loops[j]!.body, p.name);
    if (perIteration === undefined)
      return {
        noGpu: `loop ${j + 1} adds to ${what} inside a nested loop, whose trips the call does not count`,
      };
    let records = `_${p.name}_records`;
    while (taken.has(records)) records = `_${records}`;
    taken.add(records);
    const keyT: ShaderType = { kind: 'scalar', scalar: t.key };
    let elem: ShaderType = keyT;
    if (t.value !== undefined) {
      let name = `${f.name}_${p.name}_Entry`;
      while (taken.has(name)) name = `_${name}`;
      taken.add(name);
      structs.push({
        name,
        fields: [
          { name: 'k', type: keyT },
          { name: 'v', type: t.value },
        ],
      });
      elem = { kind: 'struct', name };
    }
    params.push({ name: records, type: { kind: 'array', elem }, mode: 'inout' });
    collections.push({ param: p.name, records, loop: j, perIteration });
  }
  const byParam = new Map(collections.map((c) => [c.param, c]));
  const recordOf = (x: Expr & { op: 'call' }): Expr | undefined => {
    const target = x.args[0];
    const c = target?.op === 'param' ? byParam.get(target.name) : undefined;
    if (c === undefined) return undefined;
    const p = params.find((q) => q.name === c.records)!;
    const arr: Expr = { op: 'param', type: p.type, name: c.records };
    const elem = (p.type as { elem: ShaderType }).elem;
    const value: Expr =
      x.fn === 'collectionAdd'
        ? x.args[1]!
        : { op: 'construct', type: elem, args: [x.args[1]!, x.args[2]!] };
    return { op: 'call', type: u32T, fn: 'push', args: [arr, value] };
  };
  const lookupOf = (y: Expr & { op: 'call' }): Expr | undefined => {
    const target = y.args[0];
    const l = target?.op === 'param' ? finders.get(target.name) : undefined;
    if (l === undefined) return undefined;
    const keysT: ShaderType = { kind: 'array', elem: u32T };
    const keysRef: Expr = { op: 'param', type: keysT, name: l.keys };
    const lit = (n: number): Expr => ({ op: 'lit', type: u32T, value: n });
    if (y.fn === 'collectionSize') return { op: 'index', type: u32T, base: keysRef, idx: lit(0) };
    const at: Expr = {
      op: 'call',
      type: u32T,
      fn: l.find.name,
      args: [y.args[1]!],
      declRef: l.find,
    };
    if (y.fn === 'collectionHas')
      return {
        op: 'compare',
        type: { kind: 'scalar', scalar: 'bool' },
        cop: '!=',
        a: at,
        b: lit(NOT_FOUND),
      };
    const valuesT: ShaderType = { kind: 'array', elem: l.value! };
    return {
      op: 'index',
      type: l.value!,
      base: { op: 'param', type: valuesT, name: l.values! },
      idx: at,
    };
  };
  const rewrite = (e: Expr): Expr => {
    const y = mapChildren(e, rewrite);
    if (y.op === 'call' && (y.fn === 'collectionAdd' || y.fn === 'collectionSet'))
      return recordOf(y) ?? y;
    if (
      y.op === 'call' &&
      (y.fn === 'collectionHas' || y.fn === 'collectionGet' || y.fn === 'collectionSize')
    )
      return lookupOf(y) ?? y;
    return y;
  };
  const stmt = (st: Stmt): Stmt => mapStmtExpr(st, rewrite, stmt);
  const lowered: FuncDecl = {
    ...f,
    params: [...f.params.filter((p) => p.type.kind !== 'collection'), ...params],
    body: f.body.map((st) => (st.s === 'for' ? stmt(st) : st)),
  };
  const m2: ModuleDecl = {
    ...m,
    structs: [...m.structs, ...structs],
    funcs: [...helpers, ...m.funcs.map((x) => (x === f ? lowered : x))],
  };
  const proof2 = proveKernels(m2).find((x) => x.fn === f.name);
  if (proof2 === undefined) return { noGpu: 'its records were not proved' };
  if (proof2.loops.some((l) => !l.ok)) return { noGpu: 'a loop of it runs on the CPU (TS8070)' };
  const plan = lowerKernel(lowered, m2, proof2);
  if ('noGpu' in plan) return plan;
  const own = (fn: FuncDecl): FuncDecl => ({
    ...fn,
    params: [...f.params, ...fn.params.slice(lowered.params.length)],
  });
  return {
    ...plan,
    ranges: plan.ranges.map(own),
    ...(collections.length > 0 ? { collections } : {}),
    ...(lookups.length > 0 ? { lookups } : {}),
  };
}

const NOT_FOUND = 0xffffffff;

function orderWordOf(k: Expr, key: 'u32' | 'i32' | 'f32'): Expr {
  if (key === 'u32') return k;
  if (key === 'i32') return { op: 'call', type: u32T, fn: 'u32', args: [k] };
  const boolT: ShaderType = { kind: 'scalar', scalar: 'bool' };
  const f32: ShaderType = { kind: 'scalar', scalar: 'f32' };
  const bits: Expr = { op: 'call', type: u32T, fn: 'bitcastU32', args: [k] };
  const zero: Expr = {
    op: 'compare',
    type: boolT,
    cop: '==',
    a: k,
    b: { op: 'lit', type: f32, value: 0 },
  };
  const nan: Expr = { op: 'compare', type: boolT, cop: '!=', a: k, b: k };
  const lit = (n: number): Expr => ({ op: 'lit', type: u32T, value: n });
  return {
    op: 'select',
    type: u32T,
    cond: nan,
    ifTrue: lit(0x7fc00000),
    ifFalse: { op: 'select', type: u32T, cond: zero, ifTrue: lit(0), ifFalse: bits },
  };
}

function findFunction(name: string, keys: string, key: 'u32' | 'i32' | 'f32'): FuncDecl {
  const keyT: ShaderType = { kind: 'scalar', scalar: key };
  const boolT: ShaderType = { kind: 'scalar', scalar: 'bool' };
  const lit = (n: number): Expr => ({ op: 'lit', type: u32T, value: n });
  const ref = (n: string): Expr => ({ op: 'varref', type: u32T, name: n });
  const word = (at: Expr): Expr => ({
    op: 'index',
    type: u32T,
    base: { op: 'varref', type: { kind: 'array', elem: u32T }, name: keys },
    idx: at,
  });
  const add = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: u32T, bop: '+', a, b });
  const cmp = (cop: '<' | '>=' | '==', a: Expr, b: Expr): Expr => ({
    op: 'compare',
    type: boolT,
    cop,
    a,
    b,
  });
  return {
    name,
    params: [{ name: 'k', type: keyT }],
    ret: u32T,
    body: [
      { s: 'let', name: '_w', expr: orderWordOf({ op: 'param', type: keyT, name: 'k' }, key) },
      { s: 'let', name: '_n', expr: word(lit(0)) },
      { s: 'var', name: '_lo', type: u32T, init: lit(0) },
      { s: 'var', name: '_hi', type: u32T, init: ref('_n') },
      {
        s: 'for',
        init: { s: 'var', name: '_s', type: u32T, init: lit(0) },
        cond: cmp('<', ref('_s'), lit(32)),
        update: { s: 'assign', target: ref('_s'), expr: add(ref('_s'), lit(1)) },
        body: [
          { s: 'if', arms: [{ cond: cmp('>=', ref('_lo'), ref('_hi')), body: [{ s: 'break' }] }] },
          {
            s: 'let',
            name: '_mid',
            expr: add(ref('_lo'), {
              op: 'binop',
              type: u32T,
              bop: '/',
              a: { op: 'binop', type: u32T, bop: '-', a: ref('_hi'), b: ref('_lo') },
              b: lit(2),
            }),
          },
          {
            s: 'if',
            arms: [
              {
                cond: cmp('<', word(add(ref('_mid'), lit(1))), ref('_w')),
                body: [{ s: 'assign', target: ref('_lo'), expr: add(ref('_mid'), lit(1)) }],
              },
            ],
            elseBody: [{ s: 'assign', target: ref('_hi'), expr: ref('_mid') }],
          },
        ],
      },
      {
        s: 'if',
        arms: [
          {
            cond: {
              op: 'logical',
              type: boolT,
              lop: '&&',
              a: cmp('<', ref('_lo'), ref('_n')),
              b: cmp('==', word(add(ref('_lo'), lit(1))), ref('_w')),
            },
            body: [{ s: 'return', expr: ref('_lo') }],
          },
        ],
      },
      { s: 'return', expr: lit(NOT_FOUND) },
    ],
  };
}
