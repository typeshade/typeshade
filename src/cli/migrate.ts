// === `tshc migrate`: a "use typeshade" file to the language's own forms ===
//
// Change 0130 (with change 0140): an entry's stage is an attribute on its function declaration,
// and the stage calls of change 0111, which the compiler refuses (`TS8028`) with a text that
// names this command, are rewritten to it. The rewrite is textual and keeps every
// byte it does not need to change, so a file reads as its author wrote it:
//
//   export const vs = vertex(function vs(i: builtin<"vertex_index", u32>): VsOut { … });
//     → @vertex
//       export function vs(i: builtin<"vertex_index", u32>): VsOut { … }
//   export const main = compute([64], function main(…) { … });   → @compute([64]) on main
//   export const k = workgroup_size([128], function k(…) { … }); → @workgroup_size([128]) on k
//   export const fs = fragment((v: VsOut): vec4 => v.c);
//     → @fragment
//       export function fs(v: VsOut): vec4 { return v.c; }
//   @compute([8]) export default function k(…) { … }   → @compute([8]) export function k(…) { … }
//   class VsOut { pos!: builtin<"position", vec4>; }    → class VsOut { pos: builtin<"position", vec4>; }
//   let q!: f32; put(q);                                → let q: f32; put(q);
//
// The `!` on a field or a local is not written (change 0130, D3): an entry I/O field is filled by
// the stage that produces it, a struct field is zero until written, and a local an `out<T>`
// argument fills first is read as assigned (Rule 7.6).
//
// The decorated form of change 0111 on a parameter or a field is still rewritten to the
// attribute type that replaces it (change 0130, Migration order step 3):
//
//   @location(1) @interpolate("flat") id: u32        → id: location<1, u32, { interpolate: "flat" }>
//   @builtin("position") @invariant pos: vec4        → pos: builtin<"position", vec4, { invariant: true }>
//
// A parameter qualifier is written before the parameter, `@inout v: f32` (Rule 8.25, change
// 0137): the rewrite leaves a written `@inout` or `@out` as it is, and rewrites the type form of
// change 0111 back to it on a parameter of a module function:
//
//   v: inout<f32>, w: out<f32>                       → @inout v: f32, @out w: f32
//
// The diagnostic filter is deleted, wherever it is written (change 0132, item 7): the compiler
// rewrites each implicit-LOD sample or derivative it can reach (Rule 8.5), and refuses a
// written filter (`TS8028`).
//
// A form the rewrite cannot carry is left as written and named in `skipped`, with its line,
// so the author finishes it by hand: an entry with no body, an attribute on a parameter with
// no type, a stage call whose function has a name of its own or options beyond the filter, an
// `export default` entry with no name, a type form of a qualifier that is no parameter's type of
// a module function.

import ts from 'typescript';
import {
  ATTRIBUTE_DECORATORS,
  QUALIFIER_DECORATORS,
  attributeTypeOf,
  decoratorParts,
  isQualifierTypeForm,
} from '../compiler/ts/decorated-form.js';
import { stageCallOf, type StageCall } from '../compiler/ts/stage-call.js';

export interface MigrateResult {
  /** The rewritten text; the input itself when nothing changed. */
  readonly text: string;
  /** How many declarations the rewrite changed. */
  readonly changes: number;
  /** One line per form left as written: `line N: why`. */
  readonly skipped: readonly string[];
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

// The vocabulary and the attribute type are the compiler's, which names the same text in its
// warning on the decorated form (`TS8028`, change 0111, milestone 4).
const STAGES = new Set(['vertex', 'fragment', 'compute', 'workgroup_size']);
const ATTRIBUTES = ATTRIBUTE_DECORATORS;
const QUALIFIERS = QUALIFIER_DECORATORS;
const partsOf = decoratorParts;
const attributeType = attributeTypeOf;

/** The decorators the parser keeps among a declaration's modifiers. */
function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  const modifiers = (node as { modifiers?: readonly ts.ModifierLike[] }).modifiers ?? [];
  return modifiers.filter(ts.isDecorator);
}

/** The text range a run of decorators takes, with the whitespace after the last one, so
 *  removing it leaves the next token where the first decorator was. */
