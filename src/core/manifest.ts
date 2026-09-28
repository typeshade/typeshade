// ═══ The compiled program's manifest (Rules 6.8 and 11.10, change 0025) ═══
//
// One plain JSON object that holds everything a host needs to run a compiled program: the
// shader text, each binding with its resource and byte layout, each entry with the bindings it
// reaches, the overrides, the features, the recorded console variant and the WebGL2 conventions.
// `packModule()` returns it, the plugin's generated module exports it as its default export, and
// the program runtime loads it.
//
// It is built from the IR alone and imports no TypeScript, so every producer computes the same
// manifest, the load-time emitter included (change 0025, section 5). The byte layouts are the
// ones the emitted WGSL assumes, the same `reflect()` reports (Rule 6.8).

import type { BindingDecl, FuncDecl, ModuleDecl, StructDecl } from './ir/nodes.js';
import { typeKey, type ShaderType } from './ir/types.js';
import { eachExpr, eachStmtExpr } from './ir/visit.js';
import { sourceSpanOf } from './ir/span.js';
import { fnReads, fnWrites } from './passes/effects.js';
import { emitModule, wgslBackend } from './backends/wgsl.js';
import { emitGlslStages } from './backends/glsl.js';
import { hostFeaturesFor } from './backend.js';
import { reflect, typeLayout, type BindEntry, type EntryIoField } from './reflect.js';
import {
  PACK_SCHEMA,
  packLayout,
  type Pack,
  type PackBinding,
  type PackConsole,
  type PackDataTexture,
  type PackEntry,
  type PackGlDraw,
  type PackIo,
  type PackOptions,
} from './manifest-types.js';
import { consoleBuffer } from './passes/console-buffer.js';
import { toPortable } from './ir/portable.js';
import type { DrawBinding, Layout } from './host-entry.js';
import { vertexLayoutOf, vertexLayoutOfEntry } from './vertex-layout.js';
import { VERSION } from './version.js';

export {
  PACK_SCHEMA,
  layoutFromPack,
  packLayout,
  type Pack,
  type PackBinding,
  type PackConsole,
  type PackDataTexture,
  type PackEntry,
  type PackGlDraw,
  type PackIo,
  type PackLayout,
  type PackLine,
  type PackOptions,
  type PackOverride,
  type PackResource,
} from './manifest-types.js';

// ─── byte layouts ────────────────────────────────────────────────────────────────────────────

const roundUp = (x: number, a: number): number => Math.ceil(x / a) * a;

/** The byte layout of a binding's type (std430 for storage, the uniform rules for uniform), from
 *  `reflect()`'s own `typeLayout`, or why it has none a host can pack. `spell` writes a type in a
 *  reason; the call layer passes the author's spelling. */
export function layoutOf(
  t: ShaderType,
  kind: 'std140' | 'std430',
  structs: ReadonlyMap<string, StructDecl>,
  spell: (t: ShaderType) => string = typeKey,
): Layout | { readonly none: string } {
  switch (t.kind) {
    case 'scalar':
      if (t.scalar === 'bool') return { none: 'a bool is not host-shareable' };
      return { k: 's', t: t.scalar };
    case 'atomic':
      return { k: 's', t: t.elem };
    case 'vec':
      if (t.elem === 'bool') return { none: `a ${spell(t)} is not host-shareable` };
      return { k: 'v', n: t.n, t: t.elem };
    case 'mat': {
      if (t.elem === 'f64') return { none: `a ${spell(t)} has no host value yet` };
      if (kind === 'std140' && t.rows === 2)
        return { none: `a ${spell(t)} in a uniform has no one layout both targets share` };
      return { k: 'm', c: t.cols, r: t.rows, cs: t.rows === 2 ? 8 : 16 };
    }
    case 'array': {
      const e = layoutOf(t.elem, kind, structs, spell);
      if ('none' in e) return e;
      const el = typeLayout(t.elem, kind, structs);
      let st = roundUp(el.size, el.align);
      if (kind === 'std140') st = roundUp(st, 16);
      return { k: 'a', n: t.size ?? null, st, e };
    }
    case 'struct': {
      const decl = structs.get(t.name);
      if (decl === undefined) return { none: `struct ${t.name} is not declared` };
      const f: (readonly [string, number, Layout])[] = [];
      let cursor = 0;
      for (const field of decl.fields) {
        const fl = layoutOf(field.type, kind, structs, spell);
        if ('none' in fl) return { none: `field ${t.name}.${field.name}: ${fl.none}` };
        const { size, align } = typeLayout(field.type, kind, structs);
        cursor = roundUp(cursor, align);
        f.push([field.name, cursor, fl]);
        cursor += size;
      }
      return { k: 'o', f, sz: typeLayout(t, kind, structs).size };
    }
    // An emulated `f64` is a `vec2<f32>` (hi, lo), and `vecN<f64>` a `DF64VecN` struct of a `hi`
    // and a `lo` plane of `vecN<f32>`, whose `lo` sits at the plane's aligned size.
    case 'f64':
      return { k: 's', t: 'f64' };
    case 'vec64':
      return { k: 'v', n: t.n, t: 'f64', lo: t.n === 2 ? 8 : 16 };
    default:
      return { none: `a ${spell(t)} has no host value` };
  }
}

