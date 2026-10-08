// ═══ The host face of a shader module (Rules 8.20, 8.21, 11.7; surface §64) ═══
//
// A host file imports a `.shade.ts` and calls what it exports. This file computes what that host
// sees, from one compile of the module:
//
//   - which exports a host can call (Rule 8.20), and why each other one cannot be;
//   - the host type of each parameter, result, constant and struct (Rule 8.21);
//   - the HOST VIEW, `name.shade.typeshade.ts`, the TypeScript that `tsc` and the editor read
//     for the import in place of the shader source;
//   - the GENERATED MODULE, the JavaScript a bundler reads for the import: the CPU tier's code
//     for the callable functions at `f32` precision (Rule 11.7), each wrapped in a function that
//     checks and converts its arguments and copies its result out.
//
// The IR does not keep the source's export list. A generic function exists only as its instances
// and a function that takes a function only per use, a class method is `P_len` and an enum is
// the constants `Mode_A` and `Mode_B`. So the face is read off the source's `export`s and the
// lowering's symbol table, and the IR is consulted for what each callable function reaches.

import ts from 'typescript';
import type {
  BindingDecl,
  ConstDecl,
  Expr,
  FuncDecl,
  ModuleDecl,
  Stmt,
  StructDecl,
} from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import { eachExpr, eachStmtExpr } from '../../core/ir/visit.js';
import { fnReads, fnWrites } from '../../core/passes/effects.js';
import { GPU_STUBS } from '../../core/cpu-runtime.js';
import { isAtomicIntrinsic, isBarrierIntrinsic } from '../../core/intrinsics.js';
import { generateModuleJs } from '../../core/cpu-codegen.js';
import type { HostType } from '../../core/host-values.js';
import { zeroOf } from '../../core/cpu-runtime.js';
import { sourceSpanOf } from '../../core/ir/span.js';
import { workgroupShapeOf } from '../../core/ir/nodes.js';
import type { ComputeEntry, DrawBinding, EntryBinding, Layout } from '../../core/host-entry.js';
import { buildGlCompute, type GlComputeProgram } from '../../core/passes/gl-compute.js';
import type { FragmentEntry } from '../../core/host-draw.js';
import type { KernelFace, KernelLoop, KernelParam } from '../../core/host-kernel.js';
import type { KernelGlLoop } from '../../core/host-kernel-gl.js';
import { proveKernels, type KernelProof } from '../../core/passes/parallel-loop.js';
import { lowerKernel, lowerKernelGl } from '../../core/passes/kernel-lower.js';
import { emitGlslModule } from '../../core/backends/glsl.js';
import { emitModule } from '../../core/backends/wgsl.js';
import { CONSOLE_NAMES, consoleBuffer } from '../../core/passes/console-buffer.js';
import type { ConsoleLog } from '../../core/console.js';
import {
  compileTsProgram,
  type compileTsSource,
  type TsCompilerDiagnostic,
} from './source-file.js';
import { emittedStructDecls } from './structs.js';
import { staticConstName } from './module-const.js';
import { authorTypeText } from './context.js';
import {
  buildManifest,
  calleesOf,
  closureOf,
  glDrawOf,
  layoutOf,
  type Pack,
} from '../../core/manifest.js';
import type { PackLayout } from '../../core/manifest-types.js';

/** How {@link hostFace} is called. */
export interface HostFaceOptions {
  /** The shader module's path, carried into the diagnostics and named in the generated files. */
  readonly fileName: string;
  /** The specifier the generated module imports its runtime from. Defaults to
   *  `typeshade/runtime/internal`; a test points it at the source file. */
  readonly runtime?: string;
  /** `'gpu'` records each `console.*` call a GPU entry reaches into the `_console` buffer
   *  (change 0014), which the runtime decodes into the host's console after the dispatch or
   *  draw. The Vite plugin sets it in `vite dev`; a production build records nothing. */
  readonly console?: 'gpu';
  /** Put the program's portable IR in the manifest, the default export, so the load-time
   *  emitter (`typeshade/emit`) can emit it again (change 0025). */
  readonly ir?: boolean;
  /** Reads a shader file the module imports (Rule 3.9), and a package's `package.json`: the
   *  module and what it imports are one program, and its face is the module's own exports and
   *  re-exports. The Vite plugin reads from disk. */
  readonly readDocument?: (fileName: string) => string | undefined;
  /** The file a specifier written in `fromFile` names; defaults to the rule `compile()` uses. */
  readonly resolveImport?: (fromFile: string, specifier: string) => string | undefined;
}

/** One export of a shader module, as the host sees it. */
export type HostExport =
  | {
      readonly kind: 'function';
      readonly name: string;
      /** The IR function the call runs. */
      readonly fn: string;
      readonly params: readonly { readonly name: string; readonly type: HostType }[];
      readonly result: HostType;
    }
  | {
      readonly kind: 'const';
      readonly name: string;
      readonly const: string;
      readonly type: HostType;
    }
  | {
      readonly kind: 'enum';
      readonly name: string;
      readonly members: readonly (readonly [string, number])[];
    }
  | { readonly kind: 'struct'; readonly name: string; readonly type: HostType & { k: 'struct' } }
  | {
      /** A `@compute` entry a host can call (Rule 8.24): everything the call needs but the WGSL,
       *  which the module shares, and the TypeScript type of its bindings object. */
      readonly kind: 'compute';
      readonly name: string;
      readonly entry: Omit<ComputeEntry, 'wgsl' | 'log'>;
      readonly bindingsType: string;
      /** The bindings object of the call that only queues, when every binding the entry
       *  writes is a storage array with no size, which a `Resident` may stand for. */
      readonly queuedType?: string;
    }
  | {
      /** A full-screen `@fragment` entry a host can draw into a canvas (Rule 8.24): everything
       *  the draw needs but the WGSL, and the TypeScript type of its bindings object. */
      readonly kind: 'fragment';
      readonly name: string;
      readonly entry: Omit<FragmentEntry, 'wgsl' | 'log'>;
      readonly bindingsType: string;
    }
  | {
      /** A kernel function (Rule 8.22), whose call is asynchronous and dispatches its loops
       *  (Rule 8.21). `ranges` are the CPU-tier functions its call runs first. */
      readonly kind: 'kernel';
      readonly name: string;
      readonly face: KernelFace;
      readonly ranges: readonly FuncDecl[];
    }
  | {
      readonly kind: 'never';
      readonly name: string;
      /** Why the host cannot use it, and which later work adds it when one is planned. */
      readonly reason: string;
      /** A type-only export (an interface, a type alias), which has no value to refuse. */
      readonly typeOnly?: true;
    };

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

// ─── reasons (Rule 8.20) ─────────────────────────────────────────────────────────────────────

const GPU_HALF = 'an entry takes it as a binding instead (Rule 8.24)';
const ITEM_15 = 'roadmap item 15 adds it';

