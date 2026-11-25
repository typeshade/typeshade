import ts from 'typescript';
import type { CompileTsSourceResult } from '../../compiler/ts/source-file.js';
import { copyCallAt, copyCallParamsAt, resultCopiesAt } from '../../compiler/ts/symbols.js';
import type { ShaderType } from '../../core/ir/types.js';
import { nodeAt } from './node-at.js';
import type { StructNames } from './types.js';
import { spellShaderType, typesOf } from './spell-type.js';

function typesInWords(types: readonly ShaderType[], struct: StructNames): string {
  const order = ['i32', 'u32', 'f32', 'f64'];
  const rank = (t: string): number => (order.includes(t) ? order.indexOf(t) : order.length);
  const spelled = [...new Set(types.map((t) => spellShaderType(t, struct)))].sort(
    (a, b) => rank(a) - rank(b),
  );
  return spelled.length <= 1
    ? (spelled[0] ?? '')
    : `${spelled.slice(0, -1).join(', ')} or ${spelled[spelled.length - 1]!}`;
}

export function resultCopiesLine(
  node: ts.Node,
  defs: readonly ts.DefinitionInfo[],
  uri: string,
  sourceFile: ts.SourceFile,
  analysis: CompileTsSourceResult,
  struct: StructNames,
): string | undefined {
  if (!ts.isIdentifier(node)) return undefined;
  const def = defs.find((d) => d.fileName === uri);
  if (def === undefined) return undefined;
  const table = analysis.sourceFile;
  const at = def.textSpan.start;
  const fn = resultCopiesAt(table, at);
  const call = copyCallAt(table, node.getStart(sourceFile));
  const named = nodeAt(sourceFile, at);
  const decl = named?.parent;
  const generic =
    decl !== undefined &&
    ts.isFunctionLike(decl) &&
    ((decl as ts.SignatureDeclaration).typeParameters?.length ?? 0) > 0;
  if (fn !== undefined || (call !== undefined && generic)) {
    const fnNode =
      decl !== undefined && ts.isVariableDeclaration(decl) && decl.initializer !== undefined
        ? decl.initializer
        : decl;
    const instance = generic ? copyCallParamsAt(table, node.getStart(sourceFile)) : undefined;
    const written = fnNode !== undefined && ts.isFunctionLike(fnNode) ? fnNode.parameters : [];
    const params =
      instance !== undefined
        ? written
            .map((p, i) => {
              const t = instance[instance.length - written.length + i];
              return `${p.name.getText(sourceFile)}: ${t === undefined ? '?' : spellShaderType(t, struct)}`;
            })
            .join(', ')
        : written.map((p) => p.getText(sourceFile).replace(/\s+/g, ' ')).join(', ');
    const callNode = node.parent;
    const typeArgs =
      generic && ts.isCallExpression(callNode) && callNode.typeArguments !== undefined
        ? `<${callNode.typeArguments.map((a) => a.getText(sourceFile)).join(', ')}>`
        : '';
    const owner =
      decl !== undefined && ts.isClassElement(decl) && ts.isClassLike(decl.parent)
        ? `${decl.parent.name?.text ?? ''}.`
        : '';
    const one = fn !== undefined && fn.types.length === 1 ? fn.types[0] : undefined;
    const fixed = call ?? one;
    const result = fixed !== undefined ? spellShaderType(fixed, struct) : undefined;
    const words = `${typesInWords(fn?.types ?? [], struct)} where it is called`;
    if (decl !== undefined && ts.isGetAccessorDeclaration(decl)) {
      return `(getter) ${owner}${node.text}${result !== undefined ? `: ${result}` : ` (${words})`}`;
    }
    if (decl !== undefined && ts.isVariableDeclaration(decl)) {
      return `const ${node.text}: (${params}) => ${result ?? `(${words})`}`;
    }
    const head =
      decl !== undefined && ts.isMethodDeclaration(decl)
        ? `(method) ${owner}${node.text}(${params})`
        : decl !== undefined &&
            ts.isFunctionDeclaration(decl) &&
            !ts.isSourceFile(decl.parent) &&
            !ts.isModuleBlock(decl.parent)
          ? `(local function) ${node.text}(${params})`
          : `function ${node.text}${typeArgs}(${params})`;
    return result !== undefined ? `${head}: ${result}` : `${head} (${words})`;
  }
  const local = analysis.symbols.filter((s) => s.start === at && s.kind === 'local');
  if (local.length < 2 || local.every((s) => typesOf(s) === typesOf(local[0]!))) return undefined;
  let around: ts.Node | undefined = nodeAt(sourceFile, at);
  let copies: ReturnType<typeof resultCopiesAt>;
  for (; around !== undefined && copies === undefined; around = around.parent) {
    if (!ts.isFunctionLike(around)) continue;
    const name =
      (around as { name?: ts.Node }).name ??
      (ts.isVariableDeclaration(around.parent) ? around.parent.name : undefined);
    if (name !== undefined) copies = resultCopiesAt(table, name.getStart(sourceFile));
  }
  if (copies === undefined) return undefined;
  return (
    `${local[0]!.mutable === false ? 'const' : 'let'} ${node.text} ` +
    `(${typesInWords(
      local.map((s) => s.type),
      struct,
    )} where "${copies.name}" is called)`
  );
}

export function importedCallLine(
  node: ts.Node,
  declared: string | undefined,
  quickInfo: string,
  defs: readonly ts.DefinitionInfo[],
  uri: string,
  analysis: CompileTsSourceResult,
  sourceFile: ts.SourceFile,
  struct: StructNames,
): string | undefined {
  if (!ts.isIdentifier(node) || defs.length === 0 || defs.some((d) => d.fileName === uri)) {
    return undefined;
  }
  const access = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
  const call = access ? node.parent.parent : node.parent;
  if (!ts.isCallExpression(call) || call.expression !== (access ? node.parent : node)) {
    return undefined;
  }
  const at = [node.getStart(sourceFile), call.expression.getStart(sourceFile)];
  const type = at.map((o) => copyCallAt(analysis.sourceFile, o)).find((t) => t !== undefined);
  if (type === undefined) return undefined;
  const result = spellShaderType(type, struct);
  const base = declared ?? quickInfo;
  const typeArgs =
    call.typeArguments === undefined
      ? ''
      : `<${call.typeArguments.map((a) => a.getText(sourceFile)).join(', ')}>`;
  if (/=> [^()]*$/.test(base)) return base.replace(/=> [^()]*$/, `=> ${result}`);
  if (!/\): [^()]*$/.test(base)) return undefined;
  const withArgs =
    typeArgs === '' || base.includes(`${node.text}<`)
      ? base
      : base.replace(new RegExp(`(^|[ .])${node.text}\\(`), `$1${node.text}${typeArgs}(`);
  return withArgs.replace(/\): [^()]*$/, `): ${result}`);
}
