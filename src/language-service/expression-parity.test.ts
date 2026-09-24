// Verifies: Rule 12.7 (docs/language-design.md; traced in reqs/).

// The editor gives every expression the type the compiler gives it (Rule 12.7, 0015).
//
// A `"use typeshade"` program is typed twice: by the front end, which gives every expression it
// lowers a `ShaderType` (`CompileTsSourceResult.expressions`), and by the language service's
// TypeScript checker, which gives the same expression a type from the ambient library. The
// scalar brands are optional, so an ambient declaration that says `number` where the compiler
// means `u32` draws no error anywhere: it shows only in a hover, a completion list or signature
// help. #271 was one (`src.length` on a runtime-sized array), and no test compared the two.
//
// This gate compares them on every program the repository ships, `examples/` and `journeys/`.
// Most differences are propagated: once one operand is `number`, what is built on it is too. So
// what it reports is the FIRST divergence, a property access, an element access or a call whose
// receiver and arguments agree with the compiler (or are numeric literals, which TypeScript
// types by their value) and whose own type does not. Each is grouped by what it reads (a member
// name, or the callee) and by the two types.
//
// KNOWN holds the groups still open, each with the class 0015 files it under. The table is
// shrink-only: a group it does not list fails the gate (a new drift), and a listed group that no
// longer occurs fails it too (a fix that forgot to take its row out), so the table cannot rot
// into a list of things that were true once. The instrument is proven first, against the exact
// declaration #271 fixed, before any zero is believed (AGENTS.md#gate-discipline).
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { compileTsSource } from '../compiler/ts/source-file.js';
import type { ShaderType } from '../core/ir/types.js';
import { SHADE_DTS } from './ambient.js';
import { TypeshadeHost } from './host.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every program the repository ships: the examples, and each journey's shader. */
function shippedPrograms(): { readonly uri: string; readonly text: string }[] {
  const files: string[] = [];
  for (const f of readdirSync(join(ROOT, 'examples'))) {
    if (f.endsWith('.shade.ts')) files.push(join(ROOT, 'examples', f));
  }
  for (const d of readdirSync(join(ROOT, 'journeys'), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of readdirSync(join(ROOT, 'journeys', d.name))) {
      if (f.endsWith('.shade.ts')) files.push(join(ROOT, 'journeys', d.name, f));
    }
  }
  return files.sort().map((path) => ({
    uri: `/${relative(ROOT, path).split('\\').join('/')}`,
    text: readFileSync(path, 'utf8'),
  }));
}

/** A `ShaderType` in the spelling this gate compares: `f32`, `vec3<f32>`, `mat4x4<f32>`,
 *  `array<f32, 3>`, `array<f32>`, a struct by name. */
function spell(t: ShaderType): string {
  switch (t.kind) {
    case 'scalar':
      return t.scalar;
    case 'f64':
      return 'f64';
    case 'vec':
      return `vec${t.n}<${t.elem}>`;
    case 'vec64':
      return `vec${t.n}<f64>`;
    case 'mat':
      return `mat${t.cols}x${t.rows}<${t.elem}>`;
    case 'array':
      return t.size === undefined
        ? `array<${spell(t.elem)}>`
        : `array<${spell(t.elem)}, ${t.size}>`;
    case 'atomic':
      return `atomic<${t.elem}>`;
    case 'struct':
      return t.name;
    default:
      return t.kind;
  }
}

/** The same spelling for the type TypeScript gives an expression, read off the brand keys the
 *  ambient library declares (`[f32Tag]`, `[vecTag]`, `[matTag]`, `[arrayTag]`, …). A type with
 *  no brand is spelled by what TypeScript knows of it: `number`, `bool`, a class by name. The
 *  read-only view of a struct (`ReadView<Ray>`, an element of a read binding) has lost its name
 *  by the time TypeScript hands it back, so an unnamed object is spelled as the struct of the
 *  program, `structs` by sorted field names, whose fields it has. */
