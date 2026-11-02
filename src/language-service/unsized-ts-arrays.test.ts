// Change 0114, stage S1: `T[]`, `Array<T>`, `readonly T[]` and `ReadonlyArray<T>` are the array
// `array<T>` with no size. Each row is one program read twice, by `compile()` and by the language
// service (CLAUDE.md, "A test reads both halves"): the accepted spellings give the emit, the
// reflection and the IR the CPU oracle evaluates that `array<T>` gives, and every refusal gives
// one code and one sentence in both halves.

import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { compileTsSource } from '../compiler/ts/source-file.js';
import { createTypeshadeLanguageService } from './service.js';

const editorErrors = (source: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  return service
    .getDiagnostics('a.ts')
    .filter((d) => d.severity === 'error')
    .map((d) => `${String(d.code)} ${d.message}`);
};

const compilerErrors = (source: string): string[] =>
  compile(source)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

const KERNEL = (xs: string, out: string): string => `"use typeshade"
export function scale(xs: ${xs}, out: ${out}, k: f32): u32 {
  xs.forEach((x, i) => {
    out[i] = x * k;
  });
  return xs.length;
}
`;

const BINDING = (type: string): string => `"use typeshade"
declare const xs: storage<${type}, "read_write">
@compute([64])
export function main(@builtin("global_invocation_id") gid: vec3u) {
  xs[gid.x] = xs[gid.x] + 1.
}
`;

/** The IR with the spans left out: a spelling is longer or shorter, and the nodes are the same. */
const irOf = (source: string): string => {
  const r = compileTsSource(source);
  return JSON.stringify([r.funcs, r.bindings], (k, v: unknown) =>
    k === 'span' || k === 'nameSpan' ? undefined : v,
  );
};

const emitOf = (source: string): string => {
  const r = compile(source);
  return JSON.stringify([r.wgsl, r.glsl]);
};

