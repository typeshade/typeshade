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
import { typeKey } from '../../core/ir/types.js';
import { eachExpr, eachStmtExpr } from '../../core/ir/visit.js';
import { fnReads, fnWrites } from '../../core/passes/effects.js';
import { GPU_STUBS } from '../../core/cpu-runtime.js';
import { isAtomicIntrinsic, isBarrierIntrinsic } from '../../core/intrinsics.js';
import { generateModuleJs } from '../../core/cpu-codegen.js';
import type { HostType } from '../../core/host-values.js';
import { typeLayout } from '../../core/reflect.js';
import { zeroOf } from '../../core/cpu-runtime.js';
import { sourceSpanOf } from '../../core/ir/span.js';
import { workgroupShapeOf } from '../../core/ir/nodes.js';
import type { ComputeEntry, EntryBinding, Layout } from '../../core/host-entry.js';
import { compileTsSource, type TsCompilerDiagnostic } from './source-file.js';
import { emittedStructDecls } from './structs.js';
import { staticConstName } from './module-const.js';

/** How {@link hostFace} is called. */
export interface HostFaceOptions {
  /** The shader module's path, carried into the diagnostics and named in the generated files. */
  readonly fileName: string;
  /** The specifier the generated module imports its runtime from. Defaults to
   *  `typeshade/runtime`; a test points it at the source file. */
  readonly runtime?: string;
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
      readonly entry: Omit<ComputeEntry, 'wgsl'>;
      readonly bindingsType: string;
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
}

// ─── reasons (Rule 8.20) ─────────────────────────────────────────────────────────────────────

const GPU_HALF = 'an entry takes it as a binding instead (Rule 8.24)';
const ITEM_15 = 'roadmap item 15 adds it';

const REASON = {
  vertex:
    'it is a vertex entry, which draws with a mesh, a vertex count and a topology; #204, the rendering design, adds it',
  fragment:
    'it is a fragment entry, drawn into a canvas through the import by the second part of change 0016',
  fp64: 'its module emulates f64, whose guard binding the call does not create yet; change 0013 adds the f64 split',
  generic:
    'it is generic, and a generic function exists only as the instances the module uses; no proposal adds it yet',
  takesFunction:
    'it takes a function, and such a function exists only as the copies the module uses; no proposal adds it yet',
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
      return { none: `a ${typeKey(t)} has no host value; ${GPU_HALF}` };
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
    if (ts.isExportAssignment(s)) {
      add({ name: 'default', missing: 'a default export has no host face; export a name instead' });
      continue;
    }
    if (!hasModifier(s, ts.SyntaxKind.ExportKeyword)) continue;
    const isDefault = hasModifier(s, ts.SyntaxKind.DefaultKeyword);
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations)
        if (ts.isIdentifier(d.name)) add({ name: d.name.text, decl: d });
      continue;
    }
    if (isDefault) {
      add({ name: 'default', missing: 'a default export has no host face; export a name instead' });
      continue;
    }
    const name = (s as { name?: ts.Node }).name;
    if (name !== undefined && ts.isIdentifier(name)) {
      const decl = local.get(name.text);
      add(decl ? { name: name.text, decl } : { name: name.text, missing: REASON.unknown });
    }
  }
  return out;
}

// ─── what a function reaches ─────────────────────────────────────────────────────────────────

