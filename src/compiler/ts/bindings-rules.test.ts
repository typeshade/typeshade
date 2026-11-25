import { describe, expect, it } from 'vitest';
import { bothHalves, bothTake } from '../../core/testing/both-halves.js';
import ts from 'typescript';
import { collectBindings } from './bindings.js';
import { compileTsSource } from './source-file.js';

const program = (body: string): string => `"use typeshade";
${body}
export function f(): f32 { return 1.; }
`;

const refusals = (body: string): { compiler: string[]; editor: string[] } => {
  const halves = bothHalves(program(body));
  return {
    compiler: halves.compiler.map((s) => s.replace(/^typeshade /, '')),
    editor: halves.editor.filter((s) => s.startsWith('typeshade ')).map((s) => s.slice(10)),
  };
};

const refused = (body: string, ...sentences: string[]): void => {
  const got = refusals(body);
  expect(got.compiler).toEqual(sentences);
  expect(got.editor).toEqual(sentences);
};

const layout = (subject: string, text: string): string => `TS8051: "${subject}" ${text}`;
const boolIn = (path: string, space: string): string =>
  layout(
    path,
    `is a bool; a ${space} struct holds numeric scalars only (WGSL's host-shareable rule). Use u32.`,
  );
const vecBoolIn = (path: string, space: string): string =>
  layout(
    path,
    `is a vec3b; a ${space} binding holds no bool, alone or in a vector (WGSL's host-shareable rule). Use vec3u.`,
  );
const twoRow = (path: string, cols: number): string =>
  layout(
    path,
    `is in a uniform: mat${cols}x2 in std140 is not supported — WGSL gives a two-row matrix a column stride of 8 and GLSL std140 rounds every column to 16, so the two targets would disagree on this field and every field after it; carry it as mat${cols}x4 (measured: both targets stride 16) or as ${cols} vec2 fields.`,
  );
const keyword = (name: string, line: string): string =>
  `TS8099: "${name}" is a storage binding, and a binding is declared const: write "${line}". ` +
  `A storage binding's access mode is its second type argument, not the declaration keyword.`;

describe('the access mode of a storage binding is its type argument, never the keyword', () => {
  it('quotes the line to write with the mode the author wrote', () => {
    refused(
      'declare let g: storage<array<f32>, "read">;',
      keyword('g', 'declare const g: storage<array<f32>, "read">'),
    );
  });

  it('names read when the type argument is omitted', () => {
    refused(
      'declare let g: storage<array<f32>>;',
      keyword('g', 'declare const g: storage<array<f32>, "read">'),
    );
  });

  it('reads the type argument before the keyword: a storage with none has one sentence', () => {
    refused('declare let g: storage;', 'TS8099: storage<T> needs a type argument.');
    refused('declare const g: storage;', 'TS8099: storage<T> needs a type argument.');
  });

  it('refuses a buffer mode that is not read or read_write, with one sentence for each word', () => {
    refused(
      'declare const g: storage<array<f32>, "write">;',
      'TS8002: storage<T, Access> Access is "read" or "read_write"; got "write". A storage BUFFER has no write-only mode; that is a storage texture\'s, texture_storage_2d<Format, "write">.',
    );
    refused(
      'declare const g: storage<array<f32>, "nope">;',
      'TS8002: storage<T, Access> Access is "read" or "read_write"; got "nope".',
    );
  });
});

describe('the retired { access } option is reported and ignored', () => {
  const gone = (line: string): string =>
    `TS8099: The { access } option is gone: a storage binding's access mode is its second type argument. Write "${line}".`;

  it('quotes the type-argument spelling with the type the author wrote', () => {
    refused(
      'const x = storage<array<f32>>({ access: "read" });',
      gone('const x = storage<array<f32>, "read">()'),
    );
  });

  it('recovers a word outside the two as read_write and keeps the other options', () => {
    refused(
      'const xs = storage<array<f32>, "read">({ group: 0, binding: 1, access: "write" });',
      gone('const xs = storage<array<f32>, "read_write">({ group: 0, binding: 1 })'),
    );
  });
});

