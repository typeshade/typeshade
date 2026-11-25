// Implements: Rule 6.2, the remedy a read-only resource names (docs/language-design.md; traced in reqs/).

import type { AbstractConst, Carried } from './abstract-const.js';
import type { InferredValue } from './use-inference.js';
import ts from 'typescript';
import type { ShaderType } from '../../core/ir/types.js';
import { CAS_RESULT_STRUCTS } from '../../core/ir/types.js';
import { optionalDeclOf } from './optional.js';
import { authorTypeText } from './written-context.js';
import type { AddressSpace, Expr } from '../../core/ir/nodes.js';
import type { FuncDecl, Stmt, StructDecl, StructField } from '../../core/ir/nodes.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import type { CollectedStruct, PrivateField, RestrictedField } from './structs.js';
import { recordDeclaration, type DeclaredSymbol, type DeclaredSymbolSink } from './symbols.js';
import type { FunctionShape } from './lower/function-types.js';
import type { ClassFunction } from './lower/class-methods.js';

export {
  authorTypeText,
  classOfStruct,
  programFileOf,
  sameFile,
  useWrittenStructs,
  withLinkedOrigin,
  withWrittenStructs,
  writtenName,
  writtenRange,
  writtenText,
} from './written-context.js';
export type { LinkedOrigin, StructOrigin } from './written-context.js';

export type PrivateFieldTable = ReadonlyMap<string, ReadonlyMap<string, PrivateField>>;

export type WithheldTable = ReadonlyMap<string, ReadonlySet<string>>;

export type ReadonlyFieldTable = ReadonlyMap<string, ReadonlyMap<string, ts.ClassLikeDeclaration>>;

export type RestrictedFieldTable = ReadonlyMap<string, ReadonlyMap<string, RestrictedField>>;

export type Instantiator = (
  name: string,
  node: ts.CallExpression,
  argTypes: readonly (ShaderType | undefined)[],
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  scope: LoweringScope,
) => FuncDecl | undefined;

export type MemberInstantiator = (
  cf: ClassFunction,
  node: ts.CallExpression | ts.NewExpression,
  on: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  scope: LoweringScope,
) => { readonly decl: FuncDecl; readonly writes: boolean } | undefined;

export type ArgumentLifter = (
  node: ts.ArrowFunction | ts.FunctionExpression,
  shape: FunctionShape,
  hint: string,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
) => FuncDecl | undefined;

export type FunctionBuilder = (
  key: string,
  base: string,
  shown: string,
  captures: readonly CaptureKey[],
  build: (name: string) => FuncDecl,
) => FuncDecl;

export type BodyFiller = (
  decl: FuncDecl,
  at: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
) => boolean;

export interface FileFunctions {
  readonly refused: Set<string>;
  readonly generics: Set<string>;
  instantiate: Instantiator | undefined;
  instantiateMember: MemberInstantiator | undefined;
  readonly fnParams: Map<string, ReadonlySet<number>>;
  lift: ArgumentLifter | undefined;
  build: FunctionBuilder | undefined;
  ensure: BodyFiller | undefined;
  readonly declared: Map<FuncDecl, Map<CaptureKey, Binding>>;
  readonly captures: Map<string, readonly CaptureKey[]>;
}

export type CaptureKey = ts.Node | typeof THIS_CAPTURE;

export const THIS_CAPTURE = 'this' as const;

const FILE_FUNCTIONS = new WeakMap<Map<string, FuncDecl>, FileFunctions>();

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

export const refusedDeclarationsOf = (callees: Map<string, FuncDecl>): Set<string> =>
  fileFunctionsOf(callees).refused;

const REFUSED_MODULE_NAMES = new WeakMap<ts.SourceFile, Set<string>>();

export function refuseModuleName(sourceFile: ts.SourceFile, name: string): void {
  const names = REFUSED_MODULE_NAMES.get(sourceFile) ?? new Set<string>();
  names.add(name);
  REFUSED_MODULE_NAMES.set(sourceFile, names);
}

export const refusedModuleNames = (sourceFile: ts.SourceFile): ReadonlySet<string> =>
  REFUSED_MODULE_NAMES.get(sourceFile) ?? new Set();

