import { withoutKernels } from './ir/kernels.js';

import { emittedName, inheritSpellings, spellingsOf } from './spelling-plan.js';
import {
  stageOf,
  type BindingDecl,
  type FuncDecl,
  type ModuleDecl,
  type StructDecl,
} from './ir/nodes.js';
import { typeKey, type ShaderType } from './ir/types.js';
import { sourceSpanOf } from './ir/span.js';
import { calleesOf, closureOf, reachOf } from './manifest/reach.js';
export { calleesOf, closureOf };
import { texturePairs } from './passes/texture-pairs.js';
import { wgslBackend } from './backends/wgsl.js';
import { emitGlslEntries } from './backends/glsl.js';
import { emitModuleLowered, loweredWithPlugins, type EmitOptions, type ParenMode } from './emit.js';
import { hostFeaturesFor } from './backend.js';
import {
  reflect,
  typeLayout,
  type BindEntry,
  type BindGroup,
  type EntryIoField,
} from './reflect.js';
import {
  PACK_SCHEMA,
  packLayout,
  type Pack,
  type PackBinding,
  type PackDataTexture,
  type PackEntry,
  type PackGlCompute,
  type PackGlDraw,
  type PackGlVertex,
  type PackIo,
} from './manifest-types.js';
import { consoleBuffer, hasConsoleCall } from './passes/console-buffer.js';
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
  /** Retain reachable console calls as an optional variant. `true` enables it by default;
   *  `false` leaves it off; `'never'` omits it. */
  readonly console?: boolean | 'never';
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

const roundUp = (x: number, a: number): number => Math.ceil(x / a) * a;

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
    case 'f64':
      return { k: 's', t: 'f64' };
    case 'vec64':
      return { k: 'v', n: t.n, t: 'f64', lo: t.n === 2 ? 8 : 16 };
    default:
      return { none: `a ${spell(t)} has no host value` };
  }
}

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
  texturesMayDrop = false,
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
    texturesMayDrop,
  );
  if ('none' in stage) return stage;
  const { source, ...rest } = stage;
  return { fragment: source, ...rest };
}

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
  texturesMayDrop = false,
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
    texturesMayDrop,
  );
  if ('none' in stage) return stage;
  const { source, ...rest } = stage;
  return { vertex: source, ...rest };
}

export interface GlslSources {
  readonly shipped: string | Error;
  readonly text: string | Error;
}

