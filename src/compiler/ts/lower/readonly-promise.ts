import ts from 'typescript';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { writeRules, type Binding, type LoweringScope } from '../context.js';
import { aliasTargetsOf } from '../type-map.js';
import { isReadonlyArrayOperator, isReadonlyArrayReference } from '../type-map/readonly-array.js';
import { TS_CODES } from '../codes.js';
import { makeDiagnostic } from '../diagnostic.js';

interface ReadonlyPromise {
  readonly written: string;
  readonly writable?: string;
}

export const READONLY_WRITE_PREFIX = 'Cannot write to "';

const MUTATING_METHODS: ReadonlySet<string> = new Set([
  'push',
  'fill',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'copyWithin',
]);

function unparenthesized(type: ts.TypeNode): ts.TypeNode {
  return ts.isParenthesizedTypeNode(type) ? unparenthesized(type.type) : type;
}

function promiseOf(
  type: ts.TypeNode,
  sourceFile: ts.SourceFile,
  followed: ReadonlySet<string> = new Set(),
): ReadonlyPromise | undefined {
  const at = unparenthesized(type);
  if (isReadonlyArrayOperator(at)) {
    return { written: at.getText(sourceFile), writable: at.type.getText(sourceFile) };
  }
  if (isReadonlyArrayReference(at)) {
    const elem = at.typeArguments![0]!.getText(sourceFile);
    return { written: at.getText(sourceFile), writable: `Array<${elem}>` };
  }
  const alias = aliasedType(at, sourceFile, followed);
  if (alias === undefined) return undefined;
  return promiseOf(alias.target, sourceFile, alias.followed) && { written: alias.name };
}

function aliasedType(
  type: ts.TypeNode,
  sourceFile: ts.SourceFile,
  followed: ReadonlySet<string>,
): { name: string; target: ts.TypeNode; followed: ReadonlySet<string> } | undefined {
  if (!ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) return undefined;
  const name = type.typeName.text;
  const target = aliasTargetsOf(sourceFile).get(name);
  if (target === undefined || followed.has(name)) return undefined;
  return { name, target, followed: new Set([...followed, name]) };
}

function fieldType(
  owner: ts.TypeNode,
  field: string,
  sourceFile: ts.SourceFile,
): ts.TypeNode | undefined {
  const at = unparenthesized(owner);
  const alias = aliasedType(at, sourceFile, new Set());
  if (alias !== undefined) return fieldType(alias.target, field, sourceFile);
  if (!ts.isTypeReferenceNode(at) || !ts.isIdentifier(at.typeName)) return undefined;
  const name = at.typeName.text;
  for (const st of sourceFile.statements) {
    if (!ts.isClassDeclaration(st) && !ts.isInterfaceDeclaration(st)) continue;
    if (st.name?.text !== name) continue;
    for (const member of st.members) {
      if (!ts.isPropertyDeclaration(member) && !ts.isPropertySignature(member)) continue;
      if (ts.isIdentifier(member.name) && member.name.text === field) return member.type;
    }
  }
  return undefined;
}

function elementTypeOf(type: ts.TypeNode): ts.TypeNode | undefined {
  const at = unparenthesized(type);
  if (ts.isArrayTypeNode(at)) return at.elementType;
  if (isReadonlyArrayOperator(at)) return at.type.elementType;
  if (ts.isTypeReferenceNode(at) && ts.isIdentifier(at.typeName)) {
    const name = at.typeName.text;
    if (name === 'array' || name === 'Array' || name === 'ReadonlyArray') {
      return at.typeArguments?.[0];
    }
  }
  return undefined;
}

function declaredParamType(name: string, at: ts.Node): ts.TypeNode | undefined {
  for (let node: ts.Node = at; !ts.isSourceFile(node); node = node.parent) {
    if (!ts.isFunctionLike(node)) continue;
    const declared = node.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === name);
    if (declared !== undefined) return declared.type;
  }
  return undefined;
}

