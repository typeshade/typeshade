import ts from 'typescript';

export const VITEST_CONFIG_PATH = 'vitest.config.ts';

export const KNOWN_PATH_LISTS: readonly string[] = [
  'MOCKS',
  'FP64',
  'NO_INLINING',
  'NO_INLINING_MOCKS',
];

export function pathLists(text: string | undefined): Map<string, string[]> {
  const lists = new Map<string, string[]>();
  if (text === undefined) return lists;
  const source = ts.createSourceFile(VITEST_CONFIG_PATH, text, ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (
        !ts.isIdentifier(declaration.name) ||
        !initializer ||
        !ts.isArrayLiteralExpression(initializer)
      ) {
        continue;
      }
      const strings = initializer.elements.filter(ts.isStringLiteralLike).map((e) => e.text);
      if (strings.length > 0) lists.set(declaration.name.text, strings);
    }
  }
  return lists;
}

export function listedPaths(...texts: (string | undefined)[]): Set<string> {
  const listed = new Set<string>();
  for (const text of texts) {
    for (const paths of pathLists(text).values()) for (const path of paths) listed.add(path);
  }
  return listed;
}
