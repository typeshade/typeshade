import ts from 'typescript';
import type { ModuleVarDecl } from '../../core/ir/nodes.js';
import { emittedMemberName, staticFieldDeclarations, writtenMemberName } from './class-names.js';
import { staticConstName } from './module-const.js';

const sourceNames = new WeakMap<ModuleVarDecl, string>();

/** The name the source scope resolves, before a module variable is separated from parameters. */
export const moduleVarSourceName = (decl: ModuleVarDecl): string =>
  sourceNames.get(decl) ?? decl.name;

/** A parameter and a module variable must occupy different IR environment slots (#1009).
 *  Rename the variable before lowering bodies, keeping authored parameter/entry names intact.
 *  Run after duplicate declarations have been diagnosed under their original names. */
export function separateModuleVars(
  sourceFile: ts.SourceFile,
  vars: readonly ModuleVarDecl[],
  declarations: readonly { readonly name: string }[],
): ModuleVarDecl[] {
  if (vars.length === 0) return [];
  const parameters = new Set<string>();
  const statics = new Set(
    [...staticFieldDeclarations(sourceFile).keys()].map((field) => {
      const dot = field.indexOf('.');
      return staticConstName(field.slice(0, dot), emittedMemberName(field.slice(dot + 1)));
    }),
  );
  if (!vars.some((decl) => statics.has(decl.name))) return [...vars];
  const taken = new Set([...vars, ...declarations].map((d) => d.name));
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) taken.add(node.text);
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) parameters.add(node.name.text);
    if (ts.isClassDeclaration(node) && node.name !== undefined) {
      for (const member of node.members) {
        const name = member.name === undefined ? undefined : writtenMemberName(member.name);
        if (name !== undefined) taken.add(staticConstName(node.name.text, emittedMemberName(name)));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return vars.map((decl) => {
    if (!statics.has(decl.name) || !parameters.has(decl.name)) return decl;
    let name = `${decl.name}_module`;
    for (let n = 1; taken.has(name); n++) name = `${decl.name}_module_${String(n)}`;
    taken.add(name);
    const renamed = { ...decl, name };
    sourceNames.set(renamed, decl.name);
    return renamed;
  });
}
