import ts from 'typescript';
import type { ShaderType } from '../../core/ir/types.js';
import { bare, fileFunction, writesAnObject } from './object-reference.js';
import { isReadonlyArrayOperator } from './type-map/readonly-array.js';

export function membersNamed(name: string, sourceFile: ts.SourceFile): readonly ts.Node[] {
  let byName = MEMBERS.get(sourceFile);
  if (byName === undefined) {
    byName = new Map();
    const index = byName;
    const visit = (n: ts.Node): void => {
      if (
        (ts.isPropertyDeclaration(n) ||
          ts.isPropertySignature(n) ||
          ts.isGetAccessorDeclaration(n) ||
          ts.isMethodDeclaration(n) ||
          ts.isMethodSignature(n) ||
          (ts.isParameter(n) && ts.isConstructorDeclaration(n.parent) && n.modifiers?.length)) &&
        n.name !== undefined &&
        (ts.isIdentifier(n.name) || ts.isPrivateIdentifier(n.name))
      ) {
        const list = index.get(n.name.text) ?? [];
        list.push(n);
        index.set(n.name.text, list);
      }
      ts.forEachChild(n, visit);
    };
    visit(sourceFile);
    MEMBERS.set(sourceFile, byName);
  }
  return byName.get(name) ?? [];
}
const MEMBERS = new WeakMap<ts.SourceFile, Map<string, ts.Node[]>>();

function isField(name: string, sourceFile: ts.SourceFile): boolean {
  const members = membersNamed(name, sourceFile);
  return (
    members.length > 0 &&
    members.every(
      (m) => ts.isPropertyDeclaration(m) || ts.isPropertySignature(m) || ts.isParameter(m),
    )
  );
}

export function isPlainPlace(e: ts.Expression, sourceFile: ts.SourceFile): boolean {
  let at = bare(e);
  for (;;) {
    if (ts.isIdentifier(at) || at.kind === ts.SyntaxKind.ThisKeyword) return true;
    if (ts.isPropertyAccessExpression(at)) {
      if (!isField(at.name.text, sourceFile)) return false;
      at = bare(at.expression);
    } else if (ts.isElementAccessExpression(at)) at = bare(at.expression);
    else return false;
  }
}

const VALUE_METHODS = new Set([
  'indexOf',
  'lastIndexOf',
  'includes',
  'some',
  'every',
  'findIndex',
  'forEach',
  'push',
  'join',
]);

export function elementType(type: ts.TypeNode | undefined): ts.TypeNode | undefined {
  let at = type;
  while (at !== undefined && ts.isParenthesizedTypeNode(at)) at = at.type;
  while (
    at !== undefined &&
    ts.isTypeReferenceNode(at) &&
    ts.isIdentifier(at.typeName) &&
    ['uniform', 'storage', 'workgroup'].includes(at.typeName.text)
  )
    at = at.typeArguments?.[0];
  if (at === undefined) return undefined;
  if (isReadonlyArrayOperator(at)) return at.type.elementType;
  if (ts.isArrayTypeNode(at)) return at.elementType;
  if (ts.isTupleTypeNode(at)) return at.elements[0];
  if (
    ts.isTypeReferenceNode(at) &&
    ts.isIdentifier(at.typeName) &&
    ['array', 'Array', 'ReadonlyArray'].includes(at.typeName.text)
  )
    return at.typeArguments?.[0];
  return undefined;
}

export class Reader {
  constructor(
    readonly sourceFile: ts.SourceFile,
    readonly lowered?: (e: ts.Expression) => ShaderType | undefined,
  ) {}