const REASON = {
  vertex:
    'it is a vertex entry, which draws with a mesh, a vertex count and a topology; #204, the rendering design, adds it',
  fragmentInput: (p: string) =>
    `parameter "${p}" is what a vertex entry writes, and a draw has no vertex entry but its full-screen triangle; #204, the rendering design, adds a mesh`,
  fragmentOutput:
    'a draw writes one @location(0) vec4 colour, a vec4 result or a struct of that one field',
  generic:
    'it is generic, and a generic function exists only as the instances the module uses; no proposal adds it yet',
  takesFunction:
    'it takes a function, and such a function exists only as the copies the module uses; no proposal adds it yet',
  reference: (p: string) =>
    `parameter "${p}" is @inout or @out, which names a place of a shader's caller, and a host call passes values (Rule 8.21); call it from a function of the module, since no proposal adds a host reference yet`,
  binding:
    'it reaches a resource binding, which a helper call passes none of; call the entry that uses it (Rule 8.24)',
  workgroup:
    'it reaches a workgroup variable, which exists only in a dispatch; call the entry that uses it (Rule 8.24)',
  gpuOnly: (fn: string) =>
    `it reaches ${fn}, which only a GPU computes; call the entry that uses it (Rule 8.24)`,
  fallback: 'the CPU tier cannot generate code for a function it reaches',
  notLowered: 'it was not lowered to one function of the module',
  bindingExport: 'it is a resource binding; pass it to the entry that uses it (Rule 8.24)',
  override: 'it is an override, which a pipeline sets; no proposal adds it yet',
  moduleVar: 'it is a module variable, which exists per invocation; no proposal adds it yet',
  namespace: 'it is a namespace; export what it holds from the top of the file instead',
  reexport: 'a shader module is one file (TS8004), so it re-exports nothing',
  generic_type: 'it is generic, and its struct exists only as the instances the module uses',
  notStruct: 'it is not a struct, and a host view names a struct only',
  unknown: 'the host view does not describe this kind of export',
} as const;

// ─── host types (Rule 8.21) ────────────────────────────────────────────────────────────────────

/** The host type of `t`, or why it has none. */
export function hostTypeOf(
  t: ShaderType,
  structs: ReadonlyMap<string, StructDecl>,
): HostType | { readonly none: string } {
  switch (t.kind) {
    case 'scalar':
      if (t.scalar === 'bool') return { k: 'bool', s: 'bool' };
      return { k: 'num', t: t.scalar, s: t.scalar };
    case 'f64':
      return { k: 'num', t: 'f64', s: 'f64' };
    case 'vec': {
      const suffix = { f32: '', i32: 'i', u32: 'u', bool: 'b' }[t.elem];
      return { k: 'vec', n: t.n, e: t.elem, s: `vec${t.n}${suffix}` };
    }
    case 'vec64':
      return { k: 'vec', n: t.n, e: 'f64', s: `vec${t.n}f64` };
    case 'mat':
      return {
        k: 'mat',
        c: t.cols,
        r: t.rows,
        e: t.elem,
        s: t.elem === 'f64' ? `mat${t.cols}x${t.rows}<f64>` : `mat${t.cols}x${t.rows}`,
      };
    case 'array': {
      if (t.size === undefined)
        return { none: `a runtime-sized array has no host value yet; ${ITEM_15}` };
      const e = hostTypeOf(t.elem, structs);
      if ('none' in e) return e;
      return { k: 'arr', n: t.size, e, s: `array<${e.s}, ${t.size}>` };
    }
    case 'struct': {
      const decl = structs.get(t.name);
      if (decl === undefined) return { none: `struct ${t.name} is not declared` };
      const f: (readonly [string, HostType])[] = [];
      for (const field of decl.fields) {
        const ft = hostTypeOf(field.type, structs);
        if ('none' in ft) return { none: `field ${t.name}.${field.name}: ${ft.none}` };
        f.push([field.name, ft]);
      }
      return { k: 'struct', f, s: t.name };
    }
    case 'void':
      return { k: 'void', s: 'void' };
    default:
      return { none: `a ${authorTypeText(t)} has no host value; ${GPU_HALF}` };
  }
}

/** The TypeScript type a host passes for `t`: read-only at every level. */
function argType(t: HostType): string {
  switch (t.k) {
    case 'num':
      return 'number';
    case 'bool':
      return 'boolean';
    case 'void':
      return 'void';
    case 'vec':
      return `readonly [${Array(t.n)
        .fill(t.e === 'bool' ? 'boolean' : 'number')
        .join(', ')}]`;
    case 'mat':
      return 'readonly number[]';
    case 'arr':
      return `readonly ${arrayElem(argType(t.e))}[]`;
    case 'struct':
      return `{ ${t.f.map(([n, ft]) => `readonly ${n}: ${argType(ft)}`).join('; ')} }`;
  }
}

/** The TypeScript type a host gets back for `t`. An exported struct goes by its name. */
function resultType(t: HostType, named: ReadonlyMap<string, string>): string {
  switch (t.k) {
    case 'num':
    case 'bool':
    case 'void':
      return argType(t);
    case 'vec':
      return `[${Array(t.n)
        .fill(t.e === 'bool' ? 'boolean' : 'number')
        .join(', ')}]`;
    case 'mat':
      return 'number[]';
    case 'arr':
      return `${arrayElem(resultType(t.e, named))}[]`;
    case 'struct':
      return named.get(t.s) ?? structBody(t, named);
  }
}

function structBody(t: HostType & { k: 'struct' }, named: ReadonlyMap<string, string>): string {
  return `{ ${t.f.map(([n, ft]) => `${n}: ${resultType(ft, named)}`).join('; ')} }`;
}

/** `T` as the element of `T[]`, parenthesized when it would bind wrong. */
const arrayElem = (s: string): string => (s.startsWith('readonly ') ? `(${s})` : s);

// ─── the source's exports ────────────────────────────────────────────────────────────────────

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some((m) => m.kind === kind) ??
  false;

/** A top-level declaration an export can name. */
type Declared =
  | ts.FunctionDeclaration
  | ts.VariableDeclaration
  | ts.EnumDeclaration
  | ts.ClassDeclaration
  | ts.InterfaceDeclaration
  | ts.TypeAliasDeclaration
  | ts.ModuleDeclaration;

interface ExportRef {
  /** The name a host imports. */
  readonly name: string;
  /** The declaration it names, when it names one of this file. */
  readonly decl?: Declared;
  /** Why it has no declaration to read, when it has none. */
  readonly missing?: string;
}

