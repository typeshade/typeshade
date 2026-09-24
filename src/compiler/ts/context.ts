// Implements: Rule 6.2, the remedy a read-only resource names (docs/language-design.md; traced in reqs/).
// === Lowering context / symbol table ===

import type ts from 'typescript';
import type { ShaderType } from '../../core/ir/types.js';
import { CAS_RESULT_STRUCTS, typeKey } from '../../core/ir/types.js';
import { authorTypeName } from './type-map.js';
import type { AddressSpace, Expr } from '../../core/ir/nodes.js';
import type { FuncDecl, Stmt, StructDecl, StructField } from '../../core/ir/nodes.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import type { PrivateField, RestrictedField } from './structs.js';
import { recordDeclaration, type DeclaredSymbol, type DeclaredSymbolSink } from './symbols.js';
import type { FunctionShape } from './lower/function-types.js';
import type { ClassFunction } from './lower/class-methods.js';

/** Which fields of each struct are private, by struct and then by the member they are emitted
 *  as (Rule 8.12). */
export type PrivateFieldTable = ReadonlyMap<string, ReadonlyMap<string, PrivateField>>;

/** The members each struct's class declared and the struct does not carry, by struct: a read
 *  of one was already explained where it was declared (Rule 12.4). */
export type WithheldTable = ReadonlyMap<string, ReadonlySet<string>>;

/** The {@link WithheldTable} `structs` carry. */
export function withheldTableOf(
  structs: readonly { readonly decl: StructDecl; readonly withheld?: ReadonlySet<string> }[],
): WithheldTable {
  const out = new Map<string, ReadonlySet<string>>();
  for (const s of structs) {
    if (s.withheld !== undefined && s.withheld.size > 0) out.set(s.decl.name, s.withheld);
  }
  return out;
}

/** The `readonly` fields of each struct, with the class whose constructor may assign each. */
export type ReadonlyFieldTable = ReadonlyMap<string, ReadonlyMap<string, ts.ClassLikeDeclaration>>;

/** The `private` and `protected` fields of each struct (Rule 8.15). */
export type RestrictedFieldTable = ReadonlyMap<string, ReadonlyMap<string, RestrictedField>>;

/** The {@link RestrictedFieldTable} `structs` carry. */
export function restrictedFieldTableOf(
  structs: readonly {
    readonly decl: StructDecl;
    readonly restrictedFields?: ReadonlyMap<string, RestrictedField>;
  }[],
): RestrictedFieldTable {
  const out = new Map<string, ReadonlyMap<string, RestrictedField>>();
  for (const s of structs) {
    if (s.restrictedFields !== undefined && s.restrictedFields.size > 0) {
      out.set(s.decl.name, s.restrictedFields);
    }
  }
  return out;
}

/** The {@link ReadonlyFieldTable} `structs` carry. */
export function readonlyFieldTableOf(
  structs: readonly {
    readonly decl: StructDecl;
    readonly readonlyFields?: ReadonlyMap<string, ts.ClassLikeDeclaration>;
  }[],
): ReadonlyFieldTable {
  const out = new Map<string, ReadonlyMap<string, ts.ClassLikeDeclaration>>();
  for (const s of structs) {
    if (s.readonlyFields !== undefined && s.readonlyFields.size > 0) {
      out.set(s.decl.name, s.readonlyFields);
    }
  }
  return out;
}

/** The table `structs` carry, for a scope that is handed the collected list. */
export function privateFieldTableOf(
  structs: readonly {
    readonly decl: StructDecl;
    readonly privateFields?: ReadonlyMap<string, PrivateField>;
  }[],
): PrivateFieldTable {
  const out = new Map<string, ReadonlyMap<string, PrivateField>>();
  for (const s of structs) {
    if (s.privateFields !== undefined && s.privateFields.size > 0) {
      out.set(s.decl.name, s.privateFields);
    }
  }
  return out;
}

/** The names a file declares as functions and could not lower, one set per callee table
 *  (roadmap 0.3 item T10, #92). It hangs off the table instead of being threaded through every
 *  scope factory because it is the other half of the same thing: what this file's calls
 *  resolve against. A call to a name in here reports nothing — the declaration said why. */
/** How one instance of a generic function is made (roadmap 0.3 item T9, #92), or of a function
 *  that takes a function (Rule 8.18). `argTypes` are the call's arguments as they lowered, which
 *  is what the type arguments are read off when the call site writes none, with a hole where a
 *  parameter takes a function; `scope` is the calling body's, which the functions a call hands
 *  over are resolved in, an arrow function written there lifted out of, and what each captures
 *  read from. */
export type Instantiator = (
  name: string,
  node: ts.CallExpression,
  argTypes: readonly (ShaderType | undefined)[],
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  scope: LoweringScope,
) => FuncDecl | undefined;

/** How a call of a method, a static method or a constructor that takes a function finds its copy
 *  for the functions it hands over (Rule 8.18): the copy, and whether it takes its object by
 *  reference, which it does when the method writes it or a function handed over writes the
 *  variable `on` names. `on` is the object the call is on, undefined for a static or `new`. */
export type MemberInstantiator = (
  cf: ClassFunction,
  node: ts.CallExpression | ts.NewExpression,
  on: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  scope: LoweringScope,
) => { readonly decl: FuncDecl; readonly writes: boolean } | undefined;

/** How an arrow function or a function expression written as an argument becomes a function of
 *  the module (Rule 8.18): named after the body it is written in and `hint`, typed by `shape`
 *  where it writes no types of its own, and taking what it captures there (Rule 8.17). */
export type ArgumentLifter = (
  node: ts.ArrowFunction | ts.FunctionExpression,
  shape: FunctionShape,
  hint: string,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
) => FuncDecl | undefined;

/** How a function the front end builds itself joins the module: an array's method, one for
 *  each array type and function a call hands it (Rule 8.18, surface §63). `key` says which two
 *  calls may share one; `base` is the name it is made under, fresh; `shown` is how a message
 *  names it; `captures` are the variables its first parameters stand for, which a call passes
 *  as it passes a local function's (Rule 8.17). `build` makes it under the name it is given. */
export type FunctionBuilder = (
  key: string,
  base: string,
  shown: string,
  captures: readonly CaptureKey[],
  build: (name: string) => FuncDecl,
) => FuncDecl;

