// ═══ The class arm: each exported class's members on every tier against the f32 oracle (change 0110) ═══
//
// WHAT IT PROVES. A class is its struct and its functions (surface §26): `new C(…)` is a call of
// `C_new`, a method is `C_m` over its object, a getter is `C_get_x`, and a static function is
// `C_s`. So a member must give one result wherever the class stands. This arm takes every exported
// class of `examples/*.shade.ts` and of `journeys/class-twins/`, writes a twin module for each one
// and holds each member a host could call to the oracle on every leg below: its result, and every
// field of the object after the call.
//
// THE CORPUS. A member is a public method, getter, setter or static function of the class, and a
// public method, getter or setter of a base class of the same file. A member is admissible under
// the conditions a host call has (Rule 8.20): it is not generic, it takes no function, each
// parameter and the result have a host value, and it reaches no binding, no workgroup variable and
// no builtin only a GPU computes. The arm does not decide these conditions itself: for each member
// it writes a probe module with one exported function that calls the member, and the member is
// admissible when `hostFace` makes that function callable. Otherwise the probe's reason is the
// member's reason. A generic member and a member that takes a function have no probe to write, so
// their reasons are read from the host face of a module that holds one function of each kind. A
// class with no admissible member, or with a constructor the arm cannot call, is listed as skipped
// with the reason, and so is a generic or an abstract class. A twin stores the class in a storage
// array, so a type a storage buffer cannot hold (a `bool`) or an emulated `f64`, which the `f32`
// oracle does not hold bit for bit, is skipped with that reason too.
//
// THE TWIN. For each class `C` the arm writes a `"use typeshade"` module that imports `C` (§68).
// For each admissible member `m` the module declares an `Args_m` struct, its fields the arguments
// of `C`'s constructor (`c0`, `c1`, …) and of `m` (`a0`, `a1`, …), and two callers:
//
//   - the entry `twin_m`, `@compute([64])`, over `storage<array<C>, "read_write">`, an array of
//     `Args_m` and an array of results: each invocation builds a local `let o = new C(…)`, calls
//     `m` on it, and stores the result and `o`;
//   - the kernel function `loop_m(out, xs: array<C>, args)` (§65): each iteration builds
//     `xs[i] = new C(…)` and calls `m` on the element itself, `out[i] = xs[i].m(…)`, a write at
//     `i` that R3 admits.
//
// A class with no constructor parameters is built as `new C()`, from its field initializers. The
// arguments are drawn on the host by `typeshade/random` (`hash32`, `uniform`) from the element's
// index, so every leg sees the same inputs: a float is a multiple of 1/8 in [-4, 4], which a sum
// or a product rounds in no grouping (#378), an `i32` is in [-32, 32) and a `u32` in [0, 64).
//
// THE LEGS. The entry on WebGPU, on WebGL2 through the pass program of change 0054, and on the CPU
// tier; the kernel function on WebGPU, on WebGL2 where it lowers (Rule 11.8), and on the CPU tier;
// each through the module the Vite plugin generates (`hostFace`), bundled for the page as a host's
// bundler bundles it, with one required tier at a time (`configure({ prefer: [tier] })`). The
// entry and the kernel function also run on the oracle itself, dispatched and called as the
// compiler's own tests do. The reference is the oracle (`compileModule` in `f32` mode, Rule
// 11.1): `C_new` and then the member's function, called directly for each element. The host leg,
// `new C(…)` and `o.m(…)` on the CPU tier through the host face, waits for proposal 0109.
//
// THE CLAIM. For every element, the member's result and every field of the object after the call
// are the same bits on every leg as on the oracle. Where the determinism report (surface §38)
// lists a row for an operation the member or the constructor reaches, a float is held to an
// envelope instead: within 32 ULP or 2^-11 of the oracle's, as the common-module arm holds it.
// A zero's sign, a NaN or an infinity, and a subnormal a GPU flushes carry no claim, as the kernel
// arm reads them. The arm prints the largest distance it saw on each leg.
//
// THE INSTRUMENT (AGENTS.md#gate-discipline). One case runs wrong on purpose in each run: the
// entry of the first member whose results differ between two neighbouring elements runs once more
// on WebGPU with one element given the next element's arguments, and the comparison must report
// that element. A gate that cannot fail cannot pass. The corpus must also reach what the claim is
// about: the classes and members below their floors, and each kind of member in `REACH`.
//
// REFUSALS. A leg a tier has no form for is named with the reason the host face gives (an entry's
// `noGl` or `noCpu`, a kernel function's `noWebgl2` or `noGpu`), and the member is held on the legs
// that run it. Any other error fails the arm.
//
//   TYPESHADE_CHROMIUM=/path/to/headless_shell TYPESHADE_DIFF_ARMS=class bun scripts/gpu-differential.ts

import type { Page } from 'playwright';
import ts from 'typescript';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/compiler/ts/compile.js';
import { authorTypeText } from '../src/compiler/ts/context.js';
import { hostFace, type HostExport } from '../src/compiler/ts/host-face.js';
import type { CpuValue } from '../src/core/cpu-runtime.js';
import { zeroOf } from '../src/core/cpu-runtime.js';
import type { FuncDecl, ModuleDecl, StructDecl } from '../src/core/ir/nodes.js';
import type { ShaderType } from '../src/core/ir/types.js';
import { calleesOf, closureOf } from '../src/core/manifest.js';
import { compileModule, type CpuModule } from '../src/core/oracle.js';
import { determinismReport } from '../src/core/passes/determinism.js';
import { createTypeshadeLanguageService } from '../src/language-service/service.js';
import { hash32, uniform } from '../src/random/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = join(ROOT, 'src/core/host-runtime.ts');
const read = (file: string): string | undefined =>
  existsSync(file) ? readFileSync(file, 'utf8') : undefined;

/** The directories whose shader files are the corpus: every exported class of each file. */
const CORPUS_DIRS = ['examples', 'journeys/class-twins'] as const;

/** Elements of each call: past three workgroups of 64 and not a multiple of 64, so the last
 *  workgroup holds invocations past the end of the arrays. */
const N = 200;
const WORKGROUP = 64;

/** The envelope a float under a determinism row is held to, as the common-module arm holds it. */
const ULP_ENVELOPE = 32;
const ABS_ENVELOPE = 2 ** -11;

/** How many classes and members the arm must hold on WebGPU, so a run that read less is red. */
const CLASSES_FLOOR = 6;
const MEMBERS_FLOOR = 13;

/** What the corpus must reach, each at least once on WebGPU. */
const REACH = [
  'a method that changes its object',
  'a method that reads its object',
  'a static function',
  'a getter',
  'a setter',
  'a member a base class declares',
  'a member that hands a field to an @inout parameter',
  'a constructor with arguments',
  'a class built from its initializers',
  'a vector result',
] as const;
type Reach = (typeof REACH)[number];

type Tier = 'webgpu' | 'webgl2' | 'cpu';
type Leg = `${'entry' | 'kernel'}/${Tier | 'oracle'}`;
const PAGE_LEGS: readonly { kind: 'entry' | 'kernel'; tier: Tier }[] = [
  { kind: 'entry', tier: 'webgpu' },
  { kind: 'entry', tier: 'webgl2' },
  { kind: 'entry', tier: 'cpu' },
  { kind: 'kernel', tier: 'webgpu' },
  { kind: 'kernel', tier: 'webgl2' },
  { kind: 'kernel', tier: 'cpu' },
];
const LEGS: readonly Leg[] = [
  'entry/webgpu',
  'entry/webgl2',
  'entry/cpu',
  'entry/oracle',
  'kernel/webgpu',
  'kernel/webgl2',
  'kernel/cpu',
  'kernel/oracle',
];