// ─── what a function reaches ─────────────────────────────────────────────────────────────────

/** The functions `f` calls, directly. */
export function calleesOf(f: FuncDecl, declared: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const s of f.body)
    eachStmtExpr(s, (e) =>
      eachExpr(e, (x) => {
        if (x.op === 'call' && declared.has(x.fn)) out.add(x.fn);
      }),
    );
  return out;
}

/** `root` and every function it reaches through calls. */
export function closureOf(
  root: string,
  callees: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const out = new Set<string>([root]);
  const todo = [root];
  while (todo.length > 0) {
    for (const c of callees.get(todo.pop()!) ?? [])
      if (!out.has(c)) {
        out.add(c);
        todo.push(c);
      }
  }
  return out;
}

/** Which sampler bindings each texture binding is sampled with, in the calls `closure` makes. */
export function texturePairs(
  closure: ReadonlySet<string>,
  byName: ReadonlyMap<string, FuncDecl>,
  declared: ReadonlySet<string>,
): Map<string, Set<string>> {
  const pairs = new Map<string, Set<string>>();
  for (const g of closure)
    for (const st of byName.get(g)!.body)
      eachStmtExpr(st, (e) =>
        eachExpr(e, (x) => {
          if (x.op !== 'call' || declared.has(x.fn)) return;
          const [t, s] = x.args;
          if (t?.op !== 'varref' || s?.op !== 'varref' || s.type.kind !== 'sampler') return;
          let set = pairs.get(t.name);
          if (set === undefined) pairs.set(t.name, (set = new Set()));
          set.add(s.name);
        }),
      );
  return pairs;
}

/** What the WebGL2 tier draws a full-screen fragment entry with: its GLSL ES 3.00 fragment
 *  program, the block name of each uniform binding and the sampler of each texture; or why it
 *  cannot. `bindings` are the ones the entry reaches, the `_fp64` guard among them. */
