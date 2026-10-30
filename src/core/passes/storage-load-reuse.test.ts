import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { compileModule } from '../oracle.js';
import type { ModuleDecl } from '../ir/index.js';
import { storageLoadReuse } from './storage-load-reuse.js';

function fixture(body: string, extra = ''): ModuleDecl {
  const r = compile(`"use typeshade";
    class Item { a: f32; b: f32; }
    declare const items: storage<array<Item>, "read_write">;
    declare const other: storage<array<Item>, "read_write">;
    ${extra}
    export function run(i: u32): f32 { ${body} }
  `);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return r.module;
}

function execute(m: ModuleDecl, i = 0, alias = false): { value: unknown; loads: number } {
  let loads = 0;
  const data = [2, 7].map(
    (a) =>
      new Proxy(
        { a, b: 3 },
        {
          get(target, key, receiver) {
            if (key === 'a') loads++;
            return Reflect.get(target, key, receiver);
          },
        },
      ),
  );
  const cpu = compileModule(m);
  type Binding = Parameters<typeof cpu.setBinding>[1];
  cpu.setBinding('items', data as unknown as Binding);
  cpu.setBinding(
    'other',
    (alias
      ? data
      : [
          { a: 5, b: 9 },
          { a: 8, b: 10 },
        ]) as unknown as Binding,
  );
  return { value: cpu.fns.run!(i), loads };
}

describe('storage reads within write-free regions', () => {
  it('caches across statements even when the function contains a write elsewhere', () => {
    const m = fixture(
      `other[1].a = 8.; const a = items[i].a * 2.; const b = items[i].a + 1.; return a + b;`,
    );
    expect(execute(m)).toEqual({ value: 7, loads: 2 });
    expect(execute(storageLoadReuse(m))).toEqual({ value: 7, loads: 1 });
  });

  it('hoists an invariant field out of a fixed loop without changing its accumulation order', () => {
    const m = fixture(
      `other[1].a = 8.; let sum: f32 = 0.; for (let k: u32 = 0; k < 6; k++) { sum += items[i].a * f32(k + 1); } return sum;`,
    );
    expect(execute(m)).toEqual({ value: 42, loads: 6 });
    expect(execute(storageLoadReuse(m))).toEqual({ value: 42, loads: 1 });
  });

  it.each(['items[i].a = 9.;', 'other[i].a = 9.;', 'write(i);'])(
    'invalidates all storage caches after %s, including aliased bindings',
    (write) => {
      const m = fixture(
        `const a = items[i].a; ${write} const b = items[i].a; return a + b;`,
        'function write(i: u32): void { other[i].a = 9.; }',
      );
      expect(execute(storageLoadReuse(m), 0, true)).toEqual(execute(m, 0, true));
      expect(execute(storageLoadReuse(m), 0, true)).toEqual({ value: 11, loads: 2 });
    },
  );

  it('restarts reuse after a write and does not rewrite lvalues', () => {
    const m = fixture(
      `let a = items[i].a + items[i].a; other[i].a = 9.; a += items[i].a + items[i].a; return a;`,
    );
    expect(execute(m, 0, true)).toEqual({ value: 22, loads: 4 });
    expect(execute(storageLoadReuse(m), 0, true)).toEqual({ value: 22, loads: 2 });
  });

  it('invalidates a cached load when its index changes', () => {
    const m = fixture(`let at = i; const a = items[at].a; at += 1; return a + items[at].a;`);
    expect(execute(storageLoadReuse(m))).toEqual({ value: 9, loads: 2 });
  });

  it.each(['workgroupBarrier();', 'sync();', 'atomicLoad(counter);'])(
    'does not reuse across %s',
    (barrier) => {
      const m = fixture(
        `const a = items[i].a; ${barrier} return a + items[i].a;`,
        'declare const counter: storage<atomic<u32>, "read_write">; function sync(): void { workgroupBarrier(); }',
      );
      expect(storageLoadReuse(m)).toEqual(m);
    },
  );

  it('preserves branch and short-circuit guards without touching unread storage', () => {
    const m = fixture(
      `if (i > 0) { return items[i].a + items[i].a; } return i > 0 ? items[i].a + items[i].a : 7.;`,
    );
    expect(execute(storageLoadReuse(m))).toEqual({ value: 7, loads: 0 });
    expect(execute(storageLoadReuse(m), 1)).toEqual({ value: 14, loads: 1 });
  });

  it.each(['0', 'i'])(
    'does not speculate a load before an unproved loop with bound %s',
    (bound) => {
      const m = fixture(
        `let sum: f32 = 0.; for (let k: u32 = 0; k < ${bound}; k++) { sum += items[0].a; } return sum;`,
      );
      expect(execute(storageLoadReuse(m))).toEqual({ value: 0, loads: 0 });
      expect(storageLoadReuse(m)).toEqual(m);
    },
  );

  it('keeps per-iteration reads when a different storage binding is written', () => {
    const m = fixture(
      `let sum: f32 = 0.; for (let k: u32 = 0; k < 3; k++) { sum += items[i].a; other[i].a = f32(k + 3); } return sum;`,
    );
    expect(execute(storageLoadReuse(m), 0, true)).toEqual(execute(m, 0, true));
    expect(execute(storageLoadReuse(m), 0, true)).toEqual({ value: 9, loads: 3 });
  });

  it('keeps conditional loop reads guarded', () => {
    const m = fixture(
      `let sum: f32 = 0.; for (let k: u32 = 0; k < 3; k++) { sum += i > 0 ? items[i].a : 1.; } return sum;`,
    );
    expect(storageLoadReuse(m)).toEqual(m);
    expect(execute(storageLoadReuse(m))).toEqual({ value: 3, loads: 0 });
  });

  it('does not shadow a user name and is idempotent', () => {
    const m = fixture(`const _storage0 = 10.; return items[i].a + items[i].a + _storage0;`);
    const out = storageLoadReuse(m);
    expect(execute(out)).toEqual({ value: 14, loads: 1 });
    expect(storageLoadReuse(out)).toEqual(out);
  });
});
