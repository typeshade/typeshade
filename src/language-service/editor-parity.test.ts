// What the compiler accepts, the editor accepts, and what TypeScript would suggest for a
// misspelled name, the compiler suggests too (Rule 12.7). Both are measured over generated
// programs rather than a sample, so a name or a swizzle added later is covered by being one.
import { describe, expect, it } from 'vitest';
import { checkDocuments } from './check.js';
import { createTypeshadeLanguageService, createTypeshadeLanguageServiceWith } from './service.js';
import { analyzeSourceFile } from './service.js';
import type { TypeshadeDiagnostic } from './types.js';

const errorsIn = (text: string): string[] =>
  checkDocuments([{ path: 'p.shade.ts', uri: '/p/p.shade.ts', text }])
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => `${d.line}:${d.column} ${d.source} ${d.code} ${d.message}`);

/** Every swizzle of a vector of `n` components, one to four picks of one family. */
function swizzles(n: 2 | 3 | 4): { readonly name: string; readonly length: number }[] {
  const out: { name: string; length: number }[] = [];
  for (const family of ['xyzw', 'rgba']) {
    const letters = [...family.slice(0, n)];
    let picks = [''];
    for (let k = 1; k <= 4; k++) {
      picks = picks.flatMap((p) => letters.map((c) => p + c));
      for (const p of picks) out.push({ name: p, length: k });
    }
  }
  return out;
}

describe('every swizzle and index the compiler takes draws no error in the editor', () => {
  // `vecN` of each element, the type a pick of `k` components has, and a local of that type is
  // assigned each pick: a false positive on the member, or a wrong type for it, fails the line.
  const ELEMENTS: Readonly<Record<string, (k: number) => string>> = {
    f32: (k) => (k === 1 ? 'f32' : `vec${k}`),
    i32: (k) => (k === 1 ? 'i32' : `vec${k}i`),
    u32: (k) => (k === 1 ? 'u32' : `vec${k}u`),
    bool: (k) => (k === 1 ? 'bool' : `vec${k}b`),
    f64: (k) => (k === 1 ? 'f64' : `vec${k}f64`),
  };
  for (const typeOf of Object.values(ELEMENTS)) {
    for (const n of [2, 3, 4] as const) {
      const vector = typeOf(n);
      it(`${vector}: every swizzle, typed by its length`, () => {
        const lines = swizzles(n).map(
          ({ name, length }, i) => `  const s${i}: ${typeOf(length)} = v.${name};`,
        );
        const text = `"use typeshade";\nexport function f(v: ${vector}): void {\n${lines.join('\n')}\n}\n`;
        expect(errorsIn(text)).toEqual([]);
      });
    }
  }

  it('a native vector indexed by a constant and by a value, read and written', () => {
    const text =
      '"use typeshade";\nexport function f(a: vec3, i: i32, u: u32): f32 {\n' +
      '  let v = a;\n  v[1] = 2.;\n  v[i] = v[u];\n  return v[0] + v[i];\n}\n';
    expect(errorsIn(text)).toEqual([]);
  });
});

