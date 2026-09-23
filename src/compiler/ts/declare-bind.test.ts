import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { STORAGE_BUFFER_ACCESS } from './bindings.js';
import { compile, reflect } from '../../index.js';
import { compileModule } from '../../core/oracle.js';

describe('declare uniform / storage', () => {
  it('binds declare const camera: uniform<f32>', () => {
    const r = compileTsSource(`
      "use typeshade";
      declare const camera: uniform<f32>;
      export function f(x: f32): f32 {
        return x * camera;
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.bindings).toHaveLength(1);
    expect(r.bindings[0]).toMatchObject({ name: 'camera', space: 'uniform', binding: 0 });
    expect(r.wgsl).toMatch(/var<uniform>/);
  });

  it('collects storage<T, "read_write"> as read_write', () => {
    const r = compileTsSource(`
      "use typeshade";
      declare const pixels: storage<f32, "read_write">;
      export function f(): f32 { return 0.; }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.bindings[0]).toMatchObject({ name: 'pixels', space: 'storage', access: 'read_write' });
  });

  it("collects storage<T> as read, which is WGSL's own default for the address space", () => {
    const r = compileTsSource(`
      "use typeshade";
      declare const src: storage<f32>;
      export function f(): f32 { return src; }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.bindings[0]).toMatchObject({ access: 'read' });
  });

  it('rejects writing a declare const uniform', () => {
    const r = compileTsSource(`
      "use typeshade";
      declare const camera: uniform<f32>;
      export function f(): void { camera = 1.; }
    `);
    expect(r.diagnostics.some((d) => /read-only/.test(d.message))).toBe(true);
  });

  // ═══ The access mode is the second type argument, and the keyword is refused ═══
  //
  // Design rule 6.1: a resource is declared `const`. Design rule 6.2: a storage binding's
  // access mode is its second type argument. The keyword used to carry the mode, which was
  // never something a reader could rely on, because a TypeScript `const` array forbids
  // rebinding the name and permits `arr[0] = 1`.
  //
  // EVERY REFUSAL HERE REPORTS AND RECOVERS. Measured: dropping the binding instead makes
  // every use of the name a second, louder diagnostic (`TS8022 Unknown identifier "gain"`),
  // so the one sentence the author has to read is buried. The arms below therefore assert the
  // diagnostic AND that the binding was still collected.
  describe('the keyword is refused, and the binding is recovered', () => {
    it('refuses declare let on a storage binding and recovers it as read_write', () => {
      const r = compileTsSource(`
        "use typeshade";
        declare let counts: storage<array<u32>>;
        @compute([64, 1, 1])
        export function k(@builtin("global_invocation_id") gid: vec3u): void {
          counts[gid.x] = 1;
        }
      `);
      expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
        'TS8099 "counts" is a storage binding, and a binding is declared const: write ' +
          '"declare const counts: storage<array<u32>, \"read_write\">". A storage binding\'s ' +
          'access mode is its second type argument, not the declaration keyword.',
      ]);
      // Recovered as read_write, since a `let` author wanted to write: exactly one sentence,
      // and the write below it is not a second one.
      expect(r.bindings[0]).toMatchObject({
        name: 'counts',
        space: 'storage',
        access: 'read_write',
      });
    });

    it('refuses declare let on a uniform binding and recovers it as a uniform', () => {
      // Appendix B's recorded hole: measured on main this program produced ZERO diagnostics
      // and emitted `var<uniform> gain: f32;`.
      const r = compileTsSource(`
        "use typeshade";
        declare let gain: uniform<f32>;
        export function f(x: f32): f32 { return x * gain; }
      `);
      expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
        'TS8099 "gain" is a uniform binding, and a binding is declared const: write ' +
          '"declare const gain: uniform<f32>". A uniform buffer is read-only, so there is no ' +
          'writable form of it to ask for.',
      ]);
      expect(r.bindings[0]).toMatchObject({ name: 'gain', space: 'uniform', access: undefined });
    });
  });

  it('keeps the access word the declaration asked for, and names it back', () => {
    // The word was discarded on this path (`isConst ? readStorageAccess(...) : 'read_write'`),
    // so a `let` that explicitly asked for `"read"` was told to write `"read_write"` — the
    // opposite mode — and was recovered as writable.
    const r = compileTsSource(`
        "use typeshade";
        declare let counts: storage<array<u32>, "read">;
        export function f(): u32 { return counts[0]; }
      `);
    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      'TS8099 "counts" is a storage binding, and a binding is declared const: write ' +
        '"declare const counts: storage<array<u32>, \"read\">". A storage binding\'s ' +
        'access mode is its second type argument, not the declaration keyword.',
    ]);
    expect(r.bindings[0]).toMatchObject({ name: 'counts', access: 'read' });
  });

  it('checks the word on a let declaration too', () => {
    // Measured before: this program got no TS8002 at all from the compiler, only the
    // editor's TS2344, because the word was never read on the `let` path.
    const r = compileTsSource(`
        "use typeshade";
        declare let counts: storage<array<u32>, "nope">;
        export function f(): u32 { return counts[0]; }
      `);
    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toContain(
      'TS8002 storage<T, Access> Access is "read" or "read_write"; got "nope".',
    );
  });

  it('reports the missing type argument alone, without quoting a T nobody wrote', () => {
    // The keyword check used to run first and quote `storage<T, "read_write">`, a type the
    // author never wrote, beside the sentence that says the type argument is missing.
    const r = compileTsSource(`
        "use typeshade";
        declare let s: storage;
        export function f(): f32 { return 0.; }
      `);
    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      'TS8099 storage<T> needs a type argument.',
    ]);
  });

  describe('the access word, and what is not one', () => {
    it('refuses an access word outside the two and recovers as read_write', () => {
      const r = compileTsSource(`
        "use typeshade";
        declare const dst: storage<array<f32>, "write">;
        @compute([64, 1, 1])
        export function k(@builtin("global_invocation_id") gid: vec3u): void {
          dst[gid.x] = 1.;
        }
      `);
      expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
        'TS8002 storage<T, Access> Access is "read" or "read_write"; got "write". A storage ' +
          "BUFFER has no write-only mode; that is a storage texture's, " +
          'texture_storage_2d<Format, "write">.',
      ]);
      // read_write, not read: measured, recovering as `read` makes the author's own write a
      // second TS8005 on the same program.
      expect(r.bindings[0]).toMatchObject({ name: 'dst', access: 'read_write' });
    });

    it('answers a word that is not "write" without the storage-texture sentence', () => {
      // The second sentence answers ONE mistake, asking a buffer for the write-only mode, and
      // was printed for every other one too — including a non-literal argument, which has
      // nothing to do with `"write"`.
      const r = compileTsSource(`
        "use typeshade";
        declare const dst: storage<array<f32>, "nope">;
        export function f(): f32 { return dst[0]; }
      `);
      expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
        'TS8002 storage<T, Access> Access is "read" or "read_write"; got "nope".',
      ]);
    });

    // THE ONE LIST. `STORAGE_BUFFER_ACCESS` is what `ambient.ts` generates the library's
    // `StorageBufferAccess` union from, and the parser now narrows through the same array
    // rather than through two words written out again. This walks the array itself, so a word
    // added to it has to be a word a declaration collects — and `ambient.test.ts` walks the
    // same array against the editor.
    it('collects every word in STORAGE_BUFFER_ACCESS, and nothing else', () => {
      for (const word of STORAGE_BUFFER_ACCESS) {
        const r = compileTsSource(`
          "use typeshade";
          declare const dst: storage<array<f32>, "${word}">;
          export function f(): f32 { return dst[0]; }
        `);
        expect(
          r.diagnostics.filter((d) => d.category === 'error'),
          word,
        ).toEqual([]);
        expect(r.bindings[0]).toMatchObject({ name: 'dst', access: word });
      }
      const outside = compileTsSource(`
        "use typeshade";
        declare const dst: storage<array<f32>, "write_only">;
        export function f(): f32 { return dst[0]; }
      `);
      expect(outside.diagnostics.map((d) => d.code)).toEqual(['TS8002']);
    });

    it('refuses a second type argument on a uniform', () => {
      const r = compileTsSource(`
        "use typeshade";
        interface Camera { pos: vec4 }
        declare const cam: uniform<Camera, "read">;
        export function f(): vec4 { return cam.pos; }
      `);
      expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
        'TS8002 uniform<T> takes one type argument. A uniform buffer is read-only, so it has ' +
          'no access mode to write.',
      ]);
      expect(r.bindings[0]).toMatchObject({ name: 'cam', space: 'uniform', access: undefined });
    });
  });

  // A write to a read binding is still TS8005, and the sentence now names the declaration that
  // would permit it. The first clause and its em dash are origin/main's, verbatim.
  it('names the storage<T, "read_write"> remedy on a write to a read binding', () => {
    const r = compileTsSource(`
      "use typeshade";
      declare const src: storage<array<f32>>;
      @compute([64, 1, 1])
      export function k(@builtin("global_invocation_id") gid: vec3u): void {
        src[gid.x] = 1.;
      }
    `);
    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      'TS8005 Cannot assign to "src" — it is a read-only resource. Write "declare const src: ' +
        'storage<array<f32>, \"read_write\">" to write to it.',
    ]);
  });

  it('rejects declare const camera: Camera without a space', () => {
    const r = compileTsSource(`
      "use typeshade";
      declare const camera: f32;
      export function f(): f32 { return camera; }
    `);
    // The list the message offers grew with #8 A7 (a texture, a sampler and override<T> are
    // declared bare, with no address-space wrapper), so the assertion is on what the message
    // is ABOUT rather than on the full enumeration.
    expect(r.diagnostics.some((d) => /must be uniform<T>, storage<T>/.test(d.message))).toBe(true);
  });
});

// ═══ A binding read is a `varref`, not a `constref` (#14) ═══
//
// Both were `BindingKind: 'module'` in the lowering scope, so `lowerIdentifier` gave a
// resource binding the shape the IR reserves for a module-scope CONSTANT. Every consumer
// that asks "which bindings does this stage reach" counts `varref` names, so the answer was
// always "none" — the GLSL writer dropped the uniform block while keeping the uses,
// `reflect()` reported no stages for any binding, and the CPU oracle could not resolve one
// at all. The arms below pin each of those three, because they failed in three different
// ways and a fix for one would not have shown up in the others.
describe('a binding is a module-scope var, not a const (#14)', () => {
  const src = `
    "use typeshade";
    const GAIN: f32 = 2.;
    declare const input: storage<array<f32>>;
    declare const output: storage<array<f32>, "read_write">;
    @compute([64, 1, 1])
    export function k(@builtin("global_invocation_id") gid: vec3u): void {
      output[gid.x] = input[gid.x] * GAIN;
    }
  `;

  it('lowers a binding read to varref and a module const read to constref', () => {
    const r = compileTsSource(src);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const ops = new Map<string, string>();
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) return void n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      const o = n as Record<string, unknown>;
      if (typeof o['op'] === 'string' && typeof o['name'] === 'string') ops.set(o['name'], o['op']);
      Object.values(o).forEach(walk);
    };
    walk(r.funcs);
    // The two kinds are told apart, and each gets the shape its meaning calls for.
    expect(ops.get('input')).toBe('varref');
    expect(ops.get('output')).toBe('varref');
    expect(ops.get('GAIN')).toBe('constref');
  });

  it('reflect() names the stage that reaches each binding', () => {
    const stages = reflect(compile(src).module)
      .bindGroups.flatMap((g) => g.entries.map((e) => `${e.name}:${e.stages.join('|')}`))
      .sort();
    // `stages: []` on every row is what a host turns into `visibility: 0`.
    expect(stages).toEqual(['input:compute', 'output:compute']);
  });

  it('the CPU oracle resolves a binding through setBinding', () => {
    const { module } = compile(src);
    const cm = compileModule(module);
    const out = [0, 0, 0, 0];
    cm.setBinding('input', [1, 2, 3, 4]);
    cm.setBinding('output', out);
    // Before the fix this threw `typeshade/cpu: unknown const input`: the oracle looks a
    // constref up in the CONST map, and a binding is never in it.
    cm.fns['k']!([2, 0, 0]);
    expect(out).toEqual([0, 0, 6, 0]);
  });
});

/** Assigning to something that cannot be assigned to, through BOTH paths that raise it:
 *  `lowerAssign` (statement.ts) for `x = v`, and `lowerUpdate` (control.ts) for `x++`.
 *
 *  Table-driven because the two paths drifted. `readOnlyPhrase` exists because three sites
 *  disagreed about what a `declare const input: storage<…>` is, and `lowerUpdate` separately
 *  answered "it is declared with const" for a name that was never declared — it passed
 *  `binding?.kind` into the phrase helper, and `undefined` took the helper's default. The
 *  columns are the point: for one target, both paths must say the same thing. */
describe('cannot assign to — the phrase names what the target actually is', () => {
  const CASES: readonly { what: string; head: string; target: string; expected: string }[] = [
    {
      what: 'a resource binding',
      head: 'declare const u: uniform<f32>',
      target: 'u',
      expected: 'Cannot assign to "u" — it is a read-only resource.',
    },
    {
      what: 'a module const',
      head: 'const K: f32 = 2.',
      target: 'K',
      expected: 'Cannot assign to "K" — it is a module const.',
    },
    {
      what: 'a local const',
      head: '',
      target: 'a',
      expected: 'Cannot assign to "a" — it is declared with const.',
    },
    {
      what: 'a name that does not exist',
      head: '',
      target: 'nope',
      expected: 'Cannot assign to unknown name "nope".',
    },
  ];

  /** `x = 1.` and `x++` in the same program shape, so the only variable is the path. */
  const program = (head: string, stmt: string): string =>
    `"use typeshade"\n${head}\n\n@fragment\nexport function fs(): vec4 {\n  const a = 1.\n  ${stmt}\n  return vec4(a, 0., 0., 1.)\n}\n`;

  for (const c of CASES) {
    for (const [path, stmt] of [
      ['assignment', `${c.target} = 1.`],
      ['increment', `${c.target}++`],
    ] as const) {
      it(`${c.what}, by ${path}`, () => {
        const errors = compileTsSource(program(c.head, stmt)).diagnostics.filter(
          (d) => d.category === 'error',
        );
        expect(errors.map((d) => d.message)).toContain(c.expected);
      });
    }
  }

  it('both paths report an unknown name under the same code', () => {
    const code = (stmt: string): string | undefined =>
      compileTsSource(program('', stmt))
        .diagnostics.filter((d) => d.category === 'error')
        .find((d) => d.message.includes('unknown name'))?.code;
    // TS8022 (UNKNOWN_NAME) on both. `lowerAssign` used to raise TS8018 (ASSIGN_TARGET),
    // which is the code for a target of the wrong SHAPE, not for one that names nothing.
    expect(code('nope = 1.')).toBe('TS8022');
    expect(code('nope++')).toBe(code('nope = 1.'));
  });
});
