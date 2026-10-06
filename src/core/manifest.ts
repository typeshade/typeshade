// ═══ The compiled program's manifest (Rules 6.8 and 11.10, change 0025) ═══
//
// One plain JSON object that holds everything a host needs to run a compiled program: the
// shader text, each binding with its resource (a texture's sample type among it, which follows
// from the calls that read it) and byte layout, each entry with the bindings it reaches, the
// overrides, the features, the recorded console variant and the WebGL2 conventions.
// `packModule()` returns it, the plugin's generated module exports it as its default export, and
// the program runtime loads it. `packModule(m, { emit })` emits the text, the GLSL and the
// bindings under the options it is given, and the manifest records the ones it can (`emit`), so
// the load-time emitter emits the program again under them (change 0028).
//
// It is built from the IR alone and imports no TypeScript, so every producer computes the same
// manifest, the load-time emitter included (change 0025, section 5). The byte layouts are the
// ones the emitted WGSL assumes, the same `reflect()` reports (Rule 6.8).

import {
  stageOf,
  type BindingDecl,
  type FuncDecl,
  type ModuleDecl,
  type StructDecl,
} from './ir/nodes.js';
import { typeKey, type ShaderType } from './ir/types.js';
import { eachExpr, eachStmtExpr } from './ir/visit.js';
import { sourceSpanOf } from './ir/span.js';
import { fnReads, fnWrites } from './passes/effects.js';
import { texturePairs } from './passes/texture-pairs.js';
import { wgslBackend } from './backends/wgsl.js';
import { emitGlslEntries } from './backends/glsl.js';
import { emitModule as emitWith, type EmitOptions, type ParenMode } from './emit.js';
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
  type PackGlCompute,
  type PackGlDraw,
  type PackGlVertex,
  type PackIo,
} from './manifest-types.js';
import { consoleBuffer } from './passes/console-buffer.js';
import { buildGlCompute } from './passes/gl-compute.js';
import type { Fp64Flavor } from './passes/fp64-lower.js';
import type { OptLevel } from './passes/opt/index.js';
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
  type PackGlCompute,
  type PackGlDraw,
  type PackIo,
  type PackLayout,
  type PackLine,
  type PackOverride,
  type PackResource,
} from './manifest-types.js';

/** Everything `packModule()` adds on request. */
export interface PackOptions {
  /** Add the recorded variant, `console`: the WGSL that records the `console.*` calls. */
  readonly console?: boolean;
  /** Add the program as portable IR, `ir`, which the load-time emitter (`typeshade/emit`) emits
   *  again without the front end. About three times the WGSL gzipped, so on request only. */
  readonly ir?: boolean;
  /** Emit the program under other options than the defaults: the WGSL writer's own
   *  ({@link EmitOptions}: `parens`, `fp64Flavor` and `plugins`) and an optimization `level`,
   *  `'O0'`, `'O1'` or `'O2'` (the default; {@link OptLevel} says what each runs). The
   *  manifest's `wgsl`, its recorded variant's `wgsl`, its `glsl` (the WebGL2 tier's programs
   *  included) and its `bindings` are the ones those options emit: `fp64Flavor` changes the
   *  bindings too, since the `'float'` flavor binds the `_fp64` guard and the `'integer'` one
   *  binds none. `parens`, `fp64Flavor` and `plugins` reach the GLSL as they reach the WGSL;
   *  `level` is the WGSL's alone, since the GLSL writer has no level and writes its own
   *  optimized program. The manifest records `level`, `parens` and `fp64Flavor` in its `emit`,
   *  which the load-time emitter emits the program again under. A plugin is a function, which a
   *  manifest cannot record, so `ir: true` with a plugin is a `TypeError`: the load-time emitter
   *  could not emit the program again. A word an option does not take is a `TypeError` too. */
  readonly emit?: EmitOptions & { readonly level?: OptLevel };
}

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

/** What the WebGL2 tier draws a fragment entry with: its GLSL ES 3.00 fragment program, the block
 *  name of each uniform binding, the sampler of each texture, and the read-only storage arrays it
 *  reads as data textures; or why it cannot. `bindings` are the ones the entry reaches, the
 *  `_fp64` guard among them; `dataTextures` the storage arrays the reader uploads as data
 *  textures (the program runtime does, the call layer's full-screen draw does not). `emit` is the options the program is emitted under (change 0028),
 *  the plugins among them: the program is what they write, and the block and sampler names are
 *  read from the same program without them, since a text plugin (`minify`) writes a declaration
 *  this reads by its spacing, and the names a plugin keeps are the ones a host binds by. */
