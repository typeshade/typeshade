import { ATTRIBUTE_DOCS, BUILTIN_DOCS } from '../docs.js';
import type { TypeshadeCompletionItem } from '../types.js';

export const VEC_SNIPPETS: readonly { readonly label: string; readonly insertText: string }[] = [
  { label: 'vec2', insertText: 'vec2(${1:x}, ${2:y})' },
  { label: 'vec3', insertText: 'vec3(${1:x}, ${2:y}, ${3:z})' },
  { label: 'vec4', insertText: 'vec4(${1:x}, ${2:y}, ${3:z}, ${4:w})' },
];

export function attributeItem(name: string): TypeshadeCompletionItem {
  return {
    label: `@${name}`,
    kind: 'attribute',
    detail: `TypeShade attribute`,
    documentation: ATTRIBUTE_DOCS[name],
  };
}

export function builtinItem(name: string): TypeshadeCompletionItem {
  return {
    label: name,
    kind: 'builtin',
    detail: 'WGSL builtin',
    documentation: BUILTIN_DOCS[name],
  };
}

export function vecSnippetItem(snippet: {
  readonly label: string;
  readonly insertText: string;
}): TypeshadeCompletionItem {
  return {
    label: snippet.label,
    kind: 'snippet',
    detail: `Construct a ${snippet.label} value`,
    insertText: snippet.insertText,
    insertTextFormat: 'snippet',
  };
}
