// Why: the IR does not keep the source's export list. A generic function exists only as its
// instances and a function that takes a function only per use, a class method is `P_len` and an
// enum is the constants `Mode_A` and `Mode_B`. So the face is read off the source's `export`s and
// the lowering's symbol table, and the IR is consulted for what each callable function reaches.
// Rule 6.1, Rule 8.22, Rule 8.23, Rule 8.24 and Rule 11.10 (docs/language-design.md) name this file;
// the reqs/ items of these rules read these keywords in it.

import ts from 'typescript';
import { emitGlslModule } from '../../core/backends/glsl.js';
import { emitModule } from '../../core/backends/wgsl.js';
import type { ConsoleLog } from '../../core/console.js';
import { generateModuleJs } from '../../core/cpu-codegen.js';
import { GPU_STUBS, zeroOf } from '../../core/cpu-runtime.js';
import {
  type ComputeEntry,
  type DrawBinding,
  type EntryBinding,
  type HandleBinding,
  type Layout,
} from '../../core/host-entry.js';
import type { KernelGlLoop } from '../../core/host-kernel-gl.js';
import type {
  FuseArray,
  FuseBare,
  FuseLoop,
  KernelFace,
  KernelFuse,
  KernelLoop,
  KernelParam,
  PushWord,
} from '../../core/host-kernel.js';
import type { HostType } from '../../core/host-values.js';
import { isAtomicIntrinsic, isBarrierIntrinsic } from '../../core/intrinsics.js';
import type {
  BindingDecl,
  ConstDecl,
  Expr,
  FuncDecl,
  ModuleDecl,
  Stmt,
  StructDecl,
} from '../../core/ir/nodes.js';
import { workgroupShapeOf } from '../../core/ir/nodes.js';
import { toPortable } from '../../core/ir/portable.js';
import { sourceSpanOf, type SourceSpan } from '../../core/ir/span.js';
import type { ShaderType } from '../../core/ir/types.js';
import { eachExpr, eachStmtExpr } from '../../core/ir/visit.js';
import { addsTo, colourOf } from './host-face/entry-shapes.js';
import { grownChecked, lowerKernelFor, madeFace } from './host-face/made.js';
import { exportsOf, type ExportRef } from './host-face/exports.js';
import { wgslLoweredOf } from './source-file/wgsl-lowered.js';
import { kernelWorkgroups } from '../../core/kernel-workgroup.js';
import { buildManifest, glDrawOf, layoutOf } from '../../core/manifest.js';
import {
  calleesOf,
  closureOf,
  emittedReachOf,
  reachOf,
  type BindingReach,
} from '../../core/manifest/reach.js';
import { callArgAccess } from '../../core/passes/access.js';
import { CONSOLE_NAMES, consoleBuffer } from '../../core/passes/console-buffer.js';
import { fnReads, fnWrites } from '../../core/passes/effects.js';
import { buildGlCompute, type GlComputeProgram } from '../../core/passes/gl-compute.js';
import {
  lowerKernelGl,
  type KernelLoopPlan,
  type KernelPlan,
} from '../../core/passes/kernel-lower.js';
import { projectKernelInputs } from '../../core/passes/kernel-project.js';
import { proveKernels, type KernelProof } from '../../core/passes/parallel-loop.js';
import { typeLayout } from '../../core/reflect.js';
import { inheritSpellings, spellingsOf } from '../../core/spelling-plan.js';
import { VERSION } from '../../core/version.js';
import type { ClassLayouts } from '../../runtime/resource.js';
import {
  accessorFnName,
  baseClassOf,
  buildsCallerClass,
  emittedMemberName,
  holdsFunction,
  isPrivateName,
  isReadonlyMember,
  isStaticMember,
  keywordAccessOf,
  memberDeclarationInChain,
  returnsThis,
  writtenMemberName,
} from './class-names.js';
import { authorTypeText } from './context.js';
import { hostContentReads } from './host-content-access.js';
import { exportDocs, type ExportDocs } from './host-docs.js';
import { topLevelDeclarations } from './host-exports.js';
import {
  type ClassExport,
  type ClassField,
  type ClassMember,
  type FaceExport,
  type HostExport,
  type MemberCall,
  type Refused,
} from './host-face-contracts.js';
import { REASON } from './host-face-shared.js';
import { moduleText } from './host-module.js';
import { hostResourceOf, type ResourceClassFacts } from './host-resource.js';
import { hostTypeOf, kernelArrayLayout } from './host-types.js';
import {
  bindingsTypes,
  isBufferBinding,
  objectType,
  structNames,
  viewText,
  type Naming,
  type ViewTypes,
} from './host-view.js';
import { describeRead } from './kernel-loops.js';
import { collectionKeyOf, keyTypeText, keysOf } from './key-types.js';
import { abstractBuilderText, ctorFnName, methodFnName } from './lower/class-methods.js';
import { pushedParams } from './lower/kernel-push.js';
import { staticConstName } from './module-const.js';
import { compileTsProgram, type TsCompilerDiagnostic } from './source-file.js';
import { emittedStructDecls, type CollectedStruct } from './structs.js';
import type { FaceCtx } from './host-face/context.js';
export { type HostExport } from './host-face-contracts.js';
export { hostTypeOf } from './host-types.js';

/** How {@link hostFace} is called. */
export interface HostFaceOptions {
  /** The shader module's path, carried into the diagnostics and named in the generated files. */
  readonly fileName: string;
  /** The exact identity of this module's fusion records (change 0122). Defaults to `fileName`;
   *  an empty string is an explicit identity. Distinct modules that can share a fusion scope
   *  need distinct identities. This does not change source paths, imports, diagnostics or
   *  views, and has no effect with `fuse: false`. */
  readonly origin?: string;
  /** The specifier the generated module imports its runtime from. Defaults to
   *  `typeshade/runtime/internal`; a test points it at the source file. A tool that runs the
   *  generated module without a bundler (change 0062) maps `typeshade/runtime/internal` to the
   *  package's own copy, as a bundler does: it is what a generated module imports, not API for
   *  a host to import. */
  readonly runtime?: string;
  /** `'gpu'` records each `console.*` call a GPU entry reaches into the `_console` buffer
   *  (change 0014), which the runtime decodes into the host's console after the dispatch or
   *  draw. The Vite plugin sets it in `vite dev`; a production build records nothing. */
  readonly console?: 'gpu';
  /** Put the program's portable IR in the manifest, the default export, so the load-time
   *  emitter (`typeshade/emit`) can emit it again (change 0025). */
  readonly ir?: boolean;
  /** Write into the face of each kernel function that lowers the facts of its loops and the
   *  lowered module they name as portable IR, which the planner of `typeshade/fuse` fuses a
   *  chain of its calls from (change 0058). Enabled by default (change 0085); `false` omits
   *  these facts to reduce generated size. Ordinary input projection remains independent. */
  readonly fuse?: boolean;
  /** Reads a shader file the module imports (Rule 3.9), and a package's `package.json`: the
   *  module and what it imports are one program, and its face is the module's own exports and
   *  re-exports. The Vite plugin reads from disk. */
  readonly readDocument?: (fileName: string) => string | undefined;
  /** The file a specifier written in `fromFile` names; defaults to the rule `compile()` uses. */
  readonly resolveImport?: (fromFile: string, specifier: string) => string | undefined;
}

/** The host face of one shader module. */
export interface HostFace {
  /** The module's own diagnostics. When one is an error, the module does not compile and
   *  `exports`, `view` and `code` are absent: a build fails with these. */
  readonly diagnostics: readonly TsCompilerDiagnostic[];
  readonly exports?: readonly HostExport[];
  /** The host view's text (`name.shade.typeshade.ts`). */
  readonly view?: string;
  /** The generated module's JavaScript. */
  readonly code?: string;
  /** Every file the compile read, the module first: what a bundler watches, so an edit to a
   *  file the module imports rebuilds it. */
  readonly files: readonly string[];
}

interface BindingRef {
  readonly kind: 'binding';
  readonly name: string;
  readonly binding: string;
}