/** Whether a call of `decl` at `at` can be lowered now (Rule 8.19). A function that writes no
 *  return type says it in its body, so the first call that needs it before the body's turn
 *  lowers that body first. False, having said why or leaving it to the check that will, when
 *  the call closes a cycle through a body still being lowered, or the body said nothing it
 *  returns because it did not lower. */
export type BodyFiller = (
  decl: FuncDecl,
  at: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
) => boolean;

/** What a file's lowering knows about its own functions, beyond the callee table itself: the
 *  names it could not lower (T10, #92) and the generic ones, with the hook that makes an
 *  instance of one (T9, #92).
 *
 *  It hangs off the callee table instead of being threaded through every scope factory because
 *  it is the rest of the same thing: what this file's calls resolve against. Every scope built
 *  from one table reads one record. */
export interface FileFunctions {
  /** A call to a name in here reports nothing — its declaration already said why. */
  readonly refused: Set<string>;
  /** The generic functions, and those that take a function (Rule 8.18), under the emitted name
   *  a call resolves to: each is made once per set of type and function arguments. */
  readonly generics: Set<string>;
  instantiate: Instantiator | undefined;
  /** Makes the copy of a class's function that takes a function (Rule 8.18). */
  instantiateMember: MemberInstantiator | undefined;
  /** For each function in {@link generics} that takes a function, which parameters do. */
  readonly fnParams: Map<string, ReadonlySet<number>>;
  lift: ArgumentLifter | undefined;
  /** Adds a function the front end builds itself to the module (surface §63). */
  build: FunctionBuilder | undefined;
  /** Lowers the body of a function whose return type the body says, when a call needs it
   *  first (Rule 8.19); undefined where every function writes its return type. */
  ensure: BodyFiller | undefined;
  /** Each function's declarations as lowered so far, by the node that declares them (a `let`, a
   *  `const`, a parameter, and {@link THIS_CAPTURE} for its object), to the binding each made
   *  there. What a call to a local function passes for a variable the function captures (Rule
   *  8.17), and the type the function's parameter for it takes. */
  readonly declared: Map<FuncDecl, Map<CaptureKey, Binding>>;
  /** The variables each local function captures, by its emitted name, in the order of the
   *  parameters it takes for them, which lead its own (Rule 8.17). */
  readonly captures: Map<string, readonly CaptureKey[]>;
}

/** What a local function captures: the declaration of a variable, or the object of the method
 *  around it, `this` (Rule 8.17). */
export type CaptureKey = ts.Node | typeof THIS_CAPTURE;

/** The key {@link FileFunctions.declared} holds a method's object under. */
export const THIS_CAPTURE = 'this' as const;

const FILE_FUNCTIONS = new WeakMap<Map<string, FuncDecl>, FileFunctions>();

/** The record belonging to `callees`, created on first ask. */
export function fileFunctionsOf(callees: Map<string, FuncDecl>): FileFunctions {
  const found = FILE_FUNCTIONS.get(callees);
  if (found !== undefined) return found;
  const made: FileFunctions = {
    refused: new Set(),
    generics: new Set(),
    instantiate: undefined,
    instantiateMember: undefined,
    fnParams: new Map(),
    lift: undefined,
    build: undefined,
    ensure: undefined,
    declared: new Map(),
    captures: new Map(),
  };
  FILE_FUNCTIONS.set(callees, made);
  return made;
}

/** The refused-declaration set belonging to `callees`. */
export const refusedDeclarationsOf = (callees: Map<string, FuncDecl>): Set<string> =>
  fileFunctionsOf(callees).refused;

/** What a name in scope refers to.
 *
 *  `module` and `binding` were one kind until #14, and conflating them is what broke stage
 *  reachability: a resource binding lowered to `Expr.constref`, the shape the IR reserves for
 *  a module-scope CONSTANT, and every consumer that asks "which bindings does this stage
 *  reach" looks for `Expr.varref`. So no stage reached any binding in a source-compiled
 *  module — the GLSL writer dropped the uniform block while keeping the uses, and
 *  `reflect()` reported no stages for anything. A binding is a module-scope `var`, not a
 *  const, and it now says so. */
export type BindingKind = 'param' | 'local' | 'module' | 'binding' | 'override' | 'modvar';

/** How a "cannot assign" diagnostic names what the target is. One helper because the three
 *  sites that raise it disagreed: two said "declared with const" for a resource binding, which
 *  is not what a `declare const input: storage<…>` is.
 *
 *  The parameter is a `BindingKind`, not `BindingKind | undefined`. An absent binding is not a
 *  read-only one — it is an unknown name, a different diagnostic — and while this accepted
 *  `undefined` it answered "declared with const" for a name that was never declared at all.
 *  Every caller now resolves that case first. The switch is exhaustive so that a NEW kind is a
 *  type error here rather than silently taking a default phrase that may not describe it. */
export function readOnlyPhrase(kind: BindingKind): string {
  switch (kind) {
    case 'binding':
      return 'a read-only resource';
    case 'module':
      return 'a module const';
    case 'override':
      return 'an override constant, set by the pipeline';
    // Never read-only; the arm keeps the switch exhaustive.
    case 'modvar':
      return 'a module variable';
    case 'param':
    case 'local':
      return 'declared with const';
    default: {
      const never: never = kind;
      throw new Error(`unhandled binding kind ${String(never)}`);
    }
  }
}

/** How a refusal spells a binding's value type back to the author. {@link typeKey} is the
 *  COMPILER's key and is NOT a spelling: it writes a struct as `struct:Params`, an array with
 *  no space after the comma, and a vector or a non-square matrix with a type argument the
 *  ambient library does not declare (`vec4<f32>`, `mat2x3<f32>`). A remedy quoting any of
 *  those goes red the moment the author pastes it — measured, `declare const a:
 *  storage<array<vec4<f32>>, "read_write">` is TS2315 "Type 'vec4' is not generic" in the
 *  editor while the compiler is clean.
 *
 *  So this spells the type in the SOURCE language, and every name it can produce comes from
 *  {@link authorTypeName}, the inverse of the very table `type-map.ts` parses a declaration
 *  with. A type spelled from its parts is composed here: a struct is its name, an array is
 *  `array<E>` or `array<E, N>` with a space after the comma, an atomic is `atomic<u32>`.
 *  `remedy-lines.test.ts` pastes every remedy back into its own program and is what keeps
 *  this honest.
 */
