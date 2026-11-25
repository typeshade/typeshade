import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse } from '../../core/testing/both-halves.js';

const USE = '"use typeshade"\n';

const inBody = (body: string): string =>
  `${USE}export function f(): f32 {
${body}
}
@fragment export function fs(): vec4 { return vec4(f()) }`;

const compilerSays = (source: string, sentences: readonly string[]): void => {
  const halves = bothHalves(source);
  const lines = sentences.map((s) => `typeshade ${s}`);
  expect(halves.compiler).toEqual(lines);
  expect(halves.editor.filter((d) => d.startsWith('typeshade '))).toEqual(lines);
};

const TRY = 'TS8013: try/catch/throw are JS exceptions. TypeShade has no exception path.';
const FOR_IN =
  "TS8013: for-in enumerates a JS object's keys, which a shader value does not have. Iterate " +
  'an array with `for (const x of xs)`, or count with `for (let i = 0; i < n; i++)`.';
const IMPORT = (specifier: string): string =>
  `A shader module is imported by an import declaration at the top of the file: import { name } from "${specifier}".`;
const STRICT = (name: string): string =>
  `"${name}" is reserved in ECMAScript's strict mode, which every "use typeshade" file is in, ` +
  'so a local of that name cannot be declared. Rename it.';

describe('eval and arguments are the only names judged by their spelling', () => {
  it.each([['eval'], ['arguments']])(
    'refuses a declaration of %s and nothing that reads it',
    (name) => {
      bothRefuse(inBody(`const ${name} = 1.; return ${name}`), 'TS8068', STRICT(name));
    },
  );

  it('reads eval, where nothing declares it, as an unknown name', () => {
    bothRefuse(inBody('const e = 1.; return e + eval'), 'TS8022', 'Unknown identifier "eval".');
  });
});

describe('a dynamic import is refused whole', () => {
  it.each([
    ['import("./x.shade.ts")', './x.shade.ts'],
    ['require("./x.shade.ts")', './x.shade.ts'],
  ])('refuses %s once, and its string says nothing more', (call, specifier) => {
    bothRefuse(inBody(`const m = ${call}; return 1.`), 'TS8072', IMPORT(specifier));
  });

  it('names a placeholder specifier for an import whose argument is not a string', () => {
    const halves = bothHalves(inBody('const m = import(x); return 1.'));
    expect(halves.compiler).toEqual([`typeshade TS8072: ${IMPORT('./file.shade.ts')}`]);
  });

  it('leaves a require with no string argument to the unknown-name sentences', () => {
    compilerSays(inBody('const m = require(x); return 1.'), [
      'TS8004: Unknown function "require". Declare it in this file, or import it from another shader module.',
      'TS8022: Unknown identifier "x".',
    ]);
  });

  it('refuses the import in the body of a generic function no call lowers', () => {
    bothRefuse(
      `${USE}export function g<T>(a: T): T { const m = import("./x.shade.ts"); return a }`,
      'TS8072',
      IMPORT('./x.shade.ts'),
    );
  });
});

describe('a name nothing declares is said once, whether or not a call lowers its body', () => {
  const unknown = 'Unknown identifier "Foo".';

  it('says it for the body of a generic function nothing calls', () => {
    bothRefuse(`${USE}export function g<T>(a: T): T { return Foo }`, 'TS8022', unknown);
  });

  it('says it once for a generic function lowered for two instances', () => {
    bothRefuse(
      `${USE}export function g<T>(a: T): T { return Foo }
@fragment export function fs(): vec4 { return vec4(g(1.), g(vec2(1.)).x, 0., 0.) }`,
      'TS8022',
      unknown,
    );
  });

  it('says a new of an unknown class for a body no call lowers', () => {
    bothRefuse(
      `${USE}export function g<T>(a: T): T { const v = new Foo(); return a }`,
      'TS8022',
      unknown,
    );
  });

  it('says an unknown type in a body once', () => {
    bothRefuse(
      inBody('const v: Foo = 1.; return 1.'),
      'TS8002',
      'Unknown type "Foo". Declare it in this file, or import it from another shader module.',
    );
  });

  it('says a callee and an assignment target each in their own words', () => {
    bothRefuse(
      inBody('return Foo(1.)'),
      'TS8004',
      'Unknown function "Foo". Declare it in this file, or import it from another shader module.',
    );
    bothRefuse(inBody('Foo = 1.; return 1.'), 'TS8022', 'Cannot assign to unknown name "Foo".');
    bothRefuse(inBody('Foo.a = 1.; return 1.'), 'TS8022', 'Cannot assign to unknown name "Foo".');
  });
});