function spellTs(
  checker: ts.TypeChecker,
  t: ts.Type,
  structs: ReadonlyMap<string, string> = new Map(),
): string {
  const again = (u: ts.Type): string => spellTs(checker, u, structs);
  if (t.flags & ts.TypeFlags.Any) return 'any';
  if (t.flags & ts.TypeFlags.BooleanLike) return 'bool';
  if (t.isUnion()) {
    const parts = [...new Set(t.types.map((u) => again(u)))];
    return parts.length === 1 ? parts[0]! : parts.join(' | ');
  }
  if (t.aliasSymbol?.name === 'ReadView' && t.aliasTypeArguments?.[0] !== undefined) {
    return again(t.aliasTypeArguments[0]);
  }
  if (checker.isTupleType(t)) {
    const elems = checker.getTypeArguments(t as ts.TypeReference);
    const spelled = [...new Set(elems.map((e) => again(e)))];
    return spelled.length === 1 ? `array<${spelled[0]}, ${elems.length}>` : 'tuple';
  }
  const literal = (x: ts.Type): string =>
    x.isStringLiteral() || x.isNumberLiteral() ? String(x.value) : checker.typeToString(x);
  const tuple = (x: ts.Type): readonly ts.Type[] => {
    const nn = checker.getNonNullableType(x);
    return checker.isTupleType(nn) ? checker.getTypeArguments(nn as ts.TypeReference) : [];
  };
  for (const p of checker.getPropertiesOfType(t)) {
    const tag = /^__@(\w+)Tag@/.exec(p.escapedName as string)?.[1];
    if (tag === undefined) continue;
    const value = checker.getTypeOfSymbol(p);
    const args = tuple(value);
    switch (tag) {
      case 'f32':
      case 'i32':
      case 'u32':
      case 'f64':
        return tag;
      case 'vec':
        return `vec${literal(args[1]!)}<${literal(args[0]!)}>`;
      case 'vec64':
        return `vec${literal(checker.getNonNullableType(value))}<f64>`;
      case 'mat':
        return `mat${literal(args[1]!)}x${literal(args[2]!)}<${literal(args[0]!)}>`;
      case 'array': {
        const n = literal(args[1]!);
        const elem = again(args[0]!);
        return n === 'number' ? `array<${elem}>` : `array<${elem}, ${n}>`;
      }
      case 'atomic':
        return `atomic<${again(checker.getNonNullableType(value))}>`;
      default:
        return `#${tag}`;
    }
  }
  if (t.flags & ts.TypeFlags.NumberLike) return 'number';
  const name = t.aliasSymbol?.name ?? t.getSymbol()?.name;
  if (name !== undefined && name !== '__type' && name !== '__object') return name;
  const fields = checker
    .getPropertiesOfType(t)
    .map((p) => p.name)
    .filter((n) => !n.startsWith('__@'))
    .sort()
    .join(',');
  return structs.get(fields) ?? checker.typeToString(t);
}

/** One first divergence: where it is, what it reads, and the two types. */
interface Divergence {
  readonly uri: string;
  readonly text: string;
  /** The member (`.length`) or the callee (`dot`, `.next`) the expression reads. */
  readonly reads: string;
  readonly compiler: string;
  readonly editor: string;
}

