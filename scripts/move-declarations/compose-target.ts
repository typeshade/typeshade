import type { SourceAnalysis } from './references.js';

export function composeTarget(
  analysis: SourceAnalysis,
  moved: ReadonlySet<number>,
  addExport: ReadonlySet<number>,
  header: readonly string[],
): string {
  const text = analysis.source.text;
  const bodies: string[] = [];
  analysis.units.forEach((unit, index) => {
    if (!moved.has(index)) return;
    let body = text.slice(unit.from, unit.to);
    if (addExport.has(index)) {
      const at = unit.node.getStart(analysis.source) - unit.from;
      body = `${body.slice(0, at)}export ${body.slice(at)}`;
    }
    bodies.push(bodies.length === 0 ? body.replace(/^(?:[ \t]*\n)+/, '') : body);
  });
  const head = header.length > 0 ? `${header.join('\n')}\n\n` : '';
  return `${head}${bodies.join('')}\n`;
}
