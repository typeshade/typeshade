import ts from 'typescript';
import { isBuiltinTypeLiteral } from '../compiler/ts/attribute-types.js';
import { ATTRIBUTE_NAMES, WGSL_BUILTIN_NAMES } from './ambient.js';
import type { TypeshadeCompletionItem } from './types.js';
import { enclosingStage } from './completions/builtin-stage.js';
import { tsCompletions } from './completions/typescript-entries.js';
import { VEC_SNIPPETS, attributeItem, builtinItem, vecSnippetItem } from './completions/items.js';

const BUILTINS_BY_STAGE: Readonly<Record<'vertex' | 'fragment' | 'compute', readonly string[]>> = {
  vertex: ['vertex_index', 'instance_index'],
  fragment: [
    'position',
    'front_facing',
    'sample_index',
    'sample_mask',
    'primitive_index',
    'subgroup_invocation_id',
    'subgroup_size',
  ],
  compute: [
    'local_invocation_id',
    'local_invocation_index',
    'global_invocation_id',
    'workgroup_id',
    'num_workgroups',
    'subgroup_invocation_id',
    'subgroup_size',
    'subgroup_id',
    'num_subgroups',
  ],
};

type CompletionContext =
  | { readonly kind: 'comment' }
  | { readonly kind: 'string'; readonly literal: ts.LiteralLikeNode }
  | { readonly kind: 'code'; readonly slot: ts.Node };

function rightmostLeaf(node: ts.Node): ts.Node {
  for (;;) {
    let last: ts.Node | undefined;
    node.forEachChild((child) => {
      last = child;
    });
    if (last === undefined) return node;
    node = last;
  }
}

function isTriviaOnly(text: string, start: number, end: number): boolean {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    text,
    undefined,
    start,
    end - start,
  );
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind < ts.SyntaxKind.FirstTriviaToken || kind > ts.SyntaxKind.LastTriviaToken) return false;
  }
  return true;
}

function endsInMissingNodeBefore(node: ts.Node, sourceFile: ts.SourceFile, pos: number): boolean {
  const end = node.getEnd();
  if (end > pos) return false;
  const leaf = rightmostLeaf(node);
  if (leaf.getFullStart() !== leaf.getEnd() || leaf.getEnd() !== end) return false;
  return isTriviaOnly(sourceFile.text, end, pos);
}

function slotAt(sourceFile: ts.SourceFile, pos: number): ts.Node {
  let node: ts.Node = sourceFile;
  for (;;) {
    let inside: ts.Node | undefined;
    let prev: ts.Node | undefined;
    let before: ts.Node | undefined;
    let last: ts.Node | undefined;
    node.forEachChild((child) => {
      const fullStart = child.getFullStart();
      const start = child.getStart(sourceFile);
      const end = child.getEnd();
      if (inside === undefined && start < pos && pos <= end) inside = child;
      if (start < pos && end <= pos) prev = child;
      if (before === undefined && fullStart <= pos && pos <= start) before = child;
      if (fullStart <= pos) last = child;
    });
    const next =
      inside ??
      (prev !== undefined && endsInMissingNodeBefore(prev, sourceFile, pos) ? prev : undefined) ??
      before ??
      (last !== undefined && last.getFullStart() === last.getEnd() ? last : undefined);
    if (next === undefined) return node;
    node = next;
  }
}

function isInCommentAt(text: string, triviaStart: number, pos: number): boolean {
  const ranges = [
    ...(ts.getLeadingCommentRanges(text, triviaStart) ?? []),
    ...(ts.getTrailingCommentRanges(text, triviaStart) ?? []),
  ];
  return ranges.some((r) => {
    if (pos <= r.pos) return false;
    if (r.kind === ts.SyntaxKind.SingleLineCommentTrivia) return pos <= r.end;
    const closed = text.startsWith('*/', r.end - 2);
    return closed ? pos < r.end : pos <= r.end;
  });
}