// ─── the corpus ──────────────────────────────────────────────────────────────────────────────

/** One exported class of a corpus file. */
interface ClassCase {
  readonly file: string;
  /** The file's path from the repository root, for the report. */
  readonly rel: string;
  readonly name: string;
  readonly decl: ts.ClassDeclaration;
  /** The file's top-level classes by name, for a base of the same file. */
  readonly classes: ReadonlyMap<string, ts.ClassDeclaration>;
  /** The types the file exports by name, which a twin may import. */
  readonly exported: ReadonlySet<string>;
  readonly module: ModuleDecl;
}

/** One member as the author wrote it, with the function it lowers to for this class. */
interface Member {
  readonly kind: 'method' | 'static' | 'getter' | 'setter';
  readonly name: string;
  /** The member's name in the twin's identifiers: `tick`, `get_saw`, `set_cutoff`. */
  readonly tag: string;
  /** The class that declares it: the class itself or a base of the same file. */
  readonly owner: string;
  readonly generic: boolean;
  readonly takesFunction: boolean;
  readonly hidden: boolean;
}

const hasModifier = (n: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === kind);

/** Every shader file of the corpus, in order. */
function corpusFiles(): { dir: string; files: string[] }[] {
  return CORPUS_DIRS.map((dir) => ({
    dir,
    files: readdirSync(join(ROOT, dir))
      .filter((f) => f.endsWith('.shade.ts'))
      .sort()
      .map((f) => join(ROOT, dir, f)),
  }));
}

/** The exported classes of one file, with its IR. A file that does not compile fails the arm. */
function classesOf(file: string): { classes: ClassCase[]; error?: string } {
  const text = read(file)!;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const classes = new Map<string, ts.ClassDeclaration>();
  const exported = new Set<string>();
  for (const s of sf.statements) {
    const name =
      (ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) &&
      s.name !== undefined
        ? s.name.text
        : undefined;
    if (name === undefined) continue;
    if (ts.isClassDeclaration(s)) classes.set(name, s);
    if (hasModifier(s, ts.SyntaxKind.ExportKeyword)) exported.add(name);
  }
  const mine = [...classes.values()].filter(
    (c) =>
      hasModifier(c, ts.SyntaxKind.ExportKeyword) &&
      !hasModifier(c, ts.SyntaxKind.DefaultKeyword) &&
      !hasModifier(c, ts.SyntaxKind.DeclareKeyword),
  );
  if (mine.length === 0) return { classes: [] };
  const r = compile(text, { fileName: file, readDocument: read });
  const errors = r.diagnostics.filter((d) => d.category === 'error');
  if (errors.length > 0 || r.module === undefined)
    return {
      classes: [],
      error: `${relative(ROOT, file)} does not compile: ${errors.map((d) => `${d.code} ${d.message}`).join('; ')}`,
    };
  return {
    classes: mine.map((decl) => ({
      file,
      rel: relative(ROOT, file),
      name: decl.name!.text,
      decl,
      classes,
      exported,
      module: r.module,
    })),
  };
}

const memberName = (n: ts.PropertyName): string | undefined =>
  ts.isIdentifier(n) || ts.isStringLiteral(n) ? n.text : undefined;

/** The members of `c`: its own, then those of its bases in the same file that it does not
 *  declare again. A static function is the class's own only. */