export function authorTypeText(t: ShaderType): string {
  switch (t.kind) {
    case 'struct':
      return t.name;
    case 'array':
      return t.size !== undefined
        ? `array<${authorTypeText(t.elem)}, ${t.size}>`
        : `array<${authorTypeText(t.elem)}>`;
    // `atomic<u32>` is written exactly as WGSL writes it, and the element is a bare scalar
    // name rather than a nested `ShaderType`, so it is composed here and not looked up.
    case 'atomic':
      return `atomic<${t.elem}>`;
    default:
      // A SQUARE `f64` matrix is the one shape with no row in the parse table (it goes through
      // the generic `matN<f64>` arm), and `typeKey` already writes what an author writes for
      // it, `mat3x3<f64>`. Every other type without a name of its own is a handle, which is
      // never a storage binding's value type.
      return authorTypeName(t) ?? typeKey(t);
  }
}

/** The resource bindings a file wrote in the CALL form (`const xs = storage<T>(…)`) rather
 *  than as a `declare const`. A remedy that names a declaration has to name the one the author
 *  wrote: measured, pasting `declare const xs: storage<…>` into a file that already binds `xs`
 *  by a call is `TS8023 Duplicate resource` on top of the refusal it was meant to close.
 *
 *  A WeakMap keyed by the source file, for the reason {@link fileFunctionsOf} is one: the
 *  declaration FORM is a fact about the TypeScript source, not about the resource, so it does
 *  not belong on `BindingDecl`, which is IR the EDSL builds too. */
const CALL_FORM_BINDINGS = new WeakMap<ts.SourceFile, Map<string, string>>();

/** Records that `name` was bound by a call in this file, with the argument list as the author
 *  wrote it (`({ binding: 3 })`, `(0, 1)`, `()`). The arguments ride along because they carry
 *  the slot: a remedy that dropped them would move the binding while it made it writable.
 *  Called by `bindings.ts` as it collects, which is the one place that has read the
 *  declaration's shape. */
export function recordCallFormBinding(
  sourceFile: ts.SourceFile,
  name: string,
  argsText: string,
): void {
  const found = CALL_FORM_BINDINGS.get(sourceFile);
  if (found) found.set(name, argsText);
  else CALL_FORM_BINDINGS.set(sourceFile, new Map([[name, argsText]]));
}

/** The bindings whose declared value type the compiler could NOT read, and recovered. A
 *  remedy is a line to paste, and a line built from a type that was already refused is not one:
 *  `storage<mat2x3<f64>>` recovers as `mat2x3` (the fp64 pass carries square matrices only) and
 *  was answered with `Write "declare const mnd: storage<mat2x3, \"read_write\">"`, which drops
 *  the `<f64>` the author wrote and is refused again the moment it is pasted; `storage<array<
 *  vec2h>>` recovers as `struct:array` and was answered with `storage<array, "read_write">`,
 *  which drops the type argument entirely. In both the FIRST sentence already names the mistake
 *  the author has to fix, and a second sentence about a type the compiler could not read is
 *  noise — so {@link writableRemedy} says nothing for these.
 *
 *  Recorded rather than derived, for the reason {@link CALL_FORM_BINDINGS} is: whether the
 *  declaration READ is a fact about this TypeScript source, and the recovered `ShaderType` that
 *  reaches the IR carries no trace of it. */
const RECOVERED_BINDINGS = new WeakMap<ts.SourceFile, Set<string>>();

/** Records that `name`'s declared value type drew a refusal and was recovered. Called by
 *  `bindings.ts`, the one place that maps a binding's declared type. */
export function recordRecoveredBinding(sourceFile: ts.SourceFile, name: string): void {
  const found = RECOVERED_BINDINGS.get(sourceFile);
  if (found) found.add(name);
  else RECOVERED_BINDINGS.set(sourceFile, new Set([name]));
}

/** The second sentence of a "cannot assign" refusal: the declaration that WOULD permit the
 *  write, or `''` where there is none. Design rule 6.2 puts a storage binding's access mode in
 *  its second type argument, so the remedy names the TYPE and never the declaration keyword.
 *  Empty for everything else on purpose: a uniform buffer is read-only in WGSL, a module const
 *  and an override are fixed before the shader runs, and naming a keyword for any of them was
 *  the stale advice this replaces.
 *
 *  It names the form the author WROTE, `declare const x: storage<T, "read_write">` or
 *  `const x = storage<T, "read_write">()`, because a remedy is a line to paste into the file
 *  it is about and the two forms do not substitute for each other.
 */
export function writableRemedy(binding: Binding, sourceFile?: ts.SourceFile): string {
  if (binding.kind !== 'binding' || binding.space !== 'storage') return '';
  // Nothing to say about a type the compiler could not read: see {@link RECOVERED_BINDINGS}.
  if (sourceFile && RECOVERED_BINDINGS.get(sourceFile)?.has(binding.name)) return '';
  const type = `storage<${authorTypeText(binding.type)}, \"read_write\">`;
  const args = sourceFile && CALL_FORM_BINDINGS.get(sourceFile)?.get(binding.name);
  const line =
    args !== undefined
      ? `const ${binding.name} = ${type}${args}`
      : `declare const ${binding.name}: ${type}`;
  return ` Write "${line}" to write to it.`;
}

/** The base constructor a `super(...)` runs, and the fields it decides (roadmap 0.3 item T5,
 *  #92). Declared here, where both the collector that fills it and the statement lowering that
 *  reads it can see it without either importing the other. */
export interface SuperCtor {
  /** The emitted name of the base's constructor function, `Base_new`. */
  readonly fn: string;
  readonly type: ShaderType;
  readonly fields: readonly StructField[];
}

