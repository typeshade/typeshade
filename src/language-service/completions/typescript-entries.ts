import type ts from 'typescript';
import type { TypeshadeCompletionItem, TypeshadeCompletionKind } from '../types.js';
import { completesVectorMembers } from './vector-members.js';

function kindOfTsCompletion(kind: ts.ScriptElementKind): TypeshadeCompletionKind {
  const k = kind as string;
  if (k === 'keyword') return 'keyword';
  if (k === 'method' || k.includes('function')) return 'function';
  if (k === 'class' || k === 'interface' || k === 'type' || k === 'alias' || k === 'enum')
    return 'type';
  if (k === 'property') return 'field';
  return 'variable';
}

const LISTED_SWIZZLES: ReadonlySet<string> = new Set([
  'x',
  'y',
  'z',
  'w',
  'r',
  'g',
  'b',
  'a',
  'xy',
  'xyz',
  'xyzw',
  'rg',
  'rgb',
  'rgba',
]);
const SWIZZLE = /^(?:[xyzw]{1,4}|[rgba]{1,4})$/;

export function tsCompletions(
  languageService: ts.LanguageService,
  uri: string,
  offset: number,
): TypeshadeCompletionItem[] {
  const result = languageService.getCompletionsAtPosition(uri, offset, {});
  if (!result) return [];
  const vector = result.isMemberCompletion && completesVectorMembers(languageService, uri, offset);
  return result.entries
    .filter((entry) => !vector || !SWIZZLE.test(entry.name) || LISTED_SWIZZLES.has(entry.name))
    .map((entry) => ({
      label: entry.name,
      kind: kindOfTsCompletion(entry.kind),
      sortText: entry.sortText,
    }));
}
