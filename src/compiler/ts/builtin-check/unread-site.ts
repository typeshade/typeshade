import ts from 'typescript';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { makeDiagnostic } from '../diagnostic.js';
import { TS_CODES } from '../codes.js';
import { isMixinDeclaration } from '../mixins.js';
import {
  ATTRIBUTE_NAMES,
  AttributeSite,
  STAGE_ATTRIBUTES,
  STD140_NOT_APPLIED,
  attributeNameOf,
  misplacedAttribute,
  wgslAttributeSentence,
  unknownAttribute,
} from '../builtin-check.js';

export function unreadDecoratorSite(node: ts.Node): AttributeSite | undefined {
  if (
    ts.isVariableStatement(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isModuleDeclaration(node)
  ) {
    return 'a declaration';
  }
  if (ts.isFunctionDeclaration(node)) {
    if (!ts.isSourceFile(node.parent) && !ts.isModuleBlock(node.parent)) return 'a local function';
    if (isMixinDeclaration(node)) return 'a mixin';
    return implementationOf(node) !== undefined ? 'an overload signature' : undefined;
  }
  if (ts.isClassExpression(node)) return 'a class expression';
  if (ts.isClassDeclaration(node)) {
    return ts.isSourceFile(node.parent) || ts.isModuleBlock(node.parent)
      ? undefined
      : 'a local class';
  }
  if (ts.isConstructorDeclaration(node)) return 'a constructor';
  if (ts.isIndexSignatureDeclaration(node)) return 'an index signature';
  if ((ts.isMethodDeclaration(node) || ts.isAccessor(node)) && node.body === undefined) {
    return node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword)
      ? 'an abstract member'
      : 'an overload signature';
  }
  if (
    ts.isPropertyDeclaration(node) &&
    node.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)
  ) {
    return 'a static field';
  }
  if (ts.isParameter(node)) {
    const fn = node.parent;
    if (ts.isConstructorDeclaration(fn)) {
      return fn.body === undefined ? 'an overload signature' : undefined;
    }
    const site = unreadDecoratorSite(fn);
    return site === 'a local function' ? undefined : site;
  }
  return undefined;
}

function implementationOf(fn: ts.FunctionDeclaration): ts.FunctionDeclaration | undefined {
  if (fn.body !== undefined || fn.name === undefined) return undefined;
  if (fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) return undefined;
  const statements = (fn.parent as ts.SourceFile | ts.ModuleBlock).statements;
  return statements.find(
    (s): s is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(s) && s.body !== undefined && s.name?.text === fn.name!.text,
  );
}

function implementationSite(d: ts.Decorator): AttributeSite | undefined {
  const on = d.parent;
  const fn = ts.isParameter(on) ? on.parent : on;
  if (!ts.isFunctionDeclaration(fn)) return undefined;
  const implementation = implementationOf(fn);
  if (implementation === undefined) return undefined;
  if (!ts.isParameter(on)) {
    return ts.isSourceFile(fn.parent) ? 'a function' : "a namespace's function";
  }
  const isEntry = (implementation.modifiers ?? []).some((m) => {
    const name = ts.isDecorator(m) ? attributeNameOf(m) : undefined;
    return name !== undefined && STAGE_ATTRIBUTES.includes(name);
  });
  return isEntry ? 'a parameter' : 'a parameter of a function that is not an entry';
}

export function unreadDecoratorRefusal(
  sourceFile: ts.SourceFile,
  d: ts.Decorator,
  site: AttributeSite,
): TsCompilerDiagnostic {
  const name = attributeNameOf(d);
  const message =
    name === undefined
      ? `"${d.getText(sourceFile)}" is not applied: ${site} takes no decorator. Remove it.`
      : name === 'std140'
        ? STD140_NOT_APPLIED
        : ATTRIBUTE_NAMES.includes(name)
          ? misplacedAttribute(name, site, implementationSite(d))
          : (wgslAttributeSentence(name, site) ?? unknownAttribute(name));
  return makeDiagnostic(sourceFile, d, message, TS_CODES.ATTRIBUTE_NAME);
}