describe('a host form is refused once, and what it holds is read only where the author wrote it', () => {
  it('says nothing about the operand of a throw, an await or a yield', () => {
    bothRefuse(inBody('throw new Foo()'), 'TS8013', TRY.slice('TS8013: '.length));
    bothRefuse(
      inBody('const x = await Foo; return 1.'),
      'TS8013',
      'await is host control flow. Shader functions are synchronous.',
    );
  });

  it('says nothing about the spans of a template string', () => {
    bothRefuse(
      inBody('const s = `a${Foo}b`; return 1.'),
      'TS8013',
      'Template strings are JS. TypeShade has no string type.',
    );
    bothRefuse(
      inBody('const s = tag`a`; return 1.'),
      'TS8013',
      'Template strings are JS. TypeShade has no string type.',
    );
  });

  it('says nothing about what a spread spreads', () => {
    bothRefuse(
      inBody('const a: array<f32, 2> = [1., 2.]; const b: array<f32, 3> = [...Foo, 3.]; return 1.'),
      'TS8013',
      '"...Foo" spreads into a list, which a shader array does not do: write the elements one by one.',
    );
  });

  it('reads the statements inside a for-in beside the for-in sentence', () => {
    compilerSays(
      inBody('let s = 0.; for (const k in { a: 1. }) { try { s += 1. } catch (e) { } } return s'),
      [FOR_IN, TRY],
    );
  });

  it('refuses a for-in alone with its own sentence', () => {
    bothRefuse(
      inBody('let s = 0.; for (const k in { a: 1. }) { s += 1. } return s'),
      'TS8013',
      FOR_IN.slice(8),
    );
  });

  it('says one sentence for a try and one for each throw inside it', () => {
    compilerSays(inBody('try { return 1. } catch (e) { throw new Error("x") }'), [TRY, TRY]);
  });
});

describe('a template names the remedy for the console, where a label is text the host keeps', () => {
  const sentence = (args: string): string =>
    'A template with a value in it builds text at run time, which a shader has no string for. ' +
    `Pass the text and the value as two arguments: console.log(${args}).`;

  it('turns text and holes into separate arguments', () => {
    bothRefuse(inBody('console.log(`label ${1.}`); return 1.'), 'TS8013', sentence('"label", 1.'));
    bothRefuse(
      inBody('console.log(`a ${1.} b ${2.}`); return 1.'),
      'TS8013',
      sentence('"a", 1., "b", 2.'),
    );
  });
});

describe('a spread is refused by what it spreads into', () => {
  it('refuses a spread argument with the runtime sentence', () => {
    bothRefuse(
      inBody('const xs: array<f32, 2> = [1., 2.]; return Math.max(...xs)'),
      'TS8013',
      'Spread is a JS runtime operation.',
    );
  });

  it('names the elements of a list spread when the lowering knows them', () => {
    bothRefuse(
      inBody('const a: array<f32, 2> = [1., 2.]; const b: array<f32, 3> = [...a, 3.]; return b[0]'),
      'TS8013',
      '"...a" spreads a list into a list, which a shader array does not do: write its elements, a[0], a[1].',
    );
  });

  it('says the sentence that fits any operand in a body no call lowers', () => {
    bothRefuse(
      `${USE}export function g<T>(a: array<T, 2>): array<T, 3> { return [...a, a[0]] }`,
      'TS8013',
      '"...a" spreads into a list, which a shader array does not do: write the elements one by one.',
    );
  });

  it('says the sentence that fits both instances where two instances name different elements', () => {
    const halves =
      bothHalves(`${USE}export function g<T>(a: array<T, 2>): array<T, 3> { return [...a, a[0]] }
@fragment export function fs(): vec4 {
  const x: array<f32, 2> = [1., 2.]
  const y: array<i32, 2> = [1, 2]
  const p = g(x)
  const q = g(y)
  return vec4(p[0])
}`);
    expect(halves.compiler).toHaveLength(1);
    expect(halves.compiler[0]).toContain('"...a" spreads a list into a list');
  });

  it('leaves a rest element of an assigned list to the assignment refusal', () => {
    bothRefuse(
      inBody(
        'let p = 0.; let q: array<f32, 1> = [0.]; const a: array<f32, 2> = [1., 2.]; [p, ...q] = a; return p',
      ),
      'TS8018',
      'A list assignment takes a name, a field or an element at each place: no rest element, no hole and no default. Write one assignment for that place.',
    );
  });
});