function triviaStartAt(slot: ts.Node, sourceFile: ts.SourceFile, pos: number): number {
  let start = slot.getFullStart();
  let node = slot;
  for (;;) {
    let holder: ts.Node | undefined;
    for (const child of node.getChildren(sourceFile)) {
      if (ts.isJSDoc(child)) continue;
      if (child.getEnd() <= pos) start = child.getEnd();
      else if (child.getFullStart() <= pos) {
        holder = child;
        break;
      }
    }
    if (holder === undefined) return start;
    node = holder;
  }
}

function contextAt(sourceFile: ts.SourceFile, offset: number): CompletionContext {
  const slot = slotAt(sourceFile, offset);
  if (isInCommentAt(sourceFile.text, triviaStartAt(slot, sourceFile, offset), offset)) {
    return { kind: 'comment' };
  }
  const start = slot.getStart(sourceFile);
  if (
    (ts.isStringLiteralLike(slot) ||
      ts.isTemplateLiteralToken(slot) ||
      ts.isRegularExpressionLiteral(slot)) &&
    start < offset
  ) {
    const inside = offset < slot.getEnd() || slot.isUnterminated === true;
    if (inside) return { kind: 'string', literal: slot };
  }
  return { kind: 'code', slot };
}

function isBuiltinIdLiteral(literal: ts.Node): boolean {
  if (isBuiltinTypeLiteral(literal)) return true;
  const call = literal.parent;
  return (
    ts.isStringLiteralLike(literal) &&
    call !== undefined &&
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === 'builtin' &&
    call.arguments[0] === literal
  );
}

function isAttributeSlot(slot: ts.Node): boolean {
  if (ts.isDecorator(slot)) return true;
  if (!ts.isIdentifier(slot)) return false;
  const parent = slot.parent;
  if (ts.isDecorator(parent) && parent.expression === slot) return true;
  return ts.isCallExpression(parent) && parent.expression === slot && ts.isDecorator(parent.parent);
}

function isExpressionSlot(slot: ts.Node): boolean {
  if (ts.isLiteralExpression(slot) || ts.isTemplateLiteralToken(slot)) return false;
  if (ts.isClassLike(slot) || ts.isInterfaceDeclaration(slot) || ts.isTypeLiteralNode(slot))
    return false;
  for (let n: ts.Node | undefined = slot; n !== undefined && !ts.isSourceFile(n); n = n.parent) {
    if (ts.isTypeNode(n) || ts.isDecorator(n)) return false;
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return false;
    if (ts.isTypeAliasDeclaration(n) || ts.isInterfaceDeclaration(n)) return false;
  }
  if (ts.isIdentifier(slot) && slot.parent !== undefined) {
    const parent = slot.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.name === slot) return false;
    if (ts.getNameOfDeclaration(parent as ts.Declaration) === slot) return false;
  }
  return true;
}

export function getCompletions(
  languageService: ts.LanguageService,
  sourceFile: ts.SourceFile,
  uri: string,
  offset: number,
): readonly TypeshadeCompletionItem[] {
  const context = contextAt(sourceFile, offset);

  if (context.kind === 'comment') return tsCompletions(languageService, uri, offset);

  if (context.kind === 'string') {
    if (!isBuiltinIdLiteral(context.literal)) return [];
    const stage = enclosingStage(sourceFile, offset);
    const allowed = stage ? BUILTINS_BY_STAGE[stage] : WGSL_BUILTIN_NAMES;
    const prefix = sourceFile.text.slice(context.literal.getStart(sourceFile) + 1, offset);
    return allowed.filter((name) => name.startsWith(prefix)).map(builtinItem);
  }

  if (isAttributeSlot(context.slot)) return ATTRIBUTE_NAMES.map(attributeItem);

  const merged = new Map<string, TypeshadeCompletionItem>();
  for (const item of tsCompletions(languageService, uri, offset)) merged.set(item.label, item);
  if (isExpressionSlot(context.slot)) {
    for (const snippet of VEC_SNIPPETS) merged.set(snippet.label, vecSnippetItem(snippet));
  }
  return [...merged.values()];
}
