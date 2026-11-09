// Implements: Rule 6.7 (docs/language-design.md; traced in reqs/).
//
// The decorated form of change 0111 in its migration release (decision D5, Amendment 2,
// milestone 4). The compiler still reads each decorator of the old form as the stage call or the
// attribute type it stands for, and warns once on each (`TS8028`), naming the form an author
// writes and the codemod that writes it. The release after this one refuses the decorators.
//
// A parameter qualifier, `@inout` or `@out`, is no decorated form: it is the language's form,
// written before the parameter (Rule 8.25, change 0137). Its type form of change 0111,
// `a: inout<f32>`, is refused at once (`refuseQualifierTypes`, `TS8028`).
//
// The list of what the codemod rewrites is one authority: `tshc migrate` (`src/cli/migrate.ts`)
// spells an attribute type with `attributeTypeOf` below, so the warning and the rewrite name the
// same text.
import ts from 'typescript';
import { TS_CODES } from './codes.js';
import { makeDiagnostic } from './diagnostic.js';
import type { TsCompilerDiagnostic } from './source-file.js';

/** The stage decorators on a function, which the stage calls replace (decision D1). */
export const STAGE_DECORATORS: ReadonlySet<string> = new Set([
  'vertex',
  'fragment',
  'compute',
  'workgroup_size',
]);
/** The attribute decorators on a parameter or a field, which the attribute types replace (D2,
 *  D7). */
export const ATTRIBUTE_DECORATORS: ReadonlySet<string> = new Set([
  'builtin',
  'location',
  'interpolate',
  'invariant',
  'blend_src',
]);
/** The qualifier decorators on a parameter, the language's form (Rule 8.25, change 0137). */
export const QUALIFIER_DECORATORS: ReadonlySet<string> = new Set(['inout', 'out']);

/** A decorator's name and its arguments' source text; the name is the decorator's whole text
 *  for a shape that is no `@name` or `@name(…)`. */
export function decoratorParts(
  d: ts.Decorator,
  sf: ts.SourceFile,
): { name: string; args: string[] } {
  const e = d.expression;
  if (ts.isIdentifier(e)) return { name: e.text, args: [] };
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression))
    return { name: e.expression.text, args: e.arguments.map((a) => a.getText(sf)) };
  return { name: d.getText(sf), args: [] };
}

/** The attribute type a run of attribute decorators stands for around `type`,
 *  `builtin<"position", vec4, { invariant: true }>`, or undefined when the run holds none, or
 *  holds an option with no `@builtin` or `@location` to carry it. A qualifier in the run stays a
 *  decorator, written before the parameter (change 0137), so it adds nothing to the type. */
export function attributeTypeOf(
  attrs: readonly { name: string; args: readonly string[] }[],
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
  return out === type ? undefined : out;
}

/** The decorators written among a declaration's modifiers. */
function writtenDecorators(node: ts.Node): readonly ts.Decorator[] {
  const modifiers = (node as { modifiers?: readonly ts.ModifierLike[] }).modifiers ?? [];
  return modifiers.filter(ts.isDecorator);
}

/** A function declaration at the top of the file or in a namespace's body, the place a stage
 *  decorator is read. */
function isModuleFunction(node: ts.Node): node is ts.FunctionDeclaration {
  return (
    ts.isFunctionDeclaration(node) &&
    node.name !== undefined &&
    (ts.isSourceFile(node.parent) || ts.isModuleBlock(node.parent))
  );
}

/** One decorator of the decorated form, and the sentence that names its new spelling. */
export interface DecoratedForm {
  readonly decorator: ts.Decorator;
  readonly message: string;
}

const NEXT = 'is the decorated form, which the next release refuses';
const MIGRATE = 'or run "tshc migrate" (change 0111).';

/** The sentence for a stage decorator on function `fn`. `@diagnostic` is no stage decorator:
 *  change 0132 removed the filter, and `builtin-check.ts` refuses it. */
function stageSentence(
  d: ts.Decorator,
  fn: ts.FunctionDeclaration,
  sf: ts.SourceFile,
): string | undefined {
  const { name, args } = decoratorParts(d, sf);
  const written = `"${d.getText(sf)}" ${NEXT}`;
  const fnName = fn.name!.text;
  const exported = fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true;
  const call = (callee: string, size?: string): string =>
    `${exported ? 'export ' : ''}const ${fnName} = ${callee}(${size === undefined ? '' : `${size}, `}function ${fnName}(…) { … })`;
  if (name === 'vertex' || name === 'fragment')
    return `${written}: write "${call(name)}", ${MIGRATE}`;
  if (name === 'compute') return `${written}: write "${call(name, args[0] ?? '[64]')}", ${MIGRATE}`;
  if (name === 'workgroup_size')
    return `${written}: write "${call(name, args[0] ?? '[64]')}", ${MIGRATE}`;
  return undefined;
}

/** The sentence for an attribute decorator on parameter or field `member`. */
function memberSentence(
  d: ts.Decorator,
  member: ts.ParameterDeclaration | ts.PropertyDeclaration,
  sf: ts.SourceFile,
): string {
  const written = `"${d.getText(sf)}" ${NEXT}`;
  const ours = writtenDecorators(member)
    .map((x) => decoratorParts(x, sf))
    .filter((p) => ATTRIBUTE_DECORATORS.has(p.name));
  const type =
    member.type === undefined ? undefined : attributeTypeOf(ours, member.type.getText(sf));
  if (type !== undefined)
    return `${written}: write "${member.name.getText(sf)}: ${type}", ${MIGRATE}`;
  return `${written}: write the attribute in the type, as "builtin<…>" or "location<…>", ${MIGRATE}`;
}