function topLevelDeclarations(sf: ts.SourceFile): Map<string, Declared> {
  const out = new Map<string, Declared>();
  for (const s of sf.statements) {
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations)
        if (ts.isIdentifier(d.name)) out.set(d.name.text, d);
    } else if (
      (ts.isFunctionDeclaration(s) ||
        ts.isEnumDeclaration(s) ||
        ts.isClassDeclaration(s) ||
        ts.isInterfaceDeclaration(s) ||
        ts.isTypeAliasDeclaration(s) ||
        ts.isModuleDeclaration(s)) &&
      s.name !== undefined &&
      ts.isIdentifier(s.name)
    ) {
      // An overload signature and its implementation share a name; the body wins.
      if (!(ts.isFunctionDeclaration(s) && s.body === undefined)) out.set(s.name.text, s);
    }
  }
  return out;
}

function exportsOf(sf: ts.SourceFile): ExportRef[] {
  const local = topLevelDeclarations(sf);
  const out: ExportRef[] = [];
  const seen = new Set<string>();
  const add = (r: ExportRef): void => {
    if (seen.has(r.name)) return;
    seen.add(r.name);
    out.push(r);
  };
  for (const s of sf.statements) {
    if (ts.isExportDeclaration(s)) {
      if (s.moduleSpecifier !== undefined || s.exportClause === undefined) {
        if (s.exportClause !== undefined && ts.isNamedExports(s.exportClause))
          for (const e of s.exportClause.elements)
            add({ name: e.name.text, missing: REASON.reexport });
        continue;
      }
      if (ts.isNamedExports(s.exportClause))
        for (const e of s.exportClause.elements) {
          const localName = (e.propertyName ?? e.name).text;
          const decl = local.get(localName);
          add(decl ? { name: e.name.text, decl } : { name: e.name.text, missing: REASON.unknown });
        }
      continue;
    }
    // The default export of the host import is the module's manifest (Rule 11.10), so the
    // author's own has no host face, as it never had.
    if (ts.isExportAssignment(s)) continue;
    if (!hasModifier(s, ts.SyntaxKind.ExportKeyword)) continue;
    const isDefault = hasModifier(s, ts.SyntaxKind.DefaultKeyword);
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations)
        if (ts.isIdentifier(d.name)) add({ name: d.name.text, decl: d });
      continue;
    }
    if (isDefault) continue;
    const name = (s as { name?: ts.Node }).name;
    if (name !== undefined && ts.isIdentifier(name)) {
      const decl = local.get(name.text);
      add(decl ? { name: name.text, decl } : { name: name.text, missing: REASON.unknown });
    }
  }
  return out;
}

// ─── what a function reaches ─────────────────────────────────────────────────────────────────

/** The first GPU-only builtin `f`'s own body calls, if any. */
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

// ─── an entry a host calls (Rule 8.24) ──────────────────────────────────────────────────────

/** The builtins a `@compute` entry's parameters can take, which the call fills in. */
const COMPUTE_BUILTINS = new Set([
  'global_invocation_id',
  'local_invocation_id',
  'local_invocation_index',
  'workgroup_id',
  'num_workgroups',
]);

/** A binding's type as its author spells it, for a refusal: `Sim`, `array<Particle>`. */
function spell(t: ShaderType): string {
  if (t.kind === 'struct') return t.name;
  if (t.kind === 'array')
    return t.size === undefined ? `array<${spell(t.elem)}>` : `array<${spell(t.elem)}, ${t.size}>`;
  if (t.kind === 'atomic') return `atomic<${t.elem}>`;
  return authorTypeText(t);
}

const TYPED_NAME = {
  f32: 'Float32Array',
  i32: 'Int32Array',
  u32: 'Uint32Array',
  f64: 'Float64Array',
} as const;

/** The TypeScript type of a binding's host value in the bindings object: read-only where the
 *  entry only reads it, mutable where the call writes it back in place (Rule 8.21). */
function bindingTsType(l: Layout, writes: boolean, top = true): string {
  const ro = writes ? '' : 'readonly ';
  switch (l.k) {
    case 's':
      return top && writes ? TYPED_NAME[l.t] : 'number';
    case 'v':
      return `${ro}[${Array(l.n).fill('number').join(', ')}]`;
    case 'm':
      return `${ro}number[]`;
    case 'a': {
      if (l.n === null && (l.e.k === 's' || l.e.k === 'v')) return TYPED_NAME[l.e.t];
      const el = bindingTsType(l.e, writes, false);
      return `${ro}${el.startsWith('readonly ') ? `(${el})` : el}[]`;
    }
    case 'o':
      return `{ ${l.f.map(([n, , fl]) => `${ro}${n}: ${bindingTsType(fl, writes, false)}`).join('; ')} }`;
  }
}

/** The first barrier `fn` reaches, as `workgroupBarrier() at file:line`, if any. */
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

// ─── the face ────────────────────────────────────────────────────────────────────────────────

