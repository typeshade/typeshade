// A `const` that binds a `Math` member to a name: `const { sqrt, PI } = Math`,
// `const { sqrt: s } = Math` and `const s = Math.sqrt`.
//
// Rules 6.3, 9.4 and 9.5 (docs/language-design.md; the reqs tag is added once a person reviews them),
// change 0113.
//
// A bound name is an alias, not a value (Rule 9.4). The declaration lowers to nothing: no local,
// no module constant and no function value exist for it. A call of the name is the call of the
// member, and a read of a constant member is its `f32` literal, both where the name is READ, by
// the declaration TypeScript's lookup finds for it (`declarationOf`). So a name another block,
// a parameter or a local function declares is that declaration's, never the alias.
//
// This file is the one place that says which declarations are such a binding, and what is
// refused of the rest of their shapes. The lowering of a declaration (statement.ts, module-const.ts)
// and of a name (expression.ts, expression-call.ts) both ask it.

import ts from 'typescript';
import type { TsCompilerDiagnostic } from './source-file.js';
import { TS_CODES, type TsCode } from './codes.js';
import { makeDiagnostic } from './diagnostic.js';
import { declarationOf } from './lower/closures.js';
import {
  MATH_MEMBER_NAMES,
  resolveMathConst,
  resolveMathExpand,
  resolveMathFn,
} from './math-alias.js';
import { unknownNameSentence } from './unknown-names.js';

/** What a name bound to a `Math` member means. */
export interface MathBinding {
  /** The member, as `Math` spells it: `sqrt`, `PI`. */
  readonly member: string;
  /** Whether the member is a constant (`PI`), which reads as a literal, and not a function. */
  readonly constant: boolean;
}

/** One name an accepted pattern or initializer binds. */
export interface MathBoundName {
  readonly name: ts.Identifier;
  readonly member: string;
}

/** What a declaration over `Math` is: the names it binds, and the refusals of what it writes
 *  that has no form. A refusal holds the names the declaration would have bound, so a use of one
 *  adds nothing to the mistake (Rule 12.4). */
export interface MathDeclaration {
  readonly isConst: boolean;
  readonly bound: readonly MathBoundName[];
  readonly refusals: readonly TsCompilerDiagnostic[];
  /** Every name the declaration binds, accepted or not. */
  readonly names: readonly string[];
}

const isMathIdentifier = (e: ts.Expression): e is ts.Identifier =>
  ts.isIdentifier(e) && e.text === 'Math' && declarationOf(e) === undefined;

const unwrap = (e: ts.Expression): ts.Expression => {
  let at = e;
  while (ts.isParenthesizedExpression(at)) at = at.expression;
  return at;
};

/** Whether `name` is a function member of `Math` that this surface names. */
const isFunctionMember = (member: string): boolean =>
  resolveMathFn(member) !== undefined ||
  resolveMathExpand(member) !== undefined ||
  member === 'random';

/** `Math.member` as an initializer: the member's name, or undefined for any other expression. */
function memberInitializer(
  init: ts.Expression | undefined,
): ts.PropertyAccessExpression | undefined {
  if (init === undefined) return undefined;
  const at = unwrap(init);
  return ts.isPropertyAccessExpression(at) &&
    at.questionDotToken === undefined &&
    isMathIdentifier(at.expression)
    ? at
    : undefined;
}

/** The declaration's `const`, `let` or `var` keyword as a flag: only a `const` aliases. */
const isConstDeclaration = (decl: ts.VariableDeclaration): boolean =>
  ts.isVariableDeclarationList(decl.parent) && (decl.parent.flags & ts.NodeFlags.Const) !== 0;

const isLetDeclaration = (decl: ts.VariableDeclaration): boolean =>
  ts.isVariableDeclarationList(decl.parent) && (decl.parent.flags & ts.NodeFlags.Let) !== 0;

const letSentence = (shown: string): string =>
  `"Math.${shown}" is a function, and a shader has no function values: bind it with const, ` +
  `const { ${shown} } = Math. A let would hold a function value.`;

/**
 * What `decl` is when it binds names over `Math`: an object pattern whose value is `Math`, or a
 * plain name whose value is a function member (`const s = Math.sqrt`). Undefined for every other
 * declaration, which lowers as it always did: `const P = Math.PI` and `let p = Math.PI` hold a
 * number, and an array pattern over `Math` is refused as `Math` read as a value.
 */
