// Implements: Rule 1.8, Rule 6.7, Rule 8.1 (docs/language-design.md; traced in reqs/).
//
// The stage call of change 0111 (decision D1), which changes 0130 and 0140 refuse: an entry
// point written as a call that wraps its function, in place of a stage attribute on a function
// declaration.
//
//   export const vs = vertex(function vs(i: u32): vec4 { … });
//   export const fs = fragment((v: VsOut): vec4 => …);
//   export const main = compute([64], function main(…) { … });
//   export const scale = workgroup_size([128], function scale(xs: array<f32>) { … });
//
// Each is one `TS8028`, an error, on the name called, and its text names the attribute the
// author writes and `tshc migrate`, which writes it ({@link refuseStageCalls}). `export default`
// on an entry is the same code, on `default`.
//
// One mistake reads as one diagnostic (Rule 12.4), so the front end still reads a refused call
// as the function declaration it stood for: its parameters, its return type and its body are
// the nodes the author wrote, and every other check reads them as it reads the attribute form.
// Nothing is then said of an entry the module lacks, of a name the entry alone reads, or of a
// struct that only the entry makes an entry I/O struct. The program does not compile: the
// refusal is an error.
import ts from 'typescript';
import { TS_CODES } from './codes.js';
import { makeDiagnostic } from './diagnostic.js';
import type { TsCompilerDiagnostic } from './source-file.js';

/** The names a refused stage call is spelled with, and what each made of its function. They
 *  stay the names of the attributes (Rule 2.1). */
export const STAGE_CALLEES = ['vertex', 'fragment', 'compute', 'workgroup_size'] as const;
export type StageCallee = (typeof STAGE_CALLEES)[number];

/** Whether a stage call to `callee` declares an entry. `workgroup_size([…], f)` declares a
 *  kernel function, which is no entry. */
export const declaresEntry = (callee: StageCallee): boolean => callee !== 'workgroup_size';

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
  /** An argument after the function: the options of changes 0111 and 0118, which the
   *  refusal names with the call. */
  readonly options?: ts.Expression;
  readonly exported: boolean;
}

const isCallee = (name: string): name is StageCallee =>
  (STAGE_CALLEES as readonly string[]).includes(name);

/** Whether the file declares `name` where a statement of the file or of a namespace around
 *  `name` can read it: a function, a `const`, a `let`, a class or an import of that spelling.
 *  The name is then the file's, whatever it spells (Rule 2.1), and a call of it is no stage
 *  call. */
function fileDeclares(name: ts.Identifier): boolean {
  const declares = (stmt: ts.Statement): boolean => {
    if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt))
      return stmt.name?.text === name.text;
    if (ts.isVariableStatement(stmt))
      return stmt.declarationList.declarations.some(
        // `const vertex = vertex(f)` declares nothing the call can read.
        (d) =>
          ts.isIdentifier(d.name) && d.name.text === name.text && d.initializer !== name.parent,
      );
    if (ts.isImportDeclaration(stmt)) {
      const clause = stmt.importClause;
      const named = clause?.namedBindings;
      return (
        clause?.name?.text === name.text ||
        (named !== undefined &&
          (ts.isNamespaceImport(named)
            ? named.name.text === name.text
            : named.elements.some((e) => e.name.text === name.text)))
      );
    }
    return false;
  };
  for (let at: ts.Node | undefined = name.parent; at !== undefined; at = at.parent) {
    if ((ts.isSourceFile(at) || ts.isModuleBlock(at)) && at.statements.some(declares)) return true;
  }
  return false;
}

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
  if (!isCallee(callee) || fileDeclares(expr.expression)) return undefined;
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

/** The attribute a call of `callee` is written as: `@vertex`, `@compute([8, 8])`,
 *  `@workgroup_size([128])`. The size is the call's first argument, as written. */
function attributeOf(callee: StageCallee, size: ts.Expression | undefined, sf: ts.SourceFile) {
  return `@${callee}${size === undefined ? '' : `(${size.getText(sf)})`}`;
}

/** The sentence for the argument `options` written after a refused call's function: an
 *  attribute takes none (changes 0131 and 0132). */
function optionsSentence(options: ts.Expression, sf: ts.SourceFile): string {
  const props = ts.isObjectLiteralExpression(options) ? options.properties : [];
  const key = (p: ts.ObjectLiteralElementLike): string | undefined =>
    p.name !== undefined && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
      ? p.name.text
      : undefined;
  const written = props.some((p) => key(p) === 'diagnostic')
    ? 'diagnostic: [...]'
    : (props[0] ?? options).getText(sf);
  return `. The attribute takes no options: delete "${written}"`;
}

/**
 * What a stage call is told (Rule 6.7, change 0140): the attribute that replaces it, on the
 * declaration the author writes, and the tool that writes it.
 *
 * `migrates` is whether the call is a `const` at the top of the file or of a namespace, the
 * shape `tshc migrate` rewrites; any other call names the place of the declaration instead.
 */
function stageCallRefusal(
  call: {
    readonly callee: StageCallee;
    readonly size?: ts.Expression;
    readonly options?: ts.Expression;
  },
  name: string,
  exported: boolean,
  migrates: boolean,
  sf: ts.SourceFile,
): string {
  const subject = call.callee === 'workgroup_size' ? `a kernel's size` : 'a stage';
  const written = `${attributeOf(call.callee, call.size, sf)} ${exported ? 'export ' : ''}function ${name}(…)`;
  return (
    `${subject} is an attribute on the function declaration: write "${written}"` +
    (migrates ? `, or run "tshc migrate"` : ` at the top of the file or of a namespace`) +
    ` (change 0130)` +
    (call.options === undefined ? '' : optionsSentence(call.options, sf))
  );
}