/**
 * Compute the host face of one shader module: which exports a host can call (Rule 8.20), their
 * host types (Rule 8.21), the host view `tsc` reads, and the generated module a bundler reads,
 * which runs the CPU tier's code at `f32` precision (Rule 11.7).
 *
 * A module with an error diagnostic has no face: the result carries the diagnostics alone.
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
  // A module that imports is read where it was lowered: the linked source holds the entry's
  // exports, its re-exports among them, under the names the module emits (Rule 3.9).
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
    // The module's `diagnostic(...)` directives (§54), as `compile()` carries them: without
    // them the manifest's WGSL, and the recorded variant `vite dev` emits, lose the
    // `diagnostic(off, derivative_uniformity);` an entry asked for, and a sample under a
    // non-uniform branch the author allowed is a shader-creation error on WebGPU.
    ...(r.directives.length > 0 ? { diagnostics: [...r.directives] } : {}),
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

  /** Why the function `fn` cannot be called from host code, or undefined when it can. */
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

  const exports: HostExport[] = [];
  for (const ref of exportsOf(faceSource)) {
    exports.push(
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
        entry: {
          module: m,
          bindings: m.bindings,
          reads,
          writes,
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

  // The CPU tier's code, for the functions the callable ones reach and nothing else, so an
  // entry point's GPU-only body is never generated and never shipped.
  const keep = new Set<string>();
  for (const e of exports) {
    if (e.kind === 'function') for (const g of closureOf(e.fn, callees)) keep.add(g);
    if ((e.kind === 'compute' || e.kind === 'fragment') && e.entry.noCpu === undefined)
      for (const g of closureOf(e.entry.fn, callees)) keep.add(g);
    if (e.kind === 'kernel') {
      for (const g of closureOf(e.face.fn, callees)) keep.add(g);
      for (const r of e.ranges) keep.add(r.name);
    }
  }
  const ranges = exports.flatMap((e) => (e.kind === 'kernel' ? e.ranges : []));
  const gen = generateModuleJs(
    { ...m, funcs: [...m.funcs, ...ranges].filter((f) => keep.has(f.name)) },
    { precision: 'f32' },
  );
  const fallbacks = new Set(gen.fallbacks);
  const final = exports.map((e): HostExport => {
    if (e.kind === 'function') {
      for (const g of closureOf(e.fn, callees))
        if (fallbacks.has(g)) return { kind: 'never', name: e.name, reason: REASON.fallback };
      return e;
    }
    if (e.kind !== 'compute' && e.kind !== 'fragment') return e;
    if (e.entry.noCpu !== undefined) return e;
    // An entry whose code the CPU tier cannot generate still runs on the GPU.
    for (const g of closureOf(e.entry.fn, callees))
      if (fallbacks.has(g))
        return { ...e, entry: { ...e.entry, noCpu: REASON.fallback } } as HostExport;
    return e;
  });

  // In `vite dev`, the WGSL records the console calls the GPU entries reach (change 0014), and
  // each entry that reaches one carries the log the runtime decodes the buffer with.
  let wgsl = r.wgsl ?? '';
  let log: ConsoleLog | undefined;
  let logged = final;
  if (options.console === 'gpu') {
    const recorded = consoleBuffer(m);
    if (recorded.log !== undefined) {
      log = recorded.log;
      wgsl = emitModule(recorded.module);
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
      logged = final.map((e): HostExport => {
        if ((e.kind === 'compute' || e.kind === 'fragment') && reaches(e.entry.fn))
          return { ...e, entry: { ...e.entry, console: true } } as HostExport;
        return e;
      });
    }
  }

  const stem = options.fileName.replace(/\\/g, '/').split('/').pop()!;
  const pack = buildManifest(m, {
    console: options.console === 'gpu',
    ...(options.ir === true ? { ir: true } : {}),
  });
  return {
    diagnostics: r.diagnostics,
    exports: logged,
    view: viewText(stem, logged, options.runtime ?? 'typeshade/runtime/internal', pack),
    code: moduleText(
      stem,
      logged,
      gen,
      options.runtime ?? 'typeshade/runtime/internal',
      wgsl,
      pack,
      log,
    ),
    files,
  };
}

interface FaceCtx {
  readonly sf: ts.SourceFile;
  readonly symbols: ReturnType<typeof compileTsSource>['symbols'];
  readonly byName: ReadonlyMap<string, FuncDecl>;
  readonly structs: ReadonlyMap<string, StructDecl>;
  readonly collected: ReturnType<typeof compileTsSource>['structs'];
  readonly constsByName: ReadonlyMap<string, ConstDecl>;
  readonly bindingNames: ReadonlySet<string>;
  readonly overrideNames: ReadonlySet<string>;
  readonly privateNames: ReadonlySet<string>;
  readonly reachProblem: (fn: string) => string | undefined;
  /** What an entry's face reads (Rule 8.24). */
  readonly entry: EntryCtx;
}

interface EntryCtx {
  /** The module, which the GLSL backend emits a fragment entry's program from. */
  readonly module: ModuleDecl;
  readonly bindings: readonly BindingDecl[];
  readonly reads: ReadonlyMap<string, ReadonlySet<string>>;
  readonly writes: ReadonlyMap<string, ReadonlySet<string>>;
  readonly callees: ReadonlyMap<string, ReadonlySet<string>>;
  readonly declared: ReadonlySet<string>;
  readonly workgroupZero: Readonly<Record<string, unknown>>;
  /** Where the `_fp64` guard is, when the module emulates `f64`: the runtime binds it. */
  readonly guard?: { readonly group: number; readonly binding: number };
}

/** The `_fp64` guard binding the WGSL of a module that emulates `f64` declares, if any. */
function guardOf(wgsl: string | undefined): { guard?: { group: number; binding: number } } {
  const m =
    wgsl === undefined ? null : /@group\((\d+)\)\s*@binding\((\d+)\)\s*var\s+_fp64\b/.exec(wgsl);
  return m === null ? {} : { guard: { group: Number(m[1]), binding: Number(m[2]) } };
}

/** The guard as a binding of an entry: a texture the runtime supplies (Rule 8.24). */
function guardBinding(at: { group: number; binding: number }): DrawBinding {
  return { name: '_fp64', ...at, space: 'texture', s: 'texture_2d<f32>', guard: true };
}

/** The bindings an entry reaches through its calls, each with its host value's layout and
 *  TypeScript type (Rule 8.21), or why one has no host value. */
function entryBindings(
  f: FuncDecl,
  c: FaceCtx,
):
  | {
      bindings: DrawBinding[];
      types: string[];
      /** A compute entry's bindings as the call that only queues takes them: each written
       *  storage array with no size a `Resident` alone. */
      queued: string[];
      closure: ReadonlySet<string>;
    }
  | { none: string } {
  const x = c.entry;
  const closure = closureOf(f.name, x.callees);
  const touched = new Set<string>();
  const written = new Set<string>();
  for (const g of closure) {
    for (const n of x.reads.get(g) ?? []) touched.add(n);
    for (const n of x.writes.get(g) ?? []) {
      touched.add(n);
      written.add(n);
    }
  }
  const bindings: DrawBinding[] = [];
  const types: string[] = [];
  const queued: string[] = [];
  for (const b of x.bindings) {
    if (!touched.has(b.name)) continue;
    const at = { name: b.name, group: b.group, binding: b.binding, s: spell(b.type) };
    if (b.type.kind === 'texture' && b.type.dim === '2d' && b.type.elem === 'f32') {
      bindings.push({ ...at, space: 'texture' });
      types.push(`readonly ${b.name}: ${IMAGE_SOURCE}`);
      queued.push(types.at(-1)!);
      continue;
    }
    if (b.type.kind === 'sampler') {
      bindings.push({ ...at, space: 'sampler' });
      types.push(`readonly ${b.name}?: ${SAMPLING}`);
      queued.push(types.at(-1)!);
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
    const t = bindingTsType(layout, writes);
    // An entry's storage array with no size may be a `Resident` of it (Rule 11.8).
    if (space === 'storage' && layout.k === 'a' && layout.n === null) {
      types.push(`readonly ${b.name}: ${t} | Resident<${t}>`);
      queued.push(`readonly ${b.name}: ${writes ? `Resident<${t}>` : `${t} | Resident<${t}>`}`);
    } else {
      types.push(`readonly ${b.name}: ${t}`);
      queued.push(types.at(-1)!);
    }
  }
  return { bindings, types, queued, closure };
}

/** A `texture_2d<f32>`'s host value (Rule 8.21), in the host view. */
const IMAGE_SOURCE =
  'ImageBitmap | ImageData | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | OffscreenCanvas | Texture';
/** A `sampler`'s host value (Rule 8.21), in the host view. */
const SAMPLING =
  "{ readonly filter?: 'nearest' | 'linear'; readonly address?: 'clamp' | 'repeat' | 'mirror' }";

/** Why the CPU tier cannot run `closure`, when it cannot: it reaches a texture or a call only a
 *  GPU computes. */
function noCpuTier(
  closure: ReadonlySet<string>,
  bindings: readonly DrawBinding[],
  c: FaceCtx,
): string | undefined {
  // The guard is the GPU's alone: the CPU tier computes an `f64` as a double.
  const handle = bindings.find(
    (b) => (b.space === 'texture' || b.space === 'sampler') && !('guard' in b),
  );
  if (handle !== undefined)
    return `it reaches the ${handle.s} "${handle.name}", which the CPU tier cannot read`;
  for (const g of closure) {
    const gpu = gpuOnlyCall(c.byName.get(g)!, c.entry.declared);
    if (gpu !== undefined && !isAtomicIntrinsic(gpu) && !isBarrierIntrinsic(gpu))
      return `it reaches ${gpu}(), which only a GPU computes`;
  }
  return undefined;
}

/** The face of a `@compute` entry (Rule 8.24): the bindings it reaches, each with its byte
 *  layout and host type, its workgroup shape and builtins, and the barrier it reaches, if any. */
function computeFace(name: string, f: FuncDecl, c: FaceCtx): HostExport {
  const x = c.entry;
  for (const p of f.params)
    if (p.builtin === undefined || !COMPUTE_BUILTINS.has(p.builtin))
      return never(name, `parameter "${p.name}" is not a builtin the call can fill in`);
  const reached = entryBindings(f, c);
  if ('none' in reached) return never(name, reached.none);
  const { bindings, types, queued, closure } = reached;
  if (x.guard !== undefined) bindings.push(guardBinding(x.guard));
  const barrier = barrierIn(closure, c.byName, x.declared);
  const noCpu = noCpuTier(closure, bindings, c);
  const gl = glTier(f, c);
  return {
    kind: 'compute',
    name,
    entry: {
      name,
      fn: f.name,
      wg: workgroupShapeOf(f) ?? [64, 1, 1],
      params: f.params.map((p) => p.builtin!),
      bindings,
      workgroupZero: x.workgroupZero as ComputeEntry['workgroupZero'],
      ...(barrier !== undefined ? { barrier } : {}),
      ...(noCpu !== undefined ? { noCpu } : {}),
      ...gl,
    },
    bindingsType: objectType(types),
    // With every written binding a `Resident`, nothing waits: the call only queues.
    ...(bindings.some((b) => isBufferBinding(b) && b.writes) &&
    bindings.every(
      (b) => !isBufferBinding(b) || !b.writes || (b.layout.k === 'a' && b.layout.n === null),
    )
      ? { queuedType: objectType(queued) }
      : {}),
  };
}

/** A `@compute` entry's pass program for the WebGL2 tier (change 0054), or why it has none. */
function glTier(f: FuncDecl, c: FaceCtx): { gl: GlComputeProgram } | { noGl: string } {
  try {
    return { gl: buildGlCompute(c.entry.module, f.name) };
  } catch (e) {
    return { noGl: e instanceof Error ? e.message : String(e) };
  }
}

const isBufferBinding = (b: DrawBinding): b is EntryBinding =>
  b.space === 'uniform' || b.space === 'storage';

/** The builtins a full-screen draw fills in for a `@fragment` entry. */
const FRAGMENT_BUILTINS = new Set(['position', 'front_facing']);

/** The face of a full-screen `@fragment` entry (Rule 8.24): the bindings it reaches, where its
 *  colour is, and what the WebGL2 and CPU tiers need to draw it, or why they cannot. */
function fragmentFace(name: string, f: FuncDecl, c: FaceCtx): HostExport {
  const x = c.entry;
  for (const p of f.params)
    if (p.builtin === undefined || !FRAGMENT_BUILTINS.has(p.builtin))
      return never(name, REASON.fragmentInput(p.name));
  const out = colourOf(f, c.structs);
  if (out === undefined) return never(name, REASON.fragmentOutput);
  const reached = entryBindings(f, c);
  if ('none' in reached) return never(name, reached.none);
  const { bindings, types, closure } = reached;
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
      params: f.params.map((p) => p.builtin!),
      out,
      bindings,
      ...('none' in gl ? { noGl: gl.none } : { gl }),
      ...(noCpu !== undefined ? { noCpu } : {}),
      ...gl,
    },
    bindingsType: objectType(types),
  };
}

const isVec4F32 = (t: ShaderType): boolean => t.kind === 'vec' && t.n === 4 && t.elem === 'f32';

/** Where a fragment entry's one `@location(0)` colour is: null for a bare `vec4` result, the
 *  field's name for a struct of that one field; undefined when it writes anything else. */
function colourOf(
  f: FuncDecl,
  structs: ReadonlyMap<string, StructDecl>,
): string | null | undefined {
  if (isVec4F32(f.ret)) return f.retAttr === '@location(0)' ? null : undefined;
  if (f.ret.kind !== 'struct') return undefined;
  const fields = structs.get(f.ret.name)?.fields ?? [];
  if (fields.length !== 1) return undefined;
  const [only] = fields;
  return only!.location === 0 && only!.builtin === undefined && isVec4F32(only!.type)
    ? only!.name
    : undefined;
}

/** The face of a kernel function (Rules 8.21 to 8.23): each value parameter's host type, each
 *  array's layout, and what its call dispatches when its loops lower, or why they do not. */
function kernelFace(name: string, f: FuncDecl, c: FaceCtx): HostExport {
  const m = c.entry.module;
  const written = fnWrites(m).get(f.name) ?? new Set<string>();
  const params: KernelParam[] = [];
  for (const p of f.params) {
    if (p.type.kind === 'array' && p.type.size === undefined) {
      const layout = layoutOf(p.type, 'std430', c.structs, authorTypeText);
      if ('none' in layout) return never(name, `parameter "${p.name}": ${layout.none}`);
      params.push({
        name: p.name,
        k: 'array',
        layout: layout as Layout & { k: 'a' },
        writes: written.has(p.name),
        s: spell(p.type),
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
  const plan = proof === undefined ? { noGpu: 'it was not proved' } : lowerKernel(f, m, proof);
  if ('noGpu' in plan)
    return { kind: 'kernel', name, face: { ...face, noGpu: plan.noGpu }, ranges: [] };
  let wgsl: string;
  try {
    wgsl = emitModule(plan.module);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return {
      kind: 'kernel',
      name,
      face: { ...face, noGpu: `its WGSL did not emit: ${why}` },
      ranges: [],
    };
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
  const partNames = new Set(
    plan.loops.flatMap((l) => (l.reduce?.vars ?? []).map((v) => v.binding)),
  );
  const arrays = plan.module.bindings.filter(
    (b) => b.name !== plan.argsBinding && !partNames.has(b.name),
  );
  const loops: KernelLoop[] = [];
  for (const l of plan.loops) {
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
    loops.push({ ...l, reduce: { entry: l.reduce.entry, vars } });
  }
  const gl = kernelGl(f, m, proof!, params);
  return {
    kind: 'kernel',
    name,
    face: {
      ...face,
      ...('noWebgl2' in gl ? { noWebgl2: gl.noWebgl2 } : { gl }),
      gpu: {
        wgsl,
        args: {
          name: plan.argsBinding,
          group: 0,
          binding: 0,
          space: 'uniform',
          writes: false,
          layout: argsLayout,
          s: plan.argsStruct,
        },
        arrays: arrays.map((b) => {
          const p = params.find((x) => x.name === b.name) as KernelParam & { k: 'array' };
          return {
            name: b.name,
            group: b.group,
            binding: b.binding,
            space: 'storage' as const,
            writes: p.writes,
            ...(b.access === 'read_write' ? { rw: true as const } : {}),
            layout: p.layout,
            s: p.s,
          };
        }),
        loops,
        ...(plan.tail !== undefined ? { tail: plan.tail } : {}),
        ...guardOf(wgsl),
      },
    },
    ranges: plan.ranges,
  };
}

/** What the WebGL2 tier draws for kernel function `f`: each loop's fragment program, or why it
 *  does not run there (Rule 11.8). */
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
        const p = params.find((x) => x.name === r) as KernelParam & { k: 'array' };
        return { name: r, layout: p.layout };
      }),
      uniforms: l.uniforms.map((u) => ({
        name: u.name,
        scalar: (u.type.kind === 'vec'
          ? u.type.elem
          : (u.type as { scalar: string }).scalar) as 'f32',
        n: u.type.kind === 'vec' ? u.type.n : 1,
      })),
    });
  }
  return { loops };
}