function ownGlsl(
  m: ModuleDecl,
  f: FuncDecl,
  stage: 'vertex' | 'fragment',
  closure: ReadonlySet<string>,
  emit: EmitOptions | undefined,
): GlslSources {
  const own = pruned(m, closure);
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

function pruned(m: ModuleDecl, closure: ReadonlySet<string>): ModuleDecl {
  const reach = reachOf(m);
  const reached = new Set([...closure].flatMap((g) => [...reach(g).touched]));
  return inheritSpellings(
    {
      ...m,
      funcs: m.funcs.filter((g) => closure.has(g.name)),
      bindings: m.bindings.filter((b) => reached.has(b.name)),
      vars: (m.vars ?? []).filter((v) => v.space !== 'workgroup'),
    },
    m,
  );
}

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
  const all = pruned(m, closure);
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
        : ownGlsl(m, j.f, j.stage, j.closure, emit),
    ),
  );
  return { ...(glsl !== undefined ? { glsl } : {}), entries };
}

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
  texturesMayDrop: boolean,
):
  | {
      readonly source: string;
      readonly blocks: Record<string, string>;
      readonly samplers: Record<string, string | null>;
      readonly data?: readonly string[];
    }
  | { none: string } {
  const storage = bindings.find(
    (b) => b.space === 'storage' && !(dataTextures?.has(b.name) ?? false),
  );
  if (storage !== undefined)
    return {
      none: `it reaches the storage binding "${storage.name}", and the WebGL2 tier does not support a storage binding in a draw yet`,
    };
  const emitted = sources ?? ownGlsl(m, f, stage, closure, emit);
  const failed = [emitted.shipped, emitted.text].find((v) => v instanceof Error);
  if (failed !== undefined)
    return { none: `the GLSL backend refuses it: ${failed.message.replace(/\.$/, '')}` };
  const shipped = emitted.shipped as string;
  const text = emitted.text as string;
  const blocks: Record<string, string> = {};
  const samplers: Record<string, string | null> = {};
  const data: string[] = [];
  const glslBindings = spellingsOf(m).glsl.bindings;
  const gl = (n: string): string => glslBindings.get(n) ?? n;
  const declared = new Set<string>();
  const sampled = (name: string): boolean =>
    new RegExp(`uniform (?:\\w+ )*[iu]?sampler2D(?:Array)?(?:Shadow)? ${name};`).test(text);
  for (const b of bindings) {
    if (b.space === 'uniform') {
      const g = gl(b.name);
      const u = new RegExp(`uniform (\\w+) \\{[^}]*\\} ${g};`).exec(text);
      if (u === null) {
        if (!new RegExp(`\\b${g}\\b`).test(text)) continue;
        return { none: `its GLSL declares no uniform block for "${b.name}"` };
      }
      blocks[b.name] = u[1]!;
      declared.add(g);
    } else if (b.space === 'storage') {
      if (!sampled(gl(b.name))) continue;
      data.push(b.name);
      declared.add(gl(b.name));
    } else if (b.space === 'texture') {
      const g = gl(b.name);
      const has = sampled(g);
      if (!has && ('guard' in b || (texturesMayDrop && !new RegExp(`\\b${g}\\b`).test(text))))
        continue;
      if (!has) return { none: `its GLSL declares no sampler2D for "${b.name}"` };
      declared.add(gl(b.name));
    }
  }
  const pairs = texturePairs(
    closure,
    byName,
    declaredFns,
    new Set(m.bindings.map((b) => b.name)),
    true,
  );
  for (const b of bindings) {
    if (b.space !== 'texture' || !declared.has(gl(b.name))) continue;
    const with_ = [...(pairs.get(b.name) ?? [])];
    if (with_.length > 1)
      return {
        none: `it samples "${b.name}" with ${with_.map((n) => `"${n}"`).join(' and ')}, and a texture with more than one sampler is not supported yet on the WebGL2 tier`,
      };
    samplers[b.name] = with_[0] ?? null;
  }
  for (const u of text.matchAll(
    /^(?:layout\([^)]*\) )?uniform (?:\w+ )*?(\w+)(?: \{[^}]*\} (\w+))?;/gm,
  )) {
    const n = u[2] ?? u[1]!;
    if (!declared.has(n))
      return { none: `its GLSL declares a uniform "${n}" the draw does not bind` };
  }
  return { source: shipped, blocks, samplers, ...(data.length > 0 ? { data } : {}) };
}

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

const STAGES = ['vertex', 'fragment', 'compute'] as const;