export function glDrawOf(
  m: ModuleDecl,
  f: FuncDecl,
  bindings: readonly DrawBinding[],
  closure: ReadonlySet<string>,
  byName: ReadonlyMap<string, FuncDecl>,
  declaredFns: ReadonlySet<string>,
): PackGlDraw | { none: string } {
  const storage = bindings.find((b) => b.space === 'storage');
  if (storage !== undefined)
    return {
      none: `it reaches the storage binding "${storage.name}", and GLSL ES 3.00 has no storage buffer`,
    };
  let frag: string;
  try {
    frag = emitGlslStages(m, { fragmentEntry: f.name }).fragment;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { none: `the GLSL backend refuses it: ${message.replace(/\.$/, '')}` };
  }
  const blocks: Record<string, string> = {};
  const samplers: Record<string, string | null> = {};
  const declared = new Set<string>();
  for (const b of bindings) {
    if (b.space === 'uniform') {
      const m = new RegExp(`uniform (\\w+) \\{[^}]*\\} ${b.name};`).exec(frag);
      if (m === null) return { none: `its GLSL declares no uniform block for "${b.name}"` };
      blocks[b.name] = m[1]!;
      declared.add(b.name);
    } else if (b.space === 'texture') {
      const has = new RegExp(`uniform (?:\\w+ )*sampler2D ${b.name};`).test(frag);
      // The guard is bound only where the program reads it.
      if (!has && 'guard' in b) continue;
      if (!has) return { none: `its GLSL declares no sampler2D for "${b.name}"` };
      declared.add(b.name);
    }
  }
  // GLSL ES 3.00 fuses a texture with its sampler: each texture takes the one sampler its
  // calls pass it, so the WebGL2 tier can set that sampler's filter and address on it.
  const pairs = texturePairs(closure, byName, declaredFns);
  for (const b of bindings) {
    if (b.space !== 'texture' || ('guard' in b && !declared.has(b.name))) continue;
    const with_ = [...(pairs.get(b.name) ?? [])];
    if (with_.length > 1)
      return {
        none: `it samples "${b.name}" with ${with_.map((n) => `"${n}"`).join(' and ')}, and GLSL ES 3.00 fuses a texture with one sampler`,
      };
    samplers[b.name] = with_[0] ?? null;
  }
  // Every uniform the program declares is one the draw binds.
  for (const u of frag.matchAll(
    /^(?:layout\([^)]*\) )?uniform (?:\w+ )*?(\w+)(?: \{[^}]*\} (\w+))?;/gm,
  )) {
    const n = u[2] ?? u[1]!;
    if (!declared.has(n))
      return { none: `its GLSL declares a uniform "${n}" the draw does not bind` };
  }
  return { fragment: frag, blocks, samplers };
}

// ─── WebGL2's data textures ──────────────────────────────────────────────────────────────────

/** The data texture a read-only storage array becomes in GLSL ES 3.00, as the GLSL writer's
 *  storage emulation lowers it: `array<f32>` one `r32float` lane, `array<vecN<f32>>` its std430
 *  stride in lanes, `array<u32>` and `array<i32>` one typed lane, and an array of structs of
 *  `f32`, `u32` and `vecN<f32>` fields its std430 stride in `r32float` lanes, a `u32` bit-cast. */
export function dataTextureOf(
  b: BindingDecl,
  structs: ReadonlyMap<string, StructDecl>,
): PackDataTexture | undefined {
  if (b.space !== 'storage' || b.access === 'read_write' || b.type.kind !== 'array')
    return undefined;
  const e = b.type.elem;
  if (e.kind === 'scalar') {
    if (e.scalar === 'f32') return { format: 'r32float', lanes: 1 };
    if (e.scalar === 'u32') return { format: 'r32uint', lanes: 1 };
    if (e.scalar === 'i32') return { format: 'r32sint', lanes: 1 };
    return undefined;
  }
  if (e.kind === 'vec' && e.elem === 'f32') return { format: 'r32float', lanes: e.n < 3 ? e.n : 4 };
  if (e.kind === 'struct') {
    const decl = structs.get(e.name);
    if (decl === undefined) return undefined;
    const lane = (t: ShaderType): boolean =>
      (t.kind === 'scalar' && (t.scalar === 'f32' || t.scalar === 'u32')) ||
      (t.kind === 'vec' && t.elem === 'f32');
    if (!decl.fields.every((f) => lane(f.type))) return undefined;
    const { size, align } = typeLayout(e, 'std430', structs);
    return { format: 'r32float', lanes: roundUp(size, align) / 4 };
  }
  return undefined;
}

// ─── the manifest ────────────────────────────────────────────────────────────────────────────

const STAGES = ['vertex', 'fragment', 'compute'] as const;

/** The builtins a full-screen draw fills in for a `@fragment` entry. */
const FRAGMENT_BUILTINS = new Set(['position', 'front_facing']);