function reported(e: FaceExport): HostExport {
  if (e.kind === 'class') return { kind: 'struct', name: e.name, type: e.type };
  if (e.kind === 'shape') return { kind: 'never', name: e.name, reason: e.reason, typeOnly: true };
  return e;
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some((m) => m.kind === kind) ??
  false;

function gpuOnlyCall(f: FuncDecl, declared: ReadonlySet<string>): string | undefined {
  let found: string | undefined;
  const visit = (x: Expr): void => {
    if (found !== undefined || x.op !== 'call' || declared.has(x.fn)) return;
    if (isBarrierIntrinsic(x.fn) || isAtomicIntrinsic(x.fn) || GPU_STUBS[x.fn] !== undefined)
      found = x.fn;
  };
  for (const s of f.body) eachStmtExpr(s, (e) => eachExpr(e, visit));
  return found;
}

const COMPUTE_BUILTINS = new Set([
  'global_invocation_id',
  'local_invocation_id',
  'local_invocation_index',
  'workgroup_id',
  'num_workgroups',
]);

function spell(t: ShaderType): string {
  if (t.kind === 'struct') return t.name;
  if (t.kind === 'array')
    return t.size === undefined ? `array<${spell(t.elem)}>` : `array<${spell(t.elem)}, ${t.size}>`;
  if (t.kind === 'atomic') return `atomic<${t.elem}>`;
  return authorTypeText(t);
}

function barrierIn(
  closure: ReadonlySet<string>,
  byName: ReadonlyMap<string, FuncDecl>,
  declared: ReadonlySet<string>,
): string | undefined {
  for (const g of closure) {
    let found: string | undefined;
    const visitStmt = (st: Stmt): void => {
      if (found !== undefined) return;
      eachStmtExpr(
        st,
        (e) =>
          eachExpr(e, (x) => {
            if (found !== undefined || x.op !== 'call' || declared.has(x.fn)) return;
            if (!isBarrierIntrinsic(x.fn)) return;
            const span = sourceSpanOf(st) ?? sourceSpanOf(x);
            const file = span?.file.replace(/\\/g, '/').split('/').pop();
            found = span ? `${x.fn}() at ${file}:${span.line + 1}` : `${x.fn}() in ${g}`;
          }),
        visitStmt,
      );
    };
    for (const st of byName.get(g)!.body) visitStmt(st);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Compute the host face of one shader module: which exports a host can call (Rule 8.20), their
 * host types (Rule 8.21), the host view `tsc` reads, and the generated module a bundler reads,
 * which runs the CPU tier's code at `f32` precision (Rule 11.7).
 *
 * A module with an error diagnostic has no face: the result carries the diagnostics alone.
 *
 * The Vite plugin and `tshc sync` call it, and `typeshade/language-service` exports it for a
 * tool that runs host code without Vite (change 0062): `readDocument` reads each file the module
 * imports from where the tool keeps it.
 */
export function hostFace(source: string, options: HostFaceOptions): HostFace {
  const { result: r, linked } = compileTsProgram(source, {
    fileName: options.fileName,
    requireDirective: true,
    ...(options.readDocument ? { readDocument: options.readDocument } : {}),
    ...(options.resolveImport ? { resolveImport: options.resolveImport } : {}),
  });
  const files = linked?.linked.files.map((f) => f.name) ?? [r.sourceFile.fileName];
  if (r.diagnostics.some((d) => d.category === 'error')) {
    return { diagnostics: r.diagnostics, files };
  }
  const faceSource = linked?.sourceFile ?? r.sourceFile;
  const faceSymbols = linked?.symbols ?? r.symbols;

  const structDecls = emittedStructDecls(r.structs);
  const m: ModuleDecl = {
    consts: [...r.consts],
    structs: structDecls,
    bindings: [...r.bindings],
    funcs: [...r.funcs],
    overrides: [...r.overrides],
    vars: [...r.vars],
    enables: [...r.enables],
  };
  const structs = new Map(structDecls.map((s) => [s.name, s]));
  const declared = new Set(m.funcs.map((f) => f.name));
  const byName = new Map(m.funcs.map((f) => [f.name, f]));
  const callees = new Map(m.funcs.map((f) => [f.name, calleesOf(f, declared)]));
  const reads = fnReads(m);
  const writes = fnWrites(m);
  const bindingNames = new Set(m.bindings.map((b) => b.name));
  const workgroupNames = new Set(
    (m.vars ?? []).filter((v) => v.space === 'workgroup').map((v) => v.name),
  );
  const overrideNames = new Set((m.overrides ?? []).map((o) => o.name));
  const privateNames = new Set((m.vars ?? []).map((v) => v.name));
  const constsByName = new Map<string, ConstDecl>(m.consts.map((c) => [c.name, c]));

  const reachProblem = (fn: string): string | undefined => {
    for (const g of closureOf(fn, callees)) {
      const f = byName.get(g)!;
      const touched = new Set([...(reads.get(g) ?? []), ...(writes.get(g) ?? [])]);
      for (const n of touched) {
        if (bindingNames.has(n)) return REASON.binding;
        if (workgroupNames.has(n)) return REASON.workgroup;
      }
      const gpu = gpuOnlyCall(f, declared);
      if (gpu !== undefined) return REASON.gpuOnly(gpu);
    }
    return undefined;
  };

  const lowered = r.wgsl !== undefined ? wgslLoweredOf(r) : undefined;
  let emittedReach: ((entry: string) => BindingReach) | undefined;
  const faces: (FaceExport | BindingRef)[] = [];
  const docs = new Map<string, ExportDocs>();
  const declaredAt = topLevelDeclarations(faceSource);
  for (const ref of exportsOf(faceSource)) {
    const written =
      ref.decl === undefined
        ? undefined
        : exportDocs(ref.decl, faceSource, declaredAt, linked?.linked);
    if (written !== undefined) docs.set(ref.name, written);
    faces.push(
      faceOf(ref, {
        sf: faceSource,
        symbols: faceSymbols,
        byName,
        structs,
        collected: r.structs,
        constsByName,
        bindingNames,
        overrideNames,
        privateNames,
        reachProblem,
        ...(options.fuse !== false ? { fuse: { origin: options.origin ?? options.fileName } } : {}),
        entry: {
          module: m,
          bindings: m.bindings,
          reads,
          writes,
          reach: (entry) =>
            (emittedReach ??= lowered !== undefined ? reachOf(lowered) : emittedReachOf(m))(entry),
          callees,
          declared,
          workgroupZero: Object.fromEntries(
            (m.vars ?? [])
              .filter((v) => v.space === 'workgroup')
              .map((v) => [v.name, zeroOf(v.type, structs)]),
          ),
          ...guardOf(r.wgsl),
        },
      }),
    );
  }

  const exports = resourceFaces(faces, m.bindings);

  const keep = new Set<string>();
  for (const e of exports) {
    if (e.kind === 'function') for (const g of closureOf(e.fn, callees)) keep.add(g);
    if (e.kind === 'class')
      for (const call of classCalls(e)) for (const g of closureOf(call.fn, callees)) keep.add(g);
    if ((e.kind === 'compute' || e.kind === 'fragment') && e.entry.noCpu === undefined)
      for (const g of closureOf(e.entry.fn, callees)) keep.add(g);
    if (e.kind === 'kernel') {
      for (const g of closureOf(e.face.fn, callees)) keep.add(g);
      for (const r of e.ranges) keep.add(r.name);
    }
  }
  const ranges = exports.flatMap((e) => (e.kind === 'kernel' ? e.ranges : []));
  const gen = generateModuleJs(
    { ...m, funcs: [...m.funcs, ...ranges].filter((f) => keep.has(f.name)).map(grownChecked) },
    { precision: 'f32' },
  );
  const fallbacks = new Set(gen.fallbacks);
  const generated = (fn: string): boolean =>
    ![...closureOf(fn, callees)].some((g) => fallbacks.has(g));
  const final = exports.map((e): FaceExport => {
    if (e.kind === 'function') {
      if (!generated(e.fn)) return { kind: 'never', name: e.name, reason: REASON.fallback };
      return e;
    }
    if (e.kind === 'class') return generatedClass(e, generated);
    if (e.kind !== 'compute' && e.kind !== 'fragment') return e;
    if (e.entry.noCpu !== undefined) return e;
    for (const g of closureOf(e.entry.fn, callees))
      if (fallbacks.has(g))
        return { ...e, entry: { ...e.entry, noCpu: REASON.fallback } } as FaceExport;
    return e;
  });

  let wgsl = r.wgsl ?? '';
  let emitted: ModuleDecl = m;
  let log: ConsoleLog | undefined;
  let logged = final;
  if (options.console === 'gpu') {
    const recorded = consoleBuffer(m);
    if (recorded.log !== undefined) {
      log = recorded.log;
      // Why: the recorded module takes the plan of `m`, so its entries keep the host's names.
      emitted = inheritSpellings(recorded.module, m);
      wgsl = emitModule(emitted);
      const rm = recorded.module;
      const rDeclared = new Set(rm.funcs.map((f) => f.name));
      const rCallees = new Map(rm.funcs.map((f) => [f.name, calleesOf(f, rDeclared)]));
      const rTouched = new Map(
        rm.funcs.map((f) => [
          f.name,
          new Set([...(fnReads(rm).get(f.name) ?? []), ...(fnWrites(rm).get(f.name) ?? [])]),
        ]),
      );
      const reaches = (fn: string): boolean =>
        [...closureOf(fn, rCallees)].some((g) => rTouched.get(g)?.has(CONSOLE_NAMES.binding));
      logged = final.map((e): FaceExport => {
        if ((e.kind === 'compute' || e.kind === 'fragment') && reaches(e.entry.fn))
          return { ...e, entry: { ...e.entry, console: true } } as FaceExport;
        return e;
      });
    }
  }

  const wgslInteger =
    guardOf(wgsl).guard !== undefined ? emitModule(emitted, { fp64Flavor: 'integer' }) : undefined;

  const stem = options.fileName.replace(/\\/g, '/').split('/').pop()!;
  const pack = buildManifest(
    m,
    {
      console: options.console === 'gpu',
      ...(options.ir === true ? { ir: true } : {}),
    },
    r.wgsl,
    lowered,
  );
  logged = logged.map((e) =>
    e.kind === 'compute' && pack.overrides.length !== 0
      ? { ...e, entry: { ...e.entry, overrides: pack.overrides } }
      : e,
  );
  const naming: Naming = { named: structNames(logged, false), structs };
  const bindingType = (n: string): ShaderType | undefined => typeOfBinding(m.bindings, n);
  logged = logged.map((e) =>
    e.kind === 'compute' || e.kind === 'fragment' ? namedBindings(e, bindingType, naming) : e,
  );
  const typesOf: ViewTypes = {
    naming,
    binding: bindingType,
    param: (fn, name) => byName.get(fn)?.params.find((p) => p.name === name)?.type,
  };
  return {
    diagnostics: r.diagnostics,
    exports: logged.map(reported),
    view: viewText(
      stem,
      logged,
      options.runtime ?? 'typeshade/runtime/internal',
      pack,
      docs,
      typesOf,
    ),
    code: moduleText(
      stem,
      logged,
      gen,
      options.runtime ?? 'typeshade/runtime/internal',
      wgsl,
      wgslInteger,
      pack,
      hostContentReads(m),
      log,
    ),
    files,
  };
}

function guardOf(wgsl: string | undefined): { guard?: { group: number; binding: number } } {
  const m =
    wgsl === undefined ? null : /@group\((\d+)\)\s*@binding\((\d+)\)\s*var\s+_fp64\b/.exec(wgsl);
  return m === null ? {} : { guard: { group: Number(m[1]), binding: Number(m[2]) } };
}

function guardBinding(at: { group: number; binding: number }): DrawBinding {
  return { name: '_fp64', ...at, space: 'texture', s: 'texture_2d<f32>', guard: true };
}

function entryBindings(
  f: FuncDecl,
  c: FaceCtx,
):
  | {
      bindings: DrawBinding[];
      types: string[];
      draw: string[];
      queued: string[];
      waiting: string[];
      closure: ReadonlySet<string>;
    }
  | { none: string } {
  const x = c.entry;
  const closure = closureOf(f.name, x.callees);
  const { touched, written } = x.reach(f.name);
  const bindings: DrawBinding[] = [];
  for (const b of x.bindings) {
    if (!touched.has(b.name)) continue;
    const glsl = spellingsOf(x.module).glsl.bindings.get(b.name);
    const at = {
      name: b.name,
      group: b.group,
      binding: b.binding,
      s: spell(b.type),
      ...(glsl !== undefined ? { glsl } : {}),
    };
    if (b.type.kind === 'texture' && b.type.dim === '2d' && b.type.elem === 'f32') {
      bindings.push({ ...at, space: 'texture' });
      continue;
    }
    if (b.type.kind === 'sampler') {
      bindings.push({ ...at, space: 'sampler' });
      continue;
    }
    const handle = ['texture', 'storage-texture', 'depth-texture', 'sampler-comparison'];
    const space = b.space === 'storage' ? 'storage' : 'uniform';
    if (handle.includes(b.type.kind))
      return {
        none: `binding "${b.name}" is a ${spell(b.type)}, which has no host value yet; #204, the rendering design, adds it`,
      };
    const layout = layoutOf(
      b.type,
      space === 'uniform' ? 'std140' : 'std430',
      c.structs,
      authorTypeText,
    );
    if ('none' in layout) return { none: `binding "${b.name}": ${layout.none}` };
    const writes = f.stage === 'compute' && space === 'storage' && written.has(b.name);
    const rw = space === 'storage' && b.access === 'read_write';
    bindings.push({ ...at, space, writes, ...(rw ? { rw: true as const } : {}), layout });
  }
  return { bindings, ...bindingsTypes(bindings, (n) => typeOfBinding(x.bindings, n)), closure };
}

const typeOfBinding = (bindings: readonly BindingDecl[], name: string): ShaderType | undefined =>
  bindings.find((b) => b.name === name)?.type;

function namedBindings(
  e: HostExport & { kind: 'compute' | 'fragment' },
  typeOf: (name: string) => ShaderType | undefined,
  naming: Naming,
): HostExport {
  const { types, draw, queued, waiting } = bindingsTypes(e.entry.bindings, typeOf, naming);
  if (e.kind === 'fragment') return { ...e, bindingsType: objectType(draw) };
  return {
    ...e,
    bindingsType: objectType(types),
    ...(e.queuedType !== undefined
      ? { queuedType: objectType(queued), waitingType: objectType(waiting) }
      : {}),
  };
}

const STORAGE_ACCESS = {
  read: 'read-only',
  write: 'write-only',
  read_write: 'read-write',
} as const;

const CPU_HANDLES: ReadonlySet<ShaderType['kind']> = new Set([
  'texture',
  'storage-texture',
  'depth-texture',
  'sampler',
  'sampler-comparison',
]);

function noCpuTier(
  closure: ReadonlySet<string>,
  bindings: readonly DrawBinding[],
  c: FaceCtx,
): string | undefined {
  const handle = bindings.find(
    (b) => (b.space === 'texture' || b.space === 'sampler') && !('guard' in b),
  );
  if (handle !== undefined)
    return `it reaches the ${handle.s} "${handle.name}", which is not supported yet on the CPU tier (Rule 8.24)`;
  for (const g of closure)
    for (const n of [...(c.entry.reads.get(g) ?? []), ...(c.entry.writes.get(g) ?? [])]) {
      const b = c.entry.bindings.find((x) => x.name === n);
      if (b !== undefined && CPU_HANDLES.has(b.type.kind))
        return `it reaches the ${spell(b.type)} "${b.name}", which is not supported yet on the CPU tier (Rule 8.24)`;
    }
  for (const g of closure) {
    const gpu = gpuOnlyCall(c.byName.get(g)!, c.entry.declared);
    if (gpu !== undefined && !isAtomicIntrinsic(gpu) && !isBarrierIntrinsic(gpu))
      return `it reaches ${gpu}(), which is not supported yet on the CPU tier (Rule 8.24)`;
  }
  return undefined;
}

function computeFace(name: string, f: FuncDecl, c: FaceCtx): HostExport {
  const x = c.entry;
  for (const p of f.params)
    if (p.builtin === undefined || !COMPUTE_BUILTINS.has(p.builtin))
      return never(name, `parameter "${p.name}" is not a builtin the call can fill in`);
  const reached = entryBindings(f, c);
  if ('none' in reached) return never(name, reached.none);
  const { bindings, types, queued, waiting, closure } = reached;
  if (x.guard !== undefined) bindings.push(guardBinding(x.guard));
  const barrier = barrierIn(closure, c.byName, x.declared);
  const noCpu = noCpuTier(closure, bindings, c);
  const gl = glTier(f, c);
  const touched = new Set([...(x.reads.get(f.name) ?? []), ...(x.writes.get(f.name) ?? [])]);
  const workgroupVars = (x.module.vars ?? []).filter(
    (v) => v.space === 'workgroup' && touched.has(v.name),
  );
  return {
    kind: 'compute',
    name,
    entry: {
      name,
      fn: f.name,
      ...wgslEntryPoint(f, c),
      wg: workgroupShapeOf(f) ?? [64, 1, 1],
      ...(f.workgroupSizeOverrides === undefined
        ? {}
        : {
            workgroupSizeOverrides: f.workgroupSizeOverrides.map((n) => n ?? null) as [
              string | null,
              string | null,
              string | null,
            ],
          }),
      ...(workgroupVars.length === 0
        ? {}
        : {
            workgroupVars: workgroupVars.map((v) => ({
              name: v.name,
              size: typeLayout(v.type, 'std430', c.structs).size,
              ...(v.type.kind === 'array' && v.type.sizeOverride !== undefined
                ? { override: v.type.sizeOverride }
                : {}),
            })),
          }),
      params: f.params.map((p) => p.builtin!),
      bindings,
      workgroupZero: Object.fromEntries(
        workgroupVars.map((v) => [v.name, x.workgroupZero[v.name]]),
      ) as ComputeEntry['workgroupZero'],
      ...(barrier !== undefined ? { barrier } : {}),
      ...(noCpu !== undefined ? { noCpu } : {}),
      ...gl,
    },
    bindingsType: objectType(types),
    ...(bindings.some((b) => isBufferBinding(b) && b.writes) &&
    bindings.every(
      (b) => !isBufferBinding(b) || !b.writes || (b.layout.k === 'a' && b.layout.n === null),
    )
      ? { queuedType: objectType(queued), waitingType: objectType(waiting) }
      : {}),
  };
}

function wgslEntryPoint(f: FuncDecl, c: FaceCtx): { entryPoint?: string } {
  const emitted = spellingsOf(c.entry.module).wgsl.entries.get(f.name);
  return emitted === undefined ? {} : { entryPoint: emitted };
}

function glTier(f: FuncDecl, c: FaceCtx): { gl: GlComputeProgram } | { noGl: string } {
  try {
    return { gl: buildGlCompute(c.entry.module, f.name) };
  } catch (e) {
    return { noGl: e instanceof Error ? e.message : String(e) };
  }
}

const FRAGMENT_BUILTINS = new Set(['position', 'front_facing']);

function fragmentFace(name: string, f: FuncDecl, c: FaceCtx): HostExport {
  const x = c.entry;
  for (const p of f.params)
    if (p.builtin === undefined || !FRAGMENT_BUILTINS.has(p.builtin))
      return never(name, REASON.fragmentInput(p.name));
  const out = colourOf(f, c.structs);
  if (out === undefined) return never(name, REASON.fragmentOutput);
  const reached = entryBindings(f, c);
  if ('none' in reached) return never(name, reached.none);
  const { bindings, draw: drawTypes, closure } = reached;
  if (x.guard !== undefined) bindings.push(guardBinding(x.guard));
  const draw = glDrawOf(x.module, f, bindings, closure, c.byName, x.declared);
  const gl =
    'none' in draw ? draw : { frag: draw.fragment, blocks: draw.blocks, samplers: draw.samplers };
  const noCpu = noCpuTier(closure, bindings, c);
  return {
    kind: 'fragment',
    name,
    entry: {
      name,
      fn: f.name,
      ...wgslEntryPoint(f, c),
      params: f.params.map((p) => p.builtin!),
      out,
      bindings,
      ...('none' in gl ? { noGl: gl.none } : { gl }),
      ...(noCpu !== undefined ? { noCpu } : {}),
      ...gl,
    },
    bindingsType: objectType(drawTypes),
  };
}

function kernelFace(name: string, f: FuncDecl, c: FaceCtx): HostExport {
  const m = c.entry.module;
  const written = fnWrites(m).get(f.name) ?? new Set<string>();
  const pushedArrays = pushedParams(f.body);
  const params: KernelParam[] = [];
  for (const p of f.params) {
    if (p.type.kind === 'texture' || p.type.kind === 'storage-texture') {
      const t = p.type;
      params.push({
        name: p.name,
        k: 'texture',
        s: spell(t),
        ...(t.kind === 'storage-texture'
          ? { storage: { format: t.format, access: t.access } }
          : {}),
      });
      continue;
    }
    if (p.type.kind === 'collection') {
      const keys = keysOf(collectionKeyOf(p.type));
      const value = p.type.value === undefined ? undefined : hostTypeOf(p.type.value, c.structs);
      if (value !== undefined && 'none' in value)
        return never(name, `parameter "${p.name}": ${value.none}`);
      params.push({
        name: p.name,
        k: 'collection',
        key: p.type.key,
        ...(keys !== undefined ? { keys } : {}),
        ...(value !== undefined ? { value } : {}),
        writes: addsTo(f, p.name),
        s:
          keys === undefined
            ? spell(p.type)
            : p.type.value === undefined
              ? `Set<${keyTypeText(keys)}>`
              : `Map<${keyTypeText(keys)}, ${value!.s}>`,
      });
      continue;
    }
    if (p.type.kind === 'array' && p.type.size === undefined) {
      const layout = kernelArrayLayout(p.type, c.structs);
      if ('none' in layout) return never(name, `parameter "${p.name}": ${layout.none}`);
      const keys = p.type.elem.kind === 'scalar' ? keysOf(p.type.elem) : undefined;
      params.push({
        name: p.name,
        k: 'array',
        layout: layout as Layout & { k: 'a' },
        writes: written.has(p.name),
        s: spell(p.type),
        ...(pushedArrays.has(p.name) ? { pushed: true as const } : {}),
        ...(keys !== undefined ? { keys } : {}),
      });
      continue;
    }
    const t = hostTypeOf(p.type, c.structs);
    if ('none' in t) return never(name, `parameter "${p.name}": ${t.none}`);
    params.push({ name: p.name, k: 'value', type: t });
  }
  const result = hostTypeOf(f.ret, c.structs);
  if ('none' in result) return never(name, `its result: ${result.none}`);
  const face: KernelFace = { name, fn: f.name, params, result };
  const proof = proveKernels(m).find((p) => p.fn === f.name);
  const plan = proof === undefined ? { noGpu: 'it was not proved' } : lowerKernelFor(f, m, proof);
  if ('noGpu' in plan)
    return { kind: 'kernel', name, face: { ...face, noGpu: plan.noGpu }, ranges: [] };
  let wgsl: string;
  let wgslInteger: string | undefined;
  let wgslSubgroup: string | undefined;
  let wgslSubgroupInteger: string | undefined;
  try {
    wgsl = emitModule(plan.module);
    wgslInteger =
      guardOf(wgsl).guard !== undefined
        ? emitModule(plan.module, { fp64Flavor: 'integer' })
        : undefined;
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return {
      kind: 'kernel',
      name,
      face: { ...face, noGpu: `its WGSL did not emit: ${why}` },
      ranges: [],
    };
  }
  if (plan.subgroupModule !== undefined) {
    try {
      wgslSubgroup = emitModule(plan.subgroupModule);
      if (wgslInteger !== undefined)
        wgslSubgroupInteger = emitModule(plan.subgroupModule, { fp64Flavor: 'integer' });
    } catch {
      wgslSubgroup = undefined;
      wgslSubgroupInteger = undefined;
    }
  }
  const structs = new Map(plan.module.structs.map((x) => [x.name, x]));
  const argsLayout = layoutOf(
    { kind: 'struct', name: plan.argsStruct },
    'std140',
    structs,
    authorTypeText,
  );
  if ('none' in argsLayout)
    return { kind: 'kernel', name, face: { ...face, noGpu: argsLayout.none }, ranges: [] };
  const partNames = new Set([
    ...plan.loops.flatMap((l) => (l.reduce?.vars ?? []).map((v) => v.binding)),
    ...plan.loops.flatMap((l) => (l.push !== undefined ? [l.push.binding] : [])),
    ...(plan.words ?? []).map((w) => w.binding),
    ...(plan.trips !== undefined ? [plan.trips.write, plan.trips.read] : []),
  ]);
  const handle = (t: ShaderType): boolean => t.kind === 'texture' || t.kind === 'storage-texture';
  const arrays = plan.module.bindings.filter(
    (b) => b.name !== plan.argsBinding && !partNames.has(b.name) && !handle(b.type),
  );
  const authored = new Map([...plan.bindingNames].map(([name, emitted]) => [emitted, name]));
  const loops: KernelLoop[] = [];
  for (const plain of plan.loops) {
    const l = dispatched(plain);
    if (l.push !== undefined) {
      const b = plan.module.bindings.find((x) => x.name === l.push!.binding)!;
      const layout = layoutOf(b.type, 'std430', structs, authorTypeText);
      if ('none' in layout)
        return { kind: 'kernel', name, face: { ...face, noGpu: layout.none }, ranges: [] };
      loops.push({
        ...(l as KernelLoop),
        push: {
          count: l.push.count,
          scan: l.push.scan,
          binding: {
            name: b.name,
            group: b.group,
            binding: b.binding,
            space: 'storage',
            writes: true,
            rw: true,
            layout,
            s: spell(b.type),
          },
        },
      });
      continue;
    }
    if (l.reduce === undefined) {
      loops.push(l as KernelLoop);
      continue;
    }
    const vars: NonNullable<KernelLoop['reduce']>['vars'][number][] = [];
    for (const v of l.reduce.vars) {
      const b = plan.module.bindings.find((x) => x.name === v.binding)!;
      const layout = layoutOf(b.type, 'std430', structs, authorTypeText);
      if ('none' in layout)
        return { kind: 'kernel', name, face: { ...face, noGpu: layout.none }, ranges: [] };
      const t = v.type;
      vars.push({
        name: v.name,
        op: v.op,
        scalar: (t.kind === 'f64' || t.kind === 'vec64'
          ? 'f64'
          : t.kind === 'vec'
            ? t.elem
            : (t as { scalar: string }).scalar) as 'f32',
        n: t.kind === 'vec' || t.kind === 'vec64' ? t.n : 1,
        binding: {
          name: b.name,
          group: b.group,
          binding: b.binding,
          space: 'storage',
          writes: true,
          rw: true,
          layout,
          s: spell(b.type),
        },
      });
    }
    loops.push({ ...(l as Omit<typeof l, 'push'>), reduce: { entry: l.reduce.entry, vars } });
  }
  const recordNames = new Set((plan.collections ?? []).map((c) => c.records));
  const collections: NonNullable<NonNullable<KernelFace['gpu']>['collections']>[number][] = [];
  for (const c of plan.collections ?? []) {
    const b = arrays.find((x) => x.name === c.records)!;
    const layout = layoutOf(b.type, 'std430', structs, authorTypeText);
    if ('none' in layout)
      return { kind: 'kernel', name, face: { ...face, noGpu: layout.none }, ranges: [] };
    collections.push({
      param: c.param,
      records: {
        name: b.name,
        group: b.group,
        binding: b.binding,
        space: 'storage',
        writes: true,
        rw: true,
        layout,
        s: spell(b.type),
      },
      loop: c.loop,
      perIteration: c.perIteration,
    });
  }
  const binding = (name: string): EntryBinding | { none: string } => {
    const b = arrays.find((x) => x.name === name)!;
    const layout = layoutOf(b.type, 'std430', structs, authorTypeText);
    if ('none' in layout) return layout;
    return {
      name: b.name,
      group: b.group,
      binding: b.binding,
      space: 'storage',
      writes: false,
      layout,
      s: spell(b.type),
    };
  };
  const lookups: NonNullable<NonNullable<KernelFace['gpu']>['lookups']>[number][] = [];
  for (const l of plan.lookups ?? []) {
    const keys = binding(l.keys);
    if ('none' in keys)
      return { kind: 'kernel', name, face: { ...face, noGpu: keys.none }, ranges: [] };
    recordNames.add(l.keys);
    let values: EntryBinding | undefined;
    if (l.values !== undefined) {
      const v = binding(l.values);
      if ('none' in v)
        return { kind: 'kernel', name, face: { ...face, noGpu: v.none }, ranges: [] };
      recordNames.add(l.values);
      values = v;
    }
    lookups.push({
      param: l.param,
      keys,
      ...(values !== undefined ? { values } : {}),
      loop: l.loop,
    });
  }
  const collected = params.find((p) => p.k === 'collection');
  const textured = params.some((p) => p.k === 'texture');
  const pushing = plan.loops.findIndex((l) => l.push !== undefined);
  const gl: ReturnType<typeof kernelGl> = textured
    ? { noWebgl2: 'it takes a texture, which the WebGL2 tier does not bind yet (change 0077)' }
    : collected !== undefined
      ? {
          noWebgl2: `it takes the Map or Set "${collected.name}", which is not supported yet on the WebGL2 tier (Rule 11.8, change 0080)`,
        }
      : pushing >= 0
        ? {
            noWebgl2: `loop ${pushing + 1} pushes onto an array, which is not supported yet on the WebGL2 tier (Rule 11.8, change 0078)`,
          }
        : kernelGl(f, m, proof!, params);
  const projectedModule =
    collected === undefined && pushing < 0 && plan.trips === undefined
      ? projectKernelInputs(plan, f)
      : undefined;
  const projectedSubgroup =
    projectedModule === undefined || plan.subgroupModule === undefined
      ? undefined
      : projectKernelInputs({ ...plan, module: plan.subgroupModule }, f);
  const projected =
    projectedModule === undefined
      ? undefined
      : {
          wgsl: emitModule(projectedModule),
          ...(wgslInteger !== undefined
            ? { wgslInteger: emitModule(projectedModule, { fp64Flavor: 'integer' }) }
            : {}),
          ...(projectedSubgroup !== undefined
            ? {
                wgslSubgroup: emitModule(projectedSubgroup),
                ...(wgslInteger !== undefined
                  ? {
                      wgslSubgroupInteger: emitModule(projectedSubgroup, { fp64Flavor: 'integer' }),
                    }
                  : {}),
              }
            : {}),
          arrays: arrays
            .filter((b) => !recordNames.has(b.name))
            .map((b): EntryBinding => {
              const name = authored.get(b.name) ?? b.name;
              const p = params.find((x) => x.name === name) as KernelParam & { k: 'array' };
              const binding = projectedModule.bindings.find((x) => x.name === b.name)!;
              const layout = layoutOf(
                binding.type,
                'std430',
                new Map(projectedModule.structs.map((s) => [s.name, s])),
                authorTypeText,
              );
              if ('none' in layout) throw new Error(layout.none);
              return {
                name,
                group: b.group,
                binding: b.binding,
                space: 'storage',
                writes: p.writes,
                ...(b.access === 'read_write' ? { rw: true as const } : {}),
                layout,
                s: p.s,
              };
            }),
        };
  const words = wordBindings(plan, structs);
  if ('none' in words)
    return { kind: 'kernel', name, face: { ...face, noGpu: words.none }, ranges: [] };
  const trips =
    plan.trips === undefined
      ? undefined
      : {
          write: wordBinding(plan, structs, plan.trips.write, true),
          read: wordBinding(plan, structs, plan.trips.read, false),
        };
  const held =
    collected === undefined && words.length < pushedArrays.size
      ? heldVariant(f, m, proof!)
      : undefined;
  return {
    kind: 'kernel',
    name,
    face: {
      ...face,
      ...('noWebgl2' in gl ? { noWebgl2: gl.noWebgl2 } : { gl }),
      ...(c.fuse !== undefined &&
      !textured &&
      pushing < 0 &&
      collected === undefined &&
      plan.finish === undefined &&
      plan.trips === undefined
        ? { fuse: fuseRecord(f, plan, proof!, c.fuse.origin) }
        : {}),
      gpu: {
        wgsl,
        ...(projected !== undefined ? { projected } : {}),
        ...(wgslInteger !== undefined ? { wgslInteger } : {}),
        ...(wgslSubgroup !== undefined ? { wgslSubgroup } : {}),
        ...(wgslSubgroupInteger !== undefined ? { wgslSubgroupInteger } : {}),
        args: {
          name: plan.argsBinding,
          group: 0,
          binding: 0,
          space: 'uniform',
          writes: false,
          layout: argsLayout,
          s: plan.argsStruct,
        },
        arrays: arrays
          .filter((b) => !recordNames.has(b.name))
          .map((b) => {
            const name = authored.get(b.name) ?? b.name;
            const p = params.find((x) => x.name === name) as KernelParam & { k: 'array' };
            return {
              name,
              group: b.group,
              binding: b.binding,
              space: 'storage' as const,
              writes: p.writes,
              ...(b.access === 'read_write' ? { rw: true as const } : {}),
              layout: p.layout,
              s: p.s,
            };
          }),
        ...(textured
          ? {
              textures: plan.module.bindings
                .filter((b) => handle(b.type))
                .map((b): HandleBinding => {
                  const name = authored.get(b.name) ?? b.name;
                  const t = b.type;
                  return {
                    name,
                    group: b.group,
                    binding: b.binding,
                    space: t.kind === 'storage-texture' ? 'storage-texture' : 'texture',
                    s: spell(t),
                    ...(t.kind === 'storage-texture'
                      ? { storage: { format: t.format, access: STORAGE_ACCESS[t.access] } }
                      : {}),
                  };
                }),
            }
          : {}),
        loops,
        ...(plan.tail !== undefined ? { tail: plan.tail } : {}),
        ...(plan.finish !== undefined ? { finish: plan.finish } : {}),
        ...(words.length > 0 ? { words } : {}),
        ...(trips !== undefined ? { trips } : {}),
        ...(held !== undefined ? { held } : {}),
        ...(collections.length > 0 ? { collections } : {}),
        ...(lookups.length > 0 ? { lookups } : {}),
        ...guardOf(wgsl),
      },
    },
    ranges: plan.ranges,
  };
}

function wordBinding(
  plan: KernelPlan,
  structs: ReadonlyMap<string, StructDecl>,
  name: string,
  rw: boolean,
): EntryBinding {
  const b = plan.module.bindings.find((x) => x.name === name)!;
  const layout = layoutOf(b.type, 'std430', structs, authorTypeText);
  if ('none' in layout) throw new Error(layout.none);
  return {
    name: b.name,
    group: b.group,
    binding: b.binding,
    space: 'storage',
    writes: rw,
    ...(rw ? { rw: true as const } : {}),
    layout,
    s: spell(b.type),
  };
}

function wordBindings(
  plan: KernelPlan,
  structs: ReadonlyMap<string, StructDecl>,
): PushWord[] | { none: string } {
  const out: PushWord[] = [];
  for (const w of plan.words ?? []) {
    const b = plan.module.bindings.find((x) => x.name === w.binding)!;
    const layout = layoutOf(b.type, 'std430', structs, authorTypeText);
    if ('none' in layout) return layout;
    out.push({
      param: w.param,
      field: w.field,
      binding: {
        name: b.name,
        group: b.group,
        binding: b.binding,
        space: 'storage',
        writes: true,
        rw: true,
        layout,
        s: spell(b.type),
      },
      loops: w.loops,
    });
  }
  return out;
}

function heldVariant(
  f: FuncDecl,
  m: ModuleDecl,
  proof: KernelProof,
): NonNullable<NonNullable<KernelFace['gpu']>['held']> | undefined {
  const plan = lowerKernelFor(f, m, proof, { held: true });
  if ('noGpu' in plan) return undefined;
  let wgsl: string;
  let wgslInteger: string | undefined;
  let wgslSubgroup: string | undefined;
  let wgslSubgroupInteger: string | undefined;
  try {
    wgsl = emitModule(plan.module);
    wgslInteger =
      guardOf(wgsl).guard !== undefined
        ? emitModule(plan.module, { fp64Flavor: 'integer' })
        : undefined;
  } catch {
    return undefined;
  }
  if (plan.subgroupModule !== undefined) {
    try {
      wgslSubgroup = emitModule(plan.subgroupModule);
      if (wgslInteger !== undefined)
        wgslSubgroupInteger = emitModule(plan.subgroupModule, { fp64Flavor: 'integer' });
    } catch {
      wgslSubgroup = undefined;
      wgslSubgroupInteger = undefined;
    }
  }
  const structs = new Map(plan.module.structs.map((x) => [x.name, x]));
  const args = layoutOf(
    { kind: 'struct', name: plan.argsStruct },
    'std140',
    structs,
    authorTypeText,
  );
  const words = wordBindings(plan, structs);
  if ('none' in args || 'none' in words) return undefined;
  return {
    wgsl,
    ...(wgslInteger !== undefined ? { wgslInteger } : {}),
    ...(wgslSubgroup !== undefined ? { wgslSubgroup } : {}),
    ...(wgslSubgroupInteger !== undefined ? { wgslSubgroupInteger } : {}),
    args: {
      name: plan.argsBinding,
      group: 0,
      binding: 0,
      space: 'uniform',
      writes: false,
      layout: args,
      s: plan.argsStruct,
    },
    words,
    ...guardOf(wgsl),
  };
}

function dispatched({
  iterates: _iterates,
  iteration: _iteration,
  continues: _continues,
  ...loop
}: KernelLoopPlan): Omit<KernelLoopPlan, 'iterates' | 'iteration' | 'continues'> {
  return loop;
}

function fuseRecord(f: FuncDecl, plan: KernelPlan, proof: KernelProof, origin: string): KernelFuse {
  const arrayParams = f.params
    .filter((p) => p.type.kind === 'array' && p.type.size === undefined)
    .map((p) => p.name);
  const facts = plan.loops.map((l, j): FuseLoop => {
    const v = proof.loops[j]!;
    if (!v.ok) throw new Error(`${f.name}: loop ${j + 1} lowered without an accepted proof`);
    const arrays: FuseArray[] = [];
    for (const param of arrayParams) {
      const store = v.stores.find((x) => x.name === param);
      const fact = store ?? v.reads.find((x) => x.name === param);
      if (fact === undefined) continue;
      const first = describeRead(f, fact);
      arrays.push({
        param,
        access: store === undefined ? 'read' : store.readBack ? 'readwrite' : 'write',
        atI: fact.atI,
        ...(first !== undefined ? { first } : {}),
      });
    }
    const bare = bareArrays(f, plan, l, arrayParams);
    return {
      entry: l.entry,
      ...(l.reduce !== undefined ? { fold: l.reduce.entry } : {}),
      wg: l.wg,
      ...(kernelWorkgroups.has(f) ? { declared: true } : {}),
      arrays,
      ...(bare.length > 0 ? { bare } : {}),
      reduces: l.reduce !== undefined,
      scatters: v.writes.some((w) => w.kind === 'scatter'),
      continues: l.continues,
      iterates: l.iterates,
      iteration: l.iteration,
    };
  });
  return { origin, facts, ir: toPortable(reachedBy(plan.module), VERSION) };
}

export function bareArrays(
  f: FuncDecl,
  plan: KernelPlan,
  l: KernelLoopPlan,
  params: readonly string[],
): FuseBare[] {
  const found = new Map<string, { place: Expr; at: SourceSpan | undefined }>();
  const walk = (st: Stmt): void =>
    eachStmtExpr(
      st,
      (e) =>
        eachExpr(e, (x) => {
          if (x.op !== 'call' || callArgAccess(x, 0) !== 'length') return;
          const named = x.args[0];
          if (named?.op !== 'varref' && named?.op !== 'param') return;
          if (params.includes(named.name) && !found.has(named.name))
            found.set(named.name, { place: x, at: sourceSpanOf(st) });
        }),
      walk,
    );
  plan.module.funcs
    .find((g) => g.name === l.iterates)
    ?.body.slice(l.iteration)
    .forEach(walk);
  return params.flatMap((param) => {
    const first = describeRead(f, { first: found.get(param) });
    return first === undefined ? [] : [{ param, first }];
  });
}

function reachedBy(m: ModuleDecl): ModuleDecl {
  const helpers = new Set(m.funcs.filter((g) => g.stage === undefined).map((g) => g.name));
  const callees = new Map(m.funcs.map((g) => [g.name, calleesOf(g, helpers)]));
  const keep = new Set<string>();
  for (const g of m.funcs)
    if (g.stage !== undefined) for (const name of closureOf(g.name, callees)) keep.add(name);
  return {
    ...m,
    funcs: m.funcs
      .filter((g) => keep.has(g.name))
      .map(({ span: _span, nameSpan: _nameSpan, ...g }): FuncDecl => g),
  };
}

function kernelGl(
  f: FuncDecl,
  m: ModuleDecl,
  proof: KernelProof,
  params: readonly KernelParam[],
): { loops: KernelGlLoop[] } | { noWebgl2: string } {
  const plan = lowerKernelGl(f, m, proof);
  if ('noWebgl2' in plan) return plan;
  const loops: KernelGlLoop[] = [];
  for (const l of plan.loops) {
    let glsl: string;
    try {
      glsl = emitGlslModule(l.module, 'fragment');
    } catch (e) {
      return { noWebgl2: `its GLSL did not emit: ${e instanceof Error ? e.message : String(e)}` };
    }
    loops.push({
      glsl,
      out: l.out,
      outScalar: l.outScalar,
      reads: l.reads.map((r) => {
        const p = params.find((x) => x.name === r.param) as KernelParam & { k: 'array' };
        const glsl = spellingsOf(l.module).glsl.bindings.get(r.name);
        return {
          param: r.param,
          name: r.name,
          ...(glsl !== undefined ? { glsl } : {}),
          layout: p.layout,
        };
      }),
      uniforms: l.uniforms.map((u) => {
        const glsl = spellingsOf(l.module).glsl.bindings.get(u.name);
        return {
          name: u.name,
          ...(glsl !== undefined ? { glsl } : {}),
          scalar: (u.type.kind === 'vec'
            ? u.type.elem
            : (u.type as { scalar: string }).scalar) as 'f32',
          n: u.type.kind === 'vec' ? u.type.n : 1,
          ...(u.lengthOf !== undefined ? { lengthOf: u.lengthOf } : {}),
        };
      }),
    });
  }
  return { loops };
}

const never = (name: string, reason: string, typeOnly?: true): HostExport =>
  typeOnly ? { kind: 'never', name, reason, typeOnly } : { kind: 'never', name, reason };

function isFunctionType(t: ts.TypeNode | undefined, sf: ts.SourceFile): boolean {
  if (t === undefined) return false;
  if (ts.isFunctionTypeNode(t)) return true;
  if (ts.isParenthesizedTypeNode(t)) return isFunctionType(t.type, sf);
  if (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName)) {
    const name = t.typeName.text;
    for (const s of sf.statements)
      if (ts.isTypeAliasDeclaration(s) && s.name.text === name) return isFunctionType(s.type, sf);
  }
  return false;
}

function faceOf(ref: ExportRef, c: FaceCtx): FaceExport | BindingRef {
  const { name, decl } = ref;
  if (decl === undefined) return never(name, ref.missing ?? REASON.unknown);

  const init = ts.isVariableDeclaration(decl) ? decl.initializer : undefined;
  const fnNode = ts.isFunctionDeclaration(decl)
    ? decl
    : init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
      ? init
      : undefined;
  if (fnNode !== undefined) {
    const nameNode = ts.isFunctionDeclaration(decl)
      ? decl.name!
      : (decl as ts.VariableDeclaration).name;
    if (fnNode.typeParameters !== undefined && fnNode.typeParameters.length > 0)
      return never(name, REASON.generic);
    if (fnNode.parameters.some((p) => isFunctionType(p.type, c.sf)))
      return never(name, REASON.takesFunction);
    const at = nameNode.getStart(c.sf);
    const lowered = new Set(
      c.symbols.filter((s) => s.kind === 'function' && s.start === at).map((s) => s.name),
    );
    const fnName = lowered.size === 1 ? [...lowered][0]! : undefined;
    const f = fnName === undefined ? undefined : c.byName.get(fnName);
    if (f === undefined) return never(name, REASON.notLowered);
    if (f.stage === 'vertex') return never(name, REASON.vertex);
    if (f.stage === 'fragment') return fragmentFace(name, f, c);
    if (f.stage === 'compute') return computeFace(name, f, c);
    if (f.kernel === true) return madeFace(kernelFace(name, f, c), f, c.structs);
    const params: { name: string; type: HostType }[] = [];
    for (const p of f.params) {
      const t = hostTypeOf(p.type, c.structs);
      if ('none' in t) return never(name, `parameter "${p.name}": ${t.none}`);
      if (t.k === 'void') return never(name, `parameter "${p.name}" is void`);
      params.push({ name: p.name, type: t });
    }
    const result = hostTypeOf(f.ret, c.structs);
    if ('none' in result) return never(name, `its result: ${result.none}`);
    const problem = c.reachProblem(f.name);
    if (problem !== undefined) return never(name, problem);
    const written = f.params.find((p) => p.mode === 'inout');
    if (written !== undefined) return never(name, REASON.reference(written.name));
    return { kind: 'function', name, fn: f.name, params, result };
  }

  if (ts.isVariableDeclaration(decl)) {
    const local = (decl.name as ts.Identifier).text;
    if (c.bindingNames.has(local)) return { kind: 'binding', name, binding: local };
    if (c.overrideNames.has(local)) return never(name, REASON.override);
    if (c.privateNames.has(local)) return never(name, REASON.moduleVar);
    const k = c.constsByName.get(local);
    if (k === undefined) return never(name, REASON.unknown);
    const t = hostTypeOf(k.type, c.structs);
    if ('none' in t) return never(name, t.none);
    return { kind: 'const', name, const: local, type: t };
  }

  if (ts.isEnumDeclaration(decl)) {
    const members: [string, number][] = [];
    for (const mem of decl.members) {
      if (!ts.isIdentifier(mem.name)) return never(name, REASON.unknown);
      const k = c.constsByName.get(staticConstName(decl.name.text, mem.name.text));
      if (k === undefined || typeof k.cpuValue !== 'number') return never(name, REASON.unknown);
      members.push([mem.name.text, k.cpuValue]);
    }
    return { kind: 'enum', name, members };
  }

  if (
    ts.isClassDeclaration(decl) ||
    ts.isInterfaceDeclaration(decl) ||
    ts.isTypeAliasDeclaration(decl)
  ) {
    const typeOnly = ts.isClassDeclaration(decl) ? undefined : (true as const);
    if (decl.typeParameters !== undefined && decl.typeParameters.length > 0)
      return never(name, REASON.generic_type, typeOnly);
    const local = decl.name!.text;
    if (ts.isClassDeclaration(decl)) {
      const cls = c.collected.find((x) => x.decl.name === local);
      return cls === undefined ? never(name, REASON.notStruct) : classFace(name, decl, cls, c);
    }
    const s = c.collected.find((x) => x.decl.name === local && x.namespace !== true);
    if (s === undefined) return never(name, REASON.notStruct, typeOnly);
    const t = hostTypeOf({ kind: 'struct', name: local }, c.structs);
    if ('none' in t) return never(name, t.none, typeOnly);
    return { kind: 'struct', name, type: t as HostType & { k: 'struct' } };
  }

  if (ts.isModuleDeclaration(decl)) return never(name, REASON.namespace);
  return never(name, REASON.unknown);
}

function resourceFaces(
  faces: readonly (FaceExport | BindingRef)[],
  bindings: readonly BindingDecl[],
): FaceExport[] {
  const classes = faces.filter((e): e is ClassExport => e.kind === 'class');
  const classOf = (name: string, layout: 'u' | 's'): ResourceClassFacts | undefined => {
    const cls = classes.find((e) => e.type.s === name);
    if (cls === undefined) return undefined;
    const why = layout === 'u' ? cls.layouts.un : cls.layouts.sn;
    return {
      name: cls.name,
      abstract: cls.abstract,
      ...(why !== undefined ? { layoutProblem: why } : {}),
    };
  };
  return faces.map((e): FaceExport => {
    if (e.kind !== 'binding') return e;
    const b = bindings.find((x) => x.name === e.binding);
    if (b === undefined || b.type === undefined) return never(e.name, REASON.bindingExport);
    const r = hostResourceOf(b, classOf);
    if (r.kind === 'other') return never(e.name, REASON.bindingExport);
    if (r.kind === 'none') return never(e.name, REASON.bindingNoResource(r.why));
    return r.length === undefined
      ? { kind: 'resource', name: e.name, cls: r.cls }
      : { kind: 'resource', name: e.name, cls: r.cls, length: r.length };
  });
}

function classChain(cls: ts.ClassDeclaration): ts.ClassDeclaration[] {
  const out: ts.ClassDeclaration[] = [];
  let at: ts.ClassDeclaration | undefined = cls;
  while (at !== undefined && !out.includes(at)) {
    out.push(at);
    at = baseClassOf(at);
  }
  return out;
}

const isGenericMember = (f: ts.SignatureDeclaration): boolean =>
  (f.typeParameters?.length ?? 0) > 0 &&
  !f.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === 'this');

function memberCall(
  fn: string,
  node: ts.SignatureDeclaration | undefined,
  instance: boolean,
  self: boolean,
  c: FaceCtx,
): MemberCall | Refused {
  if (node !== undefined && isGenericMember(node)) return { reason: REASON.generic };
  if (node?.parameters.some((p) => isFunctionType(p.type, c.sf)))
    return { reason: REASON.takesFunction };
  const f = c.byName.get(fn);
  if (f === undefined) return { reason: REASON.notLowered };
  const params: { name: string; type: HostType }[] = [];
  for (const p of instance ? f.params.slice(1) : f.params) {
    if (p.mode === 'inout') return { reason: REASON.reference(p.name) };
    const t = hostTypeOf(p.type, c.structs);
    if ('none' in t) return { reason: `parameter "${p.name}": ${t.none}` };
    if (t.k === 'void') return { reason: `parameter "${p.name}" is void` };
    params.push({ name: p.name, type: t });
  }
  const result = hostTypeOf(f.ret, c.structs);
  if ('none' in result) return { reason: `its result: ${result.none}` };
  const problem = c.reachProblem(f.name);
  if (problem !== undefined) return { reason: problem };
  const object = instance ? f.params[0] : undefined;
  const own =
    object?.type.kind === 'struct' && f.ret.kind === 'struct' && f.ret.name === object.type.name;
  return { fn: f.name, params, result, writes: object?.mode === 'inout', self: self && own };
}

function extendsStruct(
  x: CollectedStruct,
  struct: string,
  byName: ReadonlyMap<string, CollectedStruct>,
): boolean {
  const seen = new Set<string>();
  for (let at = x.bases?.[0]; at !== undefined && !seen.has(at); at = byName.get(at)?.bases?.[0]) {
    if (at === struct) return true;
    seen.add(at);
  }
  return false;
}

function concreteBelow(struct: string, c: FaceCtx): string | undefined {
  const byName = new Map(c.collected.map((x) => [x.decl.name, x]));
  return c.collected.find(
    (x) => x.abstract !== true && x.namespace !== true && extendsStruct(x, struct, byName),
  )?.decl.name;
}

function exportedBelow(struct: string, c: FaceCtx): string | undefined {
  const byName = new Map(c.collected.map((x) => [x.decl.name, x]));
  for (const ref of exportsOf(c.sf)) {
    const decl = ref.decl;
    if (decl === undefined || !ts.isClassDeclaration(decl) || decl.name === undefined) continue;
    if ((decl.typeParameters?.length ?? 0) > 0) continue;
    const x = byName.get(decl.name.text);
    if (x === undefined || x.abstract === true || x.namespace === true) continue;
    if (!extendsStruct(x, struct, byName)) continue;
    if ('none' in hostTypeOf({ kind: 'struct', name: x.decl.name }, c.structs)) continue;
    return ref.name;
  }
  return undefined;
}

function classMembers(
  name: string,
  decl: ts.ClassDeclaration,
  struct: CollectedStruct,
  c: FaceCtx,
): ClassMember[] {
  const own = struct.decl.name;
  const below = struct.abstract === true ? concreteBelow(own, c) : own;
  const out: ClassMember[] = [];
  const seen = new Set<string>();
  for (const cls of classChain(decl)) {
    for (const m of cls.members) {
      if (m.name === undefined) continue;
      const written = writtenMemberName(m.name);
      if (written === undefined) continue;
      const isStatic = isStaticMember(m);
      const accessor = ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m);
      const holder = ts.isPropertyDeclaration(m) && holdsFunction(m) && !isStatic;
      if (!ts.isMethodDeclaration(m) && !accessor && !holder) continue;
      const abstract = hasModifier(m, ts.SyntaxKind.AbstractKeyword);
      if (ts.isMethodDeclaration(m) && m.body === undefined && !abstract) continue;
      const key = `${isStatic ? 'static ' : ''}${written}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (isPrivateName(written) || keywordAccessOf(m) !== undefined) continue;
      if (abstract && struct.abstract !== true) continue;
      const owner = isStatic ? own : below;
      const isAbstract = abstract && struct.abstract === true;
      if (accessor) {
        const halves = cls.members.filter(
          (x): x is ts.AccessorDeclaration =>
            (ts.isGetAccessorDeclaration(x) || ts.isSetAccessorDeclaration(x)) &&
            isStaticMember(x) === isStatic &&
            writtenMemberName(x.name) === written,
        );
        const parts: { get?: MemberCall; set?: MemberCall } = {};
        let reason: string | undefined;
        for (const h of halves) {
          const half = ts.isGetAccessorDeclaration(h) ? 'get' : 'set';
          const call =
            owner === undefined
              ? { reason: REASON.abstractMember(name, written) }
              : memberCall(accessorFnName(owner, half, written), h, !isStatic, false, c);
          if ('reason' in call) reason ??= call.reason;
          else parts[half] = call;
        }
        out.push({
          kind: 'accessor',
          name: written,
          static: isStatic,
          abstract: isAbstract,
          ...(reason === undefined ? parts : { reason }),
        });
        continue;
      }
      const fn = holder ? (m.initializer as ts.ArrowFunction | ts.FunctionExpression) : m;
      const self = !isStatic && ts.isMethodDeclaration(m) && returnsThis(m.body);
      const builder = isStatic && struct.abstract === true && buildsCallerClass(m);
      const call = builder
        ? { reason: abstractBuilderText(name, written, exportedBelow(own, c)) }
        : owner === undefined
          ? { reason: REASON.abstractMember(name, written) }
          : memberCall(
              methodFnName(owner, emittedMemberName(written)),
              fn as ts.SignatureDeclaration,
              !isStatic,
              self,
              c,
            );
      out.push({ kind: 'method', name: written, static: isStatic, abstract: isAbstract, call });
    }
  }
  return out;
}

function classFace(
  name: string,
  decl: ts.ClassDeclaration,
  struct: CollectedStruct,
  c: FaceCtx,
): FaceExport {
  const local = struct.decl.name;
  const t: HostType | { readonly none: string } =
    struct.namespace === true
      ? { k: 'struct', f: [], s: local }
      : hostTypeOf({ kind: 'struct', name: local }, c.structs);
  if ('none' in t) {
    const fields = struct.decl.fields.map((f): readonly [string, HostType | undefined] => {
      const ft = hostTypeOf(f.type, c.structs);
      return [f.name, 'none' in ft ? undefined : ft];
    });
    return { kind: 'shape', name, reason: t.none, fields };
  }
  const type = t as HostType & { k: 'struct' };
  const fields = type.f.map(([field, ft]): ClassField => {
    const written = struct.privateFields?.get(field)?.written ?? field;
    const at = memberDeclarationInChain(decl, written, false);
    const access = isPrivateName(written)
      ? 'private'
      : at === undefined
        ? undefined
        : keywordAccessOf(at);
    return {
      name: field,
      type: ft,
      ...(access !== undefined ? { access } : {}),
      readonly: at !== undefined && isReadonlyMember(at),
    };
  });
  const bases: string[] = [];
  for (
    let at = struct.bases?.[0];
    at !== undefined && at !== local && !bases.includes(at);
    at = c.collected.find((x) => x.decl.name === at)?.bases?.[0]
  )
    bases.push(at);
  const abstract = struct.abstract === true;
  let ctor: ClassExport['ctor'];
  if (!abstract) {
    const written = classChain(decl)
      .flatMap((k) => k.members.filter(ts.isConstructorDeclaration))
      .find((k) => k.body !== undefined);
    const fn = ctorFnName(local);
    ctor =
      written === undefined && !c.byName.has(fn)
        ? { zero: zeroOf({ kind: 'struct', name: local }, c.structs) }
        : memberCall(fn, written, false, false, c);
  }
  return {
    kind: 'class',
    name,
    type,
    abstract,
    bases,
    fields,
    layouts: abstract ? { a: 1 } : resourceLayouts(local, c.structs),
    ...(ctor !== undefined ? { ctor } : {}),
    members: classMembers(name, decl, struct, c),
  };
}

function resourceLayouts(name: string, structs: ReadonlyMap<string, StructDecl>): ClassLayouts {
  const t: ShaderType = { kind: 'struct', name };
  const u = layoutOf(t, 'std140', structs, authorTypeText);
  const s = layoutOf({ kind: 'array', elem: t }, 'std430', structs, authorTypeText);
  return {
    ...('none' in u ? { un: u.none } : { u }),
    ...('none' in s ? { sn: s.none } : { s: s as Layout & { k: 'a' } }),
  };
}

function classCalls(e: ClassExport): MemberCall[] {
  const out: MemberCall[] = [];
  if (e.ctor !== undefined && 'fn' in e.ctor) out.push(e.ctor);
  for (const m of e.members) {
    if (e.abstract && !m.static) continue;
    if (m.kind === 'method' && 'fn' in m.call) out.push(m.call);
    if (m.kind === 'accessor') for (const h of [m.get, m.set]) if (h !== undefined) out.push(h);
  }
  return out;
}

function generatedClass(e: ClassExport, generated: (fn: string) => boolean): ClassExport {
  const ok = <T extends MemberCall | Refused>(call: T): T | Refused =>
    'fn' in call && !generated(call.fn) ? { reason: REASON.fallback } : call;
  const members = e.members.map((m): ClassMember => {
    if (m.kind === 'method') return { ...m, call: ok(m.call) };
    const halves = [m.get, m.set].filter((h): h is MemberCall => h !== undefined);
    const lost = halves.find((h) => !generated(h.fn));
    return lost === undefined
      ? m
      : {
          kind: 'accessor',
          name: m.name,
          static: m.static,
          abstract: m.abstract,
          reason: REASON.fallback,
        };
  });
  const ctor = e.ctor === undefined || !('fn' in e.ctor) ? e.ctor : ok(e.ctor);
  return { ...e, ...(ctor !== undefined ? { ctor } : {}), members };
}

export const hostViewPath = (path: string): string => path.replace(/\.ts$/, '.typeshade.ts');

export const isShaderModulePath = (path: string): boolean => path.endsWith('.shade.ts');

export function formatBuildErrors(diagnostics: readonly TsCompilerDiagnostic[]): string {
  return diagnostics
    .filter((d) => d.category === 'error')
    .map((d) =>
      `${d.fileName}:${d.line}:${d.character} ${d.code ?? ''} ${d.message}`.replace(/  +/, ' '),
    )
    .join('\n');
}