function packBindings(m: ModuleDecl, bindGroups: readonly BindGroup[]): PackBinding[] {
  const structs = new Map(m.structs.map((s) => [s.name, s]));
  const decls = new Map(m.bindings.map((b) => [b.name, b]));
  const out: PackBinding[] = [];
  for (const group of bindGroups)
    for (const e of group.entries) {
      const {
        group: g,
        binding,
        name,
        emitted,
        emittedGlsl,
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
        emitted,
        ...(emittedGlsl !== undefined ? { emittedGlsl } : {}),
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

function typeOfInjected(e: BindEntry): string {
  if (e.resourceKind === 'texture') return `texture_2d<${e.textureElem ?? 'f32'}>`;
  if (e.resourceKind === 'storage-buffer') return e.structName ?? 'storage';
  return e.resourceKind;
}

const wordsOf = <T extends string>(record: Record<T, true>): readonly T[] =>
  Object.keys(record) as T[];
const LEVELS = wordsOf<OptLevel>({ O0: true, O1: true, O2: true });
const PARENS = wordsOf<ParenMode>({ full: true, minimal: true });
const FLAVORS = wordsOf<Fp64Flavor>({ float: true, integer: true });

interface EmitPlan {
  readonly options: EmitOptions | undefined;
  readonly level: OptLevel | undefined;
  readonly record: Pack['emit'];
}

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

const emitWgsl = (m: ModuleDecl, plan: EmitPlan): string => emittedWgsl(m, plan).code;

const emittedWgsl = (
  m: ModuleDecl,
  plan: EmitPlan,
): { readonly code: string; readonly lowered: ModuleDecl } =>
  emitModuleLowered(m, wgslBackend, plan.options, plan.level);

export function buildManifest(
  m: ModuleDecl,
  options: PackOptions = {},
  defaultWgsl?: string,
  defaultLowered?: ModuleDecl,
): Pack {
  const spelled = spellingsOf(inheritSpellings(withoutKernels(m), m));
  const plan = emitPlanOf(options);
  const fp64Flavor = plan.options?.fp64Flavor;
  const own =
    options.emit === undefined && defaultWgsl !== undefined
      ? {
          code: defaultWgsl,
          lowered: defaultLowered ?? loweredWithPlugins(m, wgslBackend, plan.options, plan.level),
        }
      : emittedWgsl(m, plan);
  const wgsl = own.code;
  const emittedReach = reachOf(own.lowered);
  const structs = new Map(m.structs.map((s) => [s.name, s]));
  const hasVs = m.funcs.some((f) => stageOf(f) === 'vertex');
  const hasFs = m.funcs.some((f) => stageOf(f) === 'fragment');
  const r = reflect(m, { fp64Flavor });
  const bindings = packBindings(m, r.bindGroups);
  const byBinding = new Map(bindings.map((b) => [b.name, b]));

  const declared = new Set(m.funcs.map((f) => f.name));
  const byName = new Map(m.funcs.map((f) => [f.name, f]));
  const callees = new Map(m.funcs.map((f) => [f.name, calleesOf(f, declared)]));
  const guard = bindings.find((b) => b.injected && b.name === '_fp64');

  const reached = (
    f: FuncDecl,
  ): { closure: Set<string>; list: { name: string; writes: boolean }[] } => {
    const closure = closureOf(f.name, callees);
    const { touched, written } = emittedReach(f.name);
    const list = m.bindings
      .filter((b) => touched.has(b.name))
      .map((b) => ({ name: b.name, writes: written.has(b.name) }));
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
      emitted: info.emitted,
      stage: info.stage,
      ...(info.workgroupShape !== undefined ? { workgroupSize: info.workgroupShape } : {}),
      ...(info.workgroupSizeOverrides !== undefined
        ? {
            workgroupSizeOverrides: [
              info.workgroupSizeOverrides[0] ?? null,
              info.workgroupSizeOverrides[1] ?? null,
              info.workgroupSizeOverrides[2] ?? null,
            ],
          }
        : {}),
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
    if (info.stage === 'compute') computes[info.name] = glComputeOf(m, f);
  }

  const emitted = glslOfEntries(m, renderJobs, plan.options, hasVs && hasFs);
  const glsl: Pack['glsl'] = emitted.glsl;
  const glsls = emitted.entries;
  const texturesMayDrop = plan.level !== undefined && plan.level !== 'O2';
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
        texturesMayDrop,
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
        texturesMayDrop,
      );
  }

  let recorded: Partial<Pack> = {};
  const r2 = options.console !== 'never' && hasConsoleCall(m) ? consoleBuffer(m) : undefined;
  if (r2?.log !== undefined) {
    inheritSpellings(r2.module, m);
    const console = {
      wgsl: emitWgsl(r2.module, plan),
      log: r2.log,
      bindings: packBindings(r2.module, reflect(r2.module, { fp64Flavor }).bindGroups),
    };
    recorded = options.console === true ? { console } : { variants: { console } };
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
      emitted: emittedName(spelled.wgsl.structs, s.name),
      fields: s.fields.map((f) => ({
        name: f.name,
        emitted: emittedName(spelled.wgsl.members, f.name),
        type: typeKey(f.type),
      })),
    })),
    overrides: r.overrides.map((o) => ({
      name: o.name,
      emitted: o.emitted,
      ...(o.emittedGlsl !== undefined ? { emittedGlsl: o.emittedGlsl } : {}),
      type: o.type,
      default: o.default,
    })),
    features: [...hostFeaturesFor(wgslBackend, r.requiredFeatures)],
    ...recorded,
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
    ...(options.ir === true ? { ir: toPortable(m, VERSION) } : {}),
  };
}

function glComputeOf(m: ModuleDecl, f: FuncDecl): PackGlCompute | { none: string } {
  try {
    return buildGlCompute(m, f.name);
  } catch (e) {
    return { none: e instanceof Error ? e.message : String(e) };
  }
}

function toDrawBinding(b: PackBinding): DrawBinding {
  // Why: a host without a `glsl` looks the uniform up by its authored name (`glsl ?? name`), so
  // `glsl` is present whenever the GLSL name differs from that name, even when it equals the WGSL
  // one (Proposal 0070, C8, deviation 4).
  const glsl = b.emittedGlsl ?? b.emitted;
  const at = {
    name: b.name,
    group: b.group,
    binding: b.binding,
    s: b.type,
    ...(glsl !== b.name ? { glsl } : {}),
  };
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