function packBindings(m: ModuleDecl): PackBinding[] {
  const structs = new Map(m.structs.map((s) => [s.name, s]));
  const decls = new Map(m.bindings.map((b) => [b.name, b]));
  const out: PackBinding[] = [];
  for (const group of reflect(m).bindGroups)
    for (const e of group.entries) {
      const {
        group: g,
        binding,
        name,
        space,
        access,
        stages,
        owner: _owner,
        glslSpelling: _glsl,
        ...resource
      } = e;
      const decl = decls.get(name);
      const base = {
        name,
        space,
        group: g,
        binding,
        ...(access !== undefined ? { access } : {}),
        type: decl !== undefined ? typeKey(decl.type) : typeOfInjected(e),
        resource,
        stages: STAGES.filter((s) => stages.includes(s)),
      };
      if (decl === undefined) {
        out.push({ ...base, injected: true });
        continue;
      }
      const isBuffer = e.resourceKind === 'uniform-buffer' || e.resourceKind === 'storage-buffer';
      if (!isBuffer) {
        out.push(base);
        continue;
      }
      const rule = space === 'uniform' ? 'std140' : 'std430';
      const l = layoutOf(decl.type, rule, structs);
      const dataTexture = dataTextureOf(decl, structs);
      out.push({
        ...base,
        rule,
        ...('none' in l ? { noLayout: l.none } : { layout: packLayout(l) }),
        ...(dataTexture !== undefined ? { dataTexture } : {}),
      });
    }
  return out;
}

/** The type of a binding the emit adds, which the module does not declare. */
function typeOfInjected(e: BindEntry): string {
  if (e.resourceKind === 'texture') return `texture_2d<${e.textureElem ?? 'f32'}>`;
  if (e.resourceKind === 'storage-buffer') return e.structName ?? 'storage';
  return e.resourceKind;
}

/**
 * Everything a host needs to run a compiled module, in one plain object (Rule 11.10): the
 * manifest, schema {@link PACK_SCHEMA}.
 *
 * It is JSON: no IR nodes, no functions, no class instances. So it survives `JSON.stringify`, a
 * bundler's module, a worker's `postMessage` and an HTTP response unchanged.
 *
 * GLSL is best-effort and its absence is not an error: `glsl`, the vertex and fragment pair, is
 * present when the module has one entry of each stage and the GLSL ES 3.00 writer can spell
 * them, and `gl.draws` says for each full-screen fragment entry how the WebGL2 tier draws it or
 * why it cannot.
 */
