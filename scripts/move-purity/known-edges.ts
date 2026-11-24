export const LAYER_POLICY_PATH = 'src/layer-policy.test.ts';

const EDGE_LINE = /^\s*'([^'\n]+ -> [^'\n]+)',?\s*$/;

export function knownEdges(text: string | undefined): Set<string> {
  const edges = new Set<string>();
  for (const line of (text ?? '').split('\n')) {
    const match = EDGE_LINE.exec(line);
    if (match) edges.add(match[1]!);
  }
  return edges;
}

export function withoutKnownEdges(text: string): string {
  return text
    .split('\n')
    .filter((line) => !EDGE_LINE.test(line))
    .join('\n')
    .replace(/\[\s*\]/g, '[]');
}
