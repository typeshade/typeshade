import {
  TRIP_WORDS,
  deviceGap,
  rangeEntryFor,
  laneSkips,
  entryFor,
  reductionEntries,
  subgroupFoldable,
  scattersAtMostOnce,
  combineInto,
  identityOf,
  notReducible,
  firstName,
  hasOwnContinue,
  readsOutsideAtomics,
  stillPlain,
  isTextureParam,
  readsArraysByLengthOnly,
  notUniform,
  notStorage,
} from './kernel-lower/reductions.js';
export { TRIP_WORDS } from './kernel-lower/reductions.js';
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
import { mapChildren } from '../ir/visit.js';
import { KERNEL_TREE, KERNEL_WORKGROUP } from '../kernel-tree.js';
import { kernelWorkgroups, u } from '../kernel-workgroup.js';
import { fnReads, fnWrites } from './effects.js';
import {
  ATOMIC_OF,
  atomicArray,
  boolT,
  declaredNames,
  isRuntimeArray,
  mapStmt,
  rangeOf,
  spellArrayBindings,
  typeKey,
  type ForStmt,
  type KernelLoopPlan,
  type KernelPlan,
  type LoopCtx,
  type LowerOptions,
  type PushWord,
} from './kernel-lower-ir.js';
import { computeEntry } from './kernel-push/entry.js';
import { pushEntries } from './kernel-push/push-entries.js';
import { deviceRangeLoops, lastLoopOf, readsElements, storeAfterLoops } from './kernel-stores.js';
import { mapExpr } from './opt/ir-transform.js';
import { type KernelProof } from './parallel-loop.js';
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
} from './kernel-lower/push-counts.js';
import { lowerCollections } from './kernel-lower/collections.js';

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
  if (collection !== undefined) return lowerCollections(f, m, lowerKernel);
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