export type BindingKind = 'param' | 'local' | 'module' | 'binding' | 'override' | 'modvar';

export function readOnlyPhrase(kind: BindingKind): string {
  switch (kind) {
    case 'binding':
      return 'a read-only resource';
    case 'module':
      return 'a module const';
    case 'override':
      return 'an override constant, set by the pipeline';
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

const CALL_FORM_BINDINGS = new WeakMap<ts.SourceFile, Map<string, string>>();

export function recordCallFormBinding(
  sourceFile: ts.SourceFile,
  name: string,
  argsText: string,
): void {
  const found = CALL_FORM_BINDINGS.get(sourceFile);
  if (found) found.set(name, argsText);
  else CALL_FORM_BINDINGS.set(sourceFile, new Map([[name, argsText]]));
}

const RECOVERED_BINDINGS = new WeakMap<ts.SourceFile, Set<string>>();

export function recordRecoveredBinding(sourceFile: ts.SourceFile, name: string): void {
  const found = RECOVERED_BINDINGS.get(sourceFile);
  if (found) found.add(name);
  else RECOVERED_BINDINGS.set(sourceFile, new Set([name]));
}

export function isRecoveredBinding(sourceFile: ts.SourceFile, name: string): boolean {
  return RECOVERED_BINDINGS.get(sourceFile)?.has(name) ?? false;
}

let recoveredUsesDropped = 0;

export function dropsRecoveredUse(sourceFile: ts.SourceFile, binding: Binding): boolean {
  if (binding.kind !== 'binding' || !isRecoveredBinding(sourceFile, binding.name)) return false;
  recoveredUsesDropped++;
  return true;
}

export function recoveredUsesDroppedSoFar(): number {
  return recoveredUsesDropped;
}

export function writableRemedy(binding: Binding, sourceFile?: ts.SourceFile): string {
  if (binding.kind !== 'binding' || binding.space !== 'storage') return '';
  if (sourceFile && isRecoveredBinding(sourceFile, binding.name)) return '';
  const type = `storage<${authorTypeText(binding.type)}, \"read_write\">`;
  const args = sourceFile && CALL_FORM_BINDINGS.get(sourceFile)?.get(binding.name);
  const line =
    args !== undefined
      ? `const ${binding.name} = ${type}${args}`
      : `declare const ${binding.name}: ${type}`;
  return ` Write "${line}" to write to it.`;
}

export interface SuperCtor {
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
  readonly abstract?: AbstractConst;
  readonly inferred?: InferredValue;
  readonly carries?: Carried;
  readonly indexConstValue?: number;
  readonly space?: AddressSpace | 'workgroup' | 'private';
  readonly aliasOf?: string;
  readonly toVar?: () => void;
  readonly valueExpr?: Expr;
  readonly irName?: string;
  readonly capture?: { readonly of: Binding; readonly byRef: () => void };
  readonly reference?: boolean;
}

export const writeRules = (b: Binding): Binding => b.capture?.of ?? b;

export const irNameOf = (b: Binding): string => b.irName ?? b.name;

export function cloneIr<T>(value: T): T {
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
  private readonly takenIr = new Set<string>();
  private readonly byIr = new Map<string, Binding>();
  private ownerDecl: FuncDecl | undefined;
  private resourceStructs: ReadonlySet<string> = new Set();
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
  private classStructs: readonly CollectedStruct[] = [];
  private readonly enums = new Set<string>();
  private readonly namespaces = new Set<string>();
  private namespacePrefix: string | undefined;
  private staticOwner: string | undefined;
  private constantF32Conversions = false;
  private privates: PrivateFieldTable = new Map();
  private withheldMembers: WithheldTable = new Map();
  private readonlyMembers: ReadonlyFieldTable = new Map();
  private restrictedMembers: RestrictedFieldTable = new Map();
  private readonly chainAliases = new Map<ts.Node, () => Expr>();
  private readonly symbols: DeclaredSymbolSink | undefined;
  private loopDepth = 0;
  private atomicOperandDepth = 0;
  private stage: 'vertex' | 'fragment' | 'compute' | undefined;
  private retType: ShaderType | undefined;
  private inferInto: FuncDecl | undefined;
  private ownerNodeDecl: ts.SignatureDeclaration | undefined;
  private switchDepth = 0;

  constructor(callees?: Map<string, FuncDecl>, symbols?: DeclaredSymbolSink) {
    this.callees = callees ?? new Map();
    this.symbols = symbols;
    this.fns = fileFunctionsOf(this.callees);
    this.refusedDecls = this.fns.refused;
  }

  isGenericFunction(name: string): boolean {
    return this.genericName(name) !== undefined;
  }

  isFileGenericFunction(name: string): boolean {
    if (this.fns.generics.has(name)) return true;
    for (const qualified of this.qualifiedNames(name)) {
      if (this.fns.generics.has(qualified)) return true;
    }
    return false;
  }

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

  instantiateMember(
    cf: ClassFunction,
    node: ts.CallExpression | ts.NewExpression,
    on: ts.Expression | undefined,
    sourceFile: ts.SourceFile,
    diagnostics: TsCompilerDiagnostic[],
  ): { readonly decl: FuncDecl; readonly writes: boolean } | undefined {
    return this.fns.instantiateMember?.(cf, node, on, sourceFile, diagnostics, this);
  }

  functionParamsOf(name: string): ReadonlySet<number> | undefined {
    const written = this.genericName(name);
    return written === undefined ? undefined : this.fns.fnParams.get(written);
  }

  liftArgument(
    node: ts.ArrowFunction | ts.FunctionExpression,
    shape: FunctionShape,
    hint: string,
    sourceFile: ts.SourceFile,
    diagnostics: TsCompilerDiagnostic[],
  ): FuncDecl | undefined {
    return this.fns.lift?.(node, shape, hint, this, sourceFile, diagnostics);
  }

  buildFunction(
    key: string,
    base: string,
    shown: string,
    captures: readonly CaptureKey[],
    build: (name: string) => FuncDecl,
  ): FuncDecl | undefined {
    return this.fns.build?.(key, base, shown, captures, build);
  }

  calleeReady(
    decl: FuncDecl,
    at: ts.Node,
    sourceFile: ts.SourceFile,
    diagnostics: TsCompilerDiagnostic[],
  ): boolean {
    return this.fns.ensure?.(decl, at, sourceFile, diagnostics) ?? true;
  }

  private genericName(name: string): string | undefined {
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
    const owner = this.ownerDecl?.name;
    if (owner !== undefined && this.refusedDecls.has(`${owner}_${name}`)) return true;
    for (const qualified of this.qualifiedNames(name)) {
      if (this.refusedDecls.has(qualified)) return true;
    }
    return false;
  }

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

  setStage(s: 'vertex' | 'fragment' | 'compute' | undefined): void {
    this.stage = s;
  }

  currentStage(): 'vertex' | 'fragment' | 'compute' | undefined {
    return this.stage;
  }

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

  private returnsAbsenceMask = 0;
  private readonly absentReturns: { stmt: { expr?: Expr }; absence: 1 | 2 }[] = [];

  setReturnsAbsence(mask: number): void {
    this.returnsAbsenceMask = mask;
  }

  returnsAbsence(): number {
    return this.returnsAbsenceMask;
  }

  deferAbsentReturn(stmt: { expr?: Expr }, absence: 1 | 2): void {
    this.absentReturns.push({ stmt, absence });
  }

  fillAbsentReturns(make: (absence: 1 | 2) => Expr): void {
    for (const r of this.absentReturns) r.stmt.expr = make(r.absence);
    this.absentReturns.length = 0;
  }

  pendingAbsentReturns(): number {
    return this.absentReturns.length;
  }

  dropAbsentReturns(): void {
    for (const r of this.absentReturns) delete r.stmt.expr;
    this.absentReturns.length = 0;
  }

  setReturnType(t: ShaderType | undefined): void {
    this.retType = t;
  }

  returnType(): ShaderType | undefined {
    return this.retType;
  }

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

  inSwitch(): boolean {
    return this.switchDepth > 0;
  }

  setStructs(list: readonly StructDecl[]): void {
    this.structs.clear();
    // Why: WGSL builds the `atomicCompareExchangeWeak` result struct in and gives it no name,
    // so no file declares it and no backend emits it.
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

  isNamespace(name: string): boolean {
    return this.namespaces.has(name);
  }

  fieldType(structName: string, field: string): ShaderType | undefined {
    return this.structByName(structName)?.fields.find((f) => f.name === field)?.type;
  }

  setPrivateFields(table: PrivateFieldTable): void {
    this.privates = table;
  }

  privateField(structName: string, field: string): PrivateField | undefined {
    return this.privates.get(structName)?.get(field);
  }

  hasPrivateFields(structName: string): boolean {
    return (this.privates.get(structName)?.size ?? 0) > 0;
  }

  setWithheldFields(table: WithheldTable): void {
    this.withheldMembers = table;
  }

  isWithheld(structName: string, field: string): boolean {
    return this.withheldMembers.get(structName)?.has(field) ?? false;
  }

  setReadonlyFields(table: ReadonlyFieldTable): void {
    this.readonlyMembers = table;
  }

  readonlyField(structName: string, field: string): ts.ClassLikeDeclaration | undefined {
    return this.readonlyMembers.get(structName)?.get(field);
  }

  setRestrictedFields(table: RestrictedFieldTable): void {
    this.restrictedMembers = table;
  }

  restrictedField(structName: string, field: string): RestrictedField | undefined {
    return this.restrictedMembers.get(structName)?.get(field);
  }

  hasHiddenFields(structName: string): boolean {
    return (
      this.hasPrivateFields(structName) || (this.restrictedMembers.get(structName)?.size ?? 0) > 0
    );
  }

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

  setStaticClass(name: string | undefined): void {
    this.staticOwner = name;
  }

  staticClass(): string | undefined {
    return this.staticOwner;
  }

  withF64ConstPrecision<T>(lower: () => T): T {
    const previous = this.constantF32Conversions;
    this.constantF32Conversions = true;
    try {
      return lower();
    } finally {
      this.constantF32Conversions = previous;
    }
  }

  preservesConstantF32(): boolean {
    return this.constantF32Conversions;
  }

  structByName(name: string): StructDecl | undefined {
    return this.structs.get(name) ?? optionalDeclOf(name);
  }

  setClassStructs(structs: readonly CollectedStruct[]): void {
    this.classStructs = structs;
  }

  classOrigins(): readonly CollectedStruct[] {
    return this.classStructs;
  }

  allCallees(): readonly FuncDecl[] {
    return [...this.callees.values()];
  }

  setResourceStructs(names: ReadonlySet<string>): void {
    this.resourceStructs = names;
  }

  entryResultMatches(fieldNames: readonly string[]): StructDecl[] {
    const set = new Set(fieldNames);
    const out: StructDecl[] = [];
    for (const s of this.structs.values()) {
      if (s.name.startsWith('__') || this.resourceStructs.has(s.name)) continue;
      if (this.hasHiddenFields(s.name)) continue;
      if (s.fields.length !== set.size) continue;
      if (!s.fields.every((f) => set.has(f.name))) continue;
      out.push(s);
    }
    return out;
  }

  matchStruct(fieldNames: readonly string[]): StructDecl | undefined {
    const set = new Set(fieldNames);
    let hit: StructDecl | undefined;
    for (const s of this.structs.values()) {
      if (this.hasHiddenFields(s.name)) continue;
      if (s.fields.length !== set.size) continue;
      if (!s.fields.every((f) => set.has(f.name))) continue;
      if (hit) return undefined;
      hit = s;
    }
    return hit;
  }

  setSuperCtor(info: SuperCtor | undefined): void {
    this.superCtorInfo = info;
  }

  superCtor(): SuperCtor | undefined {
    return this.superCtorInfo;
  }

  setAfterSuper(stmts: readonly Stmt[] | undefined): void {
    this.afterSuperStmts = stmts;
    this.afterSuperTaken = false;
  }

  takeAfterSuper(): Stmt[] {
    const stmts = this.afterSuperStmts ?? [];
    const out = this.afterSuperTaken ? stmts.map((st) => cloneIr(st)) : [...stmts];
    this.afterSuperTaken = true;
    return out;
  }

  afterSuperPending(): boolean {
    return !this.afterSuperTaken && (this.afterSuperStmts?.length ?? 0) > 0;
  }

  setBases(bases: ReadonlyMap<string, readonly string[]>): void {
    this.baseNames = bases;
  }

  setAbstractStructs(names: ReadonlySet<string>): void {
    this.abstractNames = names;
  }

  isAbstractStruct(name: string): boolean {
    return this.abstractNames.has(name);
  }

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

  setStaticHolders(holders: ReadonlyMap<string, string>): void {
    this.staticHolders = holders;
  }

  staticHolderOf(name: string): string {
    return this.staticHolders.get(name) ?? name;
  }

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

  inheritanceNote(want: ShaderType, got: ShaderType): string {
    if (want.kind !== 'struct' || got.kind !== 'struct') return '';
    const [w, g] = [authorTypeText(want), authorTypeText(got)];
    if (this.extendsStruct(got.name, want.name)) {
      return (
        ` "${g}" extends "${w}", and a name typed as the base cannot hold a ` +
        `derived value here without a proven read-only, dispatch-equivalent base view. ` +
        `Keep "${g}" as the type to preserve its methods and receiver writes.`
      );
    }
    if (this.extendsStruct(want.name, got.name)) {
      return ` "${w}" extends "${g}", and a "${g}" has none of the fields "${w}" adds.`;
    }
    return '';
  }

  setSuperMethods(map: ReadonlyMap<string, string> | undefined): void {
    this.superMethodMap = map;
  }

  superMethods(): ReadonlyMap<string, string> | undefined {
    return this.superMethodMap;
  }

  setOwner(decl: FuncDecl | undefined): void {
    this.ownerDecl = decl;
  }

  owner(): FuncDecl | undefined {
    return this.ownerDecl;
  }

  private moduleConstants = false;

  markModuleConstants(): void {
    this.moduleConstants = true;
  }

  atModuleConstant(): boolean {
    return this.moduleConstants;
  }

  setOwnerNode(node: ts.SignatureDeclaration | undefined): void {
    this.ownerNodeDecl = node;
  }

  ownerNode(): ts.SignatureDeclaration | undefined {
    return this.ownerNodeDecl;
  }

  private hoistable = false;
  private readonly hoisted: Stmt[] = [];

  withHoisting<R>(allowed: boolean, f: () => R): R {
    const saved = this.hoistable;
    this.hoistable = allowed;
    try {
      return f();
    } finally {
      this.hoistable = saved;
    }
  }

  canHoist(): boolean {
    return this.hoistable;
  }

  hoistTemp(prefix: string, init: Expr): Expr {
    const name = this.defineTemp(prefix, init.type);
    this.hoisted.push({ s: 'let', name, expr: init });
    return { op: 'varref', type: init.type, name };
  }

  hoistVar(prefix: string, init: Expr): Expr {
    const name = this.defineTemp(prefix, init.type, true);
    this.hoisted.push({ s: 'var', name, type: init.type, init });
    return { op: 'varref', type: init.type, name };
  }

  selectWithSetup(
    cond: Expr,
    ifTrue: Expr,
    ifFalse: Expr,
    yes: readonly Stmt[] = [],
    no: readonly Stmt[] = [],
  ): Expr {
    if (yes.length === 0 && no.length === 0)
      return { op: 'select', type: ifTrue.type, cond, ifTrue, ifFalse };
    const name = this.defineTemp('_opt_branch', ifTrue.type, true);
    const target: Expr = { op: 'varref', type: ifTrue.type, name };
    this.hoisted.push(
      { s: 'var', name, type: ifTrue.type },
      {
        s: 'if',
        arms: [{ cond, body: [...yes, { s: 'assign', target, expr: ifTrue }] }],
        elseBody: [...no, { s: 'assign', target, expr: ifFalse }],
      },
    );
    return target;
  }

  hoistMark(): number {
    return this.hoisted.length;
  }

  takeHoisted(mark: number): Stmt[] {
    return this.hoisted.splice(mark);
  }

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

  bindingOfDeclaration(node: CaptureKey): Binding | undefined {
    if (this.ownerDecl === undefined) return undefined;
    return fileFunctionsOf(this.callees).declared.get(this.ownerDecl)?.get(node);
  }

  capturesOf(fn: string): readonly CaptureKey[] {
    return fileFunctionsOf(this.callees).captures.get(fn) ?? [];
  }

  defineCallee(fn: FuncDecl): void {
    this.callees.set(fn.name, fn);
  }

  setLocalFunctions(map: ReadonlyMap<string, string> | undefined): void {
    this.localFns = map;
  }

  localFunctions(): ReadonlyMap<string, string> | undefined {
    return this.localFns;
  }

  resolveFileCallee(name: string): FuncDecl | undefined {
    const direct = this.callees.get(name);
    if (direct !== undefined) return direct;
    for (const qualified of this.qualifiedNames(name)) {
      const hit = this.callees.get(qualified);
      if (hit !== undefined) return hit;
    }
    return undefined;
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

  private *qualifiedNames(name: string): Generator<string> {
    let prefix = this.namespacePrefix;
    while (prefix !== undefined && prefix !== '') {
      yield `${prefix}_${name}`;
      const cut = prefix.lastIndexOf('_');
      prefix = cut < 0 ? '' : prefix.slice(0, cut);
    }
  }

  setNamespacePrefix(prefix: string | undefined): void {
    this.namespacePrefix = prefix;
  }

  namespaceOf(): string | undefined {
    return this.namespacePrefix;
  }

  qualifiedStruct(name: string): string | undefined {
    if (this.structByName(name) !== undefined) return name;
    for (const qualified of this.qualifiedNames(name)) {
      if (this.structByName(qualified) !== undefined) return qualified;
    }
    return undefined;
  }

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

  define(binding: Binding, reserveModuleNames = false, fixedInputName = false): Binding {
    const top = this.frames[this.frames.length - 1]!;
    if (top.has(binding.name)) {
      throw new Error(`Duplicate binding "${binding.name}" in current scope frame`);
    }
    const ir =
      binding.kind === 'param' || fixedInputName
        ? (binding.irName ?? binding.name)
        : this.allocIrName(
            binding.irName ?? binding.name,
            reserveModuleNames ? (n) => this.namesModuleDecl(n) : undefined,
          );
    this.takenIr.add(ir);
    const stored: Binding = ir === binding.name ? binding : { ...binding, irName: ir };
    top.set(binding.name, stored);
    this.byIr.set(ir, stored);
    return stored;
  }

  sourceNames(): Map<string, string> {
    return new Map([...this.byIr].map(([ir, b]) => [ir, b.name]));
  }

  defineAlias(name: string, target: Binding): void {
    const top = this.frames[this.frames.length - 1]!;
    if (top.has(name)) throw new Error(`Duplicate binding "${name}" in current scope frame`);
    top.set(name, target);
  }

  defineTemp(prefix: string, type: ShaderType, mutable = false): string {
    const ir = this.allocIrName(prefix, (n) => this.namesModuleDecl(n));
    this.byIr.set(ir, { kind: 'local', name: ir, type, mutable });
    return ir;
  }

  private namesModuleDecl(name: string): boolean {
    if (this.structs.has(name) || this.callees.has(name)) return true;
    for (const fn of this.callees.values()) if (fn.name === name) return true;
    return false;
  }

  setChainAlias(node: ts.Node, make: () => Expr): void {
    this.chainAliases.set(node, make);
  }

  chainAlias(node: ts.Node): (() => Expr) | undefined {
    return this.chainAliases.get(node);
  }

  private allocIrName(name: string, reserved: (n: string) => boolean = () => false): string {
    const free = (n: string): boolean => !this.takenIr.has(n) && !reserved(n);
    if (free(name)) {
      this.takenIr.add(name);
      return name;
    }
    for (let n = 1; ; n++) {
      const candidate = `${name}_${n}`;
      if (free(candidate)) {
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
    for (const qualified of this.qualifiedNames(name)) {
      for (let i = this.frames.length - 1; i >= 0; i--) {
        const hit = this.frames[i]!.get(qualified);
        if (hit) return hit;
      }
    }
    return undefined;
  }

  resolveModuleValue(name: string): Binding | undefined {
    const module = this.frames[0]!;
    const direct = module.get(name);
    if (direct) return direct;
    for (const qualified of this.qualifiedNames(name)) {
      const hit = module.get(qualified);
      if (hit) return hit;
    }
    return undefined;
  }

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
