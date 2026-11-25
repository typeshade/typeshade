import ts from 'typescript';
import type { ShaderType } from '../../core/ir/types.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { makeDiagnostic } from './diagnostic.js';
import { TS_CODES } from './codes.js';
import { instanceName, typeParameterNames } from './generics.js';
import { mapTsTypeToShaderType } from './type-map.js';
import { authorTypeText } from './context.js';

export interface StructInstance {
  readonly name: string;
  readonly binding: ReadonlyMap<string, ShaderType> | undefined;
  readonly args?: string;
}

interface GenericParam {
  readonly name: string;
  readonly fallback: ts.TypeNode | undefined;
}

export function genericClasses(sourceFile: ts.SourceFile): Map<string, readonly GenericParam[]> {
  const out = new Map<string, readonly GenericParam[]>();
  const walk = (statements: readonly ts.Statement[], prefix: string): void => {
    for (const stmt of statements) {
      if (ts.isModuleDeclaration(stmt) && stmt.body) {
        const inner = prefix === '' ? stmt.name.text : `${prefix}_${stmt.name.text}`;
        if (ts.isModuleBlock(stmt.body)) walk(stmt.body.statements, inner);
        else if (ts.isModuleDeclaration(stmt.body)) walk([stmt.body], inner);
        continue;
      }
      if (!ts.isClassDeclaration(stmt) || !stmt.name) continue;
      const params = (stmt.typeParameters ?? []).map((p) => ({
        name: p.name.text,
        fallback: p.default,
      }));
      if (params.length > 0) {
        out.set(prefix === '' ? stmt.name.text : `${prefix}_${stmt.name.text}`, params);
      }
    }
  };
  walk(sourceFile.statements, '');
  return out;
}

function resolveName(
  written: string,
  generics: ReadonlyMap<string, readonly GenericParam[]>,
): string | undefined {
  const dotted = written.split('.').join('_');
  if (generics.has(dotted)) return dotted;
  const suffix = `_${dotted}`;
  const hits = [...generics.keys()].filter((k) => k.endsWith(suffix));
  return hits.length === 1 ? hits[0]! : undefined;
}

export function writtenInstances(
  sourceFile: ts.SourceFile,
  generics: ReadonlyMap<string, readonly GenericParam[]>,
  mapType: (node: ts.TypeNode) => ShaderType | undefined,
  diagnostics: TsCompilerDiagnostic[],
): Map<string, StructInstance[]> {
  const out = new Map<string, StructInstance[]>();
  if (generics.size === 0) return out;
  const seen = new Set<string>();
  const inScope: string[] = [];
  const record = (
    base: string,
    args: readonly ts.TypeNode[],
    at: ts.Node,
    shown: string,
    lenient?: true,
  ): void => {
    const key = resolveName(base, generics);
    if (key === undefined) return;
    const params = generics.get(key)!;
    const read = readArguments(args, params);
    if (read === undefined) {
      if (lenient) return;
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          at,
          arityMessage(base, params, args.length),
          TS_CODES.ARITY_MISMATCH,
        ),
      );
      return;
    }
    if (args.length > params.length) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          at,
          arityMessage(base, params, args.length),
          TS_CODES.ARITY_MISMATCH,
        ),
      );
    }
    const bound = new Map<string, ShaderType>();
    for (const [i, node] of read.entries()) {
      const written = node.getText(sourceFile);
      if (inScope.includes(written)) {
        diagnostics.push(
          makeDiagnostic(
            sourceFile,
            node,
            `"${shown}" is written with the type parameter "${written}", which names no layout ` +
              `until the declaration around it is instantiated. A struct is collected before ` +
              `anything is lowered against it, so its type arguments have to be concrete: ` +
              `write "${base}<f32>" (or whichever types this file uses) at the use sites.`,
            TS_CODES.UNKNOWN_TYPE,
          ),
        );
        return;
      }
      const mapped = mapType(node);
      if (!mapped) return;
      bound.set(params[i]!.name, mapped);
    }
    const name = instanceName(
      key,
      params.map((p) => bound.get(p.name)!),
    );
    usesOfInstances(sourceFile).set(name, [...(usesOfInstances(sourceFile).get(name) ?? []), at]);
    if (seen.has(name)) return;
    seen.add(name);
    const into = out.get(key) ?? [];
    into.push({ name, binding: bound, args: read.map((n) => n.getText()).join(', ') });
    out.set(key, into);
  };

  const visit = (node: ts.Node): void => {
    const own = ownTypeParameters(node);
    if (own.length > 0) inScope.push(...own);
    if (ts.isTypeReferenceNode(node)) {
      const written = entityName(node.typeName);
      if (written !== undefined) {
        record(written, node.typeArguments ?? [], node, node.getText(sourceFile));
      }
    }
    if (ts.isExpressionWithTypeArguments(node) && ts.isIdentifier(node.expression)) {
      record(node.expression.text, node.typeArguments ?? [], node, node.getText(sourceFile));
    }
    if (ts.isNewExpression(node)) {
      const written = newTargetName(node.expression);
      if (written !== undefined) {
        record(
          written,
          node.typeArguments ?? [],
          node,
          `new ${node.getText(sourceFile).slice(4)}`,
          true,
        );
      }
    }
    ts.forEachChild(node, visit);
    if (own.length > 0) inScope.length -= own.length;
  };
  ts.forEachChild(sourceFile, visit);
  return out;
}