/** The functions `f` calls, directly. */
function calleesOf(f: FuncDecl, declared: ReadonlySet<string>): Set<string> {
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
function closureOf(root: string, callees: ReadonlyMap<string, ReadonlySet<string>>): Set<string> {
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

const roundUp = (x: number, a: number): number => Math.ceil(x / a) * a;

/** The byte layout of a binding's type (std430 for storage, the uniform rules for uniform), from
 *  `reflect()`'s own `typeLayout`, or why it has none a host can pack. */
function layoutOf(
  t: ShaderType,
  kind: 'std140' | 'std430',
  structs: ReadonlyMap<string, StructDecl>,
): Layout | { readonly none: string } {
  switch (t.kind) {
    case 'scalar':
      if (t.scalar === 'bool') return { none: 'a bool is not host-shareable' };
      return { k: 's', t: t.scalar };
    case 'atomic':
      return { k: 's', t: t.elem };
    case 'vec':
      if (t.elem === 'bool') return { none: `a ${typeKey(t)} is not host-shareable` };
      return { k: 'v', n: t.n, t: t.elem };
    case 'mat': {
      if (t.elem === 'f64') return { none: `a ${typeKey(t)} waits for change 0013's f64 split` };
      if (kind === 'std140' && t.rows === 2)
        return { none: `a ${typeKey(t)} in a uniform has no one layout both targets share` };
      return { k: 'm', c: t.cols, r: t.rows, cs: t.rows === 2 ? 8 : 16 };
    }
    case 'array': {
      const e = layoutOf(t.elem, kind, structs);
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
        const fl = layoutOf(field.type, kind, structs);
        if ('none' in fl) return { none: `field ${t.name}.${field.name}: ${fl.none}` };
        const { size, align } = typeLayout(field.type, kind, structs);
        cursor = roundUp(cursor, align);
        f.push([field.name, cursor, fl]);
        cursor += size;
      }
      return { k: 'o', f, sz: typeLayout(t, kind, structs).size };
    }
    case 'f64':
    case 'vec64':
      return { none: `an ${typeKey(t)} waits for change 0013's f64 split` };
    default:
      return {
        none: `a ${typeKey(t)} binding is added by the second part of change 0016, or by #204`,
      };
  }
}

/** A binding's type as its author spells it, for a refusal: `Sim`, `array<Particle>`. */
function spell(t: ShaderType): string {
  if (t.kind === 'struct') return t.name;
  if (t.kind === 'array')
    return t.size === undefined ? `array<${spell(t.elem)}>` : `array<${spell(t.elem)}, ${t.size}>`;
  if (t.kind === 'atomic') return `atomic<${t.elem}>`;
  return typeKey(t);
}

const TYPED_NAME = { f32: 'Float32Array', i32: 'Int32Array', u32: 'Uint32Array' } as const;

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
  const r = compileTsSource(source, { fileName: options.fileName, requireDirective: true });
  if (r.diagnostics.some((d) => d.category === 'error')) return { diagnostics: r.diagnostics };

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
  for (const ref of exportsOf(r.sourceFile)) {
    exports.push(
      faceOf(ref, {
        sf: r.sourceFile,
        symbols: r.symbols,
        byName,
        structs,
        collected: r.structs,
        constsByName,
        bindingNames,
        overrideNames,
        privateNames,
        reachProblem,
        entry: {
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
          fp64: r.wgsl !== undefined && /\b_fp64\b/.test(r.wgsl),
        },
      }),
    );
  }

  // The CPU tier's code, for the functions the callable ones reach and nothing else, so an
  // entry point's GPU-only body is never generated and never shipped.
  const keep = new Set<string>();
  for (const e of exports) {
    if (e.kind === 'function') for (const g of closureOf(e.fn, callees)) keep.add(g);
    if (e.kind === 'compute') for (const g of closureOf(e.entry.fn, callees)) keep.add(g);
  }
  const gen = generateModuleJs(
    { ...m, funcs: m.funcs.filter((f) => keep.has(f.name)) },
    { precision: 'f32' },
  );
  const fallbacks = new Set(gen.fallbacks);
  const final = exports.map((e): HostExport => {
    if (e.kind !== 'function' && e.kind !== 'compute') return e;
    const fn = e.kind === 'function' ? e.fn : e.entry.fn;
    for (const g of closureOf(fn, callees))
      if (fallbacks.has(g)) return { kind: 'never', name: e.name, reason: REASON.fallback };
    return e;
  });

  const stem = options.fileName.replace(/\\/g, '/').split('/').pop()!;
  return {
    diagnostics: r.diagnostics,
    exports: final,
    view: viewText(stem, final),
    code: moduleText(stem, final, gen, options.runtime ?? 'typeshade/runtime', r.wgsl ?? ''),
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
  readonly bindings: readonly BindingDecl[];
  readonly reads: ReadonlyMap<string, ReadonlySet<string>>;
  readonly writes: ReadonlyMap<string, ReadonlySet<string>>;
  readonly callees: ReadonlyMap<string, ReadonlySet<string>>;
  readonly declared: ReadonlySet<string>;
  readonly workgroupZero: Readonly<Record<string, unknown>>;
  /** Whether the module emulates f64, which injects a guard binding the call cannot create. */
  readonly fp64: boolean;
}

/** The face of a `@compute` entry (Rule 8.24): the bindings it reaches, each with its byte
 *  layout and host type, its workgroup shape and builtins, and the barrier it reaches, if any. */
function computeFace(name: string, f: FuncDecl, c: FaceCtx): HostExport {
  const x = c.entry;
  if (x.fp64) return never(name, REASON.fp64);
  for (const p of f.params)
    if (p.builtin === undefined || !COMPUTE_BUILTINS.has(p.builtin))
      return never(name, `parameter "${p.name}" is not a builtin the call can fill in`);
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
  const bindings: EntryBinding[] = [];
  const types: string[] = [];
  for (const b of x.bindings) {
    if (!touched.has(b.name)) continue;
    const space = b.space === 'uniform' ? 'uniform' : b.space === 'storage' ? 'storage' : undefined;
    const layout =
      space === undefined
        ? layoutOf(b.type, 'std430', c.structs)
        : layoutOf(b.type, space === 'uniform' ? 'std140' : 'std430', c.structs);
    if ('none' in layout) return never(name, `binding "${b.name}": ${layout.none}`);
    if (space === undefined)
      return never(name, `binding "${b.name}" is not a buffer; change 0016's second part adds it`);
    const writes = space === 'storage' && written.has(b.name);
    bindings.push({
      name: b.name,
      group: b.group,
      binding: b.binding,
      space,
      writes,
      layout,
      s: spell(b.type),
    });
    types.push(`readonly ${b.name}: ${bindingTsType(layout, writes)}`);
  }
  const barrier = barrierIn(closure, c.byName, x.declared);
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
    },
    bindingsType: `{ ${types.join('; ')} }`,
  };
}

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
    if (f.stage === 'fragment') return never(name, REASON.fragment);
    if (f.stage === 'compute') return computeFace(name, f, c);
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
  `// Generated by typeshade from ${stem}. Do not edit; \`typeshade sync\` rewrites it.\n`;

