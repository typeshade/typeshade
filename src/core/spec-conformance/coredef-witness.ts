// ═══ One witness per instance of a core.def row, read by both halves (0017) ═══
//
// A row of `core.def` is generic: `fn dot<N: num, T: fiu32_f16>(vec<N, T>, vec<N, T>) -> T`
// stands for one overload per length and element. An INSTANCE binds each type parameter to a
// type TypeShade has (`N = 3, T = u32`) and reads `dot(vec3u, vec3u) -> u32`. Its WITNESS is a
// fragment entry that builds each argument as a local whose type is written out, calls the
// builtin once, and keeps the result:
//
//   const a0: vec3u = vec3u(u32(v.uv.x));
//   const a1: vec3u = vec3u(u32(v.uv.x));
//   const r = dot(a0, a1);
//
// Both halves then read the same text: `compile()` for whether it accepts the call and the type
// it gives it (`CompileTsSourceResult.expressions`), and the language service, through the host
// it runs on, for the errors it reports and the type its checker gives the same call. The
// arguments carry written types, so what is compared is the builtin's own declaration and
// nothing it was handed.
//
// Rows over scalars and vectors of them are witnessed in a fragment entry. A row that takes an
// atomic's location or a runtime-sized array is witnessed in a compute entry, each such
// argument a storage binding of its own the call names bare (`atomicAdd(w3_a0, a1)`), and a
// row that returns nothing is called as a statement. A family whose rows take other types (a
// texture, a matrix) extends `row-types.ts` when it lands.
import ts from 'typescript';
import { compileTsSource } from '../../compiler/ts/source-file.js';
import type { ShaderType } from '../ir/types.js';
import { TypeshadeHost } from '../../language-service/host.js';
import {
  analyzeSourceFile,
  createTypeshadeLanguageServiceWith,
} from '../../language-service/service.js';
import {
  isValueType,
  namesOf,
  rowTypes,
  scalarDomain,
  type RowType,
} from '../builtins/row-types.js';
import type { CoreDefRow } from '../builtins/coredef-types.js';

export type { CoreDefRow };

type Witnessable = RowType;

/** One instance: the row, what each type parameter is bound to, and the concrete types. */
export interface Instance {
  readonly row: CoreDefRow;
  readonly bind: Readonly<Record<string, string>>;
  readonly params: readonly Witnessable[];
  readonly ret: Witnessable;
}

/**
 * Every instance of `row` over the types TypeShade has, or `undefined` when the row has a type
 * `row-types.ts` has no form for yet.
 */
export function instancesOf(
  row: CoreDefRow,
  matchers: Readonly<Record<string, readonly string[]>>,
): Instance[] | undefined {
  const types = rowTypes(row);
  if (types === undefined) return undefined;
  let binds: Record<string, string>[] = [{}];
  // Only the parameters a type names: an address space or an access mode (`S`, `A`) is the
  // pointer's, which an author never writes.
  const named = new Set([...types.params, types.ret].flatMap(namesOf));
  for (const [param, constraint] of Object.entries(row.implicit)) {
    if (!named.has(param)) continue;
    const domain: string[] =
      constraint === 'num' ? ['2', '3', '4'] : scalarDomain(constraint, matchers);
    binds = binds.flatMap((b) => domain.map((d) => ({ ...b, [param]: d })));
  }
  const subst = (t: Witnessable, b: Record<string, string>): Witnessable =>
    t.k === 'void'
      ? t
      : t.k === 'vec'
        ? { k: 'vec', n: b[t.n] ?? t.n, s: b[t.s] ?? t.s }
        : { ...t, s: b[t.s] ?? t.s };
  return binds.map((bind) => ({
    row,
    bind,
    params: types.params.map((p) => subst(p, bind)),
    ret: subst(types.ret, bind),
  }));
}

/** The spelling both halves are compared in: `u32`, `vec3<u32>`, `atomic<u32>`. */
export function spellWitnessable(t: Witnessable): string {
  switch (t.k) {
    case 'scalar':
      return t.s;
    case 'vec':
      return `vec${t.n}<${t.s}>`;
    case 'atomic':
      return `atomic<${t.s}>`;
    case 'runtimeArray':
      return `array<${t.s}>`;
    case 'casResult':
      return `__atomic_compare_exchange_result<${t.s}>`;
    case 'void':
      return 'void';
  }
}