function readArguments(
  args: readonly ts.TypeNode[],
  params: readonly GenericParam[],
): readonly ts.TypeNode[] | undefined {
  const out: ts.TypeNode[] = [];
  for (const [i, param] of params.entries()) {
    const node = args[i] ?? param.fallback;
    if (node === undefined) return undefined;
    out.push(node);
  }
  return out;
}

function arityMessage(base: string, params: readonly GenericParam[], got: number): string {
  const required = params.filter((p) => p.fallback === undefined).length;
  const takes =
    required === params.length
      ? String(params.length)
      : `${String(required)} to ${String(params.length)}`;
  return `"${base}" takes ${takes} type argument(s), got ${String(got)}.`;
}

function newTargetName(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
    const left = newTargetName(node.expression);
    return left === undefined ? undefined : `${left}.${node.name.text}`;
  }
  return undefined;
}

function entityName(name: ts.EntityName): string | undefined {
  if (ts.isIdentifier(name)) return name.text;
  const left = entityName(name.left);
  return left === undefined ? undefined : `${left}.${name.right.text}`;
}

function ownTypeParameters(node: ts.Node): readonly string[] {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node)
  ) {
    return [...typeParameterNames(node.typeParameters)];
  }
  return [];
}

export function genericStructName(
  name: string | undefined,
  typeArguments: readonly ts.TypeNode[] | undefined,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (name === undefined) return undefined;
  const generics = classesOf(sourceFile);
  const key = resolveName(name, generics);
  if (key === undefined) return undefined;
  const read = readArguments(typeArguments ?? [], generics.get(key)!);
  if (read === undefined) return undefined;
  const bound: ShaderType[] = [];
  for (const node of read) {
    const mapped = mapTsTypeToShaderType(node, sourceFile, undefined);
    if (!mapped) return undefined;
    bound.push(mapped);
  }
  return instanceName(key, bound);
}

export function isGenericClass(name: string | undefined, sourceFile: ts.SourceFile): boolean {
  return name !== undefined && resolveName(name, classesOf(sourceFile)) !== undefined;
}

const CLASSES = new WeakMap<ts.SourceFile, Map<string, readonly GenericParam[]>>();

function classesOf(sourceFile: ts.SourceFile): Map<string, readonly GenericParam[]> {
  const hit = CLASSES.get(sourceFile);
  if (hit !== undefined) return hit;
  const made = genericClasses(sourceFile);
  CLASSES.set(sourceFile, made);
  return made;
}

export function newInstanceName(
  node: ts.NewExpression,
  written: string,
  sourceFile: ts.SourceFile,
): string | undefined {
  const args = node.typeArguments ?? [];
  const generics = classesOf(sourceFile);
  const key = resolveName(written, generics);
  if (key === undefined) return undefined;
  if (args.length === 0) {
    const only = instancesOf(sourceFile).get(key) ?? [];
    if (only.length === 1) return only[0]!.name;
  }
  const read = readArguments(args, generics.get(key)!);
  if (read === undefined) return undefined;
  const bound: ShaderType[] = [];
  for (const arg of read) {
    const mapped = mapTsTypeToShaderType(arg, sourceFile, undefined);
    if (!mapped) return undefined;
    bound.push(mapped);
  }
  return instanceName(key, bound);
}

export function ambiguousNew(written: string, sourceFile: ts.SourceFile): string | undefined {
  const key = resolveName(written, classesOf(sourceFile));
  if (key === undefined) return undefined;
  const instances = (instancesOf(sourceFile).get(key) ?? []).map(
    (i) =>
      `${written}<${i.args ?? [...(i.binding?.values() ?? [])].map(authorTypeText).join(', ')}>`,
  );
  if (instances.length === 0) {
    return (
      `"${written}" is generic, and nothing in this file says what to build it at. A struct is ` +
      `one layout, so each set of type arguments is a struct of its own: write ` +
      `"new ${written}<f32>(…)" with the type you mean, the way TypeScript lets you write it.`
    );
  }
  return (
    `"${written}" is generic and this file writes it at ${String(instances.length)} sets of type ` +
    `arguments (${instances.join(', ')}), so "new ${written}(…)" does not say which one to ` +
    `build. Write the type argument: "new ${written}<f32>(…)".`
  );
}

const INSTANCES = new WeakMap<ts.SourceFile, Map<string, StructInstance[]>>();

function instancesOf(sourceFile: ts.SourceFile): Map<string, StructInstance[]> {
  const hit = INSTANCES.get(sourceFile);
  if (hit !== undefined) return hit;
  const made = writtenInstances(
    sourceFile,
    classesOf(sourceFile),
    (node) => mapTsTypeToShaderType(node, sourceFile, undefined),
    [],
  );
  INSTANCES.set(sourceFile, made);
  return made;
}

export function writtenInstanceArgs(name: string, sourceFile: ts.SourceFile): string | undefined {
  for (const list of instancesOf(sourceFile).values()) {
    const hit = list.find((i) => i.name === name);
    if (hit !== undefined) return hit.args;
  }
  return undefined;
}

const INSTANCE_USES = new WeakMap<ts.SourceFile, Map<string, ts.Node[]>>();
const usesOfInstances = (sourceFile: ts.SourceFile): Map<string, ts.Node[]> => {
  let uses = INSTANCE_USES.get(sourceFile);
  if (uses === undefined) INSTANCE_USES.set(sourceFile, (uses = new Map()));
  return uses;
};

export function instanceUsesOf(sourceFile: ts.SourceFile, name: string): readonly ts.Node[] {
  return INSTANCE_USES.get(sourceFile)?.get(name) ?? [];
}