function decoratorRange(decorators: readonly ts.Decorator[], sf: ts.SourceFile): ts.TextRange {
  const start = decorators[0]!.getStart(sf);
  let end = decorators[decorators.length - 1]!.getEnd();
  while (end < sf.text.length && /[ \t]/.test(sf.text[end]!)) end++;
  if (sf.text[end] === '\n') {
    end++;
    // A decorator on a line of its own: drop its indentation-led line entirely, keeping the
    // indentation of the line it stood above.
    let lineStart = start;
    while (lineStart > 0 && /[ \t]/.test(sf.text[lineStart - 1]!)) lineStart--;
    if (lineStart === 0 || sf.text[lineStart - 1] === '\n') {
      while (end < sf.text.length && /[ \t]/.test(sf.text[end]!)) end++;
      return { pos: start, end };
    }
  }
  return { pos: start, end };
}

/** Whether `options`, the argument after a stage call's function, holds the diagnostic filter
 *  of change 0132 and nothing else, which the rewrite deletes. */
function filterOnly(options: ts.Expression, sf: ts.SourceFile): boolean {
  return (
    ts.isObjectLiteralExpression(options) &&
    options.properties.length > 0 &&
    options.properties.every((p) => p.name?.getText(sf) === 'diagnostic')
  );
}

/**
 * The edits that turn a stage call into the function declaration it stands for: the text before
 * the wrapped function's parameters becomes the attribute on a line of its own and
 * `export function name`, an arrow function's `=>` goes and its expression body becomes
 * `{ return expr; }`, and the text after the function (`);`, and a filter of change 0132) goes.
 * The parameters, the return type and the body keep their text, so the other edits of the
 * rewrite inside them still apply. A reason instead for a call the rewrite leaves as written.
 */
function stageCallEdits(sc: StageCall, sf: ts.SourceFile): { edits: Edit[] } | { why: string } {
  const name = sc.declaration.name.text;
  const fn = sc.fn;
  if (ts.isFunctionExpression(fn) && fn.name !== undefined && fn.name.text !== name)
    return {
      why: `the function "${fn.name.text}" that "${name}" wraps has a name of its own; an entry takes one name`,
    };
  if (ts.isFunctionExpression(fn) && fn.asteriskToken !== undefined)
    return { why: `the function "${name}" wraps is a generator` };
  if (fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) === true)
    return { why: `the function "${name}" wraps is async` };
  if (sc.options !== undefined && !filterOnly(sc.options, sf))
    return { why: `the options of "${sc.callee}" hold more than the diagnostic filter` };
  const known = (sc.size === undefined ? 1 : 2) + (sc.options === undefined ? 0 : 1);
  if (sc.call.arguments.length > known)
    return { why: `"${sc.callee}" takes more arguments than the rewrite knows` };
  const text = sf.text;
  const stmtStart = sc.statement.getStart(sf);
  // The indentation of the statement's line, so the attribute and the declaration line up.
  let lineStart = stmtStart;
  while (lineStart > 0 && /[ \t]/.test(text[lineStart - 1]!)) lineStart--;
  const indent = text.slice(lineStart, stmtStart);
  const size = sc.size === undefined ? '' : `(${sc.size.getText(sf)})`;
  const head = `@${sc.callee}${size}\n${indent}${sc.exported ? 'export ' : ''}function ${name}`;
  const edits: Edit[] = [];
  if (ts.isFunctionExpression(fn)) {
    // `function vs(` or `function (`: up to the name, or the keyword, and its whitespace.
    const keyword = fn.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.FunctionKeyword)!;
    let at = fn.name?.getEnd() ?? keyword.getEnd();
    while (at < text.length && /\s/.test(text[at]!)) at++;
    edits.push({ start: stmtStart, end: at, text: head });
  } else {
    const at = fn.getStart(sf);
    edits.push({ start: stmtStart, end: at, text: head });
    const children = fn.getChildren(sf);
    if (!children.some((c) => c.kind === ts.SyntaxKind.OpenParenToken)) {
      // `x => …`: one parameter with no parentheses.
      const p = fn.parameters[0]!;
      edits.push({ start: p.getStart(sf), end: p.getStart(sf), text: '(' });
      edits.push({ start: p.getEnd(), end: p.getEnd(), text: ')' });
    }
    // From the end of the return type, or of the parameters, to the body: ` => ` becomes ` `.
    const arrow = fn.equalsGreaterThanToken;
    let from = arrow.getStart(sf);
    while (from > 0 && /\s/.test(text[from - 1]!)) from--;
    edits.push({ start: from, end: fn.body.getStart(sf), text: ' ' });
    if (!ts.isBlock(fn.body)) {
      edits.push({ start: fn.body.getStart(sf), end: fn.body.getStart(sf), text: '{ return ' });
      edits.push({ start: fn.body.getEnd(), end: fn.body.getEnd(), text: '; }' });
    }
  }
  // `);`, and a filter after the function, go.
  edits.push({ start: fn.getEnd(), end: sc.statement.getEnd(), text: '' });
  return { edits };
}

