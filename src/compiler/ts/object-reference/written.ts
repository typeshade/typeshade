// Implements: Rule 8.8, Rule 8.25 (docs/language-design.md; traced in reqs/).
import ts from 'typescript';
import {
  writesAnObject,
  rootOf,
  ARRAY_MUTATORS,
  fileFunction,
  methodWritesThis,
  writeTargets,
  declaresAgain,
  namesOfOneObject,
} from '../object-reference.js';

export function objectWrites(
  name: string,
  body: ts.Node,
  sourceFile: ts.SourceFile,
  at?: ts.Node,
): {
  readonly member: boolean;
  readonly whole: boolean;
  readonly shadowed: boolean;
  readonly memberAt: readonly ts.Node[];
  readonly wholeAt: readonly ts.Node[];
  readonly captured: boolean;
} {
  const names = namesOfOneObject(name, body, sourceFile);
  const memberAt: ts.Node[] = [];
  const wholeAt: ts.Node[] = [];
  let captured = false;
  let home: ts.Node | undefined;
  for (let scope: ts.Node | undefined = at; scope !== undefined; scope = scope.parent) {
    if (declaresAgain(scope, name)) {
      home = scope;
      break;
    }
  }
  if (home === undefined && ts.isFunctionLike(body) && declaresAgain(body, name)) home = body;
  const findHome = (n: ts.Node): void => {
    if (home !== undefined) return;
    if (declaresAgain(n, name)) {
      home = n;
      return;
    }
    ts.forEachChild(n, findHome);
  };
  findHome(body);
  const inBody = (n: ts.Node): boolean => n.getStart() >= body.getStart() && n.end <= body.end;
  const root = home !== undefined && home !== body && inBody(home) ? home : body;
  const scan = (n: ts.Node, inner: boolean): void => {
    if (n !== root && n !== home && declaresAgain(n, name)) return;
    const within = inner || (n !== root && ts.isFunctionLike(n));
    if (within && ts.isIdentifier(n) && n.text === name) captured = true;
    for (const target of writeTargets(n)) {
      const root = rootOf(target);
      if (root !== undefined && names.has(root.name.text)) {
        if (!root.whole) memberAt.push(n);
        else if (root.name.text === name) wholeAt.push(n);
      }
    }
    if (ts.isCallExpression(n)) {
      if (ts.isPropertyAccessExpression(n.expression)) {
        const root = rootOf(n.expression.expression);
        const method = n.expression.name.text;
        if (
          root !== undefined &&
          names.has(root.name.text) &&
          (ARRAY_MUTATORS.has(method) || methodWritesThis(method, sourceFile))
        )
          memberAt.push(n);
      }
      const callee = fileFunction(n, sourceFile);
      if (callee !== undefined) {
        n.arguments.forEach((a, i) => {
          const root = rootOf(a);
          const q = callee.parameters[i];
          if (
            root !== undefined &&
            names.has(root.name.text) &&
            q !== undefined &&
            takesThePlace(q, sourceFile)
          )
            memberAt.push(n);
        });
      }
    }
    ts.forEachChild(n, (c) => scan(c, within));
  };
  scan(root, false);
  return {
    member: memberAt.length > 0,
    whole: wholeAt.length > 0,
    shadowed: false,
    memberAt,
    wholeAt,
    captured,
  };
}

export function takesThePlace(q: ts.ParameterDeclaration, sourceFile: ts.SourceFile): boolean {
  const qualified = (ts.canHaveDecorators(q) ? (ts.getDecorators(q) ?? []) : []).some(
    (d) =>
      ts.isIdentifier(d.expression) &&
      (d.expression.text === 'inout' || d.expression.text === 'out'),
  );
  return qualified || isWrittenObjectParameter(q, sourceFile);
}

const WRITTEN = new WeakMap<ts.ParameterDeclaration, boolean>();

const READING = new Set<ts.ParameterDeclaration>();

export function isWrittenObjectParameter(
  p: ts.ParameterDeclaration,
  sourceFile: ts.SourceFile,
): boolean {
  const known = WRITTEN.get(p);
  if (known !== undefined) return known;
  const fn = p.parent;
  if (
    !ts.isFunctionDeclaration(fn) ||
    fn.body === undefined ||
    fn.typeParameters !== undefined ||
    !ts.isIdentifier(p.name) ||
    !writesAnObject(p.type, sourceFile) ||
    READING.has(p)
  )
    return false;
  READING.add(p);
  const w = objectWrites(p.name.text, fn.body, sourceFile);
  READING.delete(p);
  const written = w.member && !w.whole && !w.shadowed;
  WRITTEN.set(p, written);
  return written;
}

export function accessorMayWrite(name: string, sourceFile: ts.SourceFile): boolean {
  let byName = ACCESSORS.get(sourceFile);
  if (byName === undefined) ACCESSORS.set(sourceFile, (byName = new Map()));
  const known = byName.get(name);
  if (known !== undefined) return known;
  byName.set(name, false);
  let writes = false;
  const scan = (n: ts.Node): void => {
    if (writes) return;
    if (writeTargets(n).length > 0) writes = true;
    if (
      ts.isCallExpression(n) &&
      (ts.isPropertyAccessExpression(n.expression) || fileFunction(n, sourceFile) !== undefined)
    )
      writes = true;
    ts.forEachChild(n, scan);
  };
  const visit = (n: ts.Node): void => {
    if (
      (ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)) &&
      n.body !== undefined &&
      (ts.isIdentifier(n.name) || ts.isPrivateIdentifier(n.name)) &&
      n.name.text === name
    )
      scan(n.body);
    ts.forEachChild(n, visit);
  };
  visit(sourceFile);
  byName.set(name, writes);
  return writes;
}

const ACCESSORS = new WeakMap<ts.SourceFile, Map<string, boolean>>();