function bindingDeclaration(
  name: string,
  sourceFile: ts.SourceFile,
): ts.TypeReferenceNode | ts.CallExpression | undefined {
  for (const st of sourceFile.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const decl of st.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue;
      if (decl.type !== undefined && ts.isTypeReferenceNode(decl.type)) return decl.type;
      if (decl.initializer !== undefined && ts.isCallExpression(decl.initializer)) {
        return decl.initializer;
      }
    }
  }
  return undefined;
}

function rootTypeOf(binding: Binding, at: ts.Node, sourceFile: ts.SourceFile) {
  if (binding.kind === 'param') return declaredParamType(binding.name, at);
  if (binding.kind !== 'binding') return undefined;
  return bindingDeclaration(binding.name, sourceFile)?.typeArguments?.[0];
}

function writableLine(
  binding: Binding,
  writable: string,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (binding.kind !== 'binding') return writable;
  if (binding.space !== 'storage') return undefined;
  const declared = bindingDeclaration(binding.name, sourceFile);
  const type = `storage<${writable}, "read_write">`;
  if (declared === undefined || !ts.isCallExpression(declared)) {
    return `declare const ${binding.name}: ${type}`;
  }
  const args = declared.arguments.map((a) => a.getText(sourceFile)).join(', ');
  return `const ${binding.name} = ${type}(${args})`;
}

function stepsOf(place: ts.Expression): { root: ts.Expression; steps: ts.Expression[] } {
  const steps: ts.Expression[] = [];
  let at = place;
  for (;;) {
    if (ts.isParenthesizedExpression(at) || ts.isNonNullExpression(at)) {
      at = at.expression;
    } else if (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at)) {
      steps.unshift(at);
      at = at.expression;
    } else {
      return { root: at, steps };
    }
  }
}

function readonlyAlong(
  place: ts.Expression,
  binding: Binding,
  sourceFile: ts.SourceFile,
  placeItself: boolean,
): string | undefined {
  const { root, steps } = stepsOf(place);
  let type = rootTypeOf(binding, place, sourceFile);
  let reached = root;
  for (let i = 0; type !== undefined; i++) {
    const promise = i < steps.length || placeItself ? promiseOf(type, sourceFile) : undefined;
    if (promise !== undefined) {
      const writable =
        promise.writable === undefined || i > 0
          ? promise.writable
          : writableLine(binding, promise.writable, sourceFile);
      return readonlyWriteSentence(reached, { ...promise, writable }, sourceFile);
    }
    const step = steps[i];
    if (step === undefined) return undefined;
    type = ts.isPropertyAccessExpression(step)
      ? fieldType(type, step.name.text, sourceFile)
      : elementTypeOf(type);
    reached = step;
  }
  return undefined;
}

function readonlyWriteSentence(
  reached: ts.Expression,
  promise: ReadonlyPromise,
  sourceFile: ts.SourceFile,
): string {
  const remedy =
    promise.writable === undefined ? '' : ` Write "${promise.writable}" to write to it.`;
  return (
    `${READONLY_WRITE_PREFIX}${reached.getText(sourceFile)}" — its type ` +
    `"${promise.written}" promises that nothing writes it.${remedy}`
  );
}

export function readonlyWriteThrough(
  place: ts.Expression,
  binding: Binding,
  sourceFile: ts.SourceFile,
): string | undefined {
  return readonlyAlong(place, writeRules(binding), sourceFile, false);
}

export function refusesReadonlyMutatorCall(
  node: ts.CallExpression,
  callee: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (!MUTATING_METHODS.has(callee.name.text)) return false;
  const { root } = stepsOf(callee.expression);
  if (!ts.isIdentifier(root)) return false;
  const binding = scope.resolve(root.text);
  if (binding === undefined) return false;
  const said = readonlyAlong(callee.expression, writeRules(binding), sourceFile, true);
  if (said === undefined) return false;
  diagnostics.push(makeDiagnostic(sourceFile, node, said, TS_CODES.CONST_ASSIGN));
  return true;
}
