// === Completions: TypeScript user symbols/keywords merged with TypeShade context items (§5) ===

import ts from 'typescript'
import { ATTRIBUTE_NAMES, WGSL_BUILTIN_NAMES } from './ambient.js'
import { ATTRIBUTE_DOCS, BUILTIN_DOCS } from './docs.js'
import { nodeAtPosition } from './positions.js'
import type { TypeshadeCompletionItem, TypeshadeCompletionKind } from './types.js'

/** The `@builtin(...)` names valid for a parameter of a function decorated with each stage.
 * `clip_distances` is a vertex OUTPUT (§50), so it has no parameter position in any of the
 * three stages and only ever appears via the unfiltered fallback (an unknown enclosing
 * stage). The subgroup pair does have one, on compute and on fragment, which is the stage
 * rule `builtin-check.ts` enforces. */
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

/** What the syntax tree says about the position a completion was requested at. */
type CompletionContext =
  | { readonly kind: 'comment' }
  | { readonly kind: 'string'; readonly literal: ts.LiteralLikeNode }
  | { readonly kind: 'code'; readonly slot: ts.Node }

/** The last node reached by following each node's last child (`forEachChild` order, which is
 * source order): the rightmost leaf of `node`. */
function rightmostLeaf(node: ts.Node): ts.Node {
  for (;;) {
    let last: ts.Node | undefined
    node.forEachChild((child) => {
      last = child
    })
    if (last === undefined) return node
    node = last
  }
}

/** Whether `text` between `start` and `end` is whitespace and comments only, read with a
 * scanner that reports trivia as tokens (the public counterpart of the compiler's internal
 * `skipTrivia`). */
function isTriviaOnly(text: string, start: number, end: number): boolean {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ false,
    ts.LanguageVariant.Standard,
    text,
    undefined,
    start,
    end - start,
  )
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind < ts.SyntaxKind.FirstTriviaToken || kind > ts.SyntaxKind.LastTriviaToken) return false
  }
  return true
}

/**
 * Whether `node` ends in a zero-width node the parser inserted for something missing at its
 * very end (the type after `let x:` or `a:` that has not been written yet), with nothing but
 * trivia between that end and `pos`. Such a node marks the slot the cursor at `pos` is filling,
 * even when the parser has already attached the tokens after the cursor to the next sibling.
 */
function endsInMissingNodeBefore(node: ts.Node, sourceFile: ts.SourceFile, pos: number): boolean {
  const end = node.getEnd()
  if (end > pos) return false
  const leaf = rightmostLeaf(node)
  if (leaf.getFullStart() !== leaf.getEnd() || leaf.getEnd() !== end) return false
  return isTriviaOnly(sourceFile.text, end, pos)
}

/**
 * The innermost node whose full span (`getFullStart()`, leading trivia included, through
 * `getEnd()`) holds `pos`, under the editor convention that a cursor touches the token before
 * it: at each level the child the cursor is strictly inside or at the end of wins; then the
 * last child with content before the cursor, when it ends in a zero-width node the parser
 * inserted for something missing (`endsInMissingNodeBefore`: the type after a `:` not yet
 * written), which marks the
 * slot the cursor is filling even when the parser has attached what follows the cursor to the
 * next sibling (`pos: |` on the line before `@location(1) uv: vec2` used to resolve to that
 * decorator's name); then the child whose leading trivia (or first character) the cursor sits
 * in; then a zero-width last child (the identifier of a `@` still being typed). Unlike
 * `nodeAtPosition`, which anchors a hover to a token, this never skips trivia, so a position
 * inside a comment resolves to the node around the comment and is then recognised as such by
 * `contextAt`.
 */
