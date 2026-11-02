// The stage call of change 0111 (decision D1): an entry point written as a call that wraps its
// function, in place of a decorator on a function declaration.
//
//   export const vs = vertex(function vs(i: u32): vec4 { … });
//   export const fs = fragment((v: VsOut): vec4 => …);
//   export const main = compute([64], function main(…) { … });
//   export const scale = workgroup_size([128], function scale(xs: array<f32>) { … });
//
// A plain `tsc --strict` accepts this form; it refuses a decorator on a function declaration
// (TS1206). The front end reads the call here and hands the rest of the compiler a function
// declaration made of the call's own function: its parameters, its return type and its body are
// the nodes the author wrote, so every position, every check and the emit are the ones the
// decorated form has. Only the declaration node is new, and its text range is the statement's.
import ts from 'typescript';

/** The functions a stage call is spelled with, and what each makes of its function. */
export const STAGE_CALLEES = ['vertex', 'fragment', 'compute', 'workgroup_size'] as const;
export type StageCallee = (typeof STAGE_CALLEES)[number];

/** One `const x = stage(…)` the file declares. */
export interface StageCall {
  readonly callee: StageCallee;
  readonly call: ts.CallExpression;
  readonly statement: ts.VariableStatement;
  readonly declaration: ts.VariableDeclaration & { readonly name: ts.Identifier };
  /** The function the call wraps. */
  readonly fn: ts.FunctionExpression | ts.ArrowFunction;
  /** The workgroup argument of `compute([…], f)` and `workgroup_size([…], f)`. */
  readonly size?: ts.Expression;
  /** The options argument after the function, `{ diagnostic: [...] }`. */
  readonly options?: ts.Expression;
  readonly exported: boolean;
}

const isCallee = (name: string): name is StageCallee =>
  (STAGE_CALLEES as readonly string[]).includes(name);

/** The parts of a call to a stage function, or undefined when `expr` is no such call. The
 *  function is the first argument, or the second after the workgroup argument. */
function partsOf(expr: ts.Expression):
  | {
      callee: StageCallee;
      call: ts.CallExpression;
      fn: ts.FunctionExpression | ts.ArrowFunction;
      size?: ts.Expression;
      options?: ts.Expression;
    }
  | undefined {
  if (!ts.isCallExpression(expr) || !ts.isIdentifier(expr.expression)) return undefined;
  const callee = expr.expression.text;
  if (!isCallee(callee)) return undefined;
  const sized = callee === 'compute' || callee === 'workgroup_size';
  const at = sized ? 1 : 0;
  const fn = expr.arguments[at];
  if (fn === undefined || !(ts.isFunctionExpression(fn) || ts.isArrowFunction(fn)))
    return undefined;
  return {
    callee,
    call: expr,
    fn,
    size: sized ? expr.arguments[0] : undefined,
    options: expr.arguments[at + 1],
  };
}

/** Whether `expr` is a stage call, which declares a function and no module constant. */
export function isStageCall(expr: ts.Expression): boolean {
  return partsOf(expr) !== undefined;
}

/** The stage call `stmt` declares: a `const` statement with one declarator whose name is an
 *  identifier and whose initializer is a stage call. */
export function stageCallOf(stmt: ts.Statement): StageCall | undefined {
  if (!ts.isVariableStatement(stmt)) return undefined;
  const list = stmt.declarationList;
  if ((list.flags & ts.NodeFlags.Const) === 0 || list.declarations.length !== 1) return undefined;
  const declaration = list.declarations[0]!;
  if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) return undefined;
  const parts = partsOf(declaration.initializer);
  if (parts === undefined) return undefined;
  const exported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true;
  return {
    ...parts,
    statement: stmt,
    declaration: declaration as StageCall['declaration'],
    exported,
  };
}

const declarations = new WeakMap<ts.VariableStatement, ts.FunctionDeclaration>();
const calls = new WeakMap<ts.FunctionDeclaration, StageCall>();
const byFunction = new WeakMap<ts.Node, ts.FunctionDeclaration>();

/** Gives a synthesized node the text range of `range` and the parent `parent`, so that
 *  `getStart`, `getText` and a walk up the tree work on it as on a parsed node. */
function place<T extends ts.Node>(node: T, range: ts.TextRange, parent: ts.Node): T {
  ts.setTextRange(node, range);
  (node as { parent: ts.Node }).parent = parent;
  return node;
}

/** The function declaration a stage call stands for: the variable's name, `export` when the
 *  statement has it, and the wrapped function's own parameters, return type and body. An arrow
 *  function's expression body is the one statement `return <expr>;`, at the expression's place.
 *  One declaration per statement, so each pass that reads the file reads the same node. */
export function stageDeclarationOf(sc: StageCall): ts.FunctionDeclaration {
  const known = declarations.get(sc.statement);
  if (known !== undefined) return known;
  const f = ts.factory;
  const modifiers = sc.exported
    ? [
        place(
          f.createModifier(ts.SyntaxKind.ExportKeyword),
          sc.statement.modifiers![0]!,
          sc.statement,
        ),
      ]
    : undefined;
  let body: ts.Block;
  if (ts.isBlock(sc.fn.body)) body = sc.fn.body;
  else {
    const expr = sc.fn.body;
    const ret = f.createReturnStatement(expr);
    body = f.createBlock([ret], true);
    place(ret, expr, body);
  }
  const decl = f.createFunctionDeclaration(
    modifiers,
    sc.fn.asteriskToken,
    sc.declaration.name,
    sc.fn.typeParameters,
    sc.fn.parameters,
    sc.fn.type,
    body,
  );
  // The factory copies its node arrays' members as they are: the parameters, the type and the
  // body keep their positions and their parents, which are the wrapped function's.
  place(decl, sc.statement, sc.statement.parent);
  if (!ts.isBlock(sc.fn.body)) place(body, sc.fn.body, decl);
  declarations.set(sc.statement, decl);
  calls.set(decl, sc);
  byFunction.set(sc.fn, decl);
  return decl;
}

/** The declaration a stage call's wrapped function stands as, once `stageDeclarationOf` has
 *  made it: the function the front end lowers, and so the one a walk up from a node of its
 *  body must find. Undefined for any other node. */
export function stageDeclarationOfFunction(fn: ts.Node): ts.FunctionDeclaration | undefined {
  return byFunction.get(fn);
}

/** The stage call a declaration made by `declarationOf` stands for. */
export function stageCallOfDeclaration(decl: ts.Node): StageCall | undefined {
  return ts.isFunctionDeclaration(decl) ? calls.get(decl) : undefined;
}