describe('a var is refused by its position and lowered as the let it would have been', () => {
  const VAR_BODY = '`var` is not allowed. Use `let` (mutable) or `const` (immutable).';

  it('refuses a var in a body and still reads what it holds', () => {
    bothRefuse(inBody('var x = 1.; return x'), 'TS8013', VAR_BODY);
    compilerSays(inBody('var x = Foo; return 1.'), [
      `TS8013: ${VAR_BODY}`,
      'TS8022: Unknown identifier "Foo".',
    ]);
  });

  it('refuses a var in the body of a function inside a namespace', () => {
    bothRefuse(
      `${USE}namespace N { export function g(): f32 { var x = 1.; return x } }`,
      'TS8013',
      VAR_BODY,
    );
  });

  it('gives a var at the top level, and one in a namespace, the sentence of their place', () => {
    bothRefuse(
      `${USE}var x = 1.`,
      'TS8014',
      'Top-level var is not allowed. Use `let` for a per-invocation variable or `const` for a module constant.',
    );
    const namespace =
      'A namespace holds functions, constants, classes and namespaces; a variable inside "N" has no flattened form. Declare it at the top level of the file.';
    bothRefuse(`${USE}namespace N { var x = 1. }`, 'TS8014', namespace);
    bothRefuse(`${USE}namespace N { let x = 1. }`, 'TS8014', namespace);
  });
});

describe('a statement the top level or a namespace cannot hold is refused whole', () => {
  it('refuses a top-level expression, try and for-in once, saying nothing of what they hold', () => {
    bothRefuse(
      `${USE}1 + 1`,
      'TS8014',
      'Top-level expressions are not a TypeShade program. Put work inside a function.',
    );
    const holds =
      'a shader file declares functions, classes, types, enums, namespaces, constants, module variables and resources.';
    bothRefuse(
      `${USE}try { Foo } catch (e) { }`,
      'TS8014',
      `A "try" statement at the top level runs nowhere; ${holds}`,
    );
    bothRefuse(
      `${USE}for (const k in {}) {}`,
      'TS8014',
      `A "for…in" loop at the top level runs nowhere; ${holds}`,
    );
  });

  it('refuses a top-level var and still reads what it holds, in the editor alone', () => {
    const halves = bothHalves(`${USE}var x = Foo`);
    expect(halves.compiler.filter((d) => d.includes('Foo'))).toEqual([]);
    expect(halves.editor).toContain("typescript 2304: Cannot find name 'Foo'.");
  });

  it('reads a try and a for-in in a namespace by their host sentences', () => {
    bothRefuse(`${USE}namespace N { try { } catch (e) { } }`, 'TS8013', TRY.slice(8));
    bothRefuse(`${USE}namespace N { for (const k in {}) {} }`, 'TS8013', FOR_IN.slice(8));
  });

  it('says nothing of what a refused top-level expression or namespace statement holds', () => {
    bothRefuse(
      `${USE}await Foo`,
      'TS8014',
      'Top-level expressions are not a TypeShade program. Put work inside a function.',
    );
    bothRefuse(
      `${USE}namespace N { await Foo }`,
      'TS8014',
      '"await Foo" inside "N" runs nowhere; a namespace holds functions, constants, classes and namespaces. Move it into a function.',
    );
  });

  it('says nothing of what a var in a namespace holds', () => {
    bothRefuse(
      `${USE}namespace N { var x = \`a\` }`,
      'TS8014',
      'A namespace holds functions, constants, classes and namespaces; a variable inside "N" has no flattened form. Declare it at the top level of the file.',
    );
  });
});

describe('a var in a function stops no call of it', () => {
  it('still reports a mistake made with the result of a function that holds a var', () => {
    compilerSays(
      `${USE}export function f(): f32 { var x = 1.; return x }
@fragment export function fs(): vec4 { const b: bool = f(); return vec4(1.) }`,
      [
        'TS8013: `var` is not allowed. Use `let` (mutable) or `const` (immutable).',
        'TS8003: Type mismatch: cannot let/const b bool and f32. Types must match, or cast with f32()/i32()/u32().',
      ],
    );
  });
});
