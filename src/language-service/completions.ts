import ts from 'typescript';
import { ATTRIBUTE_NAMES, WGSL_BUILTIN_NAMES } from './ambient.js';
import type { TypeshadeCompletionItem } from './types.js';
import { enclosingStage } from './completions/builtin-stage.js';
import { tsCompletions } from './completions/typescript-entries.js';
import { VEC_SNIPPETS, attributeItem, builtinItem, vecSnippetItem } from './completions/items.js';
import { isBuiltinIdLiteral, isAttributeSlot, isExpressionSlot } from './completions/slots.js';
import { slotAt } from './completions/slot-at.js';
import { isInCommentAt, triviaStartAt } from './completions/comment-at.js';

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