export interface Binding {
  readonly kind: BindingKind;
  readonly name: string;
  readonly type: ShaderType;
  readonly mutable: boolean;
  readonly constValue?: number | boolean;
  /** The address space, for `kind: 'binding'` only. Carried because a diagnostic about a
   *  runtime-sized array has to say something different for `storage` than for `uniform`:
   *  `arrayLength(&x)` is spelled `ptr<storage, array<E>, AM>` and exists for nothing else,
   *  so pointing a `uniform<array<f32>>` author at it sends them to an intrinsic Tint would
   *  refuse on their program (#46). Absent for a local, a param or a module const. */
  readonly space?: AddressSpace | 'workgroup' | 'private';
  /** For a `kind: 'local'` bound to a bare name, the name it copies: `const a = src` records
   *  `aliasOf: 'src'`, so a question about what `a` denotes (is it a storage array, for
   *  `arrayLength`) follows the chain to the binding instead of stopping at the local (#46). */
  readonly aliasOf?: string;
  /** For a local `const` whose initializer built a value nothing else holds (Rule 6.10): makes
   *  the declaration a `var` and the name writable through, the first time something writes
   *  into what it holds. The name itself is never assigned again. */
  readonly toVar?: () => void;
  /** For a `kind: 'module'` const whose value is not a scalar (a vector, an array), the
   *  initializer as lowered, so a division inside a function body can be proven zero
   *  componentwise the way a module const's own initializer is (#68). A scalar const carries
   *  its value in `constValue` instead and has no need of this. */
  readonly valueExpr?: Expr;
  /** The name the IR knows this binding by, when it is not the source name. The IR identifies
   *  a local by name alone within a function, and TypeScript lets two lexically disjoint
   *  blocks, or an inner block and the block around it, declare one name; `define` gives the
   *  second and later declarations of a name in a function `p_1`, `p_2`, ... so no two
   *  bindings share an IR name (#38). Absent for a first declaration, whose IR name is its
   *  source name. */
  readonly irName?: string;
  /** For the parameter a local function takes for a variable it captures (Rule 8.17): `of`,
   *  the binding the variable has where it is declared, whose rules a write through this one
   *  keeps (a `let` is written, a `const` only through what it holds, a parameter never), and
   *  `byRef`, which makes the parameter a reference to the variable, the way a closure writes
   *  the variable itself, the first time something writes it. */
  readonly capture?: { readonly of: Binding; readonly byRef: () => void };
}

/** The binding whose rules a write to `b` keeps: the variable's own, for a local function's
 *  parameter that captures it (Rule 8.17), and `b` itself otherwise. */
export const writeRules = (b: Binding): Binding => b.capture?.of ?? b;

/** The name an IR node for `b` carries: its {@link Binding.irName} when the source name was
 *  already taken in the function, its source name otherwise. Every site that builds a
 *  `varref` or `param` from a binding spells the name through this. */
export const irNameOf = (b: Binding): string => b.irName ?? b.name;

/** A copy of an IR node, sharing only what is shared by identity: a type, a span, and the
 *  declaration a call refers to. */
function cloneIr<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => cloneIr(v)) as T;
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = k === 'type' || k === 'span' || k === 'declRef' ? v : cloneIr(v);
  }
  return out as T;
}

export class LoweringScope {
  private readonly frames: Map<string, Binding>[] = [new Map()];
  /** Every IR name a `define` in this scope has handed out, module-level names included: a
   *  local that shadows a resource binding would otherwise be `varref dst` beside the
   *  binding's own `varref dst`, one name to every pass. */
  private readonly takenIr = new Set<string>();
  private readonly byIr = new Map<string, Binding>();
  private ownerDecl: FuncDecl | undefined;
  private superCtorInfo: SuperCtor | undefined;
  private afterSuperStmts: readonly Stmt[] | undefined;
  private afterSuperTaken = false;
  private superMethodMap: ReadonlyMap<string, string> | undefined;
  private localFns: ReadonlyMap<string, string> | undefined;
  private baseNames: ReadonlyMap<string, readonly string[]> = new Map();
  private abstractNames: ReadonlySet<string> = new Set();
  private staticHolders: ReadonlyMap<string, string> = new Map();
  private readonly callees: Map<string, FuncDecl>;
  private readonly fns: FileFunctions;
  private readonly refusedDecls: Set<string>;
  private readonly structs = new Map<string, StructDecl>();
  /** The names the file declares as an `enum` (roadmap 0.3 item T1, #92). Its members are
   *  module constants named `Enum_Member`, so the only thing the lowering needs the name for
   *  is telling a mistyped member from an unknown identifier. */
  private readonly enums = new Set<string>();
  /** The names the file declares as a `namespace` (roadmap 0.3 item T4, #92). */
  private readonly namespaces = new Set<string>();
  private namespacePrefix: string | undefined;
  /** The class whose static member's body is being lowered, which is what `this` names there
   *  (Rule 8.13); undefined everywhere else. */
  private staticOwner: string | undefined;
  private privates: PrivateFieldTable = new Map();
  private withheldMembers: WithheldTable = new Map();
  private readonlyMembers: ReadonlyFieldTable = new Map();
  private restrictedMembers: RestrictedFieldTable = new Map();
  private readonly chainAliases = new Map<ts.Node, () => Expr>();
  private readonly symbols: DeclaredSymbolSink | undefined;
  private loopDepth = 0;
  private atomicOperandDepth = 0;
  private branchDepth = 0;
  private stage: 'vertex' | 'fragment' | 'compute' | undefined;
  private retType: ShaderType | undefined;
  private inferInto: FuncDecl | undefined;
  private switchDepth = 0;

  constructor(callees?: Map<string, FuncDecl>, symbols?: DeclaredSymbolSink) {
    this.callees = callees ?? new Map();
    this.symbols = symbols;
    this.fns = fileFunctionsOf(this.callees);
    this.refusedDecls = this.fns.refused;
  }

  /** Whether this file declares `name` as a function and the declaration was refused, so its
   *  body was never lowered and no callee exists (roadmap 0.3 item T10, #92). A call to it
   *  would otherwise say "Unknown function", which is untrue: the function is right there,
   *  and why it names no callee was already said on its own declaration. */
  /** Whether this file declares `name` as a generic function, which is what tells the call
   *  lowering to read type arguments before it looks for a callee (roadmap 0.3 item T9, #92).
   *  A name may be reached through a namespace, the same spellings `resolveCallee` tries. */
  isGenericFunction(name: string): boolean {
    return this.genericName(name) !== undefined;
  }

  /** Make, or find, the instance of the generic function `name` this call needs. The hook is
   *  set by `lowerSourceFunctions`, which owns the declarations; it is called from the call
   *  lowering, which is where an instantiation is discovered. That indirection is what lets the
   *  two talk without `expression-call.ts` importing `function.ts`. Returns undefined when the
   *  instantiation was refused, having said why. */
  instantiateGeneric(
    name: string,
    node: ts.CallExpression,
    argTypes: readonly (ShaderType | undefined)[],
    sourceFile: ts.SourceFile,
    diagnostics: TsCompilerDiagnostic[],
  ): FuncDecl | undefined {
    const written = this.genericName(name);
    if (written === undefined) return undefined;
    return this.fns.instantiate?.(written, node, argTypes, sourceFile, diagnostics, this);
  }

