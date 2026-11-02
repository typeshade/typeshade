import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';

describe('@compute entry', () => {
  it('marks @compute([64]) as compute', () => {
    const r = compileTsSource(`
      "use typeshade";
      export const paint = compute([64], function paint(id: builtin<"global_invocation_id", vec3u>): void {
        const i = id.x;
      });
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const f = r.funcs.find((fn) => fn.name === 'paint')!;
    expect(f.stage).toBe('compute');
    expect(f.workgroupSize).toBe(64);
    expect(f.params[0]).toMatchObject({ name: 'id', builtin: 'global_invocation_id' });
  });

  it('does not invent gid', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function helper(): u32 {
        return gid.x;
      }
    `);
    expect(r.diagnostics.some((d) => /Unknown identifier/.test(d.message))).toBe(true);
    expect(r.funcs[0]?.params.some((p) => p.name === 'gid')).toBeFalsy();
  });

  it('accepts bare @compute as workgroup 64', () => {
    const r = compileTsSource(`
      "use typeshade";
      export const paint = compute([64], function paint(): void {});
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.funcs[0]!.workgroupSize).toBe(64);
  });
});