  declOf(
    name: string,
    at: ts.Node,
  ): ts.ParameterDeclaration | ts.VariableDeclaration | ts.BindingElement | undefined {
    type Decl = ts.ParameterDeclaration | ts.VariableDeclaration | ts.BindingElement;
    const inName = (d: Decl, n: ts.BindingName): Decl | undefined => {
      if (ts.isIdentifier(n)) return n.text === name ? d : undefined;
      for (const el of n.elements) {
        if (ts.isOmittedExpression(el)) continue;
        const hit = inName(el, el.name);
        if (hit !== undefined) return hit;
      }
      return undefined;
    };
    const inList = (list: ts.VariableDeclarationList): Decl | undefined => {
      for (const d of list.declarations) {
        const hit = inName(d, d.name);
        if (hit !== undefined) return hit;
      }
      return undefined;
    };
    const inStatements = (statements: readonly ts.Statement[]): Decl | undefined => {
      for (const st of statements) {
        if (!ts.isVariableStatement(st)) continue;
        const hit = inList(st.declarationList);
        if (hit !== undefined) return hit;
      }
      return undefined;
    };
    for (let scope = at.parent; scope !== undefined; scope = scope.parent) {
      let hit: Decl | undefined;
      if (ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope))
        hit = inStatements(scope.statements);
      else if (ts.isCaseClause(scope) || ts.isDefaultClause(scope))
        hit = inStatements(scope.statements);
      else if (ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope))
        hit =
          scope.initializer !== undefined && ts.isVariableDeclarationList(scope.initializer)
            ? inList(scope.initializer)
            : undefined;
      else if (ts.isFunctionLike(scope)) {
        for (const q of scope.parameters) {
          hit = inName(q, q.name);
          if (hit !== undefined) break;
        }
      }
      if (hit !== undefined) return hit;
    }
    return undefined;
  }

  private patternNameIsObject(d: ts.BindingElement): boolean {
    const pattern = d.parent;
    const holder = pattern.parent;
    if (ts.isObjectBindingPattern(pattern)) {
      const key = d.propertyName ?? d.name;
      if (!ts.isIdentifier(key)) return true;
      const members = membersNamed(key.text, this.sourceFile);
      if (members.length === 0) return false;
      return members.some((m) => {
        if (ts.isMethodDeclaration(m) || ts.isMethodSignature(m)) return false;
        const field = m as ts.PropertyDeclaration;
        if (field.type !== undefined) return writesAnObject(field.type, this.sourceFile);
        return field.initializer !== undefined && this.isObject(field.initializer);
      });
    }
    if (!ts.isVariableDeclaration(holder) || holder.initializer === undefined) return true;
    const init = bare(holder.initializer);
    if (ts.isArrayLiteralExpression(init)) {
      const at = init.elements[pattern.elements.indexOf(d)];
      return at === undefined || this.isObject(at);
    }
    const elem = elementType(this.typeOf(init));
    return elem === undefined || writesAnObject(elem, this.sourceFile);
  }

  declaresName(name: string, at: ts.Node): boolean {
    if (this.declOf(name, at) !== undefined) return true;
    return this.sourceFile.statements.some(
      (st) =>
        ((ts.isFunctionDeclaration(st) ||
          ts.isClassDeclaration(st) ||
          ts.isModuleDeclaration(st) ||
          ts.isEnumDeclaration(st)) &&
          st.name?.getText(this.sourceFile) === name) ||
        (ts.isVariableStatement(st) &&
          st.declarationList.declarations.some((d) => d.name.getText(this.sourceFile) === name)) ||
        (ts.isImportDeclaration(st) &&
          (st.importClause?.getText(this.sourceFile) ?? '').match(new RegExp(`\\b${name}\\b`)) !==
            null),
    );
  }

  private readonly reading = new Set<ts.Node>();

  typeOf(e: ts.Expression): ts.TypeNode | undefined {
    const x = bare(e);
    if (this.reading.has(x)) return undefined;
    this.reading.add(x);
    try {
      return this.typeOfNow(x);
    } finally {
      this.reading.delete(x);
    }
  }

  private typeOfNow(x: ts.Expression): ts.TypeNode | undefined {
    if (ts.isIdentifier(x)) {
      const d = this.declOf(x.text, x);
      if (d === undefined || ts.isBindingElement(d)) return undefined;
      if (d.type !== undefined) return d.type;
      const list = ts.isVariableDeclaration(d) ? d.parent : undefined;
      if (
        list !== undefined &&
        ts.isVariableDeclarationList(list) &&
        ts.isForOfStatement(list.parent)
      )
        return elementType(this.typeOf(list.parent.expression));
      if (d.initializer !== undefined) return this.typeOf(d.initializer);
      return undefined;
    }
    if (ts.isPropertyAccessExpression(x)) {
      const types = membersNamed(x.name.text, this.sourceFile)
        .map((m) =>
          ts.isMethodDeclaration(m) || ts.isMethodSignature(m)
            ? undefined
            : (m as ts.PropertyDeclaration).type,
        )
        .filter((t): t is ts.TypeNode => t !== undefined);
      return types.length === 1 ? types[0] : undefined;
    }
    if (ts.isElementAccessExpression(x)) return elementType(this.typeOf(x.expression));
    if (ts.isCallExpression(x)) return fileFunction(x, this.sourceFile)?.type;
    if (ts.isNewExpression(x) && ts.isIdentifier(x.expression))
      return ts.factory.createTypeReferenceNode(x.expression.text);
    return undefined;
  }

  isObject(e: ts.Expression): boolean {
    const x = bare(e);
    if (this.objects.has(x)) return false;
    this.objects.add(x);
    try {
      return this.isObjectNow(x);
    } finally {
      this.objects.delete(x);
    }
  }
  private readonly objects = new Set<ts.Node>();

  private isObjectNow(x: ts.Expression): boolean {
    if (x.kind === ts.SyntaxKind.ThisKeyword) return true;
    if (ts.isNewExpression(x) || ts.isObjectLiteralExpression(x)) return true;
    if (ts.isArrayLiteralExpression(x)) return true;
    if (ts.isConditionalExpression(x))
      return this.isObject(x.whenTrue) || this.isObject(x.whenFalse);
    if (ts.isIdentifier(x)) {
      const d = this.declOf(x.text, x);
      if (d === undefined) return false;
      if (ts.isBindingElement(d)) return this.patternNameIsObject(d);
      const t = this.typeOf(x);
      if (t !== undefined) return writesAnObject(t, this.sourceFile);
      if (ts.isParameter(d)) return true;
      const list = d.parent;
      if (ts.isVariableDeclarationList(list) && ts.isForOfStatement(list.parent)) {
        return this.isObject(list.parent.expression);
      }
      return d.initializer !== undefined && this.isObject(d.initializer);
    }
    if (ts.isPropertyAccessExpression(x)) {
      const members = membersNamed(x.name.text, this.sourceFile);
      if (members.length === 0) return false;
      return members.some((m) => {
        if (ts.isMethodDeclaration(m) || ts.isMethodSignature(m)) return false;
        const d = m as ts.PropertyDeclaration;
        if (d.type !== undefined) return writesAnObject(d.type, this.sourceFile);
        return d.initializer !== undefined && this.isObject(d.initializer);
      });
    }
    if (ts.isElementAccessExpression(x)) {
      const t = this.typeOf(x.expression);
      if (t !== undefined) {
        const elem = elementType(t);
        return elem !== undefined && writesAnObject(elem, this.sourceFile);
      }
      return this.isObject(x.expression);
    }
    if (ts.isCallExpression(x)) {
      const callee = fileFunction(x, this.sourceFile);
      if (callee !== undefined)
        return callee.type === undefined || writesAnObject(callee.type, this.sourceFile);
      const local = this.localFunction(x);
      if (local !== undefined)
        return local.type === undefined || writesAnObject(local.type, this.sourceFile);
      if (ts.isPropertyAccessExpression(x.expression)) {
        const name = x.expression.name.text;
        const methods = membersNamed(name, this.sourceFile).filter(
          (m) => ts.isMethodDeclaration(m) || ts.isMethodSignature(m),
        ) as ts.MethodDeclaration[];
        if (methods.length > 0)
          return methods.some(
            (m) => m.type === undefined || writesAnObject(m.type, this.sourceFile),
          );
        if (!this.isObject(x.expression.expression) || VALUE_METHODS.has(name)) return false;
        const f = x.arguments[0] === undefined ? undefined : bare(x.arguments[0]);
        if (name === 'map' && f !== undefined && ts.isArrowFunction(f)) {
          if (f.type !== undefined) return writesAnObject(f.type, this.sourceFile);
          return ts.isBlock(f.body) || this.isObject(f.body);
        }
        if (name === 'reduce' || name === 'reduceRight') {
          const start = x.arguments[1];
          return start === undefined || this.isObject(start);
        }
        return true;
      }
      return false;
    }
    return false;
  }

  localFunction(call: ts.CallExpression): ts.FunctionLikeDeclaration | undefined {
    const callee = bare(call.expression);
    if (!ts.isIdentifier(callee)) return undefined;
    const d = this.declOf(callee.text, callee);
    if (d !== undefined && ts.isVariableDeclaration(d) && d.initializer !== undefined) {
      const f = bare(d.initializer);
      if (ts.isArrowFunction(f) || ts.isFunctionExpression(f)) return f;
    }
    for (
      let scope: ts.Node | undefined = callee.parent;
      scope !== undefined;
      scope = scope.parent
    ) {
      if (!ts.isBlock(scope)) continue;
      for (const st of scope.statements) {
        if (ts.isFunctionDeclaration(st) && st.name?.text === callee.text && st.body) return st;
      }
    }
    return undefined;
  }

  hasObjectField(e: ts.Expression): boolean {
    let t = this.typeOf(e);
    while (t !== undefined && ts.isParenthesizedTypeNode(t)) t = t.type;
    if (t === undefined) return true;
    let members: readonly ts.Node[] | undefined;
    if (ts.isTypeLiteralNode(t)) members = t.members;
    else if (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName)) {
      const name = t.typeName.text;
      for (const st of this.sourceFile.statements) {
        if ((ts.isInterfaceDeclaration(st) || ts.isClassDeclaration(st)) && st.name?.text === name)
          members = st.members;
        if (ts.isTypeAliasDeclaration(st) && st.name.text === name && ts.isTypeLiteralNode(st.type))
          members = st.type.members;
      }
    }
    if (members === undefined) return true;
    return members.some(
      (m) =>
        (ts.isPropertySignature(m) || ts.isPropertyDeclaration(m)) &&
        (m.type === undefined || writesAnObject(m.type, this.sourceFile)),
    );
  }
}

export function eachOwn(body: ts.Node, visit: (n: ts.Node) => void): void {
  const walk = (n: ts.Node): void => {
    if (n !== body && ts.isFunctionLike(n) && !ts.isArrowFunction(n)) return;
    visit(n);
    ts.forEachChild(n, walk);
  };
  walk(body);
}

export function loopsAround(n: ts.Node, body: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  for (let at: ts.Node | undefined = n.parent; at !== undefined && at !== body; at = at.parent) {
    if (ts.isIterationStatement(at, false)) out.push(at);
  }
  return out;
}

export const within = (n: ts.Node, outer: ts.Node): boolean =>
  n.getStart() >= outer.getStart() && n.end <= outer.end;

export const isStatement = (n: ts.Node): boolean =>
  n.kind >= ts.SyntaxKind.FirstStatement && n.kind <= ts.SyntaxKind.LastStatement && !ts.isBlock(n);

export function isPropertyName(n: ts.Identifier): boolean {
  const p = n.parent;
  return (
    (ts.isPropertyAccessExpression(p) && p.name === n) ||
    (ts.isPropertyAssignment(p) && p.name === n) ||
    (ts.isVariableDeclaration(p) && p.name === n)
  );
}