  /** The copy of the class's function `cf`, which takes a function, for the functions the call
   *  `node` on `on` hands it (Rule 8.18); undefined, having said why, when it cannot be made. */
  instantiateMember(
    cf: ClassFunction,
    node: ts.CallExpression | ts.NewExpression,
    on: ts.Expression | undefined,
    sourceFile: ts.SourceFile,
    diagnostics: TsCompilerDiagnostic[],
  ): { readonly decl: FuncDecl; readonly writes: boolean } | undefined {
    return this.fns.instantiateMember?.(cf, node, on, sourceFile, diagnostics, this);
  }

  /** Which parameters of the function `name` take a function (Rule 8.18), or undefined when
   *  none does: those arguments are resolved as functions rather than lowered as values. */
  functionParamsOf(name: string): ReadonlySet<number> | undefined {
    const written = this.genericName(name);
    return written === undefined ? undefined : this.fns.fnParams.get(written);
  }

  /** The function an arrow function or a function expression written as an argument stands
   *  for (Rule 8.18), lifted out of this body; undefined, having said why, when it cannot be. */
  liftArgument(
    node: ts.ArrowFunction | ts.FunctionExpression,
    shape: FunctionShape,
    hint: string,
    sourceFile: ts.SourceFile,
    diagnostics: TsCompilerDiagnostic[],
  ): FuncDecl | undefined {
    return this.fns.lift?.(node, shape, hint, this, sourceFile, diagnostics);
  }

  /** The function the front end builds for `key` (an array's method, surface §63), made the
   *  first time a call asks for it; undefined outside the lowering of a file's functions. */
  buildFunction(
    key: string,
    base: string,
    shown: string,
    captures: readonly CaptureKey[],
    build: (name: string) => FuncDecl,
  ): FuncDecl | undefined {
    return this.fns.build?.(key, base, shown, captures, build);
  }

  /** Whether the call of `decl` at `at` can be lowered now: a function whose body says its
   *  return type has that body lowered first (Rule 8.19). False, having said why or leaving it
   *  to the recursion check, for a call back into a body still being lowered. */
  calleeReady(
    decl: FuncDecl,
    at: ts.Node,
    sourceFile: ts.SourceFile,
    diagnostics: TsCompilerDiagnostic[],
  ): boolean {
    return this.fns.ensure?.(decl, at, sourceFile, diagnostics) ?? true;
  }

  private genericName(name: string): string | undefined {
    // A local function that takes a function, named by the body that declares it (Rule 8.18).
    const local = this.localFns?.get(name);
    if (local !== undefined && this.fns.generics.has(local)) return local;
    if (this.fns.generics.has(name)) return name;
    for (const qualified of this.qualifiedNames(name)) {
      if (this.fns.generics.has(qualified)) return qualified;
    }
    return undefined;
  }

  declarationRefused(name: string): boolean {
    if (this.refusedDecls.has(name)) return true;
    const local = this.localFns?.get(name);
    if (local !== undefined && this.refusedDecls.has(local)) return true;
    // A local function refused before it was registered has no entry above, and its emitted
    // name is the owner's and its own: `scale` inside `fs` is `fs_scale`. Read through the
    // owner rather than by the written name alone, so a call to an unknown `scale` in another
    // body still says so.
    const owner = this.ownerDecl?.name;
    if (owner !== undefined && this.refusedDecls.has(`${owner}_${name}`)) return true;
    for (const qualified of this.qualifiedNames(name)) {
      if (this.refusedDecls.has(qualified)) return true;
    }
    return false;
  }

  /** Record one declaration this scope just defined into the caller's symbol table, spanning
   *  `nameNode` (see `symbols.ts`). A no-op when the caller asked for no symbols. Deliberately
   *  separate from `define`: a function's scope also defines the module consts and the bindings
   *  it can see, and those are recorded once where they are collected, not once per function. */
  recordDeclaration(
    sourceFile: ts.SourceFile,
    nameNode: ts.Node,
    symbol: Omit<DeclaredSymbol, 'start' | 'length'>,
  ): void {
    recordDeclaration(this.symbols, sourceFile, nameNode, symbol);
  }

  enterLoop(): void {
    this.loopDepth++;
  }

  exitLoop(): void {
    this.loopDepth = Math.max(0, this.loopDepth - 1);
  }

  /** Raised while an `if` arm, an `else`, or a `switch` case body is lowered: the positions a
   *  barrier may not stand in (§25). A loop body is not one; a `for` with a constant bound is
   *  uniform control flow. */
  enterBranch(): void {
    this.branchDepth++;
  }

  exitBranch(): void {
    this.branchDepth = Math.max(0, this.branchDepth - 1);
  }

  inBranch(): boolean {
    return this.branchDepth > 0;
  }

  /** The stage of the entry whose body is being lowered, `undefined` for a helper function
   *  and outside a body. Workgroup memory is a compute entry's alone (§24). */
  setStage(s: 'vertex' | 'fragment' | 'compute' | undefined): void {
    this.stage = s;
  }

  currentStage(): 'vertex' | 'fragment' | 'compute' | undefined {
    return this.stage;
  }

  /** Raised while an atomic builtin's location argument is lowered: the one position in which
   *  an expression of atomic type may stand (lower/atomics.ts, rule 2). */
  enterAtomicOperand(): void {
    this.atomicOperandDepth++;
  }

  exitAtomicOperand(): void {
    this.atomicOperandDepth = Math.max(0, this.atomicOperandDepth - 1);
  }

  inAtomicOperand(): boolean {
    return this.atomicOperandDepth > 0;
  }

  inLoop(): boolean {
    return this.loopDepth > 0;
  }

  /** The declared return type of the function whose body is being lowered, so a `return` can
   *  be checked and typed against it: `return 0` takes it (#8 A3) and `return { … }` takes the
   *  struct it names (#8 A11). Undefined outside a function body — at module-constant
   *  collection, for instance — and, in a function that writes no return type, until its first
   *  `return` with a value says it (Rule 8.19, {@link setInferredReturn}). */
  setReturnType(t: ShaderType | undefined): void {
    this.retType = t;
  }

  returnType(): ShaderType | undefined {
    return this.retType;
  }

  /** For a function that writes no return type (Rule 8.19), the stub whose return type its
   *  first `return` with a value says: the later ones are then typed against it, as against a
   *  written one. The return type stays undefined until that `return`. */
  setInferredReturn(stub: FuncDecl | undefined): void {
    this.inferInto = stub;
    if (stub !== undefined) this.retType = undefined;
  }

