import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse, bothTake } from '../../core/testing/both-halves.js';
import { compileModule } from '../../core/oracle.js';
import { optimizeAt, type OptLevel } from '../../core/passes/opt/optimize.js';

const LEVELS: readonly OptLevel[] = ['O0', 'O1', 'O2'];
const ARGS = [-3, 7, 2.5] as const;

const program = (body: string, ret = 'f32'): string =>
  `"use typeshade";\nexport function t(ii: i32, vi: u32, f: f32): ${ret} {\n  ${body}\n}\n`;

const typeScriptValue = (source: string): number => {
  const js = ts.transpileModule(source.replace('export ', ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const helpers =
    'const f32 = Math.fround, i32 = (x) => x | 0, u32 = (x) => x >>> 0, select = (a, b, c) => (c ? b : a);\n';
  return new Function(`${helpers}${js}\nreturn t(${ARGS.join(', ')});`)() as number;
};

const valuesAt = (source: string): number[] => {
  const { result } = bothTake(source);
  return LEVELS.map((level) => {
    const cpu = compileModule(optimizeAt(result.module, level), { precision: 'f32' });
    return (cpu.fns['t'] as (...a: readonly number[]) => number)(...ARGS);
  });
};

const refused = (subject: string, at: string, type: string): string => {
  const edit = `${type}(${subject})`;
  return (
    `"${subject}" is 2147483648 on its u32 bits and -2147483648 in TypeScript, so the "${at}" ` +
    `does not say which value it means. Write "${edit}" for the ${type} value.`
  );
};

const refusedValue = (
  subject: string,
  bits: number,
  typeScript: number,
  at: string,
  type: string,
): string =>
  `"${subject}" is ${bits} on its u32 bits and ${typeScript} in TypeScript, so the "${at}" ` +
  `does not say which value it means. Write "${type}(${subject})" for the ${type} value.`;

const TREE = 'let c = 9;\n  let t = (3000000000|0);\n  ';
const SHIFT = 'c << 31';
const RETURN = `return f32(${SHIFT});`;
const COMPARE = `return ((${SHIFT}) < vi) ? 1.0 : 0.0;`;

const editedAndChecked = (source: string, from: string, to: string): void => {
  const edited = source.replace(from, to);
  const want = typeScriptValue(edited);
  expect(valuesAt(edited)).toEqual([want, want, want]);
};

describe('issue 1371: a written number joined to a u32 tree keeps its u32 bits (D2)', () => {
  it.each([
    ['a store of the number', 't = c;'],
    ['a store of the number plus zero', 't = c + 0;'],
    ['a store of the number minus one', 't = c - 1;'],
    ['a store of a conditional', 't = (vi < 3 ? c : 5);'],
    ['a store of a remainder', 't = c % 2;'],
    ['a conditional with the number first', 'let x = vi < 3 ? c : t;'],
    ['a conditional with the number last', 'let x = vi < 3 ? t : c;'],
    ['a conditional arm with a nested number', 'let x = vi < 3 ? (c + 1) : t;'],
    ['a conditional arm beside a nested tree', 'let x = vi < 3 ? c : (t + 1);'],
    ['a select with the number first', 'let x = select(c, t, vi < 3);'],
    ['a select with the tree first', 'let x = select(t, c, vi < 3);'],
    ['a select argument with a nested number', 'let x = select(c + 1, t, vi < 3);'],
    ['a nested operand on the left', 'let x = (c + 1) + t;'],
    ['a nested operand on the right', 'let x = t + (c + 1);'],
    ['a nested product', 'let x = c * 2 + t;'],
    ['a nested difference under a product', 'let x = (c - 1) * t;'],
    ['a nested remainder', 'let x = (c % 2) + t;'],
  ])('the program of the issue is refused in both halves: %s', (_, join) => {
    const source = program(`${TREE}${join} ${RETURN}`);
    bothRefuse(source, 'TS8003', refused(SHIFT, 'f32()', 'i32'));
    editedAndChecked(source, `f32(${SHIFT})`, `f32(i32(${SHIFT}))`);
  });

  it.each([
    ['a nested conditional', 'let x = (vi < 3 ? c : 1) + t;', 'cannot + i32 and u32', 'a + i32(b)'],
    ['a nested select', 'let x = select(c, 1, vi < 3) + t;', 'cannot + i32 and u32', 'a + i32(b)'],
    ['a nested bit or', 'let x = (c | 1) & t;', 'cannot bitwise i32 and u32', 'a + i32(b)'],
    ['a compound store', 't += c;', 'cannot += u32 and i32', 'a + u32(b)'],
  ])(
    'a program a type mismatch refused before is refused with both sentences: %s',
    (_, join, said, e) => {
      const source = program(`${TREE}${join} ${RETURN}`);
      const { compiler, editor } = bothHalves(source);
      expect(compiler).toEqual(editor);
      expect(compiler).toHaveLength(2);
      expect(compiler[0]).toContain(said);
      expect(compiler[0]).toContain(e);
      expect(compiler[1]).toBe(`typeshade TS8003: ${refused(SHIFT, 'f32()', 'i32')}`);
    },
  );

  it.each([
    ['a store', 't = c;'],
    ['a conditional', 'let x = vi < 3 ? c : t;'],
    ['a select', 'let x = select(c, t, vi < 3);'],
    ['a nested operand', 'let x = (c + 1) + t;'],
  ])('the comparison of the issue is refused in both halves: %s', (_, join) => {
    const source = program(`${TREE}${join} ${COMPARE}`);
    bothRefuse(source, 'TS8003', refused(SHIFT, '<', 'u32'));
    editedAndChecked(source, `(${SHIFT}) <`, `u32(${SHIFT}) <`);
  });

  it.each([
    ['a store', 'let t = 5;\n  t = c;'],
    ['a conditional', 'let t = 5;\n  let x = vi < 3 ? c : t;'],
    ['a select', 'let t = 5;\n  let x = select(c, t, vi < 3);'],
    ['a nested operand', 'let t = 5;\n  let x = (c + 1) + t;'],
    ['a compound store', 'let t = 5;\n  t += c;'],
    ['a conditional with a small literal', 'let t = 5;\n  let x = vi < 3 ? c : 7;'],
    ['a typed shift amount', 'let t = 5;\n  t <<= c;'],
  ])('a neighbour with no tree keeps its value: %s', (_, join) => {
    const source = program(`let c = 9;\n  ${join}\n  ${RETURN}`);
    expect(valuesAt(source)).toEqual([-2147483648, -2147483648, -2147483648]);
    expect(typeScriptValue(source)).toBe(-2147483648);
  });

  it('two plain numbers joined keep their values', () => {
    const source = program(
      'let c = 9;\n  let d = 4;\n  let x = (c + 1) + d;\n  d = c;\n  return f32(c << 31);',
    );
    expect(valuesAt(source)).toEqual([-2147483648, -2147483648, -2147483648]);
  });
});

describe('issue 1371: the other return positions and operand shapes of the same join', () => {
  it.each([
    ['a store', 't = c;'],
    ['a conditional', 'let x = vi < 3 ? c : t;'],
  ])('a product that overflows i32 is refused at f32(): %s', (_, join) => {
    const source = program(`${TREE}${join} return f32(c*1000000000);`);
    bothRefuse(
      source,
      'TS8003',
      refusedValue('c*1000000000', 410065408, 9000000000, 'f32()', 'i32'),
    );
    editedAndChecked(source, 'f32(c*1000000000)', 'f32(i32(c*1000000000))');
  });

  it.each([
    ['a store', 't = c;'],
    ['a conditional', 'let x = vi < 3 ? c : t;'],
  ])('a strict equality against zero is refused at ===: %s', (_, join) => {
    const source = program(`${TREE}${join} return ((${SHIFT}) === 0) ? 1.0 : 0.0;`);
    bothRefuse(source, 'TS8003', refused(SHIFT, '===', 'i32'));
    editedAndChecked(source, `((${SHIFT}) ===`, `((i32(${SHIFT})) ===`);
  });

  it.each([
    ['a store', 't = c;'],
    ['a conditional', 'let x = vi < 3 ? c : t;'],
  ])('an arithmetic shift of the shifted number is refused at >>: %s', (_, join) => {
    const source = program(`${TREE}${join} return f32((${SHIFT}) >> 1);`);
    bothRefuse(source, 'TS8003', refused(SHIFT, '>>', 'i32'));
    editedAndChecked(source, `f32((${SHIFT}) >> 1)`, `f32(i32(${SHIFT}) >> 1)`);
  });

  it.each([
    ['a bare block', '{ t = c; }'],
    ['an if', 'if (vi < 3) { t = c; }'],
    ['a for loop', 'for (let i = 0; i < 2; i++) { t = c; }'],
    ['a read after the store', 't = c; let u = t;'],
    ['a copy overwritten by the number', 'let x = t; x = c;'],
    ['a product with a nested tree', 'let x = c * (t + 1);'],
  ])('the store forms of the issue are refused in each statement shape: %s', (_, join) => {
    const source = program(`${TREE}${join} ${RETURN}`);
    bothRefuse(source, 'TS8003', refused(SHIFT, 'f32()', 'i32'));
    editedAndChecked(source, `f32(${SHIFT})`, `f32(i32(${SHIFT}))`);
  });

  it('a second store of the tree to a plain number adds the sentence after the mismatch', () => {
    const source = program(`${TREE}let o = 0; o = c; o = t; ${RETURN}`);
    const { compiler, editor } = bothHalves(source);
    expect(compiler).toEqual(editor);
    expect(compiler).toHaveLength(2);
    expect(compiler[0]).toContain('cannot assign i32 to u32');
    expect(compiler[1]).toBe(`typeshade TS8003: ${refused(SHIFT, 'f32()', 'i32')}`);
  });
});