/** The outermost expression of each span in `sf`, keyed `start:end` after `mapStart`/`mapEnd`. */
function expressionsBySpan(
  sf: ts.SourceFile,
  mapStart: (offset: number) => number,
  mapEnd: (offset: number) => number,
): Map<string, ts.Expression> {
  const out = new Map<string, ts.Expression>();
  const visit = (node: ts.Node): void => {
    if (ts.isExpression(node)) {
      const key = `${mapStart(node.getStart(sf))}:${mapEnd(node.getEnd())}`;
      if (!out.has(key)) out.set(key, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const isNumericLiteral = (node: ts.Expression): boolean =>
  ts.isNumericLiteral(node) ||
  (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) ||
  (ts.isParenthesizedExpression(node) && isNumericLiteral(node.expression));

/** What a checked expression reads, or undefined for a kind this gate does not judge: the
 *  operators are TypeScript's to erase (`projection.ts` owns that), not a declaration's. */
function readsOf(node: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return `.${node.name.text}`;
  if (ts.isElementAccessExpression(node)) return '[]';
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isPropertyAccessExpression(callee)) return `.${callee.name.text}()`;
    if (ts.isIdentifier(callee)) return `${callee.text}()`;
    return '()';
  }
  return undefined;
}

/** The expressions a checked expression is built from, in the document as written. */
function inputsOf(node: ts.Expression): readonly ts.Expression[] {
  if (ts.isPropertyAccessExpression(node)) return [node.expression];
  if (ts.isElementAccessExpression(node)) return [node.expression, node.argumentExpression];
  if (ts.isCallExpression(node)) {
    const receiver = ts.isPropertyAccessExpression(node.expression)
      ? [node.expression.expression]
      : [];
    return [...node.arguments, ...receiver];
  }
  return [];
}

/**
 * Every first divergence in `programs`, read through the same host the language service runs
 * (the ambient library `ambientLib`, the projection), and how many expressions were compared.
 */
function firstDivergences(
  programs: readonly { readonly uri: string; readonly text: string }[],
  ambientLib: string = SHADE_DTS,
): { readonly divergences: Divergence[]; readonly compared: number } {
  const registry = ts.createDocumentRegistry();
  const divergences: Divergence[] = [];
  let compared = 0;
  for (const { uri, text } of programs) {
    const result = compileTsSource(text, { fileName: uri });
    const written = result.sourceFile;
    const host = new TypeshadeHost({ ambientLib });
    host.openDocument(uri, text);
    const program = ts.createLanguageService(host, registry).getProgram()!;
    const checker = program.getTypeChecker();
    const projection = host.projectionOf(uri)!;
    const structs = new Map(
      result.structs.map((c) => [
        c.decl.fields
          .map((f) => f.name)
          .sort()
          .join(','),
        c.decl.name,
      ]),
    );
    const identity = (offset: number): number => offset;
    const inWritten = expressionsBySpan(written, identity, identity);
    const inProjected = expressionsBySpan(
      program.getSourceFile(uri)!,
      (o) => projection.toOriginal(o),
      (o) => projection.toOriginal(o),
    );

    // Each span the compiler typed, with TypeScript's type for the same span beside it.
    const agrees = new Map<ts.Expression, boolean>();
    const typed: { node: ts.Expression; compiler: string; editor: string }[] = [];
    for (const e of result.expressions) {
      const key = `${e.start}:${e.start + e.length}`;
      const node = inWritten.get(key);
      const seen = inProjected.get(key);
      if (node === undefined || seen === undefined) continue;
      const compiler = spell(e.type);
      const editor = spellTs(checker, checker.getTypeAtLocation(seen), structs);
      agrees.set(node, compiler === editor);
      typed.push({ node, compiler, editor });
      compared++;
    }
    for (const { node, compiler, editor } of typed) {
      if (compiler === editor) continue;
      const reads = readsOf(node);
      if (reads === undefined) continue;
      const clean = inputsOf(node).every((i) => isNumericLiteral(i) || agrees.get(i) !== false);
      if (!clean) continue;
      divergences.push({ uri, text: node.getText(written), reads, compiler, editor });
    }
  }
  return { divergences, compared };
}

const groupOf = (d: Divergence): string => `${d.reads} | ${d.compiler} | ${d.editor}`;

/**
 * The first divergences still open, by group: `reads | compiler | editor`, and the class 0015
 * files each under.
 *
 *   A  a builtin's result, which the ambient library retypes instead of deriving
 *   B  an unannotated scalar the document declares, which TypeScript infers as `number`
 *   C  a constructor or a method that loses a type argument
 *
 * SHRINK-ONLY: a fix takes its rows out in the same change; a row that no longer occurs fails.
 */
const KNOWN: Readonly<Record<string, 'A' | 'B' | 'C'>> = {
  // A. A builtin's result: `(…: number) => number` (`scalarMathOverload`) and the reductions
  // `SPECIAL_MATH_SIGNATURES` declares by hand, where the compiler gives the argument's scalar.
  'abs() | f32 | number': 'A',
  'abs() | u32 | number': 'A',
  'atan2() | f32 | number': 'A',
  'clamp() | f32 | number': 'A',
  'countOneBits() | u32 | number': 'A',
  'determinant() | f32 | number': 'A',
  'distance() | f32 | number': 'A',
  'dot() | f32 | number': 'A',
  'dot() | i32 | number': 'A',
  'dot() | u32 | number': 'A',
  'firstLeadingBit() | u32 | number': 'A',
  'fwidthCoarse() | f32 | number': 'A',
  'length() | f32 | number': 'A',
  'max() | f32 | number': 'A',
  'max() | u32 | number': 'A',
  'min() | f32 | number': 'A',
  'mix() | f32 | number': 'A',
  'pow() | f32 | number': 'A',
  'radians() | f32 | number': 'A',
  'reverseBits() | u32 | number': 'A',
  'round() | f64 | number': 'A',
  'select() | f32 | number': 'A',
  'sin() | f32 | number': 'A',
  'smoothstep() | f32 | number': 'A',
  'sqrt() | f32 | number': 'A',
  // B. A scalar the document declares with no annotation (a field, a method or function
  // return), which TypeScript infers from a literal as `number` and the front end as `f32`.
  '.#width | f32 | number': 'B',
  '.MIN_WIDTH | f32 | number': 'B',
  '.SIZE | f32 | number': 'B',
  '.dist | f32 | number': 'B',
  '.drawn | f32 | number': 'B',
  '.next() | f32 | number': 'B',
  '.period | f32 | number': 'B',
  'draw() | f32 | number': 'B',
  'pick() | f32 | number': 'B',
  // C. A constructor or a method that loses a type argument: `array(...)` its element and
  // count, an array method its element, a static builder its `this` class.
  '.map() | array<f32, 3> | array<number, 3>': 'C',
  '.map() | array<f32, 4> | array<number, 4>': 'C',
  '.reduce() | f32 | number': 'C',
  '.unit() | Capped | Disc': 'C',
  'array() | array<f32, 3> | array<number>': 'C',
};

describe('the editor gives every expression the type the compiler gives it (Rule 12.7, 0015)', () => {
  const programs = shippedPrograms();

  it('sees a divergence when one is there: the declaration #271 fixed, put back', () => {
    // The ambient `array<T, N>` said `length: N` before #271, so a runtime-sized array's length
    // was `number` to the editor. Put that declaration back and the gate must name it, on the
    // example written for it; a gate that cannot is a gate whose zero means nothing.
    const fixed = 'readonly length: number extends N ? u32 : N';
    expect(SHADE_DTS).toContain(fixed);
    const before = SHADE_DTS.replace(fixed, 'readonly length: N');
    const example = programs.filter((p) => p.uri === '/examples/array-length.shade.ts');
    expect(example).toHaveLength(1);
    const { divergences } = firstDivergences(example, before);
    expect(divergences.map(groupOf)).toContain('.length | u32 | number');
    expect(firstDivergences(example).divergences.map(groupOf)).not.toContain(
      '.length | u32 | number',
    );
  });

  it('reads every shipped program, and compares enough of each to mean something', () => {
    expect(programs.length).toBeGreaterThanOrEqual(80);
    expect(programs.some((p) => p.uri.startsWith('/journeys/'))).toBe(true);
  });

  // One run over every program, shared by the three assertions below: about ten seconds.
  let divergences: readonly Divergence[] = [];
  let compared = 0;
  beforeAll(() => {
    ({ divergences, compared } = firstDivergences(programs));
  }, 120_000);

  it('compared the front end and the checker on thousands of expressions', () => {
    expect(compared).toBeGreaterThanOrEqual(10000);
  });

  it('finds no first divergence KNOWN does not list', () => {
    const unknown = divergences.filter((d) => KNOWN[groupOf(d)] === undefined);
    expect(
      unknown.map((d) => `${groupOf(d)}   at ${d.uri}: ${d.text.replace(/\s+/g, ' ')}`),
    ).toEqual([]);
  });

  it('lists no group that has stopped occurring', () => {
    const seen = new Set(divergences.map(groupOf));
    expect(Object.keys(KNOWN).filter((g) => !seen.has(g))).toEqual([]);
  });
});
