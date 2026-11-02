// === `tshc migrate`: the decorated form of a "use typeshade" file to plain TypeScript ===
//
// Change 0111, milestone 2 (amendment 2). The rewrite is textual and keeps every byte it does
// not need to change, so a file reads as its author wrote it:
//
//   @vertex export function vs(@builtin("vertex_index") i: u32): VsOut { … }
//     → export const vs = vertex(function vs(i: builtin<"vertex_index", u32>): VsOut { … });
//   @compute([64]) export function main(…) { … }   → export const main = compute([64], function main(…) { … });
//   @workgroup_size([128]) export function k(…) { … } → export const k = workgroup_size([128], function k(…) { … });
//   @fragment @diagnostic("off", "derivative_uniformity") export function fs(…) { … }
//     → export const fs = fragment(function fs(…) { … }, { diagnostic: ["off", "derivative_uniformity"] });
//   @location(1) @interpolate("flat") id: u32        → id: location<1, u32, { interpolate: "flat" }>
//   @builtin("position") @invariant pos: vec4        → pos: builtin<"position", vec4, { invariant: true }>
//   @inout v: f32, @out w: f32                       → v: inout<f32>, w: out<f32>
//   class VsOut { @builtin("position") pos: vec4; }  → interface VsOut { pos: builtin<"position", vec4>; }
//   let q: f32; put(q);   (put's parameter is @out)  → let q!: f32; put(q);
//
// A form the rewrite cannot carry is left as written and named in `skipped`, with its line,
// so the author finishes it by hand: an entry with no body, an attribute on a parameter with
// no type, a decorated class that is more than its fields.

import ts from 'typescript';

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

const STAGES = new Set(['vertex', 'fragment', 'compute']);
const ATTRIBUTES = new Set(['builtin', 'location', 'interpolate', 'invariant', 'blend_src']);
const QUALIFIERS = new Set(['inout', 'out']);

/** The decorators the parser keeps among a declaration's modifiers. */
function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  const modifiers = (node as { modifiers?: readonly ts.ModifierLike[] }).modifiers ?? [];
  return modifiers.filter(ts.isDecorator);
}

/** A decorator's name and its arguments' source text. */
function partsOf(d: ts.Decorator, sf: ts.SourceFile): { name: string; args: string[] } {
  const e = d.expression;
  if (ts.isIdentifier(e)) return { name: e.text, args: [] };
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression))
    return { name: e.expression.text, args: e.arguments.map((a) => a.getText(sf)) };
  return { name: d.getText(sf), args: [] };
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

/** The attribute type a run of attribute decorators stands for around `type`, or undefined
 *  when the run holds none. */
function attributeType(
  attrs: readonly { name: string; args: string[] }[],
  type: string,
): string | undefined {
  let out = type;
  const builtin = attrs.find((a) => a.name === 'builtin');
  const location = attrs.find((a) => a.name === 'location');
  const options: string[] = [];
  for (const a of attrs) {
    if (a.name === 'invariant') options.push('invariant: true');
    if (a.name === 'interpolate')
      options.push(`interpolate: ${a.args.length === 1 ? a.args[0] : `[${a.args.join(', ')}]`}`);
    if (a.name === 'blend_src') options.push(`blend_src: ${a.args[0]}`);
  }
  const third = options.length > 0 ? `, { ${options.join('; ')} }` : '';
  if (builtin) out = `builtin<${builtin.args[0]}, ${out}${third}>`;
  else if (location) out = `location<${location.args[0]}, ${out}${third}>`;
  else if (options.length > 0) return undefined;
  for (const a of attrs) if (QUALIFIERS.has(a.name)) out = `${a.name}<${out}>`;
  return out === type ? undefined : out;
}

