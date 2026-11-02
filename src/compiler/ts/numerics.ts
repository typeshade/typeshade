// Implements: Rule 6.7, Rule 11.22 (docs/language-design.md; traced in reqs/).
//
// ═══ A numerical contract, opted into per function (change 0107, surface §78) ═══
//
// An author opts a function into a class of floating-point rewrite that the default optimizer
// refuses, in the form change 0111 gives every attribute:
//
//   const tick = numerics(["finite-math"], function tick(…) { … });   // a function of the file
//   export const fs = fragment(function fs(…) { … }, { numerics: ["finite-math"] });   // an entry
//
// This module reads both forms once per file, refuses a wrong one with `TS8078`, and records the
// classes of each statement for `lower/function.ts`, which sets `FuncDecl.numerics`. Reading
// once matters: a generic function is lowered once per instance, and one mistake is one
// diagnostic (Rule 12.4).

import ts from 'typescript';
import type { NumericsClass } from '../../core/ir/nodes.js';
import { makeDiagnostic } from './diagnostic.js';
import { TS_CODES } from './codes.js';
import { stageCallOf, type StageCall } from './stage-call.js';
import type { TsCompilerDiagnostic } from './source-file.js';

/** Every {@link NumericsClass}, in the order the documentation lists them. */
export const NUMERICS_CLASSES: readonly NumericsClass[] = ['finite-math', 'reassociate'];

/** The classes each accepted statement opted into, keyed by the stage call's statement. */
const classesOf = new WeakMap<ts.VariableStatement, readonly NumericsClass[]>();

/** The classes the stage call `sc` opted its function into, once {@link collectNumerics} has
 *  read the file; `undefined` for a function under no contract. */
export function numericsOf(sc: StageCall): readonly NumericsClass[] | undefined {
  return classesOf.get(sc.statement);
}

const CALL_FORM = 'const f = numerics(["finite-math"], function f(…) { … })';
const OPTION_FORM = '{ numerics: ["finite-math"] }';

/**
 * Reads every numerical contract the file writes, records the accepted ones and refuses the
 * rest with `TS8078`:
 *
 * - a `numerics([…], f)` call that initializes a `const` at the top of the file, and the
 *   `numerics` option of a top-level stage call, are read;
 * - a list that is not an array of string literals, an empty list, an unknown class and a class
 *   named twice are refused at the list or the element;
 * - a `numerics(...)` call anywhere else (inside a function, inside a namespace, around
 *   something that is not a function expression, or not as a `const`'s whole initializer) is
 *   refused at the call.
 */
export function collectNumerics(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  /** The calls the top-level statements read, which the walk below leaves alone. */
  const accepted = new Set<ts.CallExpression>();
  for (const stmt of sourceFile.statements) {
    const sc = stageCallOf(stmt);
    if (sc === undefined) continue;
    let list: ts.Expression | undefined;
    let form: 'call' | 'option' = 'call';
    if (sc.callee === 'numerics') {
      accepted.add(sc.call);
      list = sc.classes;
    } else if (sc.options !== undefined && ts.isObjectLiteralExpression(sc.options)) {
      for (const prop of sc.options.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const key =
          ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : undefined;
        if (key === 'numerics') {
          list = prop.initializer;
          form = 'option';
        }
      }
    }
    if (list === undefined) continue;
    const classes = readClasses(list, form, sourceFile, diagnostics);
    if (classes !== undefined) classesOf.set(sc.statement, classes);
  }
  const visit = (node: ts.Node): void => {
    // A decorator is refused whole (`TS8028`, Rule 6.7), `@numerics([…])` with it.
    if (ts.isDecorator(node)) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'numerics' &&
      !accepted.has(node)
    ) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          node,
          `numerics(...) wraps a function declared at the top of the file: ${CALL_FORM}. An ` +
            `entry or a kernel function takes ${OPTION_FORM} as its stage call's option.`,
          TS_CODES.NUMERICS,
        ),
      );
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
}

/** The classes `list` names, or `undefined` after a refusal. Each mistake is one diagnostic at
 *  the node that holds it. */
function readClasses(
  list: ts.Expression,
  form: 'call' | 'option',
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): readonly NumericsClass[] | undefined {
  const refuse = (node: ts.Node, message: string): undefined => {
    diagnostics.push(makeDiagnostic(sourceFile, node, message, TS_CODES.NUMERICS));
    return undefined;
  };
  const shape = form === 'call' ? CALL_FORM : OPTION_FORM;
  const known = NUMERICS_CLASSES.map((c) => `"${c}"`).join(' and ');
  if (!ts.isArrayLiteralExpression(list)) {
    return refuse(list, `numerics takes an array of class names, as strings: ${shape}.`);
  }
  if (list.elements.length === 0) {
    const either = NUMERICS_CLASSES.map((c) => `"${c}"`).join(' or ');
    return refuse(list, `An empty numerics list opts into nothing. Name a class: ${either}.`);
  }
  const out: NumericsClass[] = [];
  let failed = false;
  for (const e of list.elements) {
    if (!ts.isStringLiteral(e) && !ts.isNoSubstitutionTemplateLiteral(e)) {
      refuse(e, `numerics takes an array of class names, as strings: ${shape}.`);
      failed = true;
      continue;
    }
    const name = e.text;
    if (!(NUMERICS_CLASSES as readonly string[]).includes(name)) {
      refuse(e, `"${name}" is not a numerics class. The classes are ${known}.`);
      failed = true;
      continue;
    }
    if (out.includes(name as NumericsClass)) {
      refuse(e, `"${name}" is named twice in this numerics list. Name each class once.`);
      failed = true;
      continue;
    }
    out.push(name as NumericsClass);
  }
  return failed ? undefined : out;
}
