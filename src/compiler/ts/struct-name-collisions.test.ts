import { describe, expect, it } from 'vitest';
import { bothHalves } from '../../core/testing/both-halves.js';

const program = (declarations: string, body = ''): string =>
  `"use typeshade"\n${declarations}\n@compute([1]) export function main(): void { ${body} }\n`;

const refuses = (source: string, lines: readonly string[]): void => {
  const halves = bothHalves(source);
  expect(halves.compiler).toEqual(lines);
  for (const line of lines) expect(halves.editor).toContain(line);
};

describe('a struct name declared twice', () => {
  const duplicate = (name: string): string =>
    `typeshade TS8023: Struct "${name}" is declared more than once. A class, an interface and a ` +
    `type alias are three spellings of one struct, not declarations that merge — TypeScript ` +
    `would merge two interfaces, and the merged layout would disagree with this one at every ` +
    `use site.`;

  it('an interface beside a class, nothing using either', () => {
    refuses(
      program(`interface S { a: f32 }
class S { b: f32 = 1.; }`),
      [duplicate('S')],
    );
  });

  it('two interfaces, nothing using either', () => {
    refuses(
      program(`interface S { a: f32 }
interface S { b: f32 }`),
      [duplicate('S')],
    );
  });

  it('two interfaces of one name that a use reaches are reported once', () => {
    const halves = bothHalves(
      program(
        `interface S { a: f32 }
interface S { b: f32 }`,
        'const s: S = { a: 1. };',
      ),
    );
    expect(halves.compiler.filter((line) => line === duplicate('S'))).toHaveLength(1);
    expect(halves.editor).toContain(duplicate('S'));
  });

  it('a type inside a namespace has no flattened form', () => {
    refuses(program(`namespace N { export interface I { x: f32 } }`, 'const i: N.I = { x: 1. };'), [
      'typeshade TS8014: A namespace holds functions, constants, classes and namespaces; a type inside "N" has no flattened form. Declare it at the top level of the file.',
    ]);
  });
});