function slotAt(sourceFile: ts.SourceFile, pos: number): ts.Node {
  let node: ts.Node = sourceFile
  for (;;) {
    let inside: ts.Node | undefined
    let prev: ts.Node | undefined
    let before: ts.Node | undefined
    let last: ts.Node | undefined
    node.forEachChild((child) => {
      const fullStart = child.getFullStart()
      const start = child.getStart(sourceFile)
      const end = child.getEnd()
      if (inside === undefined && start < pos && pos <= end) inside = child
      if (start < pos && end <= pos) prev = child
      if (before === undefined && fullStart <= pos && pos <= start) before = child
      if (fullStart <= pos) last = child
    })
    const next =
      inside ??
      (prev !== undefined && endsInMissingNodeBefore(prev, sourceFile, pos) ? prev : undefined) ??
      before ??
      (last !== undefined && last.getFullStart() === last.getEnd() ? last : undefined)
    if (next === undefined) return node
    node = next
  }
}

/** Whether `pos` is inside one of the comments in the trivia that starts at `triviaStart` (the
 * end of the previous token). A cursor at the very end of a `//` comment is still inside it,
 * since that is where one types; a cursor right after a closing `*\/` is not. */
function isInCommentAt(text: string, triviaStart: number, pos: number): boolean {
  const ranges = [
    ...(ts.getLeadingCommentRanges(text, triviaStart) ?? []),
    ...(ts.getTrailingCommentRanges(text, triviaStart) ?? []),
  ]
  return ranges.some((r) => {
    if (pos <= r.pos) return false
    if (r.kind === ts.SyntaxKind.SingleLineCommentTrivia) return pos <= r.end
    const closed = text.startsWith('*/', r.end - 2)
    return closed ? pos < r.end : pos <= r.end
  })
}

/**
 * Where the trivia that holds `pos` begins within `slot`: the end of the last token of `slot`
 * that ends at or before `pos` (tokens included through `getChildren`, descending into the
 * child, a `SyntaxList` of arguments say, whose span holds the cursor), or the slot's own full
 * start when the cursor is in its leading trivia. Every comment lies in trivia, and every run
 * of trivia starts at the end of the token before it, so scanning comments from here finds the
 * one holding `pos` wherever it sits: before a statement, after the last statement of a block,
 * between two arguments, before a closing `)` or `}`, on the line of the token before it.
 */
function triviaStartAt(slot: ts.Node, sourceFile: ts.SourceFile, pos: number): number {
  let start = slot.getFullStart()
  let node = slot
  for (;;) {
    let holder: ts.Node | undefined
    for (const child of node.getChildren(sourceFile)) {
      // A JSDoc comment is exposed as a child node of its declaration, but it is trivia: the
      // scan from the token before it must see it as a comment, not as tokens to walk into.
      if (ts.isJSDoc(child)) continue
      if (child.getEnd() <= pos) start = child.getEnd()
      else if (child.getFullStart() <= pos) {
        holder = child
        break
      }
    }
    if (holder === undefined) return start
    node = holder
  }
}

/**
 * Classifies `offset` in `sourceFile` from the tree: inside a comment, inside a string,
 * template or regular expression literal (an unterminated one included, since that is what
 * `@builtin("ver` is while it is being typed), or in code at some slot. The TypeShade triggers
 * used to be regexes over the raw text before the cursor, which fired on `@ver` in a comment
 * and `"vec"` in a string alike; the comment check then only looked at the leading trivia of
 * the slot, which missed a comment after the last statement of a body, before a closing
 * bracket, or on the line of the token before it.
 */
function contextAt(sourceFile: ts.SourceFile, offset: number): CompletionContext {
  const slot = slotAt(sourceFile, offset)
  if (isInCommentAt(sourceFile.text, triviaStartAt(slot, sourceFile, offset), offset)) {
    return { kind: 'comment' }
  }
  const start = slot.getStart(sourceFile)
  if (
    (ts.isStringLiteralLike(slot) ||
      ts.isTemplateLiteralToken(slot) ||
      ts.isRegularExpressionLiteral(slot)) &&
    start < offset
  ) {
    const inside = offset < slot.getEnd() || slot.isUnterminated === true
    if (inside) return { kind: 'string', literal: slot }
  }
  return { kind: 'code', slot }
}

/** Whether `literal` is the id argument of a `builtin(...)` call: the one string position where
 * completions are offered, since `WgslBuiltinName` is a closed vocabulary. */