/** An object type of these members, `{}` for none. */
const objectType = (members: readonly string[]): string =>
  members.length === 0 ? '{}' : `{ ${members.join('; ')} }`;

const never = (name: string, reason: string, typeOnly?: true): HostExport =>
  typeOnly ? { kind: 'never', name, reason, typeOnly } : { kind: 'never', name, reason };

/** A function-typed annotation, written out or through a type alias of one. */
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

function faceOf(ref: ExportRef, c: FaceCtx): HostExport {
  const { name, decl } = ref;
  if (decl === undefined) return never(name, ref.missing ?? REASON.unknown);

  // A function: a declaration, or a `const` that holds an arrow function or a function expression.
  const fnNode = ts.isFunctionDeclaration(decl)
    ? decl
    : ts.isVariableDeclaration(decl) &&
        decl.initializer !== undefined &&
        (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
      ? decl.initializer
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
    if (f.kernel === true) return kernelFace(name, f, c);
    const params: { name: string; type: HostType }[] = [];
    for (const p of f.params) {
      // A host call passes values (Rule 8.21), and a reference names a place of the caller's,
      // which a host value is not (Rule 8.25).
      if (p.mode === 'inout') return never(name, REASON.reference(p.name));
      const t = hostTypeOf(p.type, c.structs);
      if ('none' in t) return never(name, `parameter "${p.name}": ${t.none}`);
      if (t.k === 'void') return never(name, `parameter "${p.name}" is void`);
      params.push({ name: p.name, type: t });
    }
    const result = hostTypeOf(f.ret, c.structs);
    if ('none' in result) return never(name, `its result: ${result.none}`);
    const problem = c.reachProblem(f.name);
    if (problem !== undefined) return never(name, problem);
    return { kind: 'function', name, fn: f.name, params, result };
  }

  if (ts.isVariableDeclaration(decl)) {
    const local = (decl.name as ts.Identifier).text;
    if (c.bindingNames.has(local)) return never(name, REASON.bindingExport);
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
    const s = c.collected.find((x) => x.decl.name === local && x.namespace !== true);
    if (s === undefined) return never(name, REASON.notStruct, typeOnly);
    const t = hostTypeOf({ kind: 'struct', name: local }, c.structs);
    if ('none' in t) return never(name, t.none, typeOnly);
    return { kind: 'struct', name, type: t as HostType & { k: 'struct' } };
  }

  if (ts.isModuleDeclaration(decl)) return never(name, REASON.namespace);
  return never(name, REASON.unknown);
}