export function glDrawOf(
  m: ModuleDecl,
  f: FuncDecl,
  bindings: readonly DrawBinding[],
  closure: ReadonlySet<string>,
  byName: ReadonlyMap<string, FuncDecl>,
  declaredFns: ReadonlySet<string>,
  emit?: EmitOptions,
  dataTextures?: ReadonlySet<string>,
  sources?: GlslSources,
): PackGlDraw | { none: string } {
  const stage = glStageOf(
    m,
    f,
    'fragment',
    bindings,
    closure,
    byName,
    declaredFns,
    emit,
    dataTextures,
    sources,
  );
  if ('none' in stage) return stage;
  const { source, ...rest } = stage;
  return { fragment: source, ...rest };
}

/** What the WebGL2 tier runs a vertex entry with, as {@link glDrawOf} gives a fragment entry's
 *  (change 0054). */
export function glVertexOf(
  m: ModuleDecl,
  f: FuncDecl,
  bindings: readonly DrawBinding[],
  closure: ReadonlySet<string>,
  byName: ReadonlyMap<string, FuncDecl>,
  declaredFns: ReadonlySet<string>,
  emit: EmitOptions | undefined,
  dataTextures: ReadonlySet<string>,
  sources: GlslSources | undefined,
): PackGlVertex | { none: string } {
  const stage = glStageOf(
    m,
    f,
    'vertex',
    bindings,
    closure,
    byName,
    declaredFns,
    emit,
    dataTextures,
    sources,
  );
  if ('none' in stage) return stage;
  const { source, ...rest } = stage;
  return { vertex: source, ...rest };
}

/** A stage's program as shipped (the emit options' plugins applied) and as read for its names
 *  (without them), or the writer's refusal of either. */
export interface GlslSources {
  readonly shipped: string | Error;
  readonly text: string | Error;
}

/** Entry `f`'s program of its own: what it and its callees reach, emitted alone. A compute entry
 *  of the same module, or a storage array another entry writes, is no part of it, and would make
 *  the GLSL writer refuse the module whole. */
function ownGlsl(
  m: ModuleDecl,
  f: FuncDecl,
  stage: 'vertex' | 'fragment',
  bindings: readonly DrawBinding[],
  closure: ReadonlySet<string>,
  emit: EmitOptions | undefined,
): GlslSources {
  const own = pruned(m, closure, new Set(bindings.map((b) => b.name)));
  const one = (o: EmitOptions | undefined): string | Error =>
    emitGlslEntries(own, [{ stage, name: f.name }], o).programs[0]!;
  const shipped = one(emit);
  return {
    shipped,
    text:
      emit?.plugins !== undefined && emit.plugins.length > 0
        ? one({ ...emit, plugins: undefined })
        : shipped,
  };
}

/** `m` with only the functions of `closure` and the bindings of `reached`, and no workgroup
 *  memory: the module a vertex or fragment program is emitted from. */
function pruned(
  m: ModuleDecl,
  closure: ReadonlySet<string>,
  reached: ReadonlySet<string>,
): ModuleDecl {
  return {
    ...m,
    funcs: m.funcs.filter((g) => closure.has(g.name)),
    bindings: m.bindings.filter((b) => reached.has(b.name)),
    vars: (m.vars ?? []).filter((v) => v.space !== 'workgroup'),
  };
}

/** The module's own vertex and fragment pair (`Pack.glsl`, where `pair` asks for it) and each
 *  vertex and fragment entry's program, from one lowering of the module: a lowering for each
 *  entry cost a third of the manifest. Where the writer refuses the module whole (a compute
 *  entry that writes storage, say), the entries are emitted from the module pruned to what they
 *  reach together, and where it refuses that too, each alone, so the others keep theirs. */
