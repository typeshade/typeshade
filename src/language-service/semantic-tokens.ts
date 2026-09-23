// === Semantic tokens: TypeScript's own classifications, layered with TypeShade vocabulary (§4, §5) ===
//
// `ts.LanguageService#getEncodedSemanticClassifications` in the "2020" format already
// distinguishes a class from a property from a function from a plain variable/parameter — the
// encoded triples are `[start, length, (tokenType + 1) << 8 | modifierBits]`, decoded below
// against `ts`'s own (unexported) `TokenType`/`TokenModifier` enum order. It classifies
// identifiers and type references only, so `getEncodedSyntacticClassifications` fills in
// keywords, numbers, operators and ordinary strings. One AST pass then adds exactly the
// vocabulary neither classifier reports on its own: a decorator's own identifier (`vertex`,
// `builtin`, ...) is otherwise just a `function` reference; the WGSL id inside `@builtin("...")`
// carries no semantic classification at all, being a string literal; and which GPU-typed
// tokens, entry functions and resource bindings get the TypeShade-specific type/modifier.

import ts from 'typescript';
import type { CompileTsSourceResult } from '../compiler/ts/source-file.js';
import { WGSL_BUILTIN_NAMES } from './ambient.js';
import { TYPE_DOCS } from './docs.js';
import { stageOf } from './navigation.js';
import { offsetAt, positionAt } from './positions.js';
import type {
  TypeshadeRange,
  TypeshadeSemanticToken,
  TypeshadeSemanticTokenModifier,
  TypeshadeSemanticTokenType,
} from './types.js';

/** `ts`'s internal "2020" semantic `TokenType` enum order (`class = 0` through `member = 11`),
 * not exported by the `typescript` package, so re-declared here by index. A TypeScript upgrade
 * that reorders it fails `semantic-tokens.test.ts` (run against a real `ts.LanguageService`)
 * instead of silently mis-classifying a token. */
const SEMANTIC_TYPE_BY_TOKEN_TYPE: readonly TypeshadeSemanticTokenType[] = [
  'struct', // class
  'type', // enum
  'struct', // interface
  'type', // namespace
  'type', // typeParameter
  'type', // type
  'parameter', // parameter
  'variable', // variable
  'variable', // enumMember
  'property', // property
  'function', // function
  'property', // member
];

const TOKEN_TYPE_SHIFT = 8;
const TOKEN_MODIFIER_MASK = (1 << TOKEN_TYPE_SHIFT) - 1;

/** `ts`'s "2020" `TokenModifier` bit order (`declaration = 0` through `local = 5`); only the
 * three bits with a `TypeshadeSemanticTokenModifier` counterpart are decoded — `static`,
 * `async` and `local` have no place in this vocabulary. */
const DECLARATION_BIT = 1 << 0;
const READONLY_BIT = 1 << 3;
const DEFAULT_LIBRARY_BIT = 1 << 4;

function decodeModifiers(bits: number): TypeshadeSemanticTokenModifier[] {
  const modifiers: TypeshadeSemanticTokenModifier[] = [];
  if (bits & DECLARATION_BIT) modifiers.push('declaration');
  if (bits & READONLY_BIT) modifiers.push('readonly');
  if (bits & DEFAULT_LIBRARY_BIT) modifiers.push('defaultLibrary');
  return modifiers;
}

const SYNTACTIC_TYPE_MAP: Readonly<Partial<Record<number, TypeshadeSemanticTokenType>>> = {
  [ts.ClassificationType.keyword]: 'keyword',
  [ts.ClassificationType.numericLiteral]: 'number',
  [ts.ClassificationType.bigintLiteral]: 'number',
  [ts.ClassificationType.operator]: 'operator',
  [ts.ClassificationType.stringLiteral]: 'string',
};

interface RawToken {
  readonly start: number;
  readonly length: number;
  readonly type: TypeshadeSemanticTokenType;
  readonly modifiers: readonly TypeshadeSemanticTokenModifier[];
}

interface Overlay {
  /** Start offset of a decorator's own identifier (`vertex` in `@vertex`, `builtin` in
   * `@builtin(...)`) — overrides whatever base type TypeScript classified it as. */
  readonly decoratorStarts: ReadonlySet<number>;
  /** Start offset of an entry function's name identifier. */
  readonly entryNameStarts: ReadonlySet<number>;
  /** Ready-made `'builtin'` tokens for the id text inside each `@builtin("...")`, excluding
   * the surrounding quotes. */
  readonly builtinTokens: readonly RawToken[];
  /** Start offset of each `@builtin("...")` string literal *including* its quotes, so the
   * syntactic pass's generic `'string'` token for the same span is skipped. */
  readonly builtinStringStarts: ReadonlySet<number>;
}

/** One AST pass collecting every position the TypeShade layer overrides or adds relative to
 * TypeScript's own classifiers (see the file header). */