/** The name an author writes for a value's type. */
function authorSpelling(t: Witnessable): string {
  if (t.k === 'scalar') return t.s;
  if (t.k !== 'vec') return spellWitnessable(t);
  const suffix: Record<string, string> = { f32: '', i32: 'i', u32: 'u', bool: 'b' };
  return `vec${t.n}${suffix[t.s] ?? ''}`;
}

/** A value of the type, built from the entry's input (`x`, an `f32`) so no constant folds it
 *  away. */
function valueOf(t: Witnessable, x: string): string {
  const scalar: Record<string, string> = {
    f32: x,
    i32: `i32(${x})`,
    u32: `u32(${x})`,
    bool: `${x} > 0.5`,
  };
  if (t.k !== 'scalar' && t.k !== 'vec') throw new Error(`no value of ${spellWitnessable(t)}`);
  const s = scalar[t.s] ?? x;
  return t.k === 'scalar' ? s : `${authorSpelling(t)}(${s})`;
}

const HEAD = [
  '"use typeshade"',
  'class V {',
  '  @builtin("position") pos: vec4;',
  '  @location(0) uv: vec2;',
  '}',
  '',
].join('\n');

/** The witness of one instance: a fragment entry, and the call's text in it. */
export function witnessOf(inst: Instance, index: number): { text: string; call: string } {
  const compute =
    !inst.params.every(isValueType) ||
    !inst.row.stages.every((s) => s === 'fragment' || s === 'compute')
      ? true
      : inst.row.stages.length > 0 && !inst.row.stages.includes('fragment');
  const x = compute ? 'f32(gid.x)' : 'v.uv.x';
  const bindings: string[] = [];
  const names = inst.params.map((p, j) => {
    const name = `w${String(index)}_a${String(j)}`;
    if (p.k === 'atomic')
      bindings.push(`declare const ${name}: storage<atomic<${p.s}>, "read_write">;`);
    else if (p.k === 'runtimeArray')
      bindings.push(`declare const ${name}: storage<array<${p.s}>>;`);
    else return `a${String(j)}`;
    return name;
  });
  const decls = inst.params.flatMap((p, j) =>
    isValueType(p) ? [`  const a${String(j)}: ${authorSpelling(p)} = ${valueOf(p, x)};`] : [],
  );
  const call = `${inst.row.name}(${names.join(', ')})`;
  const body = [...decls, inst.ret.k === 'void' ? `  ${call};` : `  const r = ${call};`];
  const text = [
    ...bindings,
    ...(compute
      ? [
          '@compute([1, 1, 1])',
          `export function cs_${String(index)}(@builtin("global_invocation_id") gid: vec3u): void {`,
          ...body,
        ]
      : [
          '@fragment',
          `export function fs_${String(index)}(v: V): vec4 {`,
          ...body,
          '  return vec4(0., 0., 0., 1.);',
        ]),
    '}',
    '',
  ].join('\n');
  return { text, call };
}

function spellShader(t: ShaderType): string {
  if (t.kind === 'scalar') return t.scalar;
  if (t.kind === 'vec') return `vec${String(t.n)}<${t.elem}>`;
  const cas = t.kind === 'struct' ? /^__atomic_compare_exchange_result_(\w+)$/.exec(t.name) : null;
  if (cas) return `__atomic_compare_exchange_result<${cas[1]!}>`;
  return t.kind;
}

/** What one half made of one instance. */
export interface HalfReading {
  readonly accepts: boolean;
  /** The call's type, spelled as `spellWitnessable` spells it; undefined when none was read. */
  readonly type: string | undefined;
  readonly errors: readonly string[];
}

/** The compiler's reading of each instance, each witness compiled on its own. */
export function compilerReadings(instances: readonly Instance[]): HalfReading[] {
  return instances.map((inst, i) => {
    const { text, call } = witnessOf(inst, i);
    const source = HEAD + text;
    const result = compileTsSource(source);
    const errors = result.diagnostics
      .filter((d) => d.category === 'error')
      .map((d) => `${d.code} ${d.message}`);
    const at = source.indexOf(call);
    const e = result.expressions.find((x) => x.start === at && x.length === call.length);
    return { accepts: errors.length === 0, type: e ? spellShader(e.type) : undefined, errors };
  });
}

/** The spelling of TypeScript's type for a call, by the brand keys the ambient library
 *  declares: `[f32Tag]` and its siblings for a scalar, `[vecTag]` for a vector. */