// ─── the host view ───────────────────────────────────────────────────────────────────────────

/** The header both generated files open with. */
const header = (stem: string): string =>
  `// Generated by typeshade from ${stem}. Do not edit; \`tshc sync\` rewrites it.\n`;

/** The text of the host view: what `tsc` reads for `import … from './name.shade.ts'`. */
/** What a draw or a dispatch may bind for a buffer of the host's own (change 0025): the shape
 *  of a `GPUBuffer`, which the runtime tells by `mapAsync` and `getMappedRange`. */
const GPU_BUFFER = '{ readonly mapAsync: unknown; readonly getMappedRange: unknown }';
/** Any typed array of numbers, which the runtime takes for a vector, a matrix or an array with
 *  a size, by its length. */
const NUMBERS = 'Float32Array | Int32Array | Uint32Array | Float64Array';

/** A buffer binding's host value (Rule 8.21) as a draw or a dispatch passes it, from its
 *  manifest layout: what the runtime's `pack` takes for each shape. */
function packHostType(l: PackLayout): string {
  switch (l.kind) {
    case 'scalar':
      return 'number';
    case 'vector':
      return `readonly [${Array(l.size).fill('number').join(', ')}] | ${NUMBERS}`;
    case 'matrix':
      return `readonly number[] | ${NUMBERS}`;
    case 'array': {
      const e = l.element;
      // An array with no size of scalars or vectors is the typed array of its element alone.
      if (l.length === null && (e.kind === 'scalar' || e.kind === 'vector'))
        return TYPED_NAME[e.type];
      if (e.kind === 'scalar') return `readonly number[] | ${NUMBERS}`;
      return `readonly (${packHostType(e)})[]`;
    }
    case 'struct':
      return `{ ${l.fields.map((f) => `readonly ${f.name}: ${packHostType(f.layout)}`).join('; ')} }`;
  }
}

/** The type argument of the view's `Pack`: for each entry, the bindings it reaches, each with
 *  the values a draw or a dispatch may pass for it (change 0030). A buffer takes its host value,
 *  a `Resident` of it or the host's own buffer; a texture or a sampler takes the runtime's or the
 *  host's own object. A binding the emit adds is the runtime's to bind and is left out. */
function programType(pack: Pack): string {
  const byName = new Map(pack.bindings.map((b) => [b.name, b]));
  const entries = pack.entries.map((e) => {
    const fields = (e.bindings ?? []).flatMap(({ name }) => {
      const b = byName.get(name);
      if (b === undefined || b.injected === true) return [];
      const kind = b.resource.resourceKind;
      if (kind !== 'uniform-buffer' && kind !== 'storage-buffer')
        return [`readonly ${name}: object`];
      if (b.layout === undefined) return [`readonly ${name}: ${GPU_BUFFER}`];
      const t = packHostType(b.layout);
      return [`readonly ${name}: ${t} | Resident<${t}> | ${GPU_BUFFER}`];
    });
    return `readonly ${e.name}: { ${fields.join('; ')} }`;
  });
  return `{ ${entries.join('; ')} }`;
}

