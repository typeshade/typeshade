import { linkedCompileOf, type CompileTsSourceResult } from '../../compiler/ts/source-file.js';
import type { DeclaredSymbol } from '../../compiler/ts/symbols.js';

export function linkedFieldAt(
  analysis: CompileTsSourceResult,
  fileName: string,
  start: number,
): DeclaredSymbol | undefined {
  const linked = linkedCompileOf(analysis);
  if (linked === undefined) return undefined;
  for (const symbol of linked.symbols) {
    if (symbol.kind !== 'field') continue;
    const written = linked.linked.map(symbol.start, symbol.start + symbol.length);
    if (written?.file.name === fileName && written.start === start) return symbol;
  }
  return undefined;
}