function isBuiltinIdLiteral(literal: ts.Node): boolean {
  const call = literal.parent
  return (
    ts.isStringLiteralLike(literal) &&
    call !== undefined &&
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === 'builtin' &&
    call.arguments[0] === literal
  )
}

/** Whether `slot` is the name of a decorator being typed: `@ver|`, a bare `@|` (the parser
 * leaves a zero-width identifier there), or the callee of a decorator factory, `@buil|(...)`. */
function isAttributeSlot(slot: ts.Node): boolean {
  if (ts.isDecorator(slot)) return true
  if (!ts.isIdentifier(slot)) return false
  const parent = slot.parent
  if (ts.isDecorator(parent) && parent.expression === slot) return true
  return ts.isCallExpression(parent) && parent.expression === slot && ts.isDecorator(parent.parent)
}

/**
 * Whether a value expression can start at `slot`: not inside a type (`let x: vec|`,
 * `f(): vec|`, `uniform<Cam|>`), a decorator, an import or export clause, or a class body's
 * member list; not a declaration's own name (`const vec|`), a property access member
 * (`a.vec|`), or a literal already there. Everything else, including the whitespace after
 * `return` or at the start of a statement, is where a `vec4(...)` snippet makes sense.
 */
function isExpressionSlot(slot: ts.Node): boolean {
  if (ts.isLiteralExpression(slot) || ts.isTemplateLiteralToken(slot)) return false
  if (ts.isClassLike(slot) || ts.isInterfaceDeclaration(slot) || ts.isTypeLiteralNode(slot))
    return false
  for (let n: ts.Node | undefined = slot; n !== undefined && !ts.isSourceFile(n); n = n.parent) {
    if (ts.isTypeNode(n) || ts.isDecorator(n)) return false
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return false
    if (ts.isTypeAliasDeclaration(n) || ts.isInterfaceDeclaration(n)) return false
  }
  if (ts.isIdentifier(slot) && slot.parent !== undefined) {
    const parent = slot.parent
    if (ts.isPropertyAccessExpression(parent) && parent.name === slot) return false
    if (ts.getNameOfDeclaration(parent as ts.Declaration) === slot) return false
  }
  return true
}

/**
 * Completions at `offset` in `uri`, decided by `contextAt` (§5): inside a comment, TypeScript's
 * own answer and nothing TypeShade-specific; inside a string literal nothing at all, except the
 * `WgslBuiltinName` list (filtered to the enclosing function's stage when known) inside
 * `@builtin("`; the attribute list when the cursor is on a decorator's name; and otherwise
 * TypeScript's user-symbol and keyword completions, with snippet-enabled entries for
 * `vec2`/`vec3`/`vec4` replacing the plain TypeScript entry of the same name only where a value
 * expression can start (`isExpressionSlot`), never in a type position or after `@`. Deduped by
 * `label`, last write wins, so a TypeShade item always wins over the TypeScript entry it
 * enriches.
 */
export function getCompletions(
  languageService: ts.LanguageService,
  sourceFile: ts.SourceFile,
  uri: string,
  offset: number,
): readonly TypeshadeCompletionItem[] {
  const context = contextAt(sourceFile, offset)

  if (context.kind === 'comment') return tsCompletions(languageService, uri, offset)

  if (context.kind === 'string') {
    if (!isBuiltinIdLiteral(context.literal)) return []
    const stage = enclosingStage(sourceFile, offset)
    const allowed = stage ? BUILTINS_BY_STAGE[stage] : WGSL_BUILTIN_NAMES
    const prefix = sourceFile.text.slice(context.literal.getStart(sourceFile) + 1, offset)
    return allowed.filter((name) => name.startsWith(prefix)).map(builtinItem)
  }

  if (isAttributeSlot(context.slot)) return ATTRIBUTE_NAMES.map(attributeItem)

  const merged = new Map<string, TypeshadeCompletionItem>()
  for (const item of tsCompletions(languageService, uri, offset)) merged.set(item.label, item)
  if (isExpressionSlot(context.slot)) {
    for (const snippet of VEC_SNIPPETS) merged.set(snippet.label, vecSnippetItem(snippet))
  }
  return [...merged.values()]
}