describe('an array with no size in TypeScript spelling is array<T> (change 0114, S1)', () => {
  describe('a storage binding', () => {
    const base = BINDING('array<f32>');
    for (const spelling of ['f32[]', 'Array<f32>']) {
      it(`${spelling} compiles in both halves with the IR and the emit of array<f32>`, () => {
        const source = BINDING(spelling);
        expect(compilerErrors(source)).toEqual([]);
        expect(editorErrors(source)).toEqual([]);
        expect(irOf(source)).toBe(irOf(base));
        expect(emitOf(source)).toBe(emitOf(base));
        expect(compile(source).wgsl).toContain('array<f32>');
      });
    }
  });

  describe("a kernel function's parameter", () => {
    const base = KERNEL('array<f32>', 'array<f32>');
    const rows: readonly (readonly [string, string])[] = [
      ['f32[] and f32[]', KERNEL('f32[]', 'f32[]')],
      ['Array<f32> and Array<f32>', KERNEL('Array<f32>', 'Array<f32>')],
      ['readonly f32[] and f32[]', KERNEL('readonly f32[]', 'f32[]')],
      ['ReadonlyArray<f32> and f32[]', KERNEL('ReadonlyArray<f32>', 'f32[]')],
    ];
    for (const [name, source] of rows) {
      it(`${name} compile in both halves with the IR and the emit of array<f32>`, () => {
        expect(compilerErrors(source)).toEqual([]);
        expect(editorErrors(source)).toEqual([]);
        expect(irOf(source)).toBe(irOf(base));
        expect(emitOf(source)).toBe(emitOf(base));
      });
    }
  });

  describe('the length is a u32 in both halves', () => {
    it('hovers as u32 on f32[] and on readonly f32[], as it does on array<f32>', () => {
      for (const t of ['array<f32>', 'f32[]', 'readonly f32[]', 'ReadonlyArray<f32>']) {
        const source = `"use typeshade"
export function n(xs: ${t}, out: f32[]): u32 {
  out[0] = xs[0]
  return xs.length
}
`;
        expect(compilerErrors(source), t).toEqual([]);
        expect(editorErrors(source), t).toEqual([]);
        const service = createTypeshadeLanguageService();
        service.openDocument('a.ts', source);
        const hover = service.getHover(
          'a.ts',
          service.positionAt('a.ts', source.indexOf('length')),
        );
        expect(hover?.contents, t).toContain('u32');
      }
    });
  });

  describe('readonly is the promise not to write', () => {
    const SENTENCE = (name: string): string =>
      `TS8005 Cannot write through "${name}" — it is declared readonly, so nothing writes through it. ` +
      `Remove "readonly" from its type to write through it.`;
    const WRITES: readonly (readonly [string, string])[] = [
      ['an element assigned', '  xs[0] = out[0]'],
      ['an element assigned by +=', '  xs[0] += out[0]'],
      ['an element incremented', '  xs[0]++'],
      ['a push', '  for (let i = 0; i < 3; i++) {\n    xs.push(1.)\n  }'],
      ['a fill', '  xs.fill(1.)'],
    ];
    for (const spelling of ['readonly f32[]', 'ReadonlyArray<f32>']) {
      for (const [what, body] of WRITES) {
        it(`${what} through ${spelling} is the same one diagnostic in both halves`, () => {
          const source = `"use typeshade"\nexport function f(xs: ${spelling}, out: f32[]) {\n${body}\n}\n`;
          expect(compilerErrors(source)).toEqual([SENTENCE('xs')]);
          expect(editorErrors(source)).toEqual([SENTENCE('xs')]);
        });
      }
    }

    it('a read of it, and a write to the other array, are accepted in both halves', () => {
      const source = KERNEL('readonly f32[]', 'f32[]');
      expect(compilerErrors(source)).toEqual([]);
      expect(editorErrors(source)).toEqual([]);
    });

    it('is kept through a type alias', () => {
      const source = `"use typeshade"\ntype Xs = readonly f32[]\nexport function f(xs: Xs, out: f32[]) {\n  xs[0] = out[0]\n}\n`;
      expect(compilerErrors(source)).toEqual([SENTENCE('xs')]);
      expect(editorErrors(source)).toEqual([SENTENCE('xs')]);
    });
  });

  describe('a readonly array reaching a place that writes is one diagnostic in both halves', () => {
    // An array with no size lives in a storage binding or a kernel function's parameter only, so
    // the compiler refuses every flow into a writable `T[]` with a sentence that names the fix.
    // TypeScript's TS2345, TS4104 and TS2542 about the same flow are that refusal's repeats.
    const ROWS: readonly (readonly [string, string, string])[] = [
      [
        'passed to a kernel function',
        'export function g(a: f32[]) {\n  a[0] = 1.\n}\nexport function f(xs: readonly f32[]) {\n  g(xs)\n}',
        'TS8099 "g" is a kernel function',
      ],
      [
        'passed to a kernel function that takes array<f32>',
        'export function g(a: array<f32>) {\n  a[0] = 1.\n}\nexport function f(xs: readonly f32[]) {\n  g(xs)\n}',
        'TS8099 "g" is a kernel function',
      ],
      [
        'passed to a local function',
        'export function f(xs: readonly f32[], out: f32[]) {\n  const g = (a: f32[]): f32 => a[0]\n  out[0] = g(xs)\n}',
        'TS8020 Parameter "a" is array<f32>',
      ],
      [
        'copied to a writable local',
        'export function f(xs: readonly f32[], out: f32[]) {\n  const a: f32[] = xs\n  out[0] = a[0]\n}',
        'TS8099 "a" would copy "xs"',
      ],
      [
        'copied by name and written',
        'export function f(xs: readonly f32[]) {\n  const a = xs\n  a[0] = 1.\n}',
        'TS8099 "a" would copy "xs"',
      ],
    ];
    for (const [what, body, starts] of ROWS) {
      it(`${what}`, () => {
        const source = `"use typeshade"\n${body}\n`;
        const compiler = compilerErrors(source);
        expect(compiler.length, compiler.join('\n')).toBe(1);
        expect(compiler[0]).toContain(starts);
        expect(editorErrors(source)).toEqual(compiler);
      });
    }
  });

  describe('storage<readonly T[]>', () => {
    const SENTENCE = (written: string): string =>
      `TS8002 "${written}" promises that nothing writes the binding, and "read_write" asks for a ` +
      `binding that is written. Write the value type without "readonly" to keep "read_write", ` +
      `or drop "read_write".`;
    for (const written of ['readonly f32[]', 'ReadonlyArray<f32>']) {
      it(`${written} with "read_write" is one TS8002 in both halves, written or not`, () => {
        for (const write of ['', 'xs[gid.x] = 1.']) {
          const source = `"use typeshade"\ndeclare const xs: storage<${written}, "read_write">\n@compute([64])\nexport function main(@builtin("global_invocation_id") gid: vec3u) {\n  ${write}\n}\n`;
          expect(compilerErrors(source), write).toEqual([SENTENCE(written)]);
          expect(editorErrors(source), write).toEqual([SENTENCE(written)]);
        }
      });
      it(`${written} read is accepted in both halves, with its length and elements`, () => {
        const source = `"use typeshade"\ndeclare const xs: storage<${written}>\ndeclare const out: storage<f32[], "read_write">\n@compute([64])\nexport function main(@builtin("global_invocation_id") gid: vec3u) {\n  out[gid.x] = xs[gid.x] + f32(xs.length)\n}\n`;
        expect(compilerErrors(source)).toEqual([]);
        expect(editorErrors(source)).toEqual([]);
      });
    }
  });

  describe('a list of lists as a kernel function parameter mirrors array<array<f32>>', () => {
    // Measured on the same source: array<array<f32>> is accepted in both halves, and the new
    // spellings give the same IR. S1 adds no refusal and removes none.
    const source = (t: string): string =>
      `"use typeshade"\nexport function f(xs: ${t}) {\n  xs[0][0] = 1.\n}\n`;
    for (const t of ['f32[][]', 'Array<f32[]>', 'Array<Array<f32>>']) {
      it(`${t}`, () => {
        const base = compilerErrors(source('array<array<f32>>'));
        expect(compilerErrors(source(t))).toEqual(base);
        expect(editorErrors(source(t))).toEqual(base);
        expect(irOf(source(t))).toBe(irOf(source('array<array<f32>>')));
      });
    }
  });

  describe('what stays refused says the same in both halves', () => {
    it('readonly array<f32> is TS8002 once, naming readonly f32[] (compiler TS8002 against editor TS1354 before)', () => {
      const source = KERNEL('readonly array<f32>', 'f32[]');
      const said =
        'TS8002 "readonly array<f32>" is not valid TypeScript: "readonly" applies to an array type ' +
        'T[] only. An array with no size that nothing writes is "readonly f32[]".';
      expect(compilerErrors(source)).toEqual([said]);
      expect(editorErrors(source)).toEqual([said]);
    });

    it('f32[] as a local keeps the refusal array<f32> has, in both halves', () => {
      const source = (t: string): string =>
        `"use typeshade"\nexport function f(xs: ${t}): f32 {\n  const a: ${t} = xs\n  return a[0]\n}\n`;
      const base = compilerErrors(source('array<f32>'));
      expect(base.length).toBe(1);
      expect(base[0]).toContain('TS8099');
      for (const t of ['f32[]', 'Array<f32>']) {
        expect(compilerErrors(source(t)), t).toEqual(base);
        expect(editorErrors(source(t)), t).toEqual(compilerErrors(source(t)));
      }
    });

    it('a list of lists has no fixed size, as array<array<f32>> has none (storage)', () => {
      const source = (t: string): string => `"use typeshade"\ndeclare const xs: storage<${t}>\n`;
      const base = compilerErrors(source('array<array<f32>>'));
      expect(base.length).toBe(1);
      for (const t of ['f32[][]', 'Array<f32[]>']) {
        expect(compilerErrors(source(t)), t).toEqual(base);
        expect(editorErrors(source(t)), t).toEqual(base);
      }
    });

    it('a result of f32[] is refused as array<f32> is, in both halves', () => {
      const source = (t: string): string =>
        `"use typeshade"\nexport function f(xs: ${t}): ${t} {\n  return xs\n}\n`;
      const base = compilerErrors(source('array<f32>'));
      expect(base.length).toBe(1);
      expect(compilerErrors(source('f32[]'))).toEqual(base);
      expect(editorErrors(source('f32[]'))).toEqual(base);
    });

    it('Array<f32, 4> is refused, naming array<T, N>, in both halves', () => {
      const source = `"use typeshade"\nexport function f(xs: Array<f32, 4>): f32 {\n  return 0.\n}\n`;
      const said = 'TS8002 Array<T> takes one type argument. A list with a size is array<T, N>.';
      expect(compilerErrors(source)).toEqual([said]);
      expect(editorErrors(source).filter((m) => m.startsWith('TS8002'))).toEqual([said]);
    });
  });
});
