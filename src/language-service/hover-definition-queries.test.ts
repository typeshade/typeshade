import { describe, expect, it, vi } from 'vitest';

const counts = vi.hoisted(() => ({ queries: 0 }));

vi.mock('typescript', async (importOriginal) => {
  const actual = await importOriginal<typeof import('typescript')>();
  const create = actual.default.createLanguageService;
  const counted: typeof create = (...args) => {
    const inner = create(...args);
    const query = inner.getDefinitionAtPosition.bind(inner);
    inner.getDefinitionAtPosition = (...rest) => {
      counts.queries++;
      return query(...rest);
    };
    return inner;
  };
  return { ...actual, default: { ...actual.default, createLanguageService: counted } };
});

const { createTypeshadeLanguageService } = await import('./service.js');

const fence = (text: string): string => `\`\`\`ts\n${text}\n\`\`\``;

const URI = '/p/a.shade.ts';
const SOURCE = `"use typeshade";
export function f(a: f32, b: f32): f32 {
  const m = max(a, b);
  return m;
}
`;

const hoverCounting = (needle: string): { queries: number; contents: string | undefined } => {
  const service = createTypeshadeLanguageService();
  service.openDocument(URI, SOURCE);
  service.getDiagnostics(URI);
  counts.queries = 0;
  const contents = service.getHover(URI, service.positionAt(URI, SOURCE.indexOf(needle)))?.contents;
  return { queries: counts.queries, contents };
};

describe('the definition queries of a hover', () => {
  it('asks none for an ambient name this file declares nothing of', () => {
    const { queries, contents } = hoverCounting('max');
    expect(queries).toBe(0);
    expect(contents).toContain('function max');
  });

  it('asks one for a name this file declares', () => {
    const { queries, contents } = hoverCounting('m = max');
    expect(queries).toBe(1);
    expect(contents).toBe(fence('const m: f32'));
  });
});