function glslOfEntries(
  m: ModuleDecl,
  jobs: readonly {
    readonly stage: 'vertex' | 'fragment';
    readonly f: FuncDecl;
    readonly closure: ReadonlySet<string>;
    readonly bindings: readonly DrawBinding[];
  }[],
  emit: EmitOptions | undefined,
  pair: boolean,
): {
  readonly glsl?: { vertex: string; fragment: string };
  readonly entries: Map<string, GlslSources>;
} {
  const list = [
    ...jobs.map((j) => ({ stage: j.stage, name: j.f.name })),
    ...(pair ? [{ stage: 'vertex' as const }, { stage: 'fragment' as const }] : []),
  ];
  const plugins = emit?.plugins !== undefined && emit.plugins.length > 0;
  const shipped = emitGlslEntries(m, list, emit);
  const v = shipped.programs[jobs.length];
  const f = shipped.programs[jobs.length + 1];
  const glsl =
    pair && typeof v === 'string' && typeof f === 'string' ? { vertex: v, fragment: f } : undefined;
  const entries = new Map<string, GlslSources>();
  if (jobs.length === 0) return { ...(glsl !== undefined ? { glsl } : {}), entries };
  if (shipped.lowered) {
    const plain = plugins
      ? emitGlslEntries(m, list, { ...emit, plugins: undefined }).programs
      : shipped.programs;
    jobs.forEach((j, i) =>
      entries.set(j.f.name, { shipped: shipped.programs[i]!, text: plain[i]! }),
    );
    return { ...(glsl !== undefined ? { glsl } : {}), entries };
  }
  const closure = new Set(jobs.flatMap((j) => [...j.closure]));
  const reached = new Set(jobs.flatMap((j) => j.bindings.map((b) => b.name)));
  const all = pruned(m, closure, reached);
  const together = emitGlslEntries(all, list.slice(0, jobs.length), emit);
  const plain =
    together.lowered && plugins
      ? emitGlslEntries(all, list.slice(0, jobs.length), { ...emit, plugins: undefined }).programs
      : together.programs;
  jobs.forEach((j, i) =>
    entries.set(
      j.f.name,
      together.lowered
        ? { shipped: together.programs[i]!, text: plain[i]! }
        : ownGlsl(m, j.f, j.stage, j.bindings, j.closure, emit),
    ),
  );
  return { ...(glsl !== undefined ? { glsl } : {}), entries };
}

/** One stage's GLSL ES 3.00 program of entry `f`, and the names a draw binds it by. */
function glStageOf(
  m: ModuleDecl,
  f: FuncDecl,
  stage: 'vertex' | 'fragment',
  bindings: readonly DrawBinding[],
  closure: ReadonlySet<string>,
  byName: ReadonlyMap<string, FuncDecl>,
  declaredFns: ReadonlySet<string>,
  emit: EmitOptions | undefined,
  dataTextures: ReadonlySet<string> | undefined,
  sources: GlslSources | undefined,
):
  | {
      readonly source: string;
      readonly blocks: Record<string, string>;
      readonly samplers: Record<string, string | null>;
      readonly data?: readonly string[];
    }
  | { none: string } {
  // A read-only storage array is a data texture where the reader can upload one (`data`); the
  // call layer's full-screen draw cannot, and a written one has no GLSL ES 3.00 form at all.
  const storage = bindings.find(
    (b) => b.space === 'storage' && !(dataTextures?.has(b.name) ?? false),
  );
  if (storage !== undefined)
    return {
      none: `it reaches the storage binding "${storage.name}", and GLSL ES 3.00 has no storage buffer`,
    };
  const emitted = sources ?? ownGlsl(m, f, stage, bindings, closure, emit);
  const failed = [emitted.shipped, emitted.text].find((v) => v instanceof Error);
  if (failed !== undefined)
    return { none: `the GLSL backend refuses it: ${failed.message.replace(/\.$/, '')}` };
  const shipped = emitted.shipped as string;
  const text = emitted.text as string;
  const blocks: Record<string, string> = {};
  const samplers: Record<string, string | null> = {};
  const data: string[] = [];
  const declared = new Set<string>();
  const sampled = (name: string): boolean =>
    new RegExp(`uniform (?:\\w+ )*[iu]?sampler2D(?:Array)?(?:Shadow)? ${name};`).test(text);
  for (const b of bindings) {
    if (b.space === 'uniform') {
      const u = new RegExp(`uniform (\\w+) \\{[^}]*\\} ${b.name};`).exec(text);
      if (u === null) {
        // A stage that reads no field of the binding declares no block for it.
        if (!new RegExp(`\\b${b.name}\\b`).test(text)) continue;
        return { none: `its GLSL declares no uniform block for "${b.name}"` };
      }
      blocks[b.name] = u[1]!;
      declared.add(b.name);
    } else if (b.space === 'storage') {
      if (!sampled(b.name)) continue;
      data.push(b.name);
      declared.add(b.name);
    } else if (b.space === 'texture') {
      const has = sampled(b.name);
      // The guard is bound only where the program reads it.
      if (!has && 'guard' in b) continue;
      if (!has) return { none: `its GLSL declares no sampler2D for "${b.name}"` };
      declared.add(b.name);
    }
  }
  // GLSL ES 3.00 fuses a texture with its sampler: each texture takes the one sampler its
  // calls pass it, so the WebGL2 tier can set that sampler's filter and address on it.
  const pairs = texturePairs(closure, byName, declaredFns, new Set(m.bindings.map((b) => b.name)));
  for (const b of bindings) {
    if (b.space !== 'texture' || !declared.has(b.name)) continue;
    const with_ = [...(pairs.get(b.name) ?? [])];
    if (with_.length > 1)
      return {
        none: `it samples "${b.name}" with ${with_.map((n) => `"${n}"`).join(' and ')}, and GLSL ES 3.00 fuses a texture with one sampler`,
      };
    samplers[b.name] = with_[0] ?? null;
  }
  // Every uniform the program declares is one the draw binds.
  for (const u of text.matchAll(
    /^(?:layout\([^)]*\) )?uniform (?:\w+ )*?(\w+)(?: \{[^}]*\} (\w+))?;/gm,
  )) {
    const n = u[2] ?? u[1]!;
    if (!declared.has(n))
      return { none: `its GLSL declares a uniform "${n}" the draw does not bind` };
  }
  return { source: shipped, blocks, samplers, ...(data.length > 0 ? { data } : {}) };
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

