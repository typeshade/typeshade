import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => d.message);
const FS = `@fragment export function fs(): vec4 {
  return vec4(1.)
}
`;

describe('what a mixin is not, each in one sentence', () => {
  it('a function whose body is more than one return of a class', () => {
    expect(
      errorsOf(`"use typeshade"
class Particle {
  pos: vec3
}
function Aged<TBase extends AnyClass>(Base: TBase) {
  const k: f32 = 1.
  return class extends Base {
    age: f32
  }
}
class Body extends Aged(Particle) {
  mass: f32
}
${FS}`),
    ).toEqual([
      '"Aged" is applied as a mixin by "Body", so its body has to be one "return class … ' +
        '{ … }". There is no run time here for anything else in it to happen in.',
    ]);
  });

  it('a call to a function this file does not declare', () => {
    expect(
      errorsOf(`"use typeshade"
class Particle {
  pos: vec3
}
class Body extends Nowhere(Particle) {
  mass: f32
}
${FS}`)[0],
    ).toContain('this file declares no function "Nowhere"');
  });

  it('a mixin applied to itself', () => {
    expect(
      errorsOf(`"use typeshade"
function Aged<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    age: f32
  }
}
class Body extends Aged(Aged(Aged)) {
  mass: f32
}
${FS}`)[0],
    ).toContain('Mixin "Aged" is applied to itself');
  });

  it('a base passed to a mixin that has nowhere to put it', () => {
    expect(
      errorsOf(`"use typeshade"
class Particle {
  pos: vec3
}
function Tagged() {
  return class {
    tag: u32
  }
}
class Body extends Tagged(Particle) {
  mass: f32
}
${FS}`)[0],
    ).toContain('so the base would go nowhere');
  });

  it('a mixin that extends its parameter and is given nothing', () => {
    expect(
      errorsOf(`"use typeshade"
function Aged<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    age: f32
  }
}
class Body extends Aged() {
  mass: f32
}
${FS}`)[0],
    ).toContain('so it needs the base to extend');
  });

  it('a base that is neither a name nor a call, which never reaches the mixin evaluation', () => {
    expect(
      errorsOf(`"use typeshade"
class Body extends (1 + 2) {
  mass: f32
}
${FS}`)[0],
    ).toBe(
      '"Body" extends an expression. A base has to be a declared class or interface here, or ' +
        'a mixin: a call to a function of this file whose body is one "return class … { … }".',
    );
  });
});