describe('a declaration the front end drops is refused once', () => {
  it('a call form with a let keyword adds the keyword sentence to the unknown function', () => {
    refused(
      'let xs = storage<array<f32>, "read">();',
      'TS8004: Unknown function "storage". Declare it in this file, or import it from another shader module.',
      keyword('xs', 'const xs = storage<array<f32>, "read_write">()'),
    );
  });

  it('refuses an optional value in a binding', () => {
    refused(
      'declare const g: uniform<f32 | undefined>;',
      'TS8002: "f32 | undefined" holds a value and a flag saying whether it is there, which a local, a parameter, a function\'s result, a struct field or an array element may hold; a binding may not. Carry a u32 flag beside the value, "f32".',
    );
  });

  it('refuses an atomic outside storage memory and names the storage line', () => {
    refused(
      'declare const g: uniform<array<atomic<u32>, 4>>;',
      'TS8099: "g" holds an atomic<u32>, which lives in storage memory only: write "declare const g: storage<array<atomic<u32>, 4>, "read_write">".',
    );
  });

  it('refuses a handle inside an address space wrapper', () => {
    refused(
      'declare const s: uniform<sampler>;',
      'TS8099: "s" is a sampler; it is declared bare, not inside uniform<...>: write "declare const s: sampler".',
    );
  });

  it('reports a repeated name as a diagnostic and keeps the first', () => {
    const body = 'declare const a: uniform<f32>;\ndeclare const a: uniform<f32>;';
    const halves = bothHalves(program(body));
    expect(halves.compiler).toEqual(['typeshade TS8023: Duplicate resource "a".']);
    expect(halves.editor).toContain('typeshade TS8023: Duplicate resource "a".');
    expect(compileTsSource(program(body)).bindings.map((b) => b.name)).toEqual(['a']);
  });
});

describe('the host-shareable rules of a buffer binding', () => {
  it('refuses a bool alone, as a field, and a vector of bools as a field and alone', () => {
    refused('declare const b: uniform<bool>;', boolIn('b', 'uniform'));
    refused('interface P { ok: bool; }\ndeclare const b: uniform<P>;', boolIn('P.ok', 'uniform'));
    refused('declare const b: uniform<vec3b>;', vecBoolIn('b', 'uniform'));
    refused(
      'interface P { v: vec3b; }\ndeclare const b: storage<array<P>, "read">;',
      vecBoolIn('P.v', 'storage'),
    );
  });

  it('refuses a runtime array that is not the last field, in a nested struct too', () => {
    const notLast = (name: string): string =>
      layout(
        `${name}.a`,
        `is a list of no fixed length and is not the last field of "${name}": nothing after it has an offset. Move it last, or give it a length.`,
      );
    refused(
      'interface P { a: array<f32>; n: u32; }\ndeclare const b: storage<P, "read">;',
      notLast('P'),
    );
    refused(
      'interface Q { a: array<f32>; n: u32; }\ninterface P { q: Q; }\ndeclare const b: storage<array<P>, "read">;',
      notLast('Q'),
    );
  });

  it('refuses a runtime array in a uniform, alone and as a field', () => {
    const unsized = (path: string, name: string): string =>
      layout(
        path,
        `is a list of no fixed length, which a uniform cannot hold: a uniform buffer has one size. Give it a length, array<T, N>, or declare "${name}" as storage<T>.`,
      );
    refused('declare const b: uniform<array<f32>>;', unsized('b', 'b'));
    refused('interface P { a: array<f32>; }\ndeclare const b: uniform<P>;', unsized('P.a', 'b'));
  });

  it('refuses a two-row matrix in a uniform, alone, in a struct and in an array of structs', () => {
    refused('declare const b: uniform<mat3x2<f32>>;', twoRow('b', 3));
    refused(
      'interface A { m: mat2x2<f32>; }\ndeclare const b: uniform<array<A, 2>>;',
      twoRow('A.m', 2),
    );
  });

  it('takes a two-row matrix in storage and a three-row matrix in a uniform', () => {
    bothTake(program('declare const b: storage<array<mat2x2<f32>>, "read">;'));
    bothTake(program('declare const b: uniform<mat3x3<f32>>;'));
  });

  it('walks a struct that two fields name once', () => {
    refused(
      'interface Q { ok: bool; }\ninterface P { a: Q; b: Q; }\ndeclare const b: uniform<P>;',
      boolIn('Q.ok', 'uniform'),
    );
  });

  it('refuses an array of arrays of no fixed length', () => {
    refused(
      'declare const b: storage<array<array<u32>>>;',
      'TS8002: "array<array<u32>>" is a list of lists of no fixed length, and an array\'s element has a fixed size (WGSL). Hold the rows flat: the values in one array<u32> and each row\'s first index in an array<u32> of offsets, read as "values[offsets[r] + k]".',
    );
  });
});