describe('a misspelled name gets every suggestion TypeScript would give, from the compiler', () => {
  // One service for each view, the document updated in place, as an editor keeps one open.
  const URI = '/p/p.shade.ts';
  const unmerged = createTypeshadeLanguageServiceWith({}, analyzeSourceFile, { merge: false });
  const service = createTypeshadeLanguageService();
  let version = 0;
  /** TypeScript's own view, unmerged, and the list the editor shows, for one text. */
  const views = (
    text: string,
  ): {
    readonly typescript: readonly TypeshadeDiagnostic[];
    readonly shown: readonly TypeshadeDiagnostic[];
  } => {
    version++;
    if (version === 1) {
      unmerged.openDocument(URI, text);
      service.openDocument(URI, text);
    } else {
      unmerged.updateDocument(URI, text, version);
      service.updateDocument(URI, text, version);
    }
    return {
      typescript: unmerged.getDiagnostics(URI).filter((d) => d.source === 'typescript'),
      shown: service.getDiagnostics(URI),
    };
  };

  /** A program that writes each kind of name, correctly; the sweep breaks one use at a time. */
  const PROGRAM = `"use typeshade";
class Frame {
  time: f32;
  scale: f32;
}
declare const frame: uniform<Frame>;
const GAMMA = 2.2;
function shade(albedo: vec3, light: f32): vec3 {
  return albedo * light;
}
@fragment
export function fs(@location(0) normal: vec3): vec4 {
  const brightness = clamp(frame.time * frame.scale, 0., 1.);
  const tone = pow(shade(normalize(normal), brightness), vec3(1. / GAMMA));
  return vec4(tone, 1.);
}
`;
  /** Each name the program writes, at each place it writes it. */
  const NAMES = [
    'clamp',
    'normalize',
    'shade',
    'brightness',
    'GAMMA',
    'albedo',
    'light',
    'Frame',
    'normal',
  ];
  /** The misspellings a hand or a model makes of `name`: two letters swapped, one dropped, one
   *  doubled, the case of the first changed. */
  const misspellings = (name: string): string[] => {
    const out = new Set<string>();
    for (let i = 0; i + 1 < name.length; i++) {
      out.add(name.slice(0, i) + name[i + 1] + name[i] + name.slice(i + 2));
    }
    for (let i = 0; i < name.length; i++) {
      out.add(name.slice(0, i) + name.slice(i + 1));
      out.add(name.slice(0, i) + name[i] + name.slice(i));
    }
    const first = name[0]!;
    out.add(
      (first === first.toLowerCase() ? first.toUpperCase() : first.toLowerCase()) + name.slice(1),
    );
    out.delete(name);
    return [...out].filter((m) => m.length >= 2 && !NAMES.includes(m));
  };
  const SUGGESTED = /Did you mean '([^']+)'\?/;

  // Measured against the name the typo was made of, not against TypeScript's guess: where the two
  // differ, the compiler's is the one that fits the place. `normailze(normal)` is "Did you mean
  // 'normal'?" to TypeScript, whose first scope with a match is the parameters, and a vec3 is
  // not a function; the compiler's candidates for a callee are the functions, so it answers
  // `normalize`. So a suggestion is lost when TypeScript names the original and the editor does
  // not, or when TypeScript names anything and the editor names nothing.
  it('names the misspelled name wherever TypeScript does, in the one sentence shown', () => {
    const lost: string[] = [];
    let measured = 0;
    for (const name of NAMES) {
      const uses = PROGRAM.split(new RegExp(`\\b${name}\\b`)).length - 1;
      for (let use = 0; use < uses; use++) {
        for (const typo of misspellings(name)) {
          let seen = -1;
          const text = PROGRAM.replace(new RegExp(`\\b${name}\\b`, 'g'), (m) =>
            ++seen === use ? typo : m,
          );
          const { typescript, shown: list } = views(text);
          for (const d of typescript) {
            const hint = SUGGESTED.exec(d.message)?.[1];
            if (hint === undefined) continue;
            measured++;
            const shown = list.filter((m) => m.span.start === d.span.start);
            const named = shown.flatMap(
              (m) => /Did you mean "([^"]+)"\?/.exec(m.message)?.[1] ?? [],
            );
            if (
              shown.length !== 1 ||
              named.length === 0 ||
              (hint === name && !named.includes(name))
            ) {
              lost.push(
                `${typo} (for ${name}): TypeScript '${hint}', shown ${JSON.stringify(shown.map((m) => m.message))}`,
              );
            }
          }
        }
      }
    }
    // The sweep measures something: TypeScript suggests a name for most of these typos.
    expect(measured).toBeGreaterThan(100);
    expect(lost).toEqual([]);
  });
});