/** Rewrites one file. Pure: the text in, the text out. */
export function migrateSource(text: string, fileName = 'a.shade.ts'): MigrateResult {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const edits: Edit[] = [];
  const skipped: string[] = [];
  let changes = 0;
  const line = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const skip = (n: ts.Node, why: string): void => void skipped.push(`line ${line(n)}: ${why}`);

  // The functions with an `@out` parameter, by name, and the index of each: a local such a
  // call fills first takes `!` (decision D8).
  const outParams = new Map<string, Set<number>>();
  const visitOut = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name) {
      n.parameters.forEach((p, i) => {
        if (decoratorsOf(p).some((d) => partsOf(d, sf).name === 'out')) {
          const at = outParams.get(n.name!.text) ?? new Set<number>();
          at.add(i);
          outParams.set(n.name!.text, at);
        }
      });
    }
    ts.forEachChild(n, visitOut);
  };
  visitOut(sf);

  // Attributes on a parameter or a field: the decorators go, the type carries them.
  const rewriteMember = (
    node: ts.ParameterDeclaration | ts.PropertyDeclaration,
    what: string,
  ): boolean => {
    const decorators = decoratorsOf(node).filter((d) => {
      const name = partsOf(d, sf).name;
      return ATTRIBUTES.has(name) || QUALIFIERS.has(name);
    });
    if (decorators.length === 0) return false;
    if (decorators.length !== decoratorsOf(node).length) {
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

  // `let q: T;` filled first by an `@out` argument takes `!`.
  const visitCalls = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const at = outParams.get(n.expression.text);
      for (const i of at ?? []) {
        const arg = n.arguments[i];
        if (arg === undefined || !ts.isIdentifier(arg)) continue;
        const decl = localDeclaration(arg);
        if (
          decl !== undefined &&
          decl.initializer === undefined &&
          decl.exclamationToken === undefined &&
          decl.type !== undefined &&
          ts.isIdentifier(decl.name) &&
          !edits.some((e) => e.start === decl.name.getEnd() && e.text === '!')
        ) {
          edits.push({ start: decl.name.getEnd(), end: decl.name.getEnd(), text: '!' });
          changes++;
        }
      }
    }
    ts.forEachChild(n, visitCalls);
  };
  visitCalls(sf);

  // Classes whose every member is a field: attributes in the field types, and the class an
  // interface, since a plain `tsc --strict` refuses a class field with no initializer (TS2564).
  // A class something builds with `new` stays a class: an interface has no constructor.
  const built = new Set<string>();
  const visitNew = (n: ts.Node): void => {
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression)) built.add(n.expression.text);
    ts.forEachChild(n, visitNew);
  };
  visitNew(sf);
  // A field a class keeps takes `!`, which tells a plain `tsc --strict` that it is assigned
  // (TS2564): a struct's field is zero until something writes it.
  const definite = (m: ts.PropertyDeclaration): void => {
    if (
      m.initializer === undefined &&
      m.questionToken === undefined &&
      m.exclamationToken === undefined
    )
      edits.push({ start: m.name.getEnd(), end: m.name.getEnd(), text: '!' });
  };
  const visitClasses = (n: ts.Node): void => {
    // A mixin's class expression, `return class extends Base { tint: vec3; }`, has no
    // attribute; its fields take `!` as a declared class's do.
    if (ts.isClassExpression(n)) {
      for (const m of n.members) {
        if (
          ts.isPropertyDeclaration(m) &&
          !(m.modifiers ?? []).some((x) => x.kind === ts.SyntaxKind.StaticKeyword) &&
          m.initializer === undefined &&
          m.questionToken === undefined &&
          m.exclamationToken === undefined &&
          m.type !== undefined
        ) {
          definite(m);
          changes++;
        }
      }
    }
    if (ts.isClassDeclaration(n) && n.name) {
      const decorated = n.members.some(
        (m) => ts.isPropertyDeclaration(m) && decoratorsOf(m).length > 0,
      );
      // A struct class with no attribute: each field with no initializer takes `!` (TS2564).
      if (!decorated) {
        let any = false;
        for (const m of n.members) {
          if (
            ts.isPropertyDeclaration(m) &&
            !(m.modifiers ?? []).some((x) => x.kind === ts.SyntaxKind.StaticKeyword) &&
            m.initializer === undefined &&
            m.questionToken === undefined &&
            m.exclamationToken === undefined &&
            m.type !== undefined
          ) {
            definite(m);
            any = true;
          }
        }
        if (any) changes++;
      }
      if (decorated) {
        const plain =
          !built.has(n.name.text) &&
          n.heritageClauses === undefined &&
          n.typeParameters === undefined &&
          decoratorsOf(n).length === 0 &&
          n.members.every(
            (m) =>
              ts.isPropertyDeclaration(m) &&
              m.initializer === undefined &&
              m.questionToken === undefined &&
              (m.modifiers ?? []).every(ts.isDecorator),
          );
        if (!plain) {
          for (const m of n.members) {
            if (!ts.isPropertyDeclaration(m)) continue;
            rewriteMember(m, `field "${m.name.getText(sf)}"`);
            if (!(m.modifiers ?? []).some((x) => x.kind === ts.SyntaxKind.StaticKeyword))
              definite(m);
          }
          changes++;
        } else {
          const keyword = n.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.ClassKeyword);
          if (keyword)
            edits.push({ start: keyword.getStart(sf), end: keyword.getEnd(), text: 'interface' });
          for (const m of n.members)
            if (ts.isPropertyDeclaration(m)) rewriteMember(m, `field "${m.name.getText(sf)}"`);
          changes++;
        }
      }
    }
    ts.forEachChild(n, visitClasses);
  };
  visitClasses(sf);

  // Entries and kernel functions: the decorator becomes the stage call around the function.
  const visitFunctions = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name) {
      const decorators = decoratorsOf(n);
      const parts = decorators.map((d) => partsOf(d, sf));
      const stage = parts.find((p) => STAGES.has(p.name) || p.name === 'workgroup_size');
      const diagnostics = parts.filter((p) => p.name === 'diagnostic');
      if (stage === undefined) {
        if (diagnostics.length > 0) skip(n, `@diagnostic on "${n.name.text}", which is no entry`);
      } else if (n.body === undefined) {
        skip(n, `entry "${n.name.text}" has no body`);
      } else if (parts.length !== 1 + diagnostics.length) {
        skip(n, `entry "${n.name.text}" carries a decorator the rewrite does not know`);
      } else {
        const name = n.name.text;
        const range = decoratorRange(decorators, sf);
        edits.push({ start: range.pos, end: range.end, text: '' });
        // `export function vs` → `export const vs = vertex(function vs`
        const fnKeyword = n.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.FunctionKeyword)!;
        const size =
          stage.name === 'compute' || stage.name === 'workgroup_size'
            ? `${stage.args[0] ?? '[64]'}, `
            : '';
        edits.push({
          start: fnKeyword.getStart(sf),
          end: fnKeyword.getStart(sf),
          text: `const ${name} = ${stage.name}(${size}`,
        });
        const options =
          diagnostics.length > 0
            ? `, { ${diagnostics.map((d) => `diagnostic: [${d.args.join(', ')}]`).join(', ')} }`
            : '';
        edits.push({ start: n.body.getEnd(), end: n.body.getEnd(), text: `${options});` });
        changes++;
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

/** The `let` or `var` declaration in the enclosing function an identifier names, found by its
 *  name. Good enough for a migration: a shadowed name is left for the compiler to report. */
function localDeclaration(id: ts.Identifier): ts.VariableDeclaration | undefined {
  let scope: ts.Node | undefined = id.parent;
  while (scope !== undefined && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope))
    scope = scope.parent;
  if (scope === undefined) return undefined;
  let found: ts.VariableDeclaration | undefined;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === id.text &&
      n.getStart() < id.getStart()
    )
      found = n;
    ts.forEachChild(n, visit);
  };
  visit(scope);
  return found;
}