/** What `export default` on an entry is told (Rule 8.1, change 0140). */
export const defaultEntryRefusal = (name: string | undefined): string =>
  `an entry takes its declaration's name; write "export function ${name ?? 'k'}"`;

/**
 * The refusal of `callee(…)`, a call of a stage name that nothing of the file declares and that
 * is no `const` at the top of the file or of a namespace: a call in a function's body, in a
 * `let`, in a list of declarators, or one with no function to wrap. Undefined for any other
 * name. A function of the file named `vertex` is the file's (Rule 2.1), and a call of it never
 * reaches here.
 */
export function stageCallRefusalAt(callee: ts.Identifier, sf: ts.SourceFile): string | undefined {
  const call = callee.parent;
  if (!isCallee(callee.text) || !ts.isCallExpression(call) || call.expression !== callee)
    return undefined;
  const parts = partsOf(call);
  const sized = callee.text === 'compute' || callee.text === 'workgroup_size';
  const first = call.arguments[0];
  const size =
    parts?.size ??
    (sized && first !== undefined && ts.isArrayLiteralExpression(first) ? first : undefined);
  const holder = call.parent;
  const own =
    parts !== undefined && ts.isFunctionExpression(parts.fn) ? parts.fn.name?.text : undefined;
  const name =
    own ??
    (ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name) ? holder.name.text : 'f');
  return stageCallRefusal(
    { callee: callee.text, size, options: parts?.options },
    name,
    true,
    false,
    sf,
  );
}

const stageAttribute = (d: ts.Decorator): boolean => {
  const e = ts.isCallExpression(d.expression) ? d.expression.expression : d.expression;
  return ts.isIdentifier(e) && isCallee(e.text) && declaresEntry(e.text);
};

/**
 * Refuses the entry forms of change 0111 (Rules 6.7 and 8.1, changes 0130 and 0140), each with
 * one `TS8028`:
 *
 * - a stage call that declares a `const`, at the top of the file and in a namespace, on the
 *   name called;
 * - a stage call written as a statement or after `export default` at the top of the file, or
 *   in a `const` list that declares no entry, on the name called;
 * - `export default` on a function declaration with a stage attribute, on `default`.
 *
 * A stage call anywhere else is refused where the call is lowered ({@link stageCallRefusalAt}).
 * The editor's report on the same call merges into this refusal, so both halves read one
 * diagnostic (Rule 12.7).
 */
export function refuseStageCalls(sf: ts.SourceFile, diagnostics: TsCompilerDiagnostic[]): void {
  const refuse = (at: ts.Node, message: string): void =>
    void diagnostics.push(makeDiagnostic(sf, at, message, TS_CODES.ATTRIBUTE_NAME));
  const visit = (statements: readonly ts.Statement[], top: boolean): void => {
    for (const stmt of statements) {
      if (ts.isModuleDeclaration(stmt)) {
        let body = stmt.body;
        while (body !== undefined && ts.isModuleDeclaration(body)) body = body.body;
        if (body !== undefined && ts.isModuleBlock(body)) visit(body.statements, false);
        continue;
      }
      const sc = stageCallOf(stmt);
      if (sc !== undefined) {
        const name = sc.declaration.name.text;
        refuse(sc.call.expression, stageCallRefusal(sc, name, sc.exported, true, sf));
        continue;
      }
      // A `const` list that holds a stage call beside another declarator, or declares a
      // pattern from one: no entry, and no constant either, so nothing else reads it.
      if (ts.isVariableStatement(stmt) && (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0) {
        for (const d of stmt.declarationList.declarations) {
          if (d.initializer === undefined || !isStageCall(d.initializer)) continue;
          const callee = (d.initializer as ts.CallExpression).expression as ts.Identifier;
          refuse(callee, stageCallRefusalAt(callee, sf)!);
        }
        continue;
      }
      const loose = top ? looseStageCallOf(stmt) : undefined;
      if (loose !== undefined) {
        refuse(loose, stageCallRefusalAt(loose, sf)!);
        continue;
      }
      if (
        ts.isFunctionDeclaration(stmt) &&
        (stmt.modifiers?.filter(ts.isDecorator).some(stageAttribute) ?? false)
      ) {
        const keyword = stmt.modifiers?.find((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
        if (keyword !== undefined) refuse(keyword, defaultEntryRefusal(stmt.name?.text));
      }
    }
  };
  visit(sf.statements, true);
}

/** The name called by a stage call written as a statement, `vertex(function vs() { … });`, or
 *  after `export default`. Neither declares a name, so neither is lowered. */
export function looseStageCallOf(stmt: ts.Statement): ts.Identifier | undefined {
  const expr =
    ts.isExpressionStatement(stmt) || (ts.isExportAssignment(stmt) && stmt.isExportEquals !== true)
      ? stmt.expression
      : undefined;
  return expr !== undefined && partsOf(expr) !== undefined
    ? ((expr as ts.CallExpression).expression as ts.Identifier)
    : undefined;
}