function viewText(
  stem: string,
  exports: readonly HostExport[],
  runtime: string,
  pack: Pack,
): string {
  const program = programType(pack);
  // An exported struct goes by its exported name wherever it stands in a result.
  const named = new Map<string, string>();
  for (const e of exports) if (e.kind === 'struct') named.set(e.type.s, e.name);
  const out: string[] = [header(stem)];
  // A kernel function takes a `Resident` wherever it takes an array, and an entry wherever it
  // takes a storage array with no size (Rule 11.8).
  if (
    exports.some(
      (e) =>
        e.kind === 'kernel' ||
        ((e.kind === 'compute' || e.kind === 'fragment') && e.bindingsType.includes('Resident<')),
    ) ||
    program.includes('Resident<')
  )
    out.push(`import type { Resident } from ${JSON.stringify(runtime)};`);
  out.push(`import type { Pack } from ${JSON.stringify(runtime)};`);
  // A texture binding also takes a program runtime's Texture, bound as it is (change 0025).
  if (
    exports.some(
      (e) =>
        (e.kind === 'compute' || e.kind === 'fragment') && e.bindingsType.includes('| Texture'),
    )
  )
    out.push(`import type { Texture } from ${JSON.stringify(runtime)};`);
  for (const e of exports) {
    switch (e.kind) {
      case 'function': {
        const params = e.params.map((p) => `${p.name}: ${argType(p.type)}`).join(', ');
        out.push(`export declare function ${e.name}(${params}): ${resultType(e.result, named)};`);
        break;
      }
      case 'const':
        out.push(`export declare const ${e.name}: ${constType(e.type)};`);
        break;
      case 'enum': {
        const members = e.members.map(([n, v]) => `readonly ${n}: ${v}`).join('; ');
        const values = [...new Set(e.members.map(([, v]) => v))].join(' | ') || 'never';
        out.push(
          `export declare const ${e.name}: { ${members}; readonly [value: number]: string };`,
          `export type ${e.name} = ${values};`,
        );
        break;
      }
      case 'struct':
        out.push(`export interface ${e.name} ${structBody(e.type, named)}`);
        break;
      case 'compute': {
        const [x, y, z] = e.entry.wg;
        out.push(
          `/** A \`@compute\` entry, \`@workgroup_size(${x}, ${y}, ${z})\`: \`workgroups\` counts workgroups, dispatched as written, and each binding the entry writes is read back into your value in place, or stays on the device in a Resident (Rules 8.24 and 11.8). */`,
          ...(e.queuedType !== undefined
            ? [
                `export declare function ${e.name}(bindings: ${e.queuedType}, workgroups: number | readonly [number, number?, number?]): void;`,
              ]
            : []),
          `export declare function ${e.name}(bindings: ${e.bindingsType}, workgroups: number | readonly [number, number?, number?]): Promise<void>;`,
        );
        break;
      }
      case 'kernel': {
        const f = e.face;
        // Each array as the host array or a `Resident` of it; `queued` types a written one as
        // a `Resident` alone, the call that only queues.
        const params = (queued: boolean): string =>
          f.params
            .map((p) => {
              if (p.k === 'value') return `${p.name}: ${argType(p.type)}`;
              const t = bindingTsType(p.layout, p.writes);
              return queued && p.writes
                ? `${p.name}: Resident<${t}>`
                : `${p.name}: ${t} | Resident<${t}>`;
            })
            .join(', ');
        const where =
          f.gpu !== undefined
            ? 'Each of its loops runs on the GPU, one invocation per iteration, where there is WebGPU, and on the CPU otherwise'
            : `It runs on the CPU: ${f.noGpu ?? 'unknown'}`;
        out.push(
          `/** A kernel function (Rule 8.22). ${where}. Each array it writes is read back into yours in place, or stays on the device in a Resident (Rules 8.21 and 11.8). */`,
        );
        // With every written array a `Resident` and no result, nothing waits: the call queues.
        if (f.result.k === 'void' && f.params.some((p) => p.k === 'array' && p.writes))
          out.push(`export declare function ${e.name}(${params(true)}): void;`);
        out.push(
          `export declare function ${e.name}(${params(false)}): Promise<${resultType(f.result, named)}>;`,
        );
        break;
      }
      case 'fragment':
        out.push(
          `/** A full-screen \`@fragment\` entry: draws one frame into \`target\`, filling its width by height, on WebGPU, then WebGL2, then the CPU. The first draw into a canvas decides its tier. The promise resolves when the frame is submitted; nothing is read back (Rule 8.24). */`,
          `export declare function ${e.name}(target: HTMLCanvasElement | OffscreenCanvas, bindings: ${e.bindingsType}): Promise<void>;`,
        );
        break;
      case 'never': {
        out.push(`/** Not callable from host code (Rule 8.20): ${e.reason}. */`);
        if (e.typeOnly) out.push(`export type ${e.name} = never;`);
        else out.push(`export declare const ${e.name}: never;`);
        break;
      }
    }
  }
  out.push(
    '/** The compiled program, its manifest: the shader text, each binding with its byte layout and each entry with the bindings it reaches, which the program runtime loads (Rule 11.10). */',
    `declare const program: Pack<${program}>;`,
    'export default program;',
  );
  return `${out.join('\n')}\n`;
}

/** A constant's host type: read-only at every level, since the host gets a frozen copy. */
function constType(t: HostType): string {
  return argType(t);
}

// ─── the generated module ────────────────────────────────────────────────────────────────────

const RT = '__ts_rt';
const MOD = '__ts_m';

/** The JavaScript a bundler reads for the import: the CPU tier's code as module code, with no
 *  `new Function`, and one checking wrapper per callable export.
 *
 *  No name the file declares is bound here. An export is bound under a name of the generator's
 *  own, `__ts_x0`, and exported under the file's (`export { __ts_x0 as Object }`), and a
 *  wrapper's parameters are `__ts_p0` and on: a name the file declares is the file's whatever it
 *  spells (Rule 2.1), and bound at the top of this module it would shadow a global the code
 *  here reads, `Object.freeze` for an enum, and `Math`, `Array`, `NaN`, `Infinity` and
 *  `undefined` in the CPU tier's code, so one export named `Object` left the module unable to
 *  load. A name the author cannot write, one that begins with `__` (Rule 3.2), cannot meet
 *  these. */