function membersOf(c: ClassCase): Member[] {
  const out: Member[] = [];
  const seen = new Set<string>();
  let decl: ts.ClassDeclaration | undefined = c.decl;
  let own = true;
  while (decl !== undefined) {
    const owner = decl.name!.text;
    for (const el of decl.members) {
      const isStatic = hasModifier(el, ts.SyntaxKind.StaticKeyword);
      if (isStatic && !own) continue;
      let kind: Member['kind'];
      if (ts.isMethodDeclaration(el)) {
        if (el.body === undefined) continue; // an overload signature, or an abstract method
        kind = isStatic ? 'static' : 'method';
      } else if (ts.isGetAccessorDeclaration(el) && !isStatic) kind = 'getter';
      else if (ts.isSetAccessorDeclaration(el) && !isStatic) kind = 'setter';
      else continue;
      const hidden =
        ts.isPrivateIdentifier(el.name) ||
        hasModifier(el, ts.SyntaxKind.PrivateKeyword) ||
        hasModifier(el, ts.SyntaxKind.ProtectedKeyword);
      const name = ts.isPrivateIdentifier(el.name) ? el.name.text : memberName(el.name);
      if (name === undefined) continue;
      const tag = kind === 'getter' ? `get_${name}` : kind === 'setter' ? `set_${name}` : name;
      if (seen.has(tag)) continue;
      seen.add(tag);
      out.push({
        kind,
        name,
        tag: tag.replace(/^#/, ''),
        owner,
        generic: ts.isMethodDeclaration(el) && (el.typeParameters?.length ?? 0) > 0,
        takesFunction: el.parameters.some(
          (p) => p.type !== undefined && (ts.isFunctionTypeNode(p.type) || isFunctionAlias(c, p)),
        ),
        hidden,
      });
    }
    const base: ts.Expression | undefined = decl.heritageClauses?.find(
      (h) => h.token === ts.SyntaxKind.ExtendsKeyword,
    )?.types[0]?.expression;
    decl = base !== undefined && ts.isIdentifier(base) ? c.classes.get(base.text) : undefined;
    own = false;
  }
  return out;
}

/** Whether a parameter's type names a type alias of the file that is a function type. */
function isFunctionAlias(c: ClassCase, p: ts.ParameterDeclaration): boolean {
  if (p.type === undefined || !ts.isTypeReferenceNode(p.type)) return false;
  const name = p.type.typeName.getText();
  const alias = c.decl
    .getSourceFile()
    .statements.find(
      (s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === name,
    );
  return alias !== undefined && ts.isFunctionTypeNode(alias.type);
}

// ─── types ───────────────────────────────────────────────────────────────────────────────────

/** Why a storage buffer of the twin cannot hold `t`, or undefined when it can. */
function unstorable(
  t: ShaderType,
  structs: ReadonlyMap<string, StructDecl>,
  at: string,
): string | undefined {
  switch (t.kind) {
    case 'scalar':
      return t.scalar === 'bool'
        ? `${at} is a bool, which a storage buffer cannot hold (WGSL's host-shareable types)`
        : undefined;
    case 'vec':
      return t.elem === 'bool'
        ? `${at} is a vector of bool, which a storage buffer cannot hold (WGSL's host-shareable types)`
        : undefined;
    case 'mat':
      return t.elem === 'f64'
        ? `${at} is an emulated f64, which the f32 oracle does not hold bit for bit`
        : undefined;
    case 'f64':
    case 'vec64':
      return `${at} is an emulated f64, which the f32 oracle does not hold bit for bit`;
    case 'struct': {
      const decl = structs.get(t.name);
      if (decl === undefined) return `${at} is ${t.name}, which the module does not declare`;
      for (const f of decl.fields) {
        const why = unstorable(f.type, structs, `field ${t.name}.${f.name}`);
        if (why !== undefined) return why;
      }
      return undefined;
    }
    case 'array':
      return t.size === undefined
        ? `${at} is an array with no size, which only a binding or a kernel function holds`
        : unstorable(t.elem, structs, at);
    default:
      return `${at} is a ${authorTypeText(t)}, which a storage buffer cannot hold`;
  }
}

/** The struct names `t` spells, which a twin must import. */
function structNames(t: ShaderType, out = new Set<string>()): Set<string> {
  if (t.kind === 'struct') out.add(t.name);
  else if (t.kind === 'array') structNames(t.elem, out);
  return out;
}

/** The scalar each number of `t` is, in the order `numbersOf` lists them. */
function isFloat(t: ShaderType): boolean {
  return (
    (t.kind === 'scalar' && t.scalar === 'f32') ||
    (t.kind === 'vec' && t.elem === 'f32') ||
    t.kind === 'mat'
  );
}

/** Every number of a value of `t`, with whether it is a float and where it is (`z`, `gains[1]`),
 *  in the struct's field order. */
interface Numbers {
  readonly v: number[];
  readonly f: boolean[];
  readonly at: string[];
}
const numbers = (): Numbers => ({ v: [], f: [], at: [] });

function numbersOf(
  t: ShaderType,
  v: unknown,
  structs: ReadonlyMap<string, StructDecl>,
  into: Numbers,
  at: string,
): void {
  switch (t.kind) {
    case 'scalar':
      into.v.push(Number(v));
      into.f.push(isFloat(t));
      into.at.push(at);
      return;
    case 'vec':
    case 'mat': {
      const lanes = t.kind === 'vec' ? t.n : t.cols * t.rows;
      const xs = v as ArrayLike<number>;
      for (let k = 0; k < lanes; k++) {
        into.v.push(Number(xs[k]));
        into.f.push(isFloat(t));
        into.at.push(`${at}[${String(k)}]`);
      }
      return;
    }
    case 'struct': {
      const o = v as Record<string, unknown>;
      for (const f of structs.get(t.name)!.fields)
        numbersOf(f.type, o[f.name], structs, into, at === '' ? f.name : `${at}.${f.name}`);
      return;
    }
    case 'array': {
      const xs = v as readonly unknown[];
      for (let k = 0; k < (t.size ?? 0); k++)
        numbersOf(t.elem, xs[k], structs, into, `${at}[${String(k)}]`);
      return;
    }
    default:
      throw new Error(`the class arm reads no ${authorTypeText(t)}`);
  }
}

/** Whether the host value of an array of `t` is a typed array (Rule 8.21): a scalar's or a
 *  vector's components one after another; every other element is an array of host values. */
function typedOf(t: ShaderType): 'f32' | 'i32' | 'u32' | undefined {
  if (t.kind === 'scalar' && t.scalar !== 'bool') return t.scalar;
  if (t.kind === 'vec' && t.elem !== 'bool') return t.elem;
  return undefined;
}

/** Element `i` of an array of `t` as a leg returns it: a typed array's lanes, read flat, or the
 *  element of an array of values. */
function elementAt(container: readonly unknown[], i: number, t: ShaderType): unknown {
  if (t.kind === 'vec' && typeof container[0] === 'number')
    return container.slice(i * t.n, (i + 1) * t.n);
  return container[i];
}

// ─── the inputs ──────────────────────────────────────────────────────────────────────────────

/** A draw of `t` from the word stream `next`. */
function draw(
  t: ShaderType,
  structs: ReadonlyMap<string, StructDecl>,
  next: () => number,
): CpuValue {
  const scalar = (s: string): number => {
    const u = uniform(next());
    if (s === 'f32') return Math.round((u * 8 - 4) * 8) / 8;
    if (s === 'i32') return Math.floor(u * 64) - 32;
    return Math.floor(u * 64);
  };
  switch (t.kind) {
    case 'scalar':
      return scalar(t.scalar);
    case 'vec':
      return Array.from({ length: t.n }, () => scalar(t.elem));
    case 'mat':
      return Array.from({ length: t.cols * t.rows }, () => scalar('f32'));
    case 'struct': {
      const o: Record<string, CpuValue> = {};
      for (const f of structs.get(t.name)!.fields) o[f.name] = draw(f.type, structs, next);
      return o;
    }
    case 'array':
      return Array.from({ length: t.size ?? 0 }, () => draw(t.elem, structs, next)) as CpuValue;
    default:
      throw new Error(`the class arm draws no ${authorTypeText(t)}`);
  }
}

/** The arguments of element `i`: its constructor's and its member's, drawn by `typeshade/random`
 *  from the element's index and the member's seed. */
function argsOf(
  ctor: readonly ShaderType[],
  params: readonly ShaderType[],
  structs: ReadonlyMap<string, StructDecl>,
  seed: number,
): Record<string, CpuValue>[] {
  return Array.from({ length: N }, (_, i) => {
    let k = 0;
    const next = (): number => hash32((seed ^ Math.imul(i, 0x9e3779b1) ^ (k++ * 0x85ebca6b)) >>> 0);
    const o: Record<string, CpuValue> = {};
    ctor.forEach((t, j) => (o[`c${String(j)}`] = draw(t, structs, next)));
    params.forEach((t, j) => (o[`a${String(j)}`] = draw(t, structs, next)));
    return o;
  });
}

/** A seed from a name, so each member draws its own stream. */
function seedOf(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

// ─── the probes ──────────────────────────────────────────────────────────────────────────────

/** The reasons the host face gives a generic function and one that takes a function, read from
 *  the face itself so that a member is refused in its words (one authority). */
function faceReasons(): { generic: string; takesFunction: string } {
  const file = join(ROOT, 'journeys/class-twins/__class_arm_reasons.shade.ts');
  const source = `"use typeshade";
export function generic_<T>(x: T): T {
  return x;
}
export function takes_(f: (x: f32) => f32): f32 {
  return f(1.);
}
`;
  const face = hostFace(source, { fileName: file, readDocument: read, fuse: false });
  const reason = (name: string): string => {
    const e = face.exports?.find((x) => x.name === name);
    if (e?.kind !== 'never')
      throw new Error(`the host face no longer refuses ${name}: ${JSON.stringify(e)}`);
    return e.reason;
  };
  return { generic: reason('generic_'), takesFunction: reason('takes_') };
}

/** The specifier a module beside the corpus file imports it by. */
const specifierOf = (c: ClassCase): string => `./${basename(c.file)}`;

/** The import line of a twin or a probe: `C` and the struct types its signatures spell. */
function importLine(c: ClassCase, types: Iterable<ShaderType>): { line: string; missing?: string } {
  const names = new Set<string>([c.name]);
  for (const t of types) for (const s of structNames(t)) names.add(s);
  for (const n of names)
    if (!c.exported.has(n))
      return {
        line: '',
        missing: `it spells ${n}, which ${c.rel} does not export, so no other module can name it`,
      };
  return {
    line: `import { ${[...names].sort().join(', ')} } from ${JSON.stringify(specifierOf(c))};`,
  };
}

/** The IR function a member of `c` lowers to, as the class's own copy. */
const fnNameOf = (c: ClassCase, m: Member): string => `${c.name}_${m.tag}`;

/** Whether the host face lets a host call the member, read from a probe module that exports one
 *  function calling it (Rule 8.20); the reason when it does not. */
function probe(c: ClassCase, m: Member, f: FuncDecl): string | undefined {
  const params = m.kind === 'static' ? f.params : f.params.slice(1);
  const result = f.ret.kind === 'void' ? undefined : f.ret;
  const types = [...params.map((p) => p.type), ...(result !== undefined ? [result] : [])];
  const imp = importLine(c, types);
  if (imp.missing !== undefined) return imp.missing;
  const list = params.map((p, j) => `a${String(j)}: ${authorTypeText(p.type)}`);
  const args = params.map((_, j) => `a${String(j)}`).join(', ');
  const self = m.kind === 'static' ? [] : [`o: ${c.name}`];
  const sig = [...self, ...list].join(', ');
  const ret = result === undefined ? 'void' : authorTypeText(result);
  const body =
    m.kind === 'static'
      ? `  return ${c.name}.${m.name}(${args});`
      : m.kind === 'getter'
        ? `  let c = o;\n  return c.${m.name};`
        : m.kind === 'setter'
          ? `  let c = o;\n  c.${m.name} = a0;`
          : result === undefined
            ? `  let c = o;\n  c.${m.name}(${args});`
            : `  let c = o;\n  return c.${m.name}(${args});`;
  const file = join(dirname(c.file), `__class_probe_${c.name}_${m.tag}.shade.ts`);
  const source = `"use typeshade";\n${imp.line}\nexport function probe_(${sig}): ${ret} {\n${body}\n}\n`;
  const face = hostFace(source, { fileName: file, readDocument: read, fuse: false });
  const errors = face.diagnostics.filter((d) => d.category === 'error');
  if (errors.length > 0)
    throw new Error(
      `the probe of ${c.name}.${m.name} does not compile: ${errors.map((d) => `${d.code} ${d.message}`).join('; ')}\n${source}`,
    );
  const e = face.exports?.find((x) => x.name === 'probe_');
  if (e === undefined) throw new Error(`the probe of ${c.name}.${m.name} has no export`);
  return e.kind === 'function' ? undefined : e.kind === 'never' ? e.reason : `it is a ${e.kind}`;
}

/** Whether the host face lets a host build the class with its constructor's arguments; the
 *  reason when it does not. */
function probeConstructor(c: ClassCase, f: FuncDecl): string | undefined {
  const imp = importLine(
    c,
    f.params.map((p) => p.type),
  );
  if (imp.missing !== undefined) return imp.missing;
  const sig = f.params.map((p, j) => `c${String(j)}: ${authorTypeText(p.type)}`).join(', ');
  const args = f.params.map((_, j) => `c${String(j)}`).join(', ');
  const file = join(dirname(c.file), `__class_probe_${c.name}_new.shade.ts`);
  const source = `"use typeshade";\n${imp.line}\nexport function probe_(${sig}): ${c.name} {\n  return new ${c.name}(${args});\n}\n`;
  const face = hostFace(source, { fileName: file, readDocument: read, fuse: false });
  const errors = face.diagnostics.filter((d) => d.category === 'error');
  if (errors.length > 0)
    throw new Error(
      `the probe of new ${c.name} does not compile: ${errors.map((d) => `${d.code} ${d.message}`).join('; ')}\n${source}`,
    );
  const e = face.exports?.find((x) => x.name === 'probe_');
  return e?.kind === 'function' ? undefined : e?.kind === 'never' ? e.reason : 'it has no probe';
}

// ─── the twins ───────────────────────────────────────────────────────────────────────────────

/** One admissible member of a twin. */
interface TwinMember {
  readonly m: Member;
  readonly fn: FuncDecl;
  readonly params: readonly ShaderType[];
  readonly result?: ShaderType;
  /** The rows of the determinism report for what the member and the constructor reach. */
  readonly rows: readonly string[];
  readonly reach: ReadonlySet<Reach>;
}

/** The twin module of one class, compiled, with its host face. */
interface Twin {
  readonly c: ClassCase;
  readonly ctor: readonly ShaderType[];
  readonly members: readonly TwinMember[];
  readonly source: string;
  readonly fileName: string;
  readonly module: ModuleDecl;
  readonly exports: readonly HostExport[];
  readonly code: string;
}

/** The twin module's source for `c` and its admissible members. */
function twinSource(
  c: ClassCase,
  ctor: readonly ShaderType[],
  members: readonly TwinMember[],
): string {
  const types = [
    ...ctor,
    ...members.flatMap((t) => [...t.params, ...(t.result ? [t.result] : [])]),
  ];
  const lines = ['"use typeshade";', importLine(c, types).line, ''];
  for (const t of members) {
    const tag = t.m.tag;
    const fields = [
      ...ctor.map((ty, j) => `  c${String(j)}: ${authorTypeText(ty)};`),
      ...t.params.map((ty, j) => `  a${String(j)}: ${authorTypeText(ty)};`),
    ];
    const hasArgs = fields.length > 0;
    if (hasArgs) lines.push(`class Args_${tag} {`, ...fields, '}');
    lines.push(`declare const ${tag}_xs: storage<array<${c.name}>, "read_write">;`);
    if (hasArgs) lines.push(`declare const ${tag}_args: storage<array<Args_${tag}>, "read">;`);
    if (t.result !== undefined)
      lines.push(
        `declare const ${tag}_out: storage<array<${authorTypeText(t.result)}>, "read_write">;`,
      );
    const built = (args: string): string =>
      `new ${c.name}(${ctor.map((_, j) => `${args}[i].c${String(j)}`).join(', ')})`;
    const call = (obj: string, args: string): string => {
      const a = t.params.map((_, j) => `${args}[i].a${String(j)}`).join(', ');
      if (t.m.kind === 'static') return `${c.name}.${t.m.name}(${a})`;
      if (t.m.kind === 'getter') return `${obj}.${t.m.name}`;
      if (t.m.kind === 'setter') return `${obj}.${t.m.name} = ${a}`;
      return `${obj}.${t.m.name}(${a})`;
    };
    lines.push(
      '',
      '@compute([64])',
      `export function twin_${tag}(@builtin("global_invocation_id") gid: vec3u): void {`,
      '  const i = gid.x;',
      `  if (i >= arrayLength(${tag}_xs)) {`,
      '    return;',
      '  }',
      `  let o = ${built(`${tag}_args`)};`,
      t.result !== undefined
        ? `  ${tag}_out[i] = ${call('o', `${tag}_args`)};`
        : `  ${call('o', `${tag}_args`)};`,
      `  ${tag}_xs[i] = o;`,
      '}',
      '',
      `export function loop_${tag}(${[
        ...(t.result !== undefined ? [`out: array<${authorTypeText(t.result)}>`] : []),
        `xs: array<${c.name}>`,
        ...(hasArgs ? [`args: array<Args_${tag}>`] : []),
      ].join(', ')}): void {`,
      '  for (let i: u32 = 0; i < xs.length; i++) {',
      `    xs[i] = ${built('args')};`,
      t.result !== undefined
        ? `    out[i] = ${call('xs[i]', 'args')};`
        : `    ${call('xs[i]', 'args')};`,
      '  }',
      '}',
      '',
    );
  }
  return lines.join('\n');
}

/** What the class arm makes of one class: its twin, or why it holds none. */
type Planned =
  | { readonly twin: Twin; readonly skipped: readonly string[] }
  | { readonly skip: string; readonly skipped: readonly string[] };

function plan(c: ClassCase, reasons: { generic: string; takesFunction: string }): Planned {
  const where = `${c.name} (${c.rel})`;
  const structs = new Map(c.module.structs.map((s) => [s.name, s]));
  if ((c.decl.typeParameters?.length ?? 0) > 0)
    return {
      skip: `${where}: it is generic, and a generic class exists only as the instances the module uses (Rule 8.9)`,
      skipped: [],
    };
  if (hasModifier(c.decl, ts.SyntaxKind.AbstractKeyword))
    return {
      skip: `${where}: it is abstract, a base and never a value (surface §26)`,
      skipped: [],
    };
  const struct = structs.get(c.name);
  if (struct === undefined)
    return { skip: `${where}: it was not lowered to a struct of the module`, skipped: [] };
  const storeWhy = unstorable({ kind: 'struct', name: c.name }, structs, c.name);
  if (storeWhy !== undefined) return { skip: `${where}: ${storeWhy}`, skipped: [] };
  const funcs = new Map(c.module.funcs.map((f) => [f.name, f]));
  const ctorFn = funcs.get(`${c.name}_new`);
  if (ctorFn === undefined)
    return { skip: `${where}: it has no constructor function ${c.name}_new`, skipped: [] };
  const ctor = ctorFn.params.map((p) => p.type);
  for (const [j, t] of ctor.entries()) {
    const why = unstorable(t, structs, `constructor parameter ${String(j + 1)}`);
    if (why !== undefined)
      return { skip: `${where}: its constructor cannot be called by the arm: ${why}`, skipped: [] };
  }
  const ctorWhy = probeConstructor(c, ctorFn);
  if (ctorWhy !== undefined)
    return {
      skip: `${where}: its constructor cannot be called by the arm: ${ctorWhy}`,
      skipped: [],
    };
  const declared = new Set(c.module.funcs.map((f) => f.name));
  const callees = new Map(c.module.funcs.map((f) => [f.name, calleesOf(f, declared)]));
  const report = determinismReport(c.module).filter((r) => r.kind !== 'order');
  const skipped: string[] = [];
  const members: TwinMember[] = [];
  for (const m of membersOf(c)) {
    const label = `${c.name}.${m.kind === 'getter' ? `get ${m.name}` : m.kind === 'setter' ? `set ${m.name}` : m.name}`;
    if (m.hidden) {
      skipped.push(
        `${label}: it is private or protected, which only the class's own bodies may name (Rules 8.12 and 8.15)`,
      );
      continue;
    }
    if (m.generic) {
      skipped.push(`${label}: ${reasons.generic}`);
      continue;
    }
    if (m.takesFunction) {
      skipped.push(`${label}: ${reasons.takesFunction}`);
      continue;
    }
    const f = funcs.get(fnNameOf(c, m));
    if (f === undefined) {
      skipped.push(`${label}: it was not lowered to one function of the module, ${fnNameOf(c, m)}`);
      continue;
    }
    const params = (m.kind === 'static' ? f.params : f.params.slice(1)).map((p) => p.type);
    const result = f.ret.kind === 'void' ? undefined : f.ret;
    const why = probe(c, m, f);
    if (why !== undefined) {
      skipped.push(`${label}: ${why}`);
      continue;
    }
    const store = [
      ...params.map((t, j) => unstorable(t, structs, `parameter ${String(j + 1)}`)),
      result && unstorable(result, structs, 'its result'),
    ].find((w) => w !== undefined);
    if (store !== undefined) {
      skipped.push(`${label}: ${store}`);
      continue;
    }
    const reached = new Set([...closureOf(f.name, callees), ...closureOf(ctorFn.name, callees)]);
    const rows = report
      .filter((r) => r.where.some((w) => reached.has(w)))
      .map((r) => `${r.op} (${r.kind})`);
    const reach = new Set<Reach>();
    const self = f.params[0];
    if (m.kind === 'method')
      reach.add(
        self?.name === 'self_' && self.mode === 'inout'
          ? 'a method that changes its object'
          : 'a method that reads its object',
      );
    if (m.kind === 'static') reach.add('a static function');
    if (m.kind === 'getter') reach.add('a getter');
    if (m.kind === 'setter') reach.add('a setter');
    if (m.owner !== c.name) reach.add('a member a base class declares');
    if (
      [...closureOf(f.name, callees)].some(
        (g) => !g.startsWith(`${c.name}_`) && funcs.get(g)?.params.some((p) => p.mode === 'inout'),
      )
    )
      reach.add('a member that hands a field to an @inout parameter');
    reach.add(
      ctor.length > 0 ? 'a constructor with arguments' : 'a class built from its initializers',
    );
    if (result?.kind === 'vec') reach.add('a vector result');
    members.push({ m, fn: f, params, ...(result !== undefined ? { result } : {}), rows, reach });
  }
  if (members.length === 0)
    return {
      skip: `${where}: no member a host could call${skipped.length > 0 ? `: ${skipped.join('; ')}` : ''}`,
      skipped: [],
    };
  const source = twinSource(c, ctor, members);
  const fileName = join(dirname(c.file), `__class_twin_${c.name}.shade.ts`);
  // Both halves read the twin (CLAUDE.md, "A test reads both halves"): the compiler and the
  // editor must both take it as written.
  const r = compile(source, { fileName, readDocument: read });
  const service = createTypeshadeLanguageService({ readDocument: read });
  service.openDocument(fileName, source);
  const editor = service.getDiagnostics(fileName);
  if (r.diagnostics.length > 0 || editor.length > 0 || r.module === undefined)
    throw new Error(
      `the twin of ${where} does not read clean: ${[
        ...r.diagnostics.map((d) => `compiler ${d.code} ${d.message}`),
        ...editor.map((d) => `editor ${String(d.code)} ${d.message}`),
      ].join('; ')}\n${source}`,
    );
  const face = hostFace(source, { fileName, runtime: RUNTIME, readDocument: read, fuse: false });
  if (face.code === undefined || face.exports === undefined)
    throw new Error(
      `the twin of ${where} has no host face: ${face.diagnostics.map((d) => d.message).join('; ')}`,
    );
  return {
    twin: {
      c,
      ctor,
      members,
      source,
      fileName,
      module: r.module,
      exports: face.exports,
      code: face.code,
    },
    skipped,
  };
}

// ─── the reference and the oracle legs ───────────────────────────────────────────────────────

/** What one leg gave for one member: the objects after the calls, and the results. */
interface Outcome {
  readonly xs: readonly unknown[];
  readonly out?: readonly unknown[];
}

/** The inputs of one member's calls. */
interface Inputs {
  readonly args?: readonly Record<string, CpuValue>[];
  readonly xs: readonly CpuValue[];
}

const cloneOf = <T>(v: T): T => structuredClone(v);

/** The reference: for each element, `C_new` and then the member's function on the oracle. */
function referenceOf(t: Twin, tm: TwinMember, inputs: Inputs, cpu: CpuModule): Outcome {
  const xs: CpuValue[] = [];
  const out: CpuValue[] = [];
  for (let i = 0; i < N; i++) {
    const a = inputs.args?.[i] ?? {};
    const o = cpu.fns[`${t.c.name}_new`]!(...t.ctor.map((_, j) => cloneOf(a[`c${String(j)}`]!)));
    const params = tm.params.map((_, j) => cloneOf(a[`a${String(j)}`]!));
    const r =
      tm.m.kind === 'static' ? cpu.fns[tm.fn.name]!(...params) : cpu.fns[tm.fn.name]!(o, ...params);
    xs.push(o);
    if (tm.result !== undefined) out.push(r);
  }
  return { xs, ...(tm.result !== undefined ? { out } : {}) };
}

/** The twin's entry dispatched on the oracle over the same bindings. */
function entryOnOracle(t: Twin, tm: TwinMember, inputs: Inputs, cpu: CpuModule): Outcome {
  const tag = tm.m.tag;
  const structs = new Map(t.module.structs.map((s) => [s.name, s]));
  const xs = cloneOf(inputs.xs) as CpuValue[];
  cpu.setBinding(`${tag}_xs`, xs as unknown as CpuValue);
  if (inputs.args !== undefined)
    cpu.setBinding(`${tag}_args`, cloneOf(inputs.args) as unknown as CpuValue);
  const out =
    tm.result === undefined
      ? undefined
      : Array.from({ length: N }, () => zeroOf(tm.result!, structs));
  if (out !== undefined) cpu.setBinding(`${tag}_out`, out as unknown as CpuValue);
  cpu.dispatch(`twin_${tag}`, [Math.ceil(N / WORKGROUP), 1, 1]);
  return { xs, ...(out !== undefined ? { out } : {}) };
}

/** The twin's kernel function called on the oracle with the same arrays. */
function kernelOnOracle(t: Twin, tm: TwinMember, inputs: Inputs, cpu: CpuModule): Outcome {
  const structs = new Map(t.module.structs.map((s) => [s.name, s]));
  const xs = cloneOf(inputs.xs) as CpuValue[];
  const out =
    tm.result === undefined
      ? undefined
      : Array.from({ length: N }, () => zeroOf(tm.result!, structs));
  cpu.fns[`loop_${tm.m.tag}`]!(
    ...([
      ...(out !== undefined ? [out] : []),
      xs,
      ...(inputs.args !== undefined ? [cloneOf(inputs.args)] : []),
    ] as unknown as CpuValue[]),
  );
  return { xs, ...(out !== undefined ? { out } : {}) };
}

// ─── the comparison ──────────────────────────────────────────────────────────────────────────

const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);
/** The f32 bit distance between two numbers of one sign. */
function ulps(a: number, b: number): number {
  F32[0] = a;
  const x = U32[0]!;
  F32[0] = b;
  const y = U32[0]!;
  if ((x ^ y) & 0x80000000) return Infinity;
  return Math.abs(x - y);
}

/** The largest distance a leg showed: in ULP among values of magnitude 1/16 or more (a value near
 *  zero is many ULP from a near one), and absolute. */
interface Distance {
  ulp: number;
  abs: number;
  values: number;
}

/** The first element where `got` differs from `want`, bit for bit or past the envelope when
 *  the member has determinism rows, in words; the distances seen are added to `d`. */
function compare(
  t: Twin,
  tm: TwinMember,
  want: Outcome,
  got: Outcome,
  d: Distance,
): { diff?: string; at?: number } {
  const structs = new Map(t.module.structs.map((s) => [s.name, s]));
  const cls: ShaderType = { kind: 'struct', name: t.c.name };
  if (got.xs.length < N)
    return { diff: `the objects: ${String(got.xs.length)} of ${String(N)} came back` };
  for (let i = 0; i < N; i++) {
    const w = numbers();
    const g = numbers();
    try {
      if (tm.result !== undefined) {
        numbersOf(tm.result, elementAt(want.out!, i, tm.result), structs, w, 'the result');
        numbersOf(tm.result, elementAt(got.out ?? [], i, tm.result), structs, g, 'the result');
      }
      numbersOf(cls, want.xs[i], structs, w, t.c.name);
      numbersOf(cls, got.xs[i], structs, g, t.c.name);
    } catch (e) {
      return { diff: `element ${String(i)}: ${String(e)}`, at: i };
    }
    for (let k = 0; k < w.v.length; k++) {
      const a = w.v[k]!;
      const b = g.v[k]!;
      const where = `element ${String(i)}, ${w.at[k]!}`;
      d.values += 1;
      if (Object.is(a, b) || (a === 0 && b === 0)) continue;
      if (!w.f[k]) return { diff: `${where}: oracle ${String(a)} ≠ ${String(b)}`, at: i };
      // A NaN or an infinity, and a subnormal a GPU flushes, carry no claim (as the kernel arm
      // reads them).
      if (!Number.isFinite(a)) continue;
      if (Math.abs(a) < 2 ** -126 && b === 0) continue;
      if (tm.rows.length === 0)
        return { diff: `${where}: oracle ${String(a)} ≠ ${String(b)}`, at: i };
      const u = ulps(a, b);
      if (Math.abs(a - b) <= ABS_ENVELOPE || u <= ULP_ENVELOPE) {
        d.abs = Math.max(d.abs, Math.abs(a - b));
        if (Math.abs(a) >= 1 / 16 && Number.isFinite(u)) d.ulp = Math.max(d.ulp, u);
        continue;
      }
      return { diff: `${where}: oracle ${String(a)} ≠ ${String(b)} (${String(u)} ULP)`, at: i };
    }
  }
  return {};
}

// ─── the page ────────────────────────────────────────────────────────────────────────────────

/** One call the page makes. */
interface PageJob {
  readonly twin: number;
  readonly kind: 'entry' | 'kernel';
  readonly name: string;
  readonly tag: string;
  readonly tier: Tier;
  readonly xs: readonly unknown[];
  readonly args?: readonly unknown[];
  /** The results' array: a typed array of `length` numbers, or these values. */
  readonly out?:
    | { readonly typed: 'f32' | 'i32' | 'u32'; readonly length: number }
    | { readonly values: readonly unknown[] };
}

interface PageResult {
  readonly xs?: unknown[];
  readonly out?: unknown[];
  readonly error?: string;
}

/** The part of Bun's bundler this uses. */
interface Bundler {
  build(o: { entrypoints: string[]; target: 'browser'; format: 'esm'; minify: boolean }): Promise<{
    success: boolean;
    logs: unknown[];
    outputs: { text(): Promise<string> }[];
  }>;
}

/** Every twin's generated module and the runtime's `configure`, bundled for the browser as a
 *  host's bundler bundles them, as one script that sets `globalThis.__classTwins`. */
async function bundleOf(twins: readonly Twin[]): Promise<string> {
  const bun = (globalThis as { Bun?: Bundler }).Bun;
  if (bun === undefined) throw new Error('the class arm needs Bun: run it with bun');
  const tmp = mkdtempSync(join(tmpdir(), 'typeshade-class-'));
  try {
    twins.forEach((t, i) => writeFileSync(join(tmp, `t${String(i)}.mjs`), t.code));
    const entry = join(tmp, 'entry.ts');
    writeFileSync(
      entry,
      [
        `import { configure } from ${JSON.stringify(RUNTIME)};`,
        ...twins.map((_, i) => `import * as t${String(i)} from './t${String(i)}.mjs';`),
        `(globalThis as Record<string, unknown>).__classTwins = { configure, twins: [${twins.map((_, i) => `t${String(i)}`).join(', ')}] };`,
        '',
      ].join('\n'),
    );
    const built = await bun.build({
      entrypoints: [entry],
      target: 'browser',
      format: 'esm',
      minify: false,
    });
    if (!built.success) throw new Error(`bundling the twins failed: ${JSON.stringify(built.logs)}`);
    return await built.outputs[0]!.text();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Serve the bundle on loopback, with CORS, so the gate's page may import it. */
function serveBundle(js: string): Promise<Server> {
  return new Promise((ok) => {
    const server = createServer((req, res) => {
      res.setHeader('access-control-allow-origin', '*');
      if (req.url !== '/class-twins.js') {
        res.statusCode = 404;
        res.end('not here');
        return;
      }
      res.setHeader('content-type', 'text/javascript; charset=utf-8');
      res.end(js);
    });
    server.listen(0, '127.0.0.1', () => ok(server));
  });
}

/** Runs INSIDE the browser: import the bundle, then make each call on its one tier. */
async function callsInPage(input: {
  url: string;
  jobs: readonly PageJob[];
}): Promise<PageResult[]> {
  await import(/* @vite-ignore */ input.url);
  const g = (globalThis as Record<string, unknown>)['__classTwins'] as {
    configure: (o: { prefer?: string[] }) => void;
    twins: Record<string, (...a: unknown[]) => Promise<unknown>>[];
  };
  const typed = { f32: Float32Array, i32: Int32Array, u32: Uint32Array } as const;
  const plain = (v: unknown): unknown =>
    ArrayBuffer.isView(v)
      ? Array.from(v as unknown as ArrayLike<number>)
      : Array.isArray(v)
        ? v.map(plain)
        : typeof v === 'object' && v !== null
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]))
          : v;
  const results: PageResult[] = [];
  for (const job of input.jobs) {
    const xs = structuredClone(job.xs) as unknown[];
    const args = job.args === undefined ? undefined : (structuredClone(job.args) as unknown[]);
    const out =
      job.out === undefined
        ? undefined
        : 'typed' in job.out
          ? new typed[job.out.typed](job.out.length)
          : (structuredClone(job.out.values) as unknown[]);
    g.configure({ prefer: [job.tier] });
    try {
      const fn = g.twins[job.twin]![job.name]!;
      if (job.kind === 'entry') {
        const bindings: Record<string, unknown> = { [`${job.tag}_xs`]: xs };
        if (args !== undefined) bindings[`${job.tag}_args`] = args;
        if (out !== undefined) bindings[`${job.tag}_out`] = out;
        await fn(bindings, [Math.ceil(xs.length / 64), 1, 1]);
      } else
        await fn(...(out !== undefined ? [out] : []), xs, ...(args !== undefined ? [args] : []));
      results.push({
        xs: plain(xs) as unknown[],
        ...(out !== undefined ? { out: plain(out) as unknown[] } : {}),
      });
    } catch (e) {
      results.push({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      g.configure({});
    }
  }
  return results;
}

// ─── the arm ─────────────────────────────────────────────────────────────────────────────────

/** The reason the host face gives for a tier the twin's caller has no form on, if any. */
function refusalOf(t: Twin, tag: string, kind: 'entry' | 'kernel', tier: Tier): string | undefined {
  const e = t.exports.find((x) => x.name === `${kind === 'entry' ? 'twin' : 'loop'}_${tag}`);
  if (e?.kind === 'compute') {
    if (tier === 'webgl2') return e.entry.noGl;
    if (tier === 'cpu')
      return e.entry.barrier !== undefined
        ? `it reaches ${e.entry.barrier}, and a barrier has no CPU tier`
        : e.entry.noCpu;
    return undefined;
  }
  if (e?.kind === 'kernel') {
    if (tier === 'webgpu') return e.face.noGpu;
    if (tier === 'webgl2')
      return e.face.gl === undefined
        ? (e.face.noWebgl2 ?? e.face.noGpu ?? 'it has no WebGL2 program')
        : undefined;
    return undefined;
  }
  return `the twin has no ${kind} for it: ${e === undefined ? 'no export' : e.kind}`;
}

const memberLabel = (t: Twin, tm: TwinMember): string =>
  `${t.c.name}.${tm.m.kind === 'getter' ? `get ${tm.m.name}` : tm.m.kind === 'setter' ? `set ${tm.m.name}` : tm.m.name}`;

export async function classArm(page: Page): Promise<number> {
  let failures = 0;
  const fail = (line: string): void => {
    failures += 1;
    console.log(`FAIL  class ${line}`);
  };
  const reasons = faceReasons();
  // The corpus: every exported class of every file of each directory.
  const counts: string[] = [];
  const skipped: string[] = [];
  const twins: Twin[] = [];
  for (const { dir, files } of corpusFiles()) {
    let exporting = 0;
    let classes = 0;
    for (const file of files) {
      const found = classesOf(file);
      if (found.error !== undefined) fail(found.error);
      if (found.classes.length > 0) exporting += 1;
      classes += found.classes.length;
      for (const c of found.classes) {
        const p = plan(c, reasons);
        skipped.push(...p.skipped.map((s) => `${s} (${c.rel})`));
        if ('skip' in p) skipped.push(p.skip);
        else twins.push(p.twin);
      }
    }
    counts.push(
      `${dir}: ${String(files.length)} files, ${String(exporting)} of them export a class, ${String(classes)} classes`,
    );
  }
  console.log(`class arm: corpus ${counts.join('; ')}`);

  // The inputs, the reference and the oracle legs, per member.
  interface Case {
    readonly t: number;
    readonly tm: TwinMember;
    readonly inputs: Inputs;
    readonly want: Outcome;
  }
  const cases: Case[] = [];
  const oracleOutcomes = new Map<string, Outcome>();
  twins.forEach((t, ti) => {
    const structs = new Map(t.module.structs.map((s) => [s.name, s]));
    const cpu = compileModule(t.module, { precision: 'f32' });
    for (const tm of t.members) {
      const hasArgs = t.ctor.length + tm.params.length > 0;
      const args = hasArgs
        ? argsOf(t.ctor, tm.params, structs, seedOf(memberLabel(t, tm)))
        : undefined;
      const xs = Array.from({ length: N }, () =>
        zeroOf({ kind: 'struct', name: t.c.name }, structs),
      );
      const inputs: Inputs = { xs, ...(args !== undefined ? { args } : {}) };
      const want = referenceOf(t, tm, inputs, cpu);
      cases.push({ t: ti, tm, inputs, want });
      oracleOutcomes.set(
        `${String(cases.length - 1)} entry/oracle`,
        entryOnOracle(t, tm, inputs, cpu),
      );
      oracleOutcomes.set(
        `${String(cases.length - 1)} kernel/oracle`,
        kernelOnOracle(t, tm, inputs, cpu),
      );
    }
  });

  // The instrument: the first member whose reference differs between two neighbours, its entry on
  // WebGPU once more with that element given the next element's arguments.
  let instrument: { c: number; at: number; job: PageJob } | undefined;
  for (const [ci, k] of cases.entries()) {
    if (k.inputs.args === undefined) continue;
    const t = twins[k.t]!;
    const structs = new Map(t.module.structs.map((s) => [s.name, s]));
    const key = (i: number): string => {
      const into = numbers();
      if (k.tm.result !== undefined)
        numbersOf(k.tm.result, elementAt(k.want.out!, i, k.tm.result), structs, into, '');
      numbersOf({ kind: 'struct', name: t.c.name }, k.want.xs[i], structs, into, '');
      return into.v.join(',');
    };
    const at = Array.from({ length: N - 1 }, (_, i) => i).find((i) => key(i) !== key(i + 1));
    if (at === undefined) continue;
    const args = k.inputs.args.map((a, i) => (i === at ? k.inputs.args![at + 1]! : a));
    instrument = { c: ci, at, job: { ...jobOf(t, k, 'entry', 'webgpu'), args } };
    break;
  }

  // The page legs, every call in one evaluation.
  const jobs: { c: number; leg: Leg; job: PageJob }[] = [];
  for (const [ci, k] of cases.entries())
    for (const { kind, tier } of PAGE_LEGS)
      jobs.push({ c: ci, leg: `${kind}/${tier}`, job: jobOf(twins[k.t]!, k, kind, tier) });
  const server = await serveBundle(await bundleOf(twins));
  const port = (server.address() as AddressInfo).port;
  let results: PageResult[];
  try {
    results = await page.evaluate(callsInPage, {
      url: `http://127.0.0.1:${String(port)}/class-twins.js`,
      jobs: [...jobs.map((j) => j.job), ...(instrument !== undefined ? [instrument.job] : [])],
    });
  } finally {
    server.close();
  }

  // The comparison, leg by leg.
  const distances = new Map<Leg, Distance>(LEGS.map((l) => [l, { ulp: 0, abs: 0, values: 0 }]));
  const refused = new Map<string, string[]>();
  const held = new Set<string>();
  const classesHeld = new Set<string>();
  const reached = new Set<Reach>();
  let bitForBit = 0;
  let underEnvelope = 0;
  const check = (ci: number, leg: Leg, got: PageResult | Outcome): void => {
    const k = cases[ci]!;
    const t = twins[k.t]!;
    const label = memberLabel(t, k.tm);
    if ('error' in got && got.error !== undefined) {
      const [kind, tier] = leg.split('/') as ['entry' | 'kernel', Tier];
      const why = refusalOf(t, k.tm.m.tag, kind, tier);
      if (why === undefined) {
        fail(`${leg} ${label}: ${got.error.slice(0, 240)}`);
        return;
      }
      refused.set(`${leg}: ${why}`, [...(refused.get(`${leg}: ${why}`) ?? []), label]);
      return;
    }
    const outcome = got as Outcome;
    const d = distances.get(leg)!;
    const { diff } = compare(t, k.tm, k.want, outcome, d);
    if (diff !== undefined) {
      fail(`${leg} ${label}${k.tm.rows.length > 0 ? ` [${k.tm.rows.join(', ')}]` : ''}: ${diff}`);
      return;
    }
    if (k.tm.rows.length > 0) underEnvelope += 1;
    else bitForBit += 1;
    if (leg === 'entry/webgpu') {
      held.add(label);
      classesHeld.add(t.c.name);
      for (const r of k.tm.reach) reached.add(r);
    }
  };
  jobs.forEach((j, i) => check(j.c, j.leg, results[i]!));
  for (const [ci] of cases.entries())
    for (const leg of ['entry/oracle', 'kernel/oracle'] as const)
      check(ci, leg, oracleOutcomes.get(`${String(ci)} ${leg}`)!);

  // The instrument must be reported, at the element it changed.
  let instrumentLine: string;
  if (instrument === undefined) {
    fail(
      'the instrument: no member gives two neighbouring elements different results, so nothing can run wrong on purpose',
    );
    instrumentLine = 'not run';
  } else {
    const k = cases[instrument.c]!;
    const t = twins[k.t]!;
    const got = results[jobs.length]!;
    const label = memberLabel(t, k.tm);
    const { diff, at } =
      got.error !== undefined
        ? { diff: undefined, at: undefined }
        : compare(t, k.tm, k.want, got as Outcome, { ulp: 0, abs: 0, values: 0 });
    if (got.error !== undefined)
      fail(`the instrument: ${label} on entry/webgpu threw: ${got.error.slice(0, 200)}`);
    else if (diff === undefined || at !== instrument.at)
      fail(
        `the instrument: ${label} on entry/webgpu with element ${String(instrument.at)} given element ${String(instrument.at + 1)}'s arguments was ${diff === undefined ? 'not reported' : `reported at element ${String(at)}`}`,
      );
    instrumentLine = `${label} on entry/webgpu with element ${String(instrument.at)} given element ${String(instrument.at + 1)}'s arguments: ${diff !== undefined && at === instrument.at ? `reported (${diff})` : 'NOT reported'}`;
  }

  // The floors: the corpus must reach what the claim is about.
  if (classesHeld.size < CLASSES_FLOOR)
    fail(
      `the arm held ${String(classesHeld.size)} classes on WebGPU, under its floor of ${String(CLASSES_FLOOR)}`,
    );
  if (held.size < MEMBERS_FLOOR)
    fail(
      `the arm held ${String(held.size)} members on WebGPU, under its floor of ${String(MEMBERS_FLOOR)}`,
    );
  for (const r of REACH) if (!reached.has(r)) fail(`the corpus reaches no ${r} on WebGPU`);

  const values = [...distances.values()].reduce((n, d) => n + d.values, 0);
  for (const s of skipped) console.log(`class arm: skipped ${s}`);
  for (const [why, labels] of refused)
    console.log(
      `class arm: refused as Rule 11.8 allows, ${why}: ${[...new Set(labels)].join(', ')}`,
    );
  console.log(
    `class arm: largest distance per leg: ${LEGS.map((l) => {
      const d = distances.get(l)!;
      return d.values === 0
        ? `${l} none compared`
        : `${l} ${String(d.ulp)} ULP and ${d.abs === 0 ? '0' : d.abs.toExponential(2)} absolute over ${String(d.values)} values`;
    }).join('; ')}`,
  );
  console.log('host leg: not available (change 0109)');
  console.log(`class arm: instrument: ${instrumentLine}`);
  console.log(
    `class arm: ${String(classesHeld.size)} classes and ${String(held.size)} members of ${String(twins.length)} twins held on ${String(LEGS.length)} legs against the f32 oracle, ${String(values)} values, ` +
      `${String(bitForBit)} member legs held bit for bit and ${String(underEnvelope)} under the envelope of a determinism row · ` +
      `reached: ${[...reached].join(', ')} · failures: ${String(failures)}`,
  );
  return failures;
}

/** The page's call of one member on one leg, with fresh copies of its inputs. */
function jobOf(
  t: Twin,
  k: { readonly t: number; readonly tm: TwinMember; readonly inputs: Inputs },
  kind: 'entry' | 'kernel',
  tier: Tier,
): PageJob {
  const structs = new Map(t.module.structs.map((s) => [s.name, s]));
  const result = k.tm.result;
  const typed = result === undefined ? undefined : typedOf(result);
  const lanes = result?.kind === 'vec' ? result.n : 1;
  return {
    twin: k.t,
    kind,
    name: `${kind === 'entry' ? 'twin' : 'loop'}_${k.tm.m.tag}`,
    tag: k.tm.m.tag,
    tier,
    xs: k.inputs.xs,
    ...(k.inputs.args !== undefined ? { args: k.inputs.args } : {}),
    ...(result === undefined
      ? {}
      : typed !== undefined
        ? { out: { typed, length: N * lanes } }
        : { out: { values: Array.from({ length: N }, () => zeroOf(result, structs)) } }),
  };
}