  inferredReturn(): FuncDecl | undefined {
    return this.inferInto;
  }

  enterSwitch(): void {
    this.switchDepth++;
  }

  exitSwitch(): void {
    this.switchDepth = Math.max(0, this.switchDepth - 1);
  }

  /** Whether a `break` here would leave a `switch`. Tracked apart from {@link inLoop}
   *  because `continue` is a loop statement only: a `switch` that is not inside a loop
   *  takes the one and refuses the other. */
  inSwitch(): boolean {
    return this.switchDepth > 0;
  }

  setStructs(list: readonly StructDecl[]): void {
    this.structs.clear();
    // The `atomicCompareExchangeWeak` result structs are always in scope (#152). They are not
    // declared by any file and not emitted by any backend — WGSL's is built in and unnameable
    // — but member access needs their field types, so the two live here beside whatever the
    // file declared. An author cannot reach them: the names begin with `__`, which this
    // surface's identifier rules refuse, and nothing but the builtin produces the type.
    for (const s of CAS_RESULT_STRUCTS) this.structs.set(s.name, s as StructDecl);
    for (const s of list) this.structs.set(s.name, s);
  }

  setEnums(names: Iterable<string>): void {
    this.enums.clear();
    for (const n of names) this.enums.add(n);
  }

  isEnum(name: string): boolean {
    return this.enums.has(name);
  }

  setNamespaces(names: Iterable<string>): void {
    this.namespaces.clear();
    for (const n of names) this.namespaces.add(n);
  }

  /** Whether `name` is a `namespace` the file declares (roadmap 0.3 item T4, #92). Its members
   *  are flattened to `Ns_member`, so this is what tells `Palette.warm()` from a call on a
   *  value. */
  isNamespace(name: string): boolean {
    return this.namespaces.has(name);
  }

  fieldType(structName: string, field: string): ShaderType | undefined {
    return this.structs.get(structName)?.fields.find((f) => f.name === field)?.type;
  }

  /** Which fields of each struct are private (Rule 8.12). */
  setPrivateFields(table: PrivateFieldTable): void {
    this.privates = table;
  }

  /** The private field `field` of `structName` is, by the member it is emitted as, or undefined
   *  for a field every body may name. */
  privateField(structName: string, field: string): PrivateField | undefined {
    return this.privates.get(structName)?.get(field);
  }

  /** Whether `structName` has a field only its class may name, which an object literal cannot
   *  write and a spread does not copy (Rule 8.12). */
  hasPrivateFields(structName: string): boolean {
    return (this.privates.get(structName)?.size ?? 0) > 0;
  }

  /** The members each class declared that its struct does not carry (Rule 12.4). */
  setWithheldFields(table: WithheldTable): void {
    this.withheldMembers = table;
  }

  /** Whether `field` is a member `structName`'s class declared and was refused, whose every
   *  read is already explained. */
  isWithheld(structName: string, field: string): boolean {
    return this.withheldMembers.get(structName)?.has(field) ?? false;
  }

  /** The `readonly` fields of each struct (Rule 8.14). */
  setReadonlyFields(table: ReadonlyFieldTable): void {
    this.readonlyMembers = table;
  }

  /** The class whose constructor alone may assign `field` of `structName`, when it is
   *  `readonly`; undefined for a field any body may assign. */
  readonlyField(structName: string, field: string): ts.ClassLikeDeclaration | undefined {
    return this.readonlyMembers.get(structName)?.get(field);
  }

  /** The `private` and `protected` fields of each struct (Rule 8.15). */
  setRestrictedFields(table: RestrictedFieldTable): void {
    this.restrictedMembers = table;
  }

  /** How `field` of `structName` is restricted, when it is declared `private` or `protected`. */
  restrictedField(structName: string, field: string): RestrictedField | undefined {
    return this.restrictedMembers.get(structName)?.get(field);
  }

  /** Whether `structName` has a field only its class, or its class and the ones that extend
   *  it, may name: `#x`, `private`, `protected`. An object literal cannot build one. */
  hasHiddenFields(structName: string): boolean {
    return (
      this.hasPrivateFields(structName) || (this.restrictedMembers.get(structName)?.size ?? 0) > 0
    );
  }

  /** The first field of `structName` an object literal cannot set, with how it is hidden:
   *  a `#` name, or a `private` or `protected` one. */
  hiddenFieldOf(
    structName: string,
  ): { readonly written: string; readonly access: 'private' | 'protected' } | undefined {
    for (const f of this.structs.get(structName)?.fields ?? []) {
      const p = this.privateField(structName, f.name);
      if (p !== undefined) return { written: p.written, access: 'private' };
      const r = this.restrictedField(structName, f.name);
      if (r !== undefined) return { written: f.name, access: r.access };
    }
    return undefined;
  }

  /** The class whose static member's body is being lowered: `this.K` there is `Cls.K`. */
  setStaticClass(name: string | undefined): void {
    this.staticOwner = name;
  }

  staticClass(): string | undefined {
    return this.staticOwner;
  }

  /** The collected struct with this name, or undefined. The lookup a CONTEXTUAL type needs:
   *  a declared `vec4`-shaped `VsOut` names its struct outright, where {@link matchStruct} can
   *  only guess from the field names and cannot answer at all when two structs share a shape
   *  (#8 A11). */
  structByName(name: string): StructDecl | undefined {
    return this.structs.get(name);
  }

  matchStruct(fieldNames: readonly string[]): StructDecl | undefined {
    const set = new Set(fieldNames);
    let hit: StructDecl | undefined;
    for (const s of this.structs.values()) {
      // A struct with a private field is never the one a bare literal means: its literal would
      // have to name the `#` field, which no literal can (Rule 8.12).
      if (this.hasHiddenFields(s.name)) continue;
      if (s.fields.length !== set.size) continue;
      if (!s.fields.every((f) => set.has(f.name))) continue;
      if (hit) return undefined;
      hit = s;
    }
    return hit;
  }

  /** What `super(...)` calls in the constructor body being lowered (roadmap 0.3 item T5, #92),
   *  or undefined anywhere else, where a `super` is refused. */
  setSuperCtor(info: SuperCtor | undefined): void {
    this.superCtorInfo = info;
  }

  superCtor(): SuperCtor | undefined {
    return this.superCtorInfo;
  }