function moduleText(
  stem: string,
  exports: readonly HostExport[],
  gen: ReturnType<typeof generateModuleJs>,
  runtime: string,
  wgsl: string,
  pack: Pack,
  log?: ConsoleLog,
): string {
  const q = (s: string): string => JSON.stringify(s);
  const consts = exports.filter((e) => e.kind === 'const');
  const constTable = consts.map((e) => `${q(e.const)}: ${gen.constIds.get(e.const)}`).join(', ');
  const hasPrivates = gen.fns.some((f) => f.startsWith('"$initPrivates"'));
  const out: string[] = [
    header(stem),
    `import * as ${RT} from ${q(runtime)};`,
    // Pure, so a bundle that imports only the default export, the manifest, drops the CPU tier.
    `const ${MOD} = /*#__PURE__*/ (function ($) {`,
    ...gen.decls,
    `$.F = {\n${gen.fns.join(',\n')}\n};`,
    `return { F: $.F, C: { ${constTable} }, $: $ };`,
    `})(/*#__PURE__*/ ${RT}.createCodegenRuntime({ consoleSink: ${RT}.hostConsole }));`,
    // The program's manifest, which the program runtime loads (Rule 11.10).
    `export default ${JSON.stringify(pack)};`,
  ];
  // The module's WGSL, once, for every entry the host calls on WebGPU.
  if (exports.some((e) => e.kind === 'compute' || e.kind === 'fragment'))
    out.push(`const __ts_wgsl = ${q(wgsl)};`);
  if (log !== undefined) out.push(`const __ts_console = ${JSON.stringify(log)};`);
  let t = 0;
  // Each export's own binding, and the name the file exports it under.
  const bound: string[] = [];
  const bind = (name: string): string => {
    const id = `__ts_x${bound.length}`;
    bound.push(`${id} as ${name}`);
    return id;
  };
  // A callable export is a method of an object literal, read off it, so it keeps the file's
  // name as its own (`m.Object.name` is "Object") with no binding of that name here.
  const callable = (name: string, params: readonly string[], body: readonly string[]): string[] => [
    `const ${bind(name)} = { ${q(name)}(${params.join(', ')}) {`,
    ...body.map((line) => `  ${line}`),
    `} }[${q(name)}];`,
  ];
  for (const e of exports) {
    switch (e.kind) {
      case 'function': {
        const types = e.params.map((p) => {
          const id = `__ts_t${t++}`;
          out.push(`const ${id} = ${JSON.stringify(p.type)};`);
          return id;
        });
        const ret = `__ts_t${t++}`;
        out.push(`const ${ret} = ${JSON.stringify(e.result)};`);
        const ps = e.params.map((_, i) => `__ts_p${i}`);
        const args = e.params.map(
          (p, i) => `${RT}.toShader(${q(e.name)}, ${q(p.name)}, ${types[i]}, ${ps[i]})`,
        );
        // The arguments go to the call as they are converted, in order, with no array spread
        // between (#410). A module with private variables converts every argument first, so
        // one that does not fit is refused before the variables start over, as before.
        const held = hasPrivates ? args.map((_, i) => `__ts_a${i}`) : args;
        out.push(
          ...callable(e.name, ps, [
            `if (arguments.length !== ${ps.length}) ${RT}.arity(${q(e.name)}, ${ps.length}, arguments.length);`,
            ...(hasPrivates && args.length > 0
              ? [`const ${args.map((a, i) => `${held[i]} = ${a}`).join(', ')};`]
              : []),
            ...(hasPrivates ? [`${MOD}.F.$initPrivates();`] : []),
            `return ${RT}.fromShader(${ret}, ${MOD}.F[${q(e.fn)}](${held.join(', ')}));`,
          ]),
        );
        break;
      }
      case 'const':
        out.push(
          `const ${bind(e.name)} = /*#__PURE__*/ ${RT}.constantOf(${JSON.stringify(e.type)}, ${MOD}.C[${q(e.const)}]);`,
        );
        break;
      case 'enum': {
        const fwd = e.members.map(([n, v]) => `${q(n)}: ${v}`);
        const back = e.members.map(([n, v]) => `${q(String(v))}: ${q(n)}`);
        out.push(`const ${bind(e.name)} = Object.freeze({ ${[...fwd, ...back].join(', ')} });`);
        break;
      }
      case 'struct':
        break;
      case 'compute': {
        const id = `__ts_e${t++}`;
        out.push(
          `const ${id} = { ...${JSON.stringify(e.entry)}, wgsl: __ts_wgsl${e.entry.console === true ? ', log: __ts_console' : ''} };`,
          ...callable(
            e.name,
            ['bindings', 'workgroups'],
            [`return ${RT}.callCompute(${MOD}, ${id}, arguments.length, bindings, workgroups);`],
          ),
        );
        break;
      }
      case 'kernel': {
        const id = `__ts_e${t++}`;
        const ps = e.face.params.map((_, i) => `__ts_p${i}`);
        out.push(
          `const ${id} = ${JSON.stringify(e.face)};`,
          ...callable(e.name, ps, [
            `return ${RT}.callKernel(${MOD}, ${id}, arguments.length, [${ps.join(', ')}]);`,
          ]),
        );
        break;
      }
      case 'fragment': {
        const id = `__ts_e${t++}`;
        out.push(
          `const ${id} = { ...${JSON.stringify(e.entry)}, wgsl: __ts_wgsl${e.entry.console === true ? ', log: __ts_console' : ''} };`,
          ...callable(
            e.name,
            ['target', 'bindings'],
            [`return ${RT}.callDraw(${MOD}, ${id}, arguments.length, target, bindings);`],
          ),
        );
        break;
      }
      case 'never':
        if (e.typeOnly) break;
        out.push(
          `const ${bind(e.name)} = /*#__PURE__*/ ${RT}.notCallable(${q(e.name)}, ${q(e.reason)});`,
        );
        break;
    }
  }
  if (bound.length > 0) out.push(`export { ${bound.join(', ')} };`);
  return `${out.join('\n')}\n`;
}

/** Where the host view of the shader module at `path` goes: beside it, `name.shade.typeshade.ts`,
 *  which `moduleSuffixes: [".typeshade", ""]` resolves `./name.shade.ts` to. */
export const hostViewPath = (path: string): string => path.replace(/\.ts$/, '.typeshade.ts');

/** Whether `path` names a shader module a host may import (Rule 3.8): `*.shade.ts`. */
export const isShaderModulePath = (path: string): boolean => path.endsWith('.shade.ts');

/** The build error a module with an error diagnostic fails with: each one at its file, line and
 *  column, with its code. */
export function formatBuildErrors(diagnostics: readonly TsCompilerDiagnostic[]): string {
  return diagnostics
    .filter((d) => d.category === 'error')
    .map((d) =>
      `${d.fileName}:${d.line}:${d.character} ${d.code ?? ''} ${d.message}`.replace(/  +/, ' '),
    )
    .join('\n');
}