export function buildManifest(m: ModuleDecl, options: PackOptions = {}): Pack {
  const wgsl = emitModule(m);
  const structs = new Map(m.structs.map((s) => [s.name, s]));
  const hasVs = m.funcs.some((f) => f.stage === 'vertex');
  const hasFs = m.funcs.some((f) => f.stage === 'fragment');
  let glsl: Pack['glsl'];
  if (hasVs && hasFs) {
    try {
      glsl = emitGlslStages(m);
    } catch {
      glsl = undefined;
    }
  }
  const r = reflect(m);
  const bindings = packBindings(m);
  const byBinding = new Map(bindings.map((b) => [b.name, b]));

  const declared = new Set(m.funcs.map((f) => f.name));
  const byName = new Map(m.funcs.map((f) => [f.name, f]));
  const callees = new Map(m.funcs.map((f) => [f.name, calleesOf(f, declared)]));
  const reads = fnReads(m);
  const writes = fnWrites(m);
  const guard = bindings.find((b) => b.injected && b.name === '_fp64');

  const reached = (
    f: FuncDecl,
  ): { closure: Set<string>; list: { name: string; writes: boolean }[] } => {
    const closure = closureOf(f.name, callees);
    const touched = new Set<string>();
    const written = new Set<string>();
    for (const g of closure) {
      for (const n of reads.get(g) ?? []) touched.add(n);
      for (const n of writes.get(g) ?? []) {
        touched.add(n);
        written.add(n);
      }
    }
    const list = m.bindings
      .filter((b) => touched.has(b.name))
      .map((b) => ({ name: b.name, writes: written.has(b.name) }));
    // The guard is bound for every entry of a module that emulates `f64`, as the call layer
    // binds it: the WGSL declares it once for the whole module.
    if (guard !== undefined) list.push({ name: guard.name, writes: false });
    return { closure, list };
  };

  const draws: Record<string, PackGlDraw | { none: string }> = {};
  const entries: PackEntry[] = [];
  for (const info of r.entries) {
    const f = byName.get(info.name);
    if (f === undefined) continue;
    const { closure, list } = reached(f);
    const io = ioOf(f, structs);
    const span = sourceSpanOf(f);
    const vertex = f.stage === 'vertex' ? vertexLayoutOfEntry(f, m.structs) : undefined;
    entries.push({
      name: info.name,
      stage: info.stage,
      ...(info.workgroupShape !== undefined ? { workgroupSize: info.workgroupShape } : {}),
      inputs: io.inputs,
      outputs: io.outputs,
      bindings: list,
      ...(vertex !== undefined ? { vertex } : {}),
      ...(span !== undefined ? { line: { file: span.file, line: span.line + 1 } } : {}),
    });
    if (f.stage === 'fragment' && f.params.every((p) => FRAGMENT_BUILTINS.has(p.builtin ?? ''))) {
      const drawBindings: DrawBinding[] = list.map((x) => {
        const b = byBinding.get(x.name)!;
        return toDrawBinding(b);
      });
      draws[info.name] = glDrawOf(m, f, drawBindings, closure, byName, declared);
    }
  }

  let recorded: PackConsole | undefined;
  if (options.console === true) {
    const r2 = consoleBuffer(m);
    if (r2.log !== undefined)
      recorded = {
        wgsl: emitModule(r2.module),
        log: r2.log,
        bindings: packBindings(r2.module),
      };
  }

  return {
    schema: PACK_SCHEMA,
    compiler: VERSION,
    wgsl,
    ...(glsl !== undefined ? { glsl } : {}),
    bindings,
    ...(r.vertex !== undefined ? { vertexLayout: vertexLayoutOf(m) } : {}),
    entries,
    structs: m.structs.map((s) => ({
      name: s.name,
      fields: s.fields.map((f) => ({ name: f.name, type: typeKey(f.type) })),
    })),
    overrides: r.overrides.map((o) => ({ name: o.name, type: o.type, default: o.default })),
    features: [...hostFeaturesFor(wgslBackend, r.requiredFeatures)],
    ...(recorded !== undefined ? { console: recorded } : {}),
    ...(options.ir === true ? { ir: toPortable(m, VERSION) } : {}),
    ...(Object.keys(draws).length > 0 ? { gl: { draws } } : {}),
  };
}

/** A manifest binding as the WebGL2 draw reads it. */
function toDrawBinding(b: PackBinding): DrawBinding {
  const at = { name: b.name, group: b.group, binding: b.binding, s: b.type };
  if (b.injected) return { ...at, space: 'texture', guard: true } as DrawBinding;
  if (b.resource.resourceKind === 'texture') return { ...at, space: 'texture' };
  if (b.resource.resourceKind === 'sampler') return { ...at, space: 'sampler' };
  if (b.resource.resourceKind === 'storage-texture') return { ...at, space: 'texture' };
  return {
    ...at,
    space: b.space === 'storage' ? 'storage' : 'uniform',
    writes: false,
    layout: { k: 's', t: 'u32' },
  };
}

/** An entry's stage interface with each field's interpolation, which `reflect()` leaves out. */
function ioOf(
  f: FuncDecl,
  structs: ReadonlyMap<string, StructDecl>,
): { inputs: PackIo[]; outputs: PackIo[] } {
  const r = reflect({ consts: [], structs: [...structs.values()], bindings: [], funcs: [f] });
  const entry = r.entries[0];
  const interp = new Map<string, string>();
  const note = (name: string, mode: string | undefined): void => {
    if (mode !== undefined) interp.set(name, mode);
  };
  for (const p of f.params) {
    note(p.name, p.interpolate);
    if (p.type.kind === 'struct')
      for (const fl of structs.get(p.type.name)?.fields ?? []) note(fl.name, fl.interpolate);
  }
  if (f.ret.kind === 'struct')
    for (const fl of structs.get(f.ret.name)?.fields ?? []) note(fl.name, fl.interpolate);
  const withInterp = (x: EntryIoField): PackIo => {
    const mode = x.location !== undefined ? interp.get(x.name) : undefined;
    return mode !== undefined ? { ...x, interpolate: mode } : x;
  };
  return {
    inputs: (entry?.io.inputs ?? []).map(withInterp),
    outputs: (entry?.io.outputs ?? []).map(withInterp),
  };
}