describe('what takes a bind slot', () => {
  it('an override and a nominal brand key take none', () => {
    const source = program(`declare const t: uniform<f32>;
declare const o: override<f32>;
declare const brand: unique symbol;
declare const s: storage<array<f32>, "read">;`);
    bothTake(source);
    expect(compileTsSource(source).bindings.map((b) => [b.name, b.binding])).toEqual([
      ['t', 0],
      ['s', 1],
    ]);
  });

  it('a call form takes the slot after the one before it', () => {
    const source = program(`const a = uniform<f32>();
declare const b: uniform<f32>;
declare const c: storage<array<f32>, "read">;`);
    bothTake(source);
    expect(compileTsSource(source).bindings.map((b) => [b.name, b.binding])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
  });
});

describe('the number of a binding', () => {
  const collect = (source: string, first: number): [string, number][] => {
    const sf = ts.createSourceFile('t.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    return collectBindings(sf, [] as never, undefined, first).map((b) => [b.name, b.binding]);
  };

  it('starts at the slot the file is given', () => {
    expect(collect(`declare const a: uniform<f32>;\ndeclare const b: uniform<f32>;`, 4)).toEqual([
      ['a', 4],
      ['b', 5],
    ]);
  });

  it('goes on after the highest explicit slot', () => {
    expect(collect(`const a = uniform<f32>(0, 6);\ndeclare const b: uniform<f32>;`, 0)).toEqual([
      ['a', 6],
      ['b', 7],
    ]);
  });
});

describe('a texture and a sampler are handles in the uniform space', () => {
  it('takes the uniform space and a slot, bare', () => {
    const source = program(`declare const smp: sampler;
declare const tex: texture_2d<f32>;
declare const k: uniform<f32>;`);
    bothTake(source);
    expect(compileTsSource(source).bindings.map((b) => [b.name, b.space, b.binding])).toEqual([
      ['smp', 'uniform', 0],
      ['tex', 'uniform', 1],
      ['k', 'uniform', 2],
    ]);
  });

  it('is declared const, not let', () => {
    const got = refusals('declare let smp: sampler;');
    expect(got.compiler[0]).toContain('"smp" is a sampler; declare it const, not let.');
    expect(got.editor[0]).toContain('"smp" is a sampler; declare it const, not let.');
  });
});

describe('the retired { access } option on a uniform', () => {
  it('says a uniform has no access mode and quotes the one-argument line', () => {
    refused(
      'const x = uniform<f32>({ group: 0, access: "read" });',
      'TS8099: The { access } option is gone, and a uniform buffer is read-only: it has no access mode to ask for. Write "const x = uniform<f32>({ group: 0 })".',
    );
  });

  it('keeps a valid word and falls back to read_write for a word that is no string', () => {
    refused(
      'const a = storage<array<f32>>({ access: "read" });\nconst b = storage<array<f32>>({ access: 1 });',
      'TS8099: The { access } option is gone: a storage binding\'s access mode is its second type argument. Write "const a = storage<array<f32>, "read">()".',
      'TS8099: The { access } option is gone: a storage binding\'s access mode is its second type argument. Write "const b = storage<array<f32>, "read_write">()".',
    );
  });
});
