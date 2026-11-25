import { describe, it } from 'vitest';
import { bothRefuse } from '../core/testing/both-halves.js';

const FS = (decl: string): string => `"use typeshade"
${decl}
@fragment export function fs(uv: location<0, vec2>): vec4 {
  return vec4(1.);
}
`;

const ABSTRACT_WITH_BODY =
  '"A.f" is abstract and has a body; remove "abstract", or remove the body and let each class that extends "A" write it.';

describe('a class that extends an abstract member the compiler refused draws no TS2515', () => {
  it('is the one TS8035 for a direct subclass', () => {
    bothRefuse(
      FS('abstract class A { abstract f(): f32 { return 1.; } }\nclass B extends A {}'),
      'TS8035',
      ABSTRACT_WITH_BODY,
    );
  });

  it('is the one TS8035 for a subclass of a subclass', () => {
    bothRefuse(
      FS(
        'abstract class A { abstract f(): f32 { return 1.; } }\nclass B extends A {}\nclass C extends B {}',
      ),
      'TS8035',
      ABSTRACT_WITH_BODY,
    );
  });

  it('is the one TS8035 for a subclass of an instance of a generic class', () => {
    bothRefuse(
      FS('abstract class A<T> { abstract f(): f32 { return 1.; } }\nclass B extends A<f32> {}'),
      'TS8035',
      ABSTRACT_WITH_BODY,
    );
  });

  it('is the one TS8035 when an unrelated class stands between them in the file', () => {
    bothRefuse(
      FS(
        'abstract class A { abstract f(): f32 { return 1.; } }\nclass Z { x: f32 = 1.; }\nclass B extends A {}',
      ),
      'TS8035',
      ABSTRACT_WITH_BODY,
    );
  });

  it('is the one TS8035 when the subclass writes the member', () => {
    bothRefuse(
      FS(
        'abstract class A { abstract f(): f32 { return 1.; } }\nclass B extends A { f(): f32 { return 2.; } }',
      ),
      'TS8035',
      ABSTRACT_WITH_BODY,
    );
  });
});