/** The bindings of `m`, as `reflect()` reports them under the `f64` flavor the program is emitted
 *  with: the `'float'` flavor (the default) binds the `_fp64` guard, and the `'integer'` one does
 *  not (change 0028). */
function packBindings(m: ModuleDecl, fp64Flavor?: Fp64Flavor): PackBinding[] {
  const structs = new Map(m.structs.map((s) => [s.name, s]));
  const decls = new Map(m.bindings.map((b) => [b.name, b]));
  const out: PackBinding[] = [];
  for (const group of reflect(m, { fp64Flavor }).bindGroups)
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

// ─── the emit options (change 0028) ──────────────────────────────────────────────────────────

/** Each word an emit option takes, from the type the writers take it as: the record is
 *  exhaustive over `T`, so a word added to the type and not here stops the build. */
const wordsOf = <T extends string>(record: Record<T, true>): readonly T[] =>
  Object.keys(record) as T[];
const LEVELS = wordsOf<OptLevel>({ O0: true, O1: true, O2: true });
const PARENS = wordsOf<ParenMode>({ full: true, minimal: true });
const FLAVORS = wordsOf<Fp64Flavor>({ float: true, integer: true });

/** What a build emits under: the options both writers take, the level the WGSL's optimizer runs
 *  at, and what the manifest records of them. */
interface EmitPlan {
  /** `parens`, `fp64Flavor` and `plugins`, as `emitModule()` and `emitGlslStages()` take them. */
  readonly options: EmitOptions | undefined;
  /** The WGSL's optimizer tier. The GLSL writer has none. */
  readonly level: OptLevel | undefined;
  /** `Pack.emit`: the options a manifest can record, which a plugin is not. `manifest-types.ts`
   *  spells its words out, so that the program runtime's closure reaches no emitter, and this
   *  record, made of the writers' own types, and `repack`, which hands it back to them, hold the
   *  two to each other: a word one takes and the other lacks stops the build. */
  readonly record: Pack['emit'];
}

/** The word `given` for `emit.<name>`, or undefined when there is none. The writers read a word
 *  they do not know as another (an unknown level runs the full optimizer, an unknown `parens` is
 *  `'minimal'`, an unknown flavor is `'float'`), and a manifest would record it, so it is refused. */
function wordOf<T extends string>(
  name: string,
  given: unknown,
  words: readonly T[],
): T | undefined {
  if (given === undefined) return undefined;
  if ((words as readonly unknown[]).includes(given)) return given as T;
  const list = `${words
    .slice(0, -1)
    .map((w) => `"${w}"`)
    .join(', ')} or "${words[words.length - 1]!}"`;
  const got =
    typeof given === 'string'
      ? JSON.stringify(given)
      : given === null
        ? 'null'
        : `a ${typeof given}`;
  throw new TypeError(`packModule(): emit.${name} takes ${list}; got ${got}.`);
}

/** The options of `packModule(m, { emit })`, checked, and what the manifest records of them. */
function emitPlanOf(options: PackOptions): EmitPlan {
  const emit = options.emit;
  if (emit === undefined) return { options: undefined, level: undefined, record: undefined };
  if (typeof emit !== 'object' || emit === null)
    throw new TypeError(
      'packModule(): emit takes an object of options, { level, parens, fp64Flavor, plugins }.',
    );
  const level = wordOf('level', emit.level, LEVELS);
  const parens = wordOf('parens', emit.parens, PARENS);
  const fp64Flavor = wordOf('fp64Flavor', emit.fp64Flavor, FLAVORS);
  const plugins = emit.plugins;
  if (plugins !== undefined && !Array.isArray(plugins))
    throw new TypeError(
      'packModule(): emit.plugins takes a list of plugins, such as the one obfuscate() returns.',
    );
  // A plugin is a function, which a manifest cannot record, so the program packed under one cannot
  // be emitted again from the IR it carries.
  if (options.ir === true && plugins !== undefined && plugins.length > 0)
    throw new TypeError(
      'packModule(): { ir: true } cannot go with emit.plugins: a plugin is a function, which a manifest cannot record, so the load-time emitter could not emit the program again under it. Pack the program without ir, or without the plugins.',
    );
  const record = {
    ...(level !== undefined ? { level } : {}),
    ...(parens !== undefined ? { parens } : {}),
    ...(fp64Flavor !== undefined ? { fp64Flavor } : {}),
  };
  return {
    options: {
      ...(parens !== undefined ? { parens } : {}),
      ...(fp64Flavor !== undefined ? { fp64Flavor } : {}),
      ...(plugins !== undefined ? { plugins } : {}),
    },
    level,
    record: Object.keys(record).length > 0 ? record : undefined,
  };
}

/** `m` as WGSL under the plan's options and level. With none it is `emitModule(m)`. */
const emitWgsl = (m: ModuleDecl, plan: EmitPlan): string =>
  emitWith(m, wgslBackend, plan.options, plan.level);

/**
 * Everything a host needs to run a compiled module, in one plain object (Rule 11.10): the
 * manifest, schema {@link PACK_SCHEMA}.
 *
 * It is JSON: no IR nodes, no functions, no class instances. So it survives `JSON.stringify`, a
 * bundler's module, a worker's `postMessage` and an HTTP response unchanged.
 *
 * GLSL is best-effort and its absence is not an error: `glsl`, the vertex and fragment pair, is
 * present when the module has one entry of each stage and the GLSL ES 3.00 writer can spell
 * them; and `gl` gives the WebGL2 tier each entry's program of its own (change 0054): a vertex
 * entry's (`gl.vertices`), a fragment entry's (`gl.draws`), and a compute entry's pass program
 * (`gl.computes`), or why it has none.
 *
 * `options.emit` emits the WGSL (the recorded variant's too), the GLSL (the WebGL2 tier's draws
 * too) and the bindings under other options than the defaults (change 0028): the WGSL writer's
 * `parens`, `fp64Flavor` and `plugins`, and an optimization `level` for the WGSL. The manifest
 * records `level`, `parens` and `fp64Flavor` in `emit`, and the load-time emitter emits the
 * program again under them. A plugin is a function, which a manifest cannot record, so `ir` with
 * `plugins` is a `TypeError`.
 */
export function buildManifest(m: ModuleDecl, options: PackOptions = {}): Pack {
  const plan = emitPlanOf(options);
  const fp64Flavor = plan.options?.fp64Flavor;
  const wgsl = emitWgsl(m, plan);
  const structs = new Map(m.structs.map((s) => [s.name, s]));
  // Through `stageOf`, as every stage decision is: a `fn()` handle carries `attrs`, not `stage`.
  const hasVs = m.funcs.some((f) => stageOf(f) === 'vertex');
  const hasFs = m.funcs.some((f) => stageOf(f) === 'fragment');
  const r = reflect(m, { fp64Flavor });
  const bindings = packBindings(m, fp64Flavor);
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
  const computes: Record<string, PackGlCompute | { none: string }> = {};
  const vertices: Record<string, PackGlVertex | { none: string }> = {};
  const renderJobs: {
    stage: 'vertex' | 'fragment';
    f: FuncDecl;
    closure: Set<string>;
    list: { name: string; writes: boolean }[];
    bindings: DrawBinding[];
  }[] = [];
  const entries: PackEntry[] = [];
  for (const info of r.entries) {
    const f = byName.get(info.name);
    if (f === undefined) continue;
    const { closure, list } = reached(f);
    const io = ioOf(f, structs);
    const span = sourceSpanOf(f);
    const vertex = info.stage === 'vertex' ? vertexLayoutOfEntry(f, m.structs) : undefined;
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
    if (info.stage === 'fragment' || info.stage === 'vertex')
      renderJobs.push({
        stage: info.stage,
        f,
        closure,
        list,
        bindings: list.map((x) => toDrawBinding(byBinding.get(x.name)!)),
      });
    if (info.stage === 'compute')
      computes[info.name] = glComputeOf(
        m,
        f,
        list.map((x) => toDrawBinding(byBinding.get(x.name)!)),
      );
  }

  // Each vertex and fragment entry's GLSL ES 3.00 program, which a render pipeline of the WebGL2
  // tier links in pairs, and a full-screen draw draws a fragment entry with (change 0054).
  const emitted = glslOfEntries(m, renderJobs, plan.options, hasVs && hasFs);
  const glsl: Pack['glsl'] = emitted.glsl;
  const glsls = emitted.entries;
  for (const j of renderJobs) {
    const data = new Set(
      j.list
        .filter((x) => !x.writes && byBinding.get(x.name)?.dataTexture !== undefined)
        .map((x) => x.name),
    );
    const sources = glsls.get(j.f.name);
    if (j.stage === 'fragment')
      draws[j.f.name] = glDrawOf(
        m,
        j.f,
        j.bindings,
        j.closure,
        byName,
        declared,
        plan.options,
        data,
        sources,
      );
    else
      vertices[j.f.name] = glVertexOf(
        m,
        j.f,
        j.bindings,
        j.closure,
        byName,
        declared,
        plan.options,
        data,
        sources,
      );
  }

  let recorded: PackConsole | undefined;
  if (options.console === true) {
    const r2 = consoleBuffer(m);
    if (r2.log !== undefined)
      recorded = {
        wgsl: emitWgsl(r2.module, plan),
        log: r2.log,
        bindings: packBindings(r2.module, fp64Flavor),
      };
  }

  return {
    schema: PACK_SCHEMA,
    compiler: VERSION,
    ...(plan.record !== undefined ? { emit: plan.record } : {}),
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
    ...(Object.keys(draws).length > 0 ||
    Object.keys(vertices).length > 0 ||
    Object.keys(computes).length > 0
      ? {
          gl: {
            ...(Object.keys(vertices).length > 0 ? { vertices } : {}),
            ...(Object.keys(draws).length > 0 ? { draws } : {}),
            ...(Object.keys(computes).length > 0 ? { computes } : {}),
          },
        }
      : {}),
    // The IR last, as `repack` adds it after the manifest it emits again.
    ...(options.ir === true ? { ir: toPortable(m, VERSION) } : {}),
  };
}

/** A `@compute` entry's pass program for the WebGL2 tier (change 0054), or why it has none, in
 *  the call layer's words (`host-face.ts`, `glTier`). The program runtime runs it and never
 *  builds one (Rule 11.11). */
function glComputeOf(
  m: ModuleDecl,
  f: FuncDecl,
  bindings: readonly DrawBinding[],
): PackGlCompute | { none: string } {
  const handle = bindings.find((b) => b.space !== 'uniform' && b.space !== 'storage');
  if (handle !== undefined)
    return {
      none: `it reaches the ${handle.s} "${handle.name}", which the WebGL2 tier does not bind yet`,
    };
  try {
    return buildGlCompute(m, f.name);
  } catch (e) {
    return { none: e instanceof Error ? e.message : String(e) };
  }
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