const found = new WeakMap<ts.SourceFile, readonly DecoratedForm[]>();

/**
 * Each decorator of the decorated form `sf` writes where the compiler reads it: a stage
 * decorator on a function of the module, an attribute on a parameter of one, and an attribute
 * on a class field. A qualifier, `@inout` or `@out`, is the language's form and is never among
 * them (change 0137). A decorator anywhere else is one nothing
 * reads, which the compiler refuses on its own (`TS8028`, `TS8035`). A decorator an attribute
 * type stands for (`isTypeDecorator`) is no node of the tree, so it is never among them.
 */
export function decoratedForms(sf: ts.SourceFile): readonly DecoratedForm[] {
  const known = found.get(sf);
  if (known !== undefined) return known;
  const out: DecoratedForm[] = [];
  const visit = (node: ts.Node): void => {
    if (isModuleFunction(node)) {
      for (const d of writtenDecorators(node)) {
        const name = decoratorParts(d, sf).name;
        if (!STAGE_DECORATORS.has(name)) continue;
        const message = stageSentence(d, node, sf);
        if (message !== undefined) out.push({ decorator: d, message });
      }
      for (const p of node.parameters) {
        for (const d of writtenDecorators(p)) {
          const name = decoratorParts(d, sf).name;
          if (ATTRIBUTE_DECORATORS.has(name))
            out.push({ decorator: d, message: memberSentence(d, p, sf) });
        }
      }
    }
    if (ts.isPropertyDeclaration(node) && ts.isClassLike(node.parent)) {
      for (const d of writtenDecorators(node)) {
        if (ATTRIBUTE_DECORATORS.has(decoratorParts(d, sf).name))
          out.push({ decorator: d, message: memberSentence(d, node, sf) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  found.set(sf, out);
  return out;
}

/** Whether `sf` still writes the decorated form: the editor keeps its TS1206 and TS2564 filters
 *  for such a file until the old form is refused (change 0111, Amendment 2, item 4). A qualifier
 *  does not count: it is the language's form (change 0137). */
export function usesDecoratedForm(sf: ts.SourceFile): boolean {
  return decoratedForms(sf).length > 0;
}

/** The `TS8028` warning on each decorator of the decorated form, once each. A decorator the
 *  compiler already answers at its own place (a refusal of where it is written, a wrong
 *  argument) keeps that answer alone (Rule 12.4). */
export function warnDecoratedForm(sf: ts.SourceFile, diagnostics: TsCompilerDiagnostic[]): void {
  for (const { decorator, message } of decoratedForms(sf)) {
    const start = decorator.getStart(sf);
    const end = decorator.getEnd();
    if (diagnostics.some((d) => d.start >= start && d.start + d.length <= end)) continue;
    diagnostics.push(makeDiagnostic(sf, decorator, message, TS_CODES.ATTRIBUTE_NAME, 'warning'));
  }
}

/** Whether `node` is a written `inout<…>` or `out<…>` that names the ambient library's type:
 *  the type form of a parameter qualifier (change 0111 D4, replaced by change 0137). A file that
 *  declares its own type of that name keeps it. */
export function isQualifierTypeForm(node: ts.Node, declared: ReadonlySet<string>): boolean {
  return (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    QUALIFIER_DECORATORS.has(node.typeName.text) &&
    !declared.has(node.typeName.text)
  );
}

/** The names `sf` declares a type of itself: a class, an interface, a type alias or an enum. */
function declaredTypeNames(sf: ts.SourceFile): ReadonlySet<string> {
  const out = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      (ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node)) &&
      node.name !== undefined
    )
      out.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * The `TS8028` error on each written type form of a parameter qualifier, `inout<…>` or
 * `out<…>`, in every type position: a parameter, a local, a result, a type alias, a generic
 * argument and a field (Rule 8.25, change 0137). The language writes the qualifier before the
 * parameter, `@inout a: f32`; `tshc migrate` rewrites a parameter's type form. One diagnostic
 * stands at the outermost written `inout<…>`, once (Rule 12.4): on a parameter the refused type
 * still stands for its qualifier (`attribute-types.ts`), and every other refusal of that
 * qualifier is left to this one (`lower/function.ts`).
 */
export function refuseQualifierTypes(sf: ts.SourceFile, diagnostics: TsCompilerDiagnostic[]): void {
  const declared = declaredTypeNames(sf);
  const visit = (node: ts.Node): void => {
    if (isQualifierTypeForm(node, declared)) {
      diagnostics.push(
        makeDiagnostic(
          sf,
          node,
          qualifierTypeSentence(node as ts.TypeReferenceNode, sf),
          TS_CODES.ATTRIBUTE_NAME,
        ),
      );
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

/** The sentence for a written type form `ref`: on a parameter, the parameter as the language
 *  writes it; anywhere else, the type it means, since a qualifier marks a parameter only. */
function qualifierTypeSentence(ref: ts.TypeReferenceNode, sf: ts.SourceFile): string {
  const name = (ref.typeName as ts.Identifier).text;
  const value = ref.typeArguments?.[0]?.getText(sf) ?? 'T';
  const written = `"${ref.getText(sf)}" is the type form of a parameter qualifier, which the language does not have`;
  const p = ref.parent;
  if (ts.isParameter(p) && p.type === ref && ts.isIdentifier(p.name))
    return `${written}: write "@${name} ${p.name.text}: ${value}", or run "tshc migrate" (change 0137).`;
  return (
    `${written}: a qualifier is written before a parameter, as "@${name} a: ${value}", and ` +
    `here the type is "${value}"; "tshc migrate" rewrites a parameter's type form (change 0137).`
  );
}