function collectOverlay(sourceFile: ts.SourceFile): Overlay {
  const decoratorStarts = new Set<number>();
  const entryNameStarts = new Set<number>();
  const builtinTokens: RawToken[] = [];
  const builtinStringStarts = new Set<number>();

  const visit = (node: ts.Node): void => {
    if (ts.isDecorator(node)) {
      const expr = ts.isCallExpression(node.expression)
        ? node.expression.expression
        : node.expression;
      if (ts.isIdentifier(expr)) decoratorStarts.add(expr.getStart());
      if (ts.isCallExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
        const callee = node.expression.expression;
        const arg = node.expression.arguments[0];
        if (
          callee.text === 'builtin' &&
          arg !== undefined &&
          ts.isStringLiteralLike(arg) &&
          WGSL_BUILTIN_NAMES.includes(arg.text)
        ) {
          builtinStringStarts.add(arg.getStart());
          builtinTokens.push({
            start: arg.getStart() + 1,
            length: arg.text.length,
            type: 'builtin',
            modifiers: [],
          });
        }
      }
    } else if (ts.isFunctionDeclaration(node) && node.name && stageOf(node, sourceFile)) {
      entryNameStarts.add(node.name.getStart());
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return { decoratorStarts, entryNameStarts, builtinTokens, builtinStringStarts };
}

/**
 * Semantic tokens for `sourceFile` (backed by `uri`'s entry in `languageService`), optionally
 * restricted to `range`, in document order (design doc §4, §5). GPU-typed tokens carry the
 * `gpu` modifier, an entry function's name carries `entry`, a resource binding's name (one of
 * `analysis.bindings`, from the service's one cached front-end run for this document version,
 * §8) is typed `'resource'` wherever it appears, a decorator's own identifier is typed
 * `'decorator'`, and the id inside `@builtin("...")` is typed `'builtin'` — everything else is
 * TypeScript's own syntactic/semantic classification, mapped straight across.
 */
export function getSemanticTokens(
  languageService: ts.LanguageService,
  sourceFile: ts.SourceFile,
  uri: string,
  analysis: CompileTsSourceResult,
  range?: TypeshadeRange,
): TypeshadeSemanticToken[] {
  const lo = range ? offsetAt(sourceFile, range.start) : 0;
  const hi = range ? offsetAt(sourceFile, range.end) : sourceFile.text.length;
  const span: ts.TextSpan = { start: lo, length: hi - lo };
  const overlay = collectOverlay(sourceFile);
  const bindingNames = new Set(analysis.bindings.map((b) => b.name));

  const tokens: RawToken[] = [];

  const syntactic = languageService.getEncodedSyntacticClassifications(uri, span);
  for (let i = 0; i < syntactic.spans.length; i += 3) {
    const start = syntactic.spans[i]!;
    const length = syntactic.spans[i + 1]!;
    const kind = syntactic.spans[i + 2]!;
    if (kind === ts.ClassificationType.stringLiteral && overlay.builtinStringStarts.has(start)) {
      continue; // replaced by the matching entry in overlay.builtinTokens below
    }
    const type = SYNTACTIC_TYPE_MAP[kind];
    if (type !== undefined) tokens.push({ start, length, type, modifiers: [] });
  }

  const semantic = languageService.getEncodedSemanticClassifications(
    uri,
    span,
    ts.SemanticClassificationFormat.TwentyTwenty,
  );
  for (let i = 0; i < semantic.spans.length; i += 3) {
    const start = semantic.spans[i]!;
    const length = semantic.spans[i + 1]!;
    const encoded = semantic.spans[i + 2]!;
    const tokenType = (encoded >> TOKEN_TYPE_SHIFT) - 1;
    const baseType = SEMANTIC_TYPE_BY_TOKEN_TYPE[tokenType];
    if (baseType === undefined) continue;

    if (overlay.decoratorStarts.has(start)) {
      tokens.push({ start, length, type: 'decorator', modifiers: [] });
      continue;
    }

    const modifiers = decodeModifiers(encoded & TOKEN_MODIFIER_MASK);
    const text = sourceFile.text.slice(start, start + length);
    if (baseType === 'type' && TYPE_DOCS[text] !== undefined) modifiers.push('gpu');
    if (baseType === 'function' && overlay.entryNameStarts.has(start)) modifiers.push('entry');
    const type = baseType === 'variable' && bindingNames.has(text) ? 'resource' : baseType;
    tokens.push({ start, length, type, modifiers });
  }

  for (const token of overlay.builtinTokens) {
    if (token.start >= lo && token.start + token.length <= hi) tokens.push(token);
  }

  tokens.sort((a, b) => a.start - b.start);
  return tokens.map((t) => {
    const pos = positionAt(sourceFile, t.start);
    return {
      line: pos.line,
      character: pos.character,
      length: t.length,
      type: t.type,
      modifiers: t.modifiers,
    };
  });
}