  /** What the constructor being lowered runs right after its `super(...)` returns, lowered
   *  before its body (Rule 8.14); undefined in any other body. */
  setAfterSuper(stmts: readonly Stmt[] | undefined): void {
    this.afterSuperStmts = stmts;
    this.afterSuperTaken = false;
  }

  /** The statements one `super(...)` is followed by: those lowered, and a copy of them for a
   *  second `super(...)` on another path, so no two places in the IR share a node. */
  takeAfterSuper(): Stmt[] {
    const stmts = this.afterSuperStmts ?? [];
    const out = this.afterSuperTaken ? stmts.map((st) => cloneIr(st)) : [...stmts];
    this.afterSuperTaken = true;
    return out;
  }

  /** Whether the statements of {@link setAfterSuper} are still to be placed: a body with no
   *  `super(...)` that lowered puts them first. */
  afterSuperPending(): boolean {
    return !this.afterSuperTaken && (this.afterSuperStmts?.length ?? 0) > 0;
  }

  /** Which structs extend which (roadmap 0.3 item T5, #92), so a type mismatch between two
   *  that are related can say what is really wrong: dispatch here is static, so a base-typed
   *  name must not hold a derived value. */
  setBases(bases: ReadonlyMap<string, readonly string[]>): void {
    this.baseNames = bases;
  }

  /** The classes declared `abstract`, which are bases and never values. The semantic pass
   *  already refuses a `new` on one, with the reason; this is what keeps the lowering from
   *  saying it a second time in weaker words. */
  setAbstractStructs(names: ReadonlySet<string>): void {
    this.abstractNames = names;
  }

  isAbstractStruct(name: string): boolean {
    return this.abstractNames.has(name);
  }

