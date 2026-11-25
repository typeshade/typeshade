import { describe, expect, it, vi } from 'vitest';
import { planMove } from '../scripts/move-declarations.js';
import {
  memoryWorkspace,
  moveOptions,
  refusal,
} from './core/testing/move-declarations-fixtures.js';

const counter = vi.hoisted(() => ({ checks: 0 }));

vi.mock('../scripts/move-purity/check-move.js', async (original) => {
  const real = await original<typeof import('../scripts/move-purity/check-move.js')>();
  return {
    ...real,
    checkMove: (...args: Parameters<typeof real.checkMove>) => {
      counter.checks += 1;
      return real.checkMove(...args);
    },
  };
});

const COUNT = 14;

const sources = (used: readonly number[]): Record<string, string> => {
  const files: Record<string, string> = {};
  const imports: string[] = [];
  for (let n = 1; n <= COUNT; n += 1) {
    files[`src/m${n}.ts`] =
      `export const v${n} = ${n};\nexport function tick${n}(): number {\n  return ${n};\n}\ntick${n}();\n`;
    imports.push(`import { v${n} } from './m${n}.js';`);
  }
  const names = (keep: (n: number) => boolean): string =>
    Array.from({ length: COUNT }, (_, i) => i + 1)
      .filter(keep)
      .map((n) => `v${n}`)
      .join(' + ');
  files['src/a.ts'] = `${imports.join('\n')}

export function moved(): number {
  return ${names((n) => used.includes(n))};
}

export function stays(): number {
  return ${names((n) => !used.includes(n))};
}
`;
  return files;
};

const run = async (used: readonly number[], search?: Parameters<typeof planMove>[2]) => {
  counter.checks = 0;
  const options = moveOptions('src/a.ts', 'src/a/moved.ts', 'moved');
  const result = await planMove(memoryWorkspace(sources(used)), options, search);
  return { result, checks: counter.checks };
};

const EXHAUSTIVE = { maxChecks: Infinity, probe: false };

describe(
  'move-declarations placement search (a move check builds two programs)',
  { timeout: 60_000 },
  () => {
    it('runs one full check when no placement of the new import keeps the evaluation order', async () => {
      const { result, checks } = await run([2, COUNT - 1]);
      expect(result.report.pure).toBe(false);
      expect(result.placement).toBe('after the last import');
      expect(result.report.findings.every((f) => f.kind.startsWith('evaluation order'))).toBe(true);
      expect(checks).toBe(1);
    });

    it.each([[[2, COUNT - 1]], [[1]], [[COUNT]], [[1, 2]], [[COUNT - 1, COUNT]], [[1, COUNT]]])(
      'answers like the exhaustive search for a moved group that uses %j',
      async (used) => {
        const fast = await run(used);
        const slow = await run(used, EXHAUSTIVE);
        expect(fast.result.placement).toBe(slow.result.placement);
        expect(fast.result.report).toEqual(slow.result.report);
        expect(fast.result.texts).toEqual(slow.result.texts);
        expect(fast.checks).toBeLessThanOrEqual(slow.checks);
      },
    );

    it('stops with a refusal that names the bound when the search passes it', async () => {
      counter.checks = 0;
      const options = moveOptions('src/a.ts', 'src/a/moved.ts', 'moved');
      const message = await refusal(
        planMove(memoryWorkspace(sources([2, COUNT - 1])), options, { maxChecks: 3, probe: false }),
      );
      expect(message).toContain('3 full move checks');
      expect(counter.checks).toBe(3);
    });
  },
);