/** The text of the host view: what `tsc` reads for `import … from './name.shade.ts'`. */
function viewText(stem: string, exports: readonly HostExport[]): string {
  // An exported struct goes by its exported name wherever it stands in a result.
  const named = new Map<string, string>();
  for (const e of exports) if (e.kind === 'struct') named.set(e.type.s, e.name);
  const out: string[] = [header(stem)];
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
          `/** A \`@compute\` entry, \`@workgroup_size(${x}, ${y}, ${z})\`: \`workgroups\` counts workgroups, dispatched as written, and each binding the entry writes is read back into your value in place (Rule 8.24). */`,
          `export declare function ${e.name}(bindings: ${e.bindingsType}, workgroups: number | readonly [number, number?, number?]): Promise<void>;`,
        );
        break;
      }
      case 'never': {
        out.push(`/** Not callable from host code (Rule 8.20): ${e.reason}. */`);
        if (e.name === 'default')
          out.push('declare const _default: never;', 'export default _default;');
        else if (e.typeOnly) out.push(`export type ${e.name} = never;`);
        else out.push(`export declare const ${e.name}: never;`);
        break;
      }
    }
  }
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
 *  `new Function`, and one checking wrapper per callable export. */
function moduleText(
  stem: string,
  exports: readonly HostExport[],
  gen: ReturnType<typeof generateModuleJs>,
  runtime: string,
  wgsl: string,
): string {
  const q = (s: string): string => JSON.stringify(s);
  const consts = exports.filter((e) => e.kind === 'const');
  const constTable = consts.map((e) => `${q(e.const)}: ${gen.constIds.get(e.const)}`).join(', ');
  const hasPrivates = gen.fns.some((f) => f.startsWith('"$initPrivates"'));
  const out: string[] = [
    header(stem),
    `import * as ${RT} from ${q(runtime)};`,
    `const ${MOD} = (function ($) {`,
    ...gen.decls,
    `$.F = {\n${gen.fns.join(',\n')}\n};`,
    `return { F: $.F, C: { ${constTable} }, $: $ };`,
    `})(${RT}.createCodegenRuntime({ consoleSink: ${RT}.hostConsole }));`,
  ];
  // The module's WGSL, once, for every entry the host calls on WebGPU.
  if (exports.some((e) => e.kind === 'compute')) out.push(`const __ts_wgsl = ${q(wgsl)};`);
  let t = 0;
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
        const ps = e.params.map((p) => p.name);
        const args = e.params.map(
          (p, i) => `${RT}.toShader(${q(e.name)}, ${q(p.name)}, ${types[i]}, ${p.name})`,
        );
        out.push(
          `export function ${e.name}(${ps.join(', ')}) {`,
          `  ${RT}.arity(${q(e.name)}, ${ps.length}, arguments.length);`,
          ...(args.length > 0 ? [`  const __ts_a = [${args.join(', ')}];`] : []),
          ...(hasPrivates ? [`  ${MOD}.F.$initPrivates();`] : []),
          `  return ${RT}.fromShader(${ret}, ${MOD}.F[${q(e.fn)}](${args.length > 0 ? '...__ts_a' : ''}));`,
          `}`,
        );
        break;
      }
      case 'const':
        out.push(
          `export const ${e.name} = ${RT}.constantOf(${JSON.stringify(e.type)}, ${MOD}.C[${q(e.const)}]);`,
        );
        break;
      case 'enum': {
        const fwd = e.members.map(([n, v]) => `${q(n)}: ${v}`);
        const back = e.members.map(([n, v]) => `${q(String(v))}: ${q(n)}`);
        out.push(`export const ${e.name} = Object.freeze({ ${[...fwd, ...back].join(', ')} });`);
        break;
      }
      case 'struct':
        break;
      case 'compute': {
        const id = `__ts_e${t++}`;
        out.push(
          `const ${id} = { ...${JSON.stringify(e.entry)}, wgsl: __ts_wgsl };`,
          `export function ${e.name}(bindings, workgroups) {`,
          `  return ${RT}.callCompute(${MOD}, ${id}, arguments.length, bindings, workgroups);`,
          `}`,
        );
        break;
      }
      case 'never':
        if (e.typeOnly) break;
        if (e.name === 'default')
          out.push(`export default ${RT}.notCallable("default", ${q(e.reason)});`);
        else out.push(`export const ${e.name} = ${RT}.notCallable(${q(e.name)}, ${q(e.reason)});`);
        break;
    }
  }
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