  /** The chain above `name`, nearest first: what a static a base declares is reached through
   *  (Rule 8.13). */
  ancestorsOf(name: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>([name]);
    const queue = [...(this.baseNames.get(name) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (seen.has(next)) continue;
      seen.add(next);
      out.push(next);
      queue.push(...(this.baseNames.get(next) ?? []));
    }
    return out;
  }

  /** For a generic class's instance, the name its statics are emitted under (T9, #92). */
  setStaticHolders(holders: ReadonlyMap<string, string>): void {
    this.staticHolders = holders;
  }

  /** The name the statics of `name` are emitted under: a generic class's own for one of its
   *  instances, `Pair` for `Pair_f32`, and `name` itself for every other class. */
  staticHolderOf(name: string): string {
    return this.staticHolders.get(name) ?? name;
  }

  /** True when `derived` extends `base`, at any depth. */
  extendsStruct(derived: string, base: string): boolean {
    const seen = new Set<string>();
    const queue = [...(this.baseNames.get(derived) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (next === base) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(...(this.baseNames.get(next) ?? []));
    }
    return false;
  }

  /** The sentence a mismatch between two related structs adds, or '' when they are not
   *  related. `want` is the type the place has, `got` the type of the value. */
  inheritanceNote(want: ShaderType, got: ShaderType): string {
    if (want.kind !== 'struct' || got.kind !== 'struct') return '';
    if (this.extendsStruct(got.name, want.name)) {
      return (
        ` "${got.name}" extends "${want.name}", and a name typed as the base cannot hold a ` +
        `derived value here: method dispatch is static, so a call through it would run ` +
        `"${want.name}"'s body. Write "${got.name}" as the type.`
      );
    }
    if (this.extendsStruct(want.name, got.name)) {
      return (
        ` "${want.name}" extends "${got.name}", and a "${got.name}" has none of the fields ` +
        `"${want.name}" adds.`
      );
    }
    return '';
  }

  /** `super.m(...)` in the body being lowered, to the function that carries the base's body
   *  (roadmap 0.3 item T5, #92). The collector decides it, because which base declares the
   *  method depends on the class that WROTE the body, not on the one it is lowered for. */
  setSuperMethods(map: ReadonlyMap<string, string> | undefined): void {
    this.superMethodMap = map;
  }

  superMethods(): ReadonlyMap<string, string> | undefined {
    return this.superMethodMap;
  }

  /** The function whose BODY is being lowered, or undefined while a signature's default is
   *  (roadmap 0.3 item T7, #92). A default filled into a call is spliced into the body that
   *  wrote the call, so the calls it carries are that body's for the recursion check; a call
   *  inside a default being lowered belongs to no body yet. */
  setOwner(decl: FuncDecl | undefined): void {
    this.ownerDecl = decl;
  }

  owner(): FuncDecl | undefined {
    return this.ownerDecl;
  }

  /** Record the binding `node` made in this function's body, a `let`, a `const` or a
   *  parameter, for a local function that captures it (Rule 8.17). */
  bindDeclaration(node: CaptureKey, binding: Binding): void {
    if (this.ownerDecl === undefined) return;
    const file = fileFunctionsOf(this.callees);
    let mine = file.declared.get(this.ownerDecl);
    if (mine === undefined) {
      mine = new Map();
      file.declared.set(this.ownerDecl, mine);
    }
    mine.set(node, binding);
  }

  /** The binding `node` made in this function, or undefined when nothing lowered so far made
   *  one here: a variable read before its declaration, which TypeScript throws on (Rule 8.17). */
  bindingOfDeclaration(node: CaptureKey): Binding | undefined {
    if (this.ownerDecl === undefined) return undefined;
    return fileFunctionsOf(this.callees).declared.get(this.ownerDecl)?.get(node);
  }

  /** The variables the local function `fn` captures, which a call to it passes first. */
  capturesOf(fn: string): readonly CaptureKey[] {
    return fileFunctionsOf(this.callees).captures.get(fn) ?? [];
  }

  defineCallee(fn: FuncDecl): void {
    this.callees.set(fn.name, fn);
  }

  /** A local function declared in the body being lowered, from the name it is written under to
   *  the name the module emits it as (roadmap 0.3 item T7, #92): `f` inside `fs` is `fs_f`. */
  setLocalFunctions(map: ReadonlyMap<string, string> | undefined): void {
    this.localFns = map;
  }

  localFunctions(): ReadonlyMap<string, string> | undefined {
    return this.localFns;
  }

  resolveCallee(name: string): FuncDecl | undefined {
    const local = this.localFns?.get(name);
    if (local !== undefined) {
      const hit = this.callees.get(local);
      if (hit !== undefined) return hit;
    }
    const direct = this.callees.get(name);
    if (direct !== undefined) return direct;
    for (const qualified of this.qualifiedNames(name)) {
      const hit = this.callees.get(qualified);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }

  /** The name being lowered inside `namespace A { namespace B { ... } }` is `A_B`, and a name
   *  written inside that body may be a member of `A_B`, of `A`, or of the file (roadmap 0.3
   *  item T4, #92). This yields the qualified spellings to try, innermost first, which is
   *  TypeScript's own lookup rule for a namespace body. */
  private *qualifiedNames(name: string): Generator<string> {
    let prefix = this.namespacePrefix;
    while (prefix !== undefined && prefix !== '') {
      yield `${prefix}_${name}`;
      const cut = prefix.lastIndexOf('_');
      prefix = cut < 0 ? '' : prefix.slice(0, cut);
    }
  }

  /** The namespace whose body is being lowered, flattened (`A_B`), or undefined at the top
   *  level of the file. */
  setNamespacePrefix(prefix: string | undefined): void {
    this.namespacePrefix = prefix;
  }

  namespaceOf(): string | undefined {
    return this.namespacePrefix;
  }

  /** The struct a written name means: itself when the file declares it, else the first
   *  namespace-qualified spelling that it does, so `P` inside `namespace N` is `N_P` (#107). */
  qualifiedStruct(name: string): string | undefined {
    if (this.structByName(name) !== undefined) return name;
    for (const qualified of this.qualifiedNames(name)) {
      if (this.structByName(qualified) !== undefined) return qualified;
    }
    return undefined;
  }

  /** `name` itself when the file declares it as a namespace, else the first
   *  namespace-qualified spelling that it does: inside `namespace A`, `B` is `A_B`. */
  qualifiedNamespace(name: string): string | undefined {
    if (this.namespaces.has(name)) return name;
    for (const qualified of this.qualifiedNames(name)) {
      if (this.namespaces.has(qualified)) return qualified;
    }
    return undefined;
  }

  calleeTable(): Map<string, FuncDecl> {
    return this.callees;
  }

  /** Bind `binding.name` in the current frame and return the binding as stored, which carries
   *  an {@link Binding.irName} when the name was already taken anywhere in this function.
   *  Throws on a repeat within the current frame, TypeScript's own rule; the callers that can
   *  reach that turn it into a TS8023 on the declaration. */
  define(binding: Binding): Binding {
    const top = this.frames[this.frames.length - 1]!;
    if (top.has(binding.name)) {
      throw new Error(`Duplicate binding "${binding.name}" in current scope frame`);
    }
    // A binding may ask for an IR name other than its own: `this` reads as `self_` in the
    // emitted function, since `this` and `self` are reserved words in WGSL (#86).
    const ir = this.allocIrName(binding.irName ?? binding.name);
    const stored: Binding = ir === binding.name ? binding : { ...binding, irName: ir };
    top.set(binding.name, stored);
    this.byIr.set(ir, stored);
    return stored;
  }

  /** What each IR name this scope declared was written as in the source: `i_1` for the second
   *  `i`, `_i` for a `for…of`'s counter. A refusal that the IR proves names the author's. */
  sourceNames(): Map<string, string> {
    return new Map([...this.byIr].map(([ir, b]) => [ir, b.name]));
  }

  /** Bind `name` in the current frame to an existing binding, so the name resolves to it and
   *  emits its IR name: `const a = src` for a storage array with no size, which no local can
   *  hold (Rule 12.6). Throws on a name the frame already binds, as {@link define} does. */
  defineAlias(name: string, target: Binding): void {
    const top = this.frames[this.frames.length - 1]!;
    if (top.has(name)) throw new Error(`Duplicate binding "${name}" in current scope frame`);
    top.set(name, target);
  }

  /** An internal local the lowering needs and the source never named: the value a
   *  destructuring declaration reads from, lowered once (roadmap 0.3 item T7, #92). It takes an
   *  IR name no other local can take and binds no source name, so two of them in one block do
   *  not collide with each other and neither collides with a name the program declares. Returns
   *  the IR name to write into the statement. */
  defineTemp(prefix: string, type: ShaderType, mutable = false): string {
    const ir = this.allocIrName(prefix);
    this.byIr.set(ir, { kind: 'local', name: ir, type, mutable });
    return ir;
  }

  /** What an expression node stands for once a chain has run the calls before it (Rule 8.10):
   *  `v.setX(1.)` in `v.setX(1.).setY(2.)` is `v` itself, the call having run as a statement of
   *  its own. Each read of it builds its lowering anew, so no IR node is shared. */
  setChainAlias(node: ts.Node, make: () => Expr): void {
    this.chainAliases.set(node, make);
  }

  chainAlias(node: ts.Node): (() => Expr) | undefined {
    return this.chainAliases.get(node);
  }

  private allocIrName(name: string): string {
    if (!this.takenIr.has(name)) {
      this.takenIr.add(name);
      return name;
    }
    for (let n = 1; ; n++) {
      const candidate = `${name}_${n}`;
      if (!this.takenIr.has(candidate)) {
        this.takenIr.add(candidate);
        return candidate;
      }
    }
  }

  resolve(name: string): Binding | undefined {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const hit = this.frames[i]!.get(name);
      if (hit) return hit;
    }
    // Inside a namespace body a bare name may be one of its members, which the module holds
    // under the flattened name (roadmap 0.3 item T4, #92). Tried after the frames, so a local
    // and a parameter still win, which is TypeScript's order too.
    for (const qualified of this.qualifiedNames(name)) {
      for (let i = this.frames.length - 1; i >= 0; i--) {
        const hit = this.frames[i]!.get(qualified);
        if (hit) return hit;
      }
    }
    return undefined;
  }

  /** The binding an already-lowered IR node names. {@link resolve} answers for a SOURCE name
   *  at the point of lowering; a reader holding a `varref` has the IR name, which after a
   *  rename is no source name at all, or the source name of a different local. The map is
   *  function-wide and never popped, because an IR name is unique in the function. */
  resolveIr(name: string): Binding | undefined {
    return this.byIr.get(name);
  }

  hasInCurrent(name: string): boolean {
    return this.frames[this.frames.length - 1]!.has(name);
  }

  push(): void {
    this.frames.push(new Map());
  }

  pop(): void {
    if (this.frames.length <= 1) throw new Error('Cannot pop the root scope frame');
    this.frames.pop();
  }

  entries(): readonly Binding[] {
    const merged = new Map<string, Binding>();
    for (const frame of this.frames) {
      for (const [k, v] of frame) merged.set(k, v);
    }
    return [...merged.values()];
  }
}