/** Rewrites one file. Pure: the text in, the text out. */
export function migrateSource(text: string, fileName = 'a.shade.ts'): MigrateResult {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const edits: Edit[] = [];
  const skipped: string[] = [];
  let changes = 0;
  const line = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const skip = (n: ts.Node, why: string): void => void skipped.push(`line ${line(n)}: ${why}`);

  // Attributes on a parameter or a field: the decorators go, the type carries them. A qualifier
  // stays before the parameter (change 0137).
  const rewriteMember = (
    node: ts.ParameterDeclaration | ts.PropertyDeclaration,
    what: string,
  ): boolean => {
    const decorators = decoratorsOf(node).filter((d) => ATTRIBUTES.has(partsOf(d, sf).name));
    if (decorators.length === 0) return false;
    const others = decoratorsOf(node).filter((d) => !QUALIFIERS.has(partsOf(d, sf).name));
    if (decorators.length !== others.length) {
      skip(node, `${what} carries a decorator the rewrite does not know`);
      return false;
    }
    if (node.type === undefined) {
      skip(node, `${what} has no type to carry its attribute`);
      return false;
    }
    const wrapped = attributeType(
      decorators.map((d) => partsOf(d, sf)),
      node.type.getText(sf),
    );
    if (wrapped === undefined) {
      skip(
        node,
        `${what}'s attributes have no attribute type (an option with no @builtin or @location)`,
      );
      return false;
    }
    const range = decoratorRange(decorators, sf);
    edits.push({ start: range.pos, end: range.end, text: '' });
    edits.push({ start: node.type.getStart(sf), end: node.type.getEnd(), text: wrapped });
    return true;
  };

  const visitParams = (n: ts.Node): void => {
    if (ts.isParameter(n) && rewriteMember(n, `parameter "${n.name.getText(sf)}"`)) changes++;
    ts.forEachChild(n, visitParams);
  };
  visitParams(sf);

  // The type form of a qualifier, `v: inout<f32>`, back to the language's form, `@inout v: f32`,
  // on a parameter of a module function (change 0137). Any other type form is left as written.
  const declared = new Set<string>();
  const visitDeclared = (n: ts.Node): void => {
    if (
      (ts.isClassDeclaration(n) ||
        ts.isInterfaceDeclaration(n) ||
        ts.isTypeAliasDeclaration(n) ||
        ts.isEnumDeclaration(n)) &&
      n.name !== undefined
    )
      declared.add(n.name.text);
    ts.forEachChild(n, visitDeclared);
  };
  visitDeclared(sf);
  const visitQualifierTypes = (n: ts.Node): void => {
    if (isQualifierTypeForm(n, declared)) {
      const ref = n as ts.TypeReferenceNode;
      const name = (ref.typeName as ts.Identifier).text;
      const value = ref.typeArguments?.length === 1 ? ref.typeArguments[0] : undefined;
      const p = ref.parent;
      const fn = ts.isParameter(p) ? p.parent : undefined;
      const moduleFunction =
        fn !== undefined &&
        ts.isFunctionDeclaration(fn) &&
        (ts.isSourceFile(fn.parent) || ts.isModuleBlock(fn.parent));
      const written = ts.isParameter(p)
        ? decoratorsOf(p).filter((d) => QUALIFIERS.has(partsOf(d, sf).name))
        : [];
      if (
        value === undefined ||
        !ts.isParameter(p) ||
        p.type !== ref ||
        !moduleFunction ||
        written.some((d) => partsOf(d, sf).name !== name) ||
        // An entry's attribute decorator moves into the same type (above).
        decoratorsOf(p).some((d) => ATTRIBUTES.has(partsOf(d, sf).name))
      ) {
        skip(
          ref,
          `"${ref.getText(sf)}" is no parameter's type of a module function: write the ` +
            `qualifier before the parameter by hand, "@${name} a: T"`,
        );
        return;
      }
      edits.push({ start: ref.getStart(sf), end: ref.getEnd(), text: value.getText(sf) });
      if (written.length === 0) {
        const at = p.getStart(sf);
        edits.push({ start: at, end: at, text: `@${name} ` });
      }
      changes++;
      return;
    }
    ts.forEachChild(n, visitQualifierTypes);
  };
  visitQualifierTypes(sf);

  // Fields: a decorated field's attributes go into its type, and the `!` on a field is not
  // written (change 0130, D3). A class stays a class.
  const visitFields = (n: ts.Node): void => {
    if (ts.isPropertyDeclaration(n) && ts.isClassLike(n.parent)) {
      let changed = rewriteMember(n, `field "${n.name.getText(sf)}"`);
      if (n.exclamationToken !== undefined) {
        const bang = n.exclamationToken;
        edits.push({ start: bang.getStart(sf), end: bang.getEnd(), text: '' });
        changed = true;
      }
      if (changed) changes++;
    }
    ts.forEachChild(n, visitFields);
  };
  visitFields(sf);

  // `let q!: T;` is `let q: T;`: a read before an assignment is the compiler's TS8075 either
  // way, and an `out<T>` argument assigns the variable (Rule 7.6, change 0130 D3).
  const visitLocals = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && n.exclamationToken !== undefined) {
      const bang = n.exclamationToken;
      edits.push({ start: bang.getStart(sf), end: bang.getEnd(), text: '' });
      changes++;
    }
    ts.forEachChild(n, visitLocals);
  };
  visitLocals(sf);

  // Stage calls, at the top of the file and in a namespace: each becomes the function
  // declaration with its stage attribute (change 0130, D1).
  const visitStatements = (statements: readonly ts.Statement[]): void => {
    for (const stmt of statements) {
      if (ts.isModuleDeclaration(stmt)) {
        let body = stmt.body;
        while (body !== undefined && ts.isModuleDeclaration(body)) body = body.body;
        if (body !== undefined && ts.isModuleBlock(body)) visitStatements(body.statements);
        continue;
      }
      const sc = stageCallOf(stmt);
      if (sc === undefined) continue;
      const made = stageCallEdits(sc, sf);
      if ('why' in made) {
        skip(stmt, made.why);
        continue;
      }
      edits.push(...made.edits);
      changes++;
    }
  };
  visitStatements(sf.statements);

  // Entries written with the attribute: `export default` is not written, since an entry takes
  // its declaration's name (Rule 8.1, change 0130). A `@diagnostic(…)` among the decorators is
  // deleted (change 0132).
  const visitFunctions = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n)) {
      const decorators = decoratorsOf(n);
      const parts = decorators.map((d) => partsOf(d, sf));
      const stage = parts.find((p) => STAGES.has(p.name));
      const filters = decorators.filter((d) => partsOf(d, sf).name === 'diagnostic');
      if (filters.length > 0) {
        if (filters.length === parts.length && stage === undefined) {
          const range = decoratorRange(decorators, sf);
          edits.push({ start: range.pos, end: range.end, text: '' });
          changes++;
        } else if (parts.every((p) => STAGES.has(p.name) || p.name === 'diagnostic')) {
          for (const d of filters) {
            const range = decoratorRange([d], sf);
            edits.push({ start: range.pos, end: range.end, text: '' });
          }
          changes++;
        } else {
          skip(
            n,
            `"${n.name?.text ?? 'the function'}" carries a decorator the rewrite does not know`,
          );
        }
      }
      const defaultKeyword = n.modifiers?.find((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      if (stage !== undefined && defaultKeyword !== undefined) {
        if (n.name === undefined) {
          skip(n, 'an "export default" entry has no name; write "export function k"');
        } else {
          let end = defaultKeyword.getEnd();
          while (end < sf.text.length && /[ \t]/.test(sf.text[end]!)) end++;
          edits.push({ start: defaultKeyword.getStart(sf), end, text: '' });
          changes++;
        }
      }
    }
    ts.forEachChild(n, visitFunctions);
  };
  visitFunctions(sf);

  if (edits.length === 0) return { text, changes: 0, skipped };
  // Apply from the end, so each edit's offsets are the original text's. Two edits at one
  // offset keep their recorded order.
  const ordered = edits.map((e, i) => ({ ...e, i })).sort((a, b) => b.start - a.start || b.i - a.i);
  let out = text;
  for (const e of ordered) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { text: out, changes, skipped };
}
