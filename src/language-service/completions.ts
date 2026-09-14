// === Completions: TypeScript user symbols/keywords merged with TypeShade context items (§5) ===

import ts from 'typescript'
import { ATTRIBUTE_NAMES, WGSL_BUILTIN_NAMES } from './ambient.js'
import { ATTRIBUTE_DOCS, BUILTIN_DOCS } from './docs.js'
import { nodeAtPosition } from './positions.js'
import type { TypeshadeCompletionItem, TypeshadeCompletionKind } from './types.js'

/** The `@builtin(...)` names valid for a parameter of a function decorated with each stage.
 * `clip_distances` and the subgroup pair have no parameter position in any of the three
 * stages, so they only ever appear via the unfiltered fallback (an unknown enclosing stage). */
const BUILTINS_BY_STAGE: Readonly<Record<'vertex' | 'fragment' | 'compute', readonly string[]>> = {
  vertex: ['vertex_index', 'instance_index'],
  fragment: ['position', 'front_facing', 'sample_index', 'sample_mask'],
  compute: [
    'local_invocation_id',
    'local_invocation_index',
    'global_invocation_id',
    'workgroup_id',
    'num_workgroups',
    'subgroup_invocation_id',
    'subgroup_size',
  ],
}

const VEC_SNIPPETS: readonly { readonly label: string; readonly insertText: string }[] = [
  { label: 'vec2', insertText: 'vec2(${1:x}, ${2:y})' },
  { label: 'vec3', insertText: 'vec3(${1:x}, ${2:y}, ${3:z})' },
  { label: 'vec4', insertText: 'vec4(${1:x}, ${2:y}, ${3:z}, ${4:w})' },
]

/** `ts.canHaveDecorators` reflects the *syntactically valid* decorator targets, and a plain
 * function declaration is not one of them — but the parser still attaches `@vertex` etc. to
 * its `modifiers` array (that mismatch is exactly why TS1206 fires; see `diagnostics.ts`), so
 * a decorator on a function or its parameters must be read straight off `modifiers` instead of
 * through the `canHaveDecorators`-gated helper. */
function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  if (ts.canHaveDecorators(node)) return ts.getDecorators(node) ?? []
  const modifiers = (node as { modifiers?: readonly ts.ModifierLike[] }).modifiers ?? []
  return modifiers.filter(ts.isDecorator)
}

/** The pipeline stage of the function declaration enclosing `offset`, mirroring the compiler's
 * own `parseStage` (`lower/function.ts`) closely enough to filter completions — `undefined`
 * when `offset` is not inside a stage-decorated function's parameter list. */
function enclosingStage(
  sourceFile: ts.SourceFile,
  offset: number,
): 'vertex' | 'fragment' | 'compute' | undefined {
  let node: ts.Node | undefined = nodeAtPosition(sourceFile, offset)
  while (node !== undefined && !ts.isParameter(node)) node = node.parent
  const fn = node?.parent
  if (fn === undefined || !ts.isFunctionDeclaration(fn)) return undefined
  for (const d of decoratorsOf(fn)) {
    const text = d.getText(sourceFile)
    if (/^@vertex\b/.test(text)) return 'vertex'
    if (/^@fragment\b/.test(text)) return 'fragment'
    if (/^@compute\b/.test(text)) return 'compute'
  }
  return undefined
}

function attributeItem(name: string): TypeshadeCompletionItem {
  return {
    label: `@${name}`,
    kind: 'attribute',
    detail: `TypeShade attribute`,
    documentation: ATTRIBUTE_DOCS[name],
  }
}

function builtinItem(name: string): TypeshadeCompletionItem {
  return {
    label: name,
    kind: 'builtin',
    detail: 'WGSL builtin',
    documentation: BUILTIN_DOCS[name],
  }
}

function vecSnippetItem(snippet: {
  readonly label: string
  readonly insertText: string
}): TypeshadeCompletionItem {
  return {
    label: snippet.label,
    kind: 'snippet',
    detail: `Construct a ${snippet.label} value`,
    insertText: snippet.insertText,
    insertTextFormat: 'snippet',
  }
}

function kindOfTsCompletion(kind: ts.ScriptElementKind): TypeshadeCompletionKind {
  const k = kind as string
  if (k === 'keyword') return 'keyword'
  if (k === 'method' || k.includes('function')) return 'function'
  if (k === 'class' || k === 'interface' || k === 'type' || k === 'alias' || k === 'enum')
    return 'type'
  if (k === 'property') return 'field'
  return 'variable'
}

function tsCompletions(
  languageService: ts.LanguageService,
  uri: string,
  offset: number,
): TypeshadeCompletionItem[] {
  const result = languageService.getCompletionsAtPosition(uri, offset, {})
  if (!result) return []
  return result.entries.map((entry) => ({
    label: entry.name,
    kind: kindOfTsCompletion(entry.kind),
    sortText: entry.sortText,
  }))
}

/**
 * Completions at `offset` in `uri`: TypeScript's own user-symbol and keyword completions,
 * merged with TypeShade context items — the attribute list after `@`, the `WgslBuiltinName`
 * list (filtered to the enclosing function's stage when known) inside `@builtin("`, and
 * snippet-enabled entries for `vec2`/`vec3`/`vec4` that replace the plain TypeScript entry of
 * the same name. Deduped by `label`, last write wins, so a TypeShade item always wins over the
 * TypeScript entry it enriches.
 */
export function getCompletions(
  languageService: ts.LanguageService,
  sourceFile: ts.SourceFile,
  uri: string,
  offset: number,
): readonly TypeshadeCompletionItem[] {
  const before = sourceFile.text.slice(0, offset)

  const builtinMatch = /@builtin\(\s*["']([^"']*)$/.exec(before)
  if (builtinMatch) {
    const stage = enclosingStage(sourceFile, offset)
    const allowed = stage ? BUILTINS_BY_STAGE[stage] : WGSL_BUILTIN_NAMES
    const prefix = builtinMatch[1]!
    return allowed.filter((name) => name.startsWith(prefix)).map(builtinItem)
  }

  if (/@[A-Za-z]*$/.test(before)) {
    return ATTRIBUTE_NAMES.map(attributeItem)
  }

  const merged = new Map<string, TypeshadeCompletionItem>()
  for (const item of tsCompletions(languageService, uri, offset)) merged.set(item.label, item)
  for (const snippet of VEC_SNIPPETS) merged.set(snippet.label, vecSnippetItem(snippet))
  return [...merged.values()]
}
