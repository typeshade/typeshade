import { describe, expect, it } from 'vitest';
import { createTypeshadeLanguageService } from './service.js';
import { ATTRIBUTE_DOCS, BUILTIN_DOCS, FUNCTION_DOCS, MATH_MEMBER_DOCS } from './docs.js';

const open = (source: string) => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.shade.ts', source);
  return service;
};

describe('hover and completion describe one name with one sentence', () => {
  it('a builtin id: the completion item and the hover carry the same sentence', () => {
    const source =
      '"use typeshade";\n@fragment\nexport function fs(@builtin("position") p: vec4): vec4 {\n  return p;\n}\n';
    const service = open(source);
    const typed = source.replace('"position"', '""');
    const completing = open(typed);
    const at = typed.indexOf('""') + 1;
    const item = completing
      .getCompletions('a.shade.ts', completing.positionAt('a.shade.ts', at))
      .find((i) => i.label === 'position');
    expect(item?.documentation).toBe(BUILTIN_DOCS.position);
    const hover = service.getHover(
      'a.shade.ts',
      service.positionAt('a.shade.ts', source.indexOf('position') + 2),
    );
    expect(hover?.contents).toBe(`\`position\` — ${BUILTIN_DOCS.position}`);
  });

  it('an attribute: the completion item and the hover carry the same sentence', () => {
    const source =
      '"use typeshade";\n@fragment\nexport function fs(): vec4 {\n  return vec4(0.);\n}\n';
    const completing = open(source.replace('@fragment', '@'));
    const at = completing.positionAt('a.shade.ts', '"use typeshade";\n@'.length);
    const item = completing.getCompletions('a.shade.ts', at).find((i) => i.label === '@fragment');
    expect(item?.documentation).toBe(ATTRIBUTE_DOCS.fragment);
    const service = open(source);
    const hover = service.getHover(
      'a.shade.ts',
      service.positionAt('a.shade.ts', source.indexOf('@fragment') + 3),
    );
    expect(hover?.contents).toBe(`\`@fragment\` — ${ATTRIBUTE_DOCS.fragment}`);
  });
});

describe('a Math member says what the member takes', () => {
  it('names no vector or vector operand, which the member does not take (Rule 9.4)', () => {
    for (const [name, doc] of Object.entries(MATH_MEMBER_DOCS)) {
      expect(doc, name).not.toMatch(/componentwise over vectors|scalar\/vector operands/);
    }
  });

  it('leaves the vector clauses in the sentence of the free function', () => {
    const scalarFree = Object.keys(MATH_MEMBER_DOCS).filter((name) =>
      /componentwise over vectors|scalar\/vector operands/.test(FUNCTION_DOCS[name] ?? ''),
    );
    expect(scalarFree.length).toBeGreaterThan(5);
    for (const name of scalarFree) {
      expect(MATH_MEMBER_DOCS[name], name).not.toBe(FUNCTION_DOCS[name]);
    }
  });
});
