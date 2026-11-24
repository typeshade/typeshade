export interface RowWords {
  readonly words: readonly string[];
  readonly tokens: readonly string[];
}

const IDENTIFIER = /[A-Za-z_$][\w$]*/g;

function camelParts(token: string): string[] {
  return token
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part !== '');
}

function wordsOfTokens(tokens: readonly string[], least: number): string[] {
  const found = new Set<string>();
  for (const token of tokens) {
    for (const part of camelParts(token)) {
      if (part.length >= least) found.add(part.toLowerCase());
    }
  }
  return [...found];
}

export function rowWords(name: string, covers: readonly string[]): RowWords {
  const sources = [name, ...covers.map((key) => key.slice(key.lastIndexOf(':') + 1))];
  const identifiers = sources.flatMap((source) => source.match(IDENTIFIER) ?? []);
  const long = wordsOfTokens(identifiers, 4);
  const words = long.length > 0 ? long : wordsOfTokens(identifiers, 3);
  const tokens: string[] = [];
  for (const identifier of identifiers) {
    for (const candidate of [identifier, ...camelParts(identifier)]) {
      if (candidate.length >= 4 && !tokens.includes(candidate)) tokens.push(candidate);
    }
  }
  return { words, tokens };
}

export const identifiersOf = (text: string): string[] => text.match(IDENTIFIER) ?? [];
