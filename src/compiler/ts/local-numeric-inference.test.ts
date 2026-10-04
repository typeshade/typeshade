// Verifies: Rule 5.1, Rule 5.3, Rule 5.4 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { compileTsSource } from './source-file.js';
import { compile } from './compile.js';
import { typeKey } from '../../core/ir/types.js';
import { TS_CODES } from './codes.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { localNumericInference } from './local-numeric-inference.js';

const single = `"use typeshade";
function poo(x: i32): i32 { return x + 2; }
export function run(): i32 { let objectIndex = -1; return poo(objectIndex); }`;

function localType(source: string, name: string): string | undefined {
  return compileTsSource(source)
    .symbols.filter((s) => s.kind === 'local' && s.name === name)
    .map((s) => typeKey(s.type))[0];
}

describe('integer locals constrained by declared contexts', () => {
  it('types the reported object index as i32 and evaluates integer arithmetic', () => {
    const result = compile(single);
    expect(result.diagnostics).toEqual([]);
    expect(localType(single, 'objectIndex')).toBe('i32');
    expect(result.wgsl).toContain('objectIndex: i32 = -1');
    expect(result.eval!('run')).toBe(1);
  });
  it('uses an unsigned demand', () => {
    const source = `"use typeshade"; function g(n: u32): u32 {return n;} export function run(): u32 {const n=3; return g(n);}`;
    expect(compileTsSource(source).diagnostics).toEqual([]);
    expect(localType(source, 'n')).toBe('u32');
  });
  it.each([
    ['a(n);', 'b(n);'],
    ['b(n);', 'a(n);'],
  ])('refuses conflicting demands %s %s', (first, second) => {
    const source = `"use typeshade"; function a(n:i32):void {} function b(n:f32):void {} export function run():void {let n=-1; ${first} ${second}}`;
    const result = compileTsSource(source);
    expect(
      result.diagnostics.some(
        (d) =>
          d.code === TS_CODES.TYPE_MISMATCH &&
          d.message.includes('Cannot infer "n"') &&
          d.message.includes('explicit type annotation'),
      ),
    ).toBe(true);
    expect(result.wgsl).toBeUndefined();
  });
  it('keeps unneeded defaults and float-written or nonliteral initializers unchanged', () => {
    const source = `"use typeshade"; function g(n:i32):void {} export function run():void {let plain=1; let decimal=1.; let copied=plain; g(decimal); g(copied);}`;
    expect(localType(source, 'plain')).toBe('f32');
    expect(localType(source, 'decimal')).toBe('f32');
    expect(localType(source, 'copied')).toBe('f32');
    expect(
      compileTsSource(source).diagnostics.filter((d) => d.code === TS_CODES.TYPE_MISMATCH),
    ).toHaveLength(2);
  });
  it.each(['-1', '4294967296'])('refuses values outside the unsigned target: %s', (value) => {
    const result = compileTsSource(
      `"use typeshade"; function g(n:u32):void {} export function run():void {let n=${value}; g(n);}`,
    );
    expect(result.diagnostics.some((d) => d.message.includes('outside u32'))).toBe(true);
    expect(result.wgsl).toBeUndefined();
  });
  it('honors explicit annotations', () => {
    const source = `"use typeshade"; function g(n:i32):void {} export function run():void {let n:f32=-1; g(n);}`;
    expect(localType(source, 'n')).toBe('f32');
    expect(compileTsSource(source).diagnostics.some((d) => d.code === TS_CODES.TYPE_MISMATCH)).toBe(
      true,
    );
  });
  it('honors explicit casts and a cast at the use leaves the default unchanged', () => {
    const source = `"use typeshade"; function g(n:i32):i32 {return n;} export function run():i32 {let n=-1; let cast=i32(-2); return g(i32(n)) + g(cast);}`;
    expect(compileTsSource(source).diagnostics).toEqual([]);
    expect(localType(source, 'n')).toBe('f32');
    expect(localType(source, 'cast')).toBe('i32');
  });
  it('refuses i32 and u32 demands with the same annotation remedy', () => {
    const source = `"use typeshade"; function a(n:i32):void {} function b(n:u32):void {} export function run():void {let n=1; a(n); b(n);}`;
    expect(
      compileTsSource(source).diagnostics.some((d) => d.message.includes('require i32 and u32')),
    ).toBe(true);
  });
  it('does not infer from a generic declaration', () => {
    const source = `"use typeshade"; function g<T>(n:i32):i32 {return n;} export function run():i32 {let n=1; return g<f32>(n);}`;
    expect(localType(source, 'n')).toBe('f32');
  });
  it('does not infer from an unresolved imported callee', () => {
    const source = ts.createSourceFile(
      'import.shade.ts',
      `import {g} from "./missing.shade"; function run():void {let n=1; g(n);}`,
      ts.ScriptTarget.Latest,
      true,
    );
    let inferred: ReturnType<typeof localNumericInference>;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node)) inferred = localNumericInference(node, source);
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(inferred).toBeUndefined();
  });
  it('does not choose a type from an overload signature', () => {
    const source = `"use typeshade"; function g(n:i32):i32; function g(n:f32):f32; function g(n:f32):f32 {return n;} export function run():f32 {let n=1; return g(n);}`;
    expect(localType(source, 'n')).toBe('f32');
  });
  it('does not mistake a shadowing parameter for a declared function', () => {
    const source = `"use typeshade"; function g(n:i32):i32 {return n;} export function run(g:f32):void {let n=1; g(n);}`;
    expect(localType(source, 'n')).toBe('f32');
  });
  it('refuses an initializer outside the signed target range', () => {
    const result = compileTsSource(
      `"use typeshade"; function g(n:i32):void {} export function run():void {let n=2147483648; g(n);}`,
    );
    expect(result.diagnostics.some((d) => d.message.includes('outside i32'))).toBe(true);
  });
  it('separates shadowed locals and function parameters', () => {
    const source = `"use typeshade"; function g(n:i32):void {} function h(n:f32):void {} export function run():void {let n=1; g(n); {let n=2; h(n);} }`;
    const result = compileTsSource(source);
    expect(result.diagnostics).toEqual([]);
    expect(
      result.symbols
        .filter((s) => s.kind === 'local' && s.name === 'n')
        .map((s) => typeKey(s.type)),
    ).toEqual(['i32', 'f32']);
  });
  it('includes closure calls that resolve the outer declaration', () => {
    const source = `"use typeshade"; function g(n:i32):i32 {return n;} export function run():i32 {let n=-1; function inner():i32 {return g(n);} return inner();}`;
    expect(compileTsSource(source).diagnostics).toEqual([]);
    expect(localType(source, 'n')).toBe('i32');
  });
  it('does not warn about inferred integer locals in the default deprecation window', () => {
    expect(compile(single, { deprecations: true }).diagnostics).toEqual([]);
  });
  it('agrees with language service hover and diagnostics', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('inference.shade.ts', single);
    expect(service.getDiagnostics('inference.shade.ts')).toEqual([]);
    const at = single.indexOf('objectIndex');
    expect(
      service.getHover('inference.shade.ts', service.positionAt('inference.shade.ts', at))
        ?.contents,
    ).toContain('objectIndex: i32');
  });

  it('infers the original constructor and independently typed field assignment', () => {
    const source = `"use typeshade";
class Hit { index:i32; constructor(index:i32) {this.index=index;} }
class Scene { sample():Hit {return new Hit(4);} march():Hit {let objectIndex=-1;const field=this.sample();objectIndex=field.index;return new Hit(objectIndex);} }
export function run():i32 {return new Scene().march().index;}`;
    const result = compile(source, { deprecations: true });
    expect(result.diagnostics).toEqual([]);
    expect(localType(source, 'objectIndex')).toBe('i32');
    expect(result.eval!('run')).toBe(4);
    expect(result.wgsl).toContain('objectIndex: i32 = -1');
    const service = createTypeshadeLanguageService();
    service.openDocument('constructor.shade.ts', source);
    expect(service.getDiagnostics('constructor.shade.ts')).toEqual([]);
    expect(
      service.getHover(
        'constructor.shade.ts',
        service.positionAt('constructor.shade.ts', source.indexOf('objectIndex')),
      )?.contents,
    ).toContain('objectIndex: i32');
  });

  it.each([
    [
      'new Hit(n).index',
      'class Hit {index:i32;constructor(index:i32){this.index=index;}}',
      'i32',
      -1,
    ],
    [
      'new Derived(n).index',
      'class Hit {index:i32;constructor(index:i32){this.index=index;}} class Derived extends Hit {}',
      'i32',
      -1,
    ],
    ['new Hit(n).index', 'class Hit {constructor(public index:i32){}}', 'i32', -1],
    ['hit.accept(n)', 'class Hit {accept(index:i32):i32{return index;}}', 'i32', -1],
    ['Hit.accept(n)', 'class Hit {static accept(index:u32):u32{return index;}}', 'u32', 3],
    [
      'hit.accept(n)',
      'class Base {accept(index:i32):i32{return index;}} class Hit extends Base {}',
      'i32',
      -1,
    ],
    [
      'hit.accept(n)',
      'class Base {accept(index:f32):f32{return index;}} class Hit extends Base {accept(index:i32):i32{return index;}}',
      'i32',
      -1,
    ],
    ['hit.accept(n)', 'class Hit<T> {accept(index:i32):i32{return index;}}', 'i32', -1],
  ])('infers declared member demand %s %s', (expression, declaration, type, expected) => {
    const generic = declaration.includes('Hit<T>') ? '<f32>' : '';
    const argument = declaration.includes('constructor') ? '0' : '';
    const valid = `"use typeshade";${declaration} export function run():${type} {let n=${expected};const hit=new Hit${generic}(${argument});return ${expression};}`;
    const checked = compile(valid);
    expect(checked.diagnostics).toEqual([]);
    expect(localType(valid, 'n')).toBe(type);
    expect(checked.eval!('run')).toBe(expected);
  });

  it.each([
    'let selected:i32=n;return selected;',
    'let selected:i32=0;selected=n;return selected;',
    'const hit=new Hit();n=hit.index;return i32(n);',
    'const hit:Hit=new Hit();hit.index=n;return hit.index;',
    'const alias=new Hit();let hit=alias;hit.index=n;return hit.index;',
  ])('infers explicit initialization or assignment demand: %s', (body) => {
    const source = `"use typeshade";class Hit {index:i32=4;} export function run():i32 {let n=-1;${body}}`;
    expect(compile(source).diagnostics).toEqual([]);
    expect(localType(source, 'n')).toBe('i32');
  });

  it('resolves this, super and static this methods by the enclosing member', () => {
    const source = `"use typeshade";class Base {accept(n:i32):i32{return n;}} class Hit extends Base {run():i32 {let n=-1;return this.accept(n)+super.accept(n);} static wrap(n:u32):u32{return n;} static runStatic():u32 {let u=3;return this.wrap(u);}} export function run():i32 {return new Hit().run()+i32(Hit.runStatic());}`;
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(localType(source, 'n')).toBe('i32');
    expect(localType(source, 'u')).toBe('u32');
    expect(result.eval!('run')).toBe(1);
  });

  it.each(['new Hit(n);accept(n);', 'accept(n);new Hit(n);'])(
    'refuses constructor/function conflicts independently of order: %s',
    (uses) => {
      const source = `"use typeshade";class Hit {constructor(index:i32){}} function accept(n:f32):void {} export function run():void {let n=-1;${uses}}`;
      expect(
        compileTsSource(source).diagnostics.some(
          (d) => d.message.includes('Cannot infer "n"') && d.message.includes('f32 and i32'),
        ),
      ).toBe(true);
    },
  );

  it.each(['-1', '4294967296'])(
    'retains unsigned constructor range checks for %s',
    (initializer) => {
      const source = `"use typeshade";class Hit {constructor(index:u32){}} export function run():void {let n=${initializer};new Hit(n);}`;
      expect(
        compileTsSource(source).diagnostics.some((d) => d.message.includes('outside u32')),
      ).toBe(true);
    },
  );

  it('resolves namespaced class constructors', () => {
    const source = `"use typeshade";namespace N {export class Hit {index:i32;constructor(index:i32){this.index=index;} static accept(index:i32):i32{return index;}}} export function run():i32 {let n=-1;return new N.Hit(n).index;}`;
    expect(compile(source).diagnostics).toEqual([]);
    expect(localType(source, 'n')).toBe('i32');
  });

  it('does not mistake a shadowing constructor parameter for an outer class', () => {
    const source = `"use typeshade";class Hit {constructor(index:i32){}} export function run(Hit:f32):void {let n=-1;new Hit(n);}`;
    expect(localType(source, 'n')).toBe('f32');
  });

  it('ignores unresolved generic parameters and circular receiver aliases', () => {
    const generic = `"use typeshade";class Hit<T> {accept(index:T):T{return index;}} export function run():f32 {let n=-1;const hit=new Hit<f32>();return hit.accept(n);}`;
    expect(localType(generic, 'n')).toBe('f32');
    const circular = `"use typeshade";export function run():void {let n=-1;const a=b;const b=a;a.accept(n);}`;
    expect(localType(circular, 'n')).toBe('f32');
  });

  it('keeps float-written and annotated constructor arguments concrete', () => {
    const source = `"use typeshade";class Hit {constructor(index:i32){}} export function run():void {let decimal=1.;let annotated:f32=1;const a=new Hit(decimal);const b=new Hit(annotated);}`;
    expect(localType(source, 'decimal')).toBe('f32');
    expect(localType(source, 'annotated')).toBe('f32');
    expect(
      compileTsSource(source).diagnostics.filter((d) => d.code === TS_CODES.TYPE_MISMATCH),
    ).toHaveLength(2);
  });

  it('does not infer through compound assignment or arithmetic', () => {
    const source = `"use typeshade";class Hit {index:i32=4;} export function run():void {let n=-1;const hit=new Hit();n+=hit.index;hit.index=n+1;}`;
    expect(localType(source, 'n')).toBe('f32');
  });

  it.each(['hit.accept(n);selected=n;', 'selected=n;hit.accept(n);'])(
    'refuses member/assignment conflicts: %s',
    (uses) => {
      const source = `"use typeshade";class Hit {accept(index:i32):void {}} export function run():void {let n=1;const hit=new Hit();let selected:u32=0;${uses}}`;
      expect(
        compileTsSource(source).diagnostics.some(
          (d) => d.message.includes('Cannot infer "n"') && d.message.includes('i32 and u32'),
        ),
      ).toBe(true);
    },
  );

  it('uses typed parameter properties as independently declared field demands', () => {
    const source = `"use typeshade";class Hit {constructor(public index:i32){}} export function run():i32 {let n=-1;const hit=new Hit(4);n=hit.index;return i32(n);}`;
    expect(compile(source).diagnostics).toEqual([]);
    expect(localType(source, 'n')).toBe('i32');
  });

  it('separates constructor demands on shadowed locals', () => {
    const source = `"use typeshade";class Signed {constructor(index:i32){}} class Float {constructor(index:f32){}} export function run():void {let n=-1;const signed=new Signed(n);{let n=2;const float=new Float(n);}}`;
    expect(compileTsSource(source).diagnostics).toEqual([]);
    expect(
      compileTsSource(source)
        .symbols.filter((s) => s.kind === 'local' && s.name === 'n')
        .map((s) => typeKey(s.type)),
    ).toEqual(['i32', 'f32']);
  });
});