export function mathDeclarationOf(
  decl: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
): MathDeclaration | undefined {
  const init = decl.initializer === undefined ? undefined : unwrap(decl.initializer);
  if (init === undefined || (!isConstDeclaration(decl) && !isLetDeclaration(decl))) {
    // A `var` is semantic.ts's refusal, and a declaration with no value says so elsewhere.
    return undefined;
  }
  const isConst = isConstDeclaration(decl);
  const refuse = (at: ts.Node, message: string, code: TsCode): TsCompilerDiagnostic =>
    makeDiagnostic(sourceFile, at, message, code);

  // `const s = Math.sqrt`, and the `let` of it.
  if (ts.isIdentifier(decl.name)) {
    const access = memberInitializer(init);
    if (access === undefined) return undefined;
    const member = access.name.text;
    if (!isFunctionMember(member)) return undefined;
    if (decl.type !== undefined) {
      return {
        isConst,
        bound: [],
        refusals: [
          refuse(
            decl.type,
            `"${decl.name.text}" is an alias of Math.${member}, which has no type to write: ` +
              `drop the annotation.`,
            TS_CODES.UNSUPPORTED,
          ),
        ],
        names: [decl.name.text],
      };
    }
    if (!isConst) {
      return {
        isConst,
        bound: [],
        refusals: [refuse(decl, letSentence(member), TS_CODES.UNSUPPORTED)],
        names: [decl.name.text],
      };
    }
    return {
      isConst,
      bound: [{ name: decl.name, member }],
      refusals: [],
      names: [decl.name.text],
    };
  }

  // `const { sqrt, PI: pi } = Math`.
  if (!ts.isObjectBindingPattern(decl.name) || !isMathIdentifier(init)) return undefined;
  const bound: MathBoundName[] = [];
  const refusals: TsCompilerDiagnostic[] = [];
  const names: string[] = [];
  if (decl.type !== undefined) {
    refusals.push(
      refuse(
        decl.type,
        'A destructuring declaration takes no type annotation; each name takes the type of the ' +
          'member it binds.',
        TS_CODES.UNSUPPORTED,
      ),
    );
  }
  for (const element of decl.name.elements) {
    if (ts.isIdentifier(element.name)) names.push(element.name.text);
    if (element.dotDotDotToken !== undefined) {
      refusals.push(
        refuse(
          element,
          'A rest element has no shader form: Math has no remainder to name. Bind the members ' +
            'you call.',
          TS_CODES.UNSUPPORTED,
        ),
      );
      continue;
    }
    if (element.initializer !== undefined) {
      refusals.push(
        refuse(
          element,
          'A default in a pattern has no shader form: every member of Math is present, so there ' +
            'is nothing for it to stand in for.',
          TS_CODES.UNSUPPORTED,
        ),
      );
      continue;
    }
    const key = element.propertyName ?? element.name;
    if (!ts.isIdentifier(key)) {
      refusals.push(
        refuse(
          key,
          'A member of Math is named by a plain identifier here; a computed name would choose a ' +
            'member at run time, which no shader does.',
          TS_CODES.UNSUPPORTED,
        ),
      );
      continue;
    }
    if (!ts.isIdentifier(element.name)) {
      refusals.push(
        refuse(
          element.name,
          'A member of Math binds one name; a nested pattern over it has no shader form.',
          TS_CODES.UNSUPPORTED,
        ),
      );
      continue;
    }
    const member = key.text;
    if (!MATH_MEMBER_NAMES.includes(member)) {
      refusals.push(
        refuse(
          key,
          unknownNameSentence(`"Math.${member}" is not a TypeShade alias.`, member, [
            MATH_MEMBER_NAMES,
          ]),
          TS_CODES.UNKNOWN_NAME,
        ),
      );
      continue;
    }
    if (!isConst && isFunctionMember(member)) {
      refusals.push(refuse(element, letSentence(member), TS_CODES.UNSUPPORTED));
      continue;
    }
    bound.push({ name: element.name, member });
  }
  return { isConst, bound, refusals, names };
}

const BOUND_NAMES = new WeakMap<ts.SourceFile, ReadonlySet<string>>();

/** The names some declaration of the file binds over `Math`, so a name that is none of them is
 *  answered without looking for its declaration. */
function boundNamesOf(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const known = BOUND_NAMES.get(sourceFile);
  if (known !== undefined) return known;
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const init = unwrap(node.initializer);
      if (ts.isObjectBindingPattern(node.name) && ts.isIdentifier(init) && init.text === 'Math') {
        for (const el of node.name.elements) if (ts.isIdentifier(el.name)) names.add(el.name.text);
      } else if (ts.isIdentifier(node.name) && ts.isPropertyAccessExpression(init)) {
        names.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  BOUND_NAMES.set(sourceFile, names);
  return names;
}

/**
 * What the name `id` is bound to, when the declaration TypeScript's lookup finds for it is an
 * accepted binding over `Math`: a `const` pattern element, or a `const` of a function member.
 * Undefined for every other name: a parameter, a local, a module constant, a builtin.
 */
export function mathBindingOf(id: ts.Identifier): MathBinding | undefined {
  const sourceFile = id.getSourceFile();
  if (!boundNamesOf(sourceFile).has(id.text)) return undefined;
  const found = declarationOf(id);
  if (found === undefined) return undefined;
  let decl: ts.VariableDeclaration | undefined;
  if (ts.isBindingElement(found)) {
    const pattern = found.parent;
    decl =
      ts.isObjectBindingPattern(pattern) && ts.isVariableDeclaration(pattern.parent)
        ? pattern.parent
        : undefined;
  } else if (ts.isVariableDeclaration(found)) {
    decl = found;
  }
  if (decl === undefined || !isConstDeclaration(decl)) return undefined;
  const made = mathDeclarationOf(decl, sourceFile);
  if (made === undefined || made.refusals.length > 0) return undefined;
  const hit = made.bound.find((b) => b.name.text === id.text);
  if (hit === undefined) return undefined;
  return { member: hit.member, constant: resolveMathConst(hit.member) !== undefined };
}

/** Whether `decl` is a `const` that binds only names over `Math`, with nothing refused: it
 *  declares no local and no module constant, and lowers to no statement. */
export function isMathAlias(decl: ts.VariableDeclaration, sourceFile: ts.SourceFile): boolean {
  const made = mathDeclarationOf(decl, sourceFile);
  return made !== undefined && made.isConst && made.refusals.length === 0;
}