function spellChecked(checker: ts.TypeChecker, t: ts.Type): string {
  if (t.flags & ts.TypeFlags.Any) return 'any';
  if (t.flags & ts.TypeFlags.Void) return 'void';
  // The compare-exchange's result, which the ambient library spells as its two fields.
  const oldValue = t.getProperty('old_value');
  if (oldValue !== undefined && t.getProperty('exchanged') !== undefined) {
    return `__atomic_compare_exchange_result<${spellChecked(checker, checker.getTypeOfSymbol(oldValue))}>`;
  }
  if (t.flags & ts.TypeFlags.BooleanLike) return 'bool';
  const literal = (x: ts.Type): string =>
    x.isStringLiteral() || x.isNumberLiteral() ? String(x.value) : checker.typeToString(x);
  for (const p of checker.getPropertiesOfType(t)) {
    const tag = /^__@(\w+)Tag@/.exec(p.escapedName as string)?.[1];
    if (tag === undefined) continue;
    if (tag === 'vec') {
      const value = checker.getNonNullableType(checker.getTypeOfSymbol(p));
      const args = checker.isTupleType(value)
        ? checker.getTypeArguments(value as ts.TypeReference)
        : [];
      return args.length === 2 ? `vec${literal(args[1]!)}<${literal(args[0]!)}>` : '#vec';
    }
    return tag;
  }
  if (t.flags & ts.TypeFlags.NumberLike) return 'number';
  return checker.typeToString(t);
}

/**
 * The editor's reading of each instance under `ambientLib`: every witness in one document, the
 * errors the language service reports inside each (its TypeScript half, after its own filters),
 * and the type its checker gives each call.
 */
export function editorReadings(instances: readonly Instance[], ambientLib: string): HalfReading[] {
  const witnesses = instances.map((inst, i) => witnessOf(inst, i));
  const source = HEAD + witnesses.map((w) => w.text).join('');
  const uri = '/coredef-witnesses.ts';

  const service = createTypeshadeLanguageServiceWith({ ambientLib }, analyzeSourceFile, {
    merge: false,
  });
  service.openDocument(uri, source);
  const errorsAt = service
    .getDiagnostics(uri)
    .filter((d) => d.source === 'typescript' && d.severity === 'error')
    .map((d) => ({ at: d.span.start, text: `TS${String(d.code)} ${d.message}` }));

  const host = new TypeshadeHost({ ambientLib });
  host.openDocument(uri, source);
  const program = ts.createLanguageService(host, ts.createDocumentRegistry()).getProgram()!;
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(uri)!;
  const projection = host.projectionOf(uri)!;

  let offset = HEAD.length;
  return witnesses.map((w) => {
    const start = offset;
    offset += w.text.length;
    const callAt = start + w.text.indexOf(w.call);
    const from = projection.toProjected(callAt);
    const to = projection.toProjected(callAt + w.call.length);
    let node: ts.Node | undefined;
    const visit = (n: ts.Node): void => {
      if (n.getStart(sf) > from || n.getEnd() < to) return;
      if (ts.isCallExpression(n) && n.getStart(sf) === from && n.getEnd() === to) node = n;
      ts.forEachChild(n, visit);
    };
    visit(sf);
    const errors = errorsAt.filter((e) => e.at >= start && e.at < offset).map((e) => e.text);
    return {
      accepts: errors.length === 0,
      type: node === undefined ? undefined : spellChecked(checker, checker.getTypeAtLocation(node)),
      errors,
    };
  });
}

/** Where the two halves part on one instance, or undefined where they agree. */
export function disagreement(
  inst: Instance,
  compiler: HalfReading,
  editor: HalfReading,
): string | undefined {
  const call = `${inst.row.name}(${inst.params.map(spellWitnessable).join(', ')})`;
  if (compiler.accepts !== editor.accepts) {
    return compiler.accepts
      ? `${call}: the compiler accepts it, the editor reports ${editor.errors[0] ?? '?'}`
      : `${call}: the editor accepts it, the compiler reports ${compiler.errors[0] ?? '?'}`;
  }
  if (!compiler.accepts) return undefined;
  const expected = spellWitnessable(inst.ret);
  if (compiler.type !== expected)
    return `${call}: core.def says ${expected}, the compiler ${compiler.type ?? '?'}`;
  if (editor.type !== expected)
    return `${call}: core.def says ${expected}, the editor ${editor.type ?? '?'}`;
  return undefined;
}
