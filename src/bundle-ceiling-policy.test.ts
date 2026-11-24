import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REFERENCE = 'c4a12d3fa2d4847809eeba52a1278dbedee2346c';
const FACTOR = 1.01;
const OWNER = '`CLAUDE.md` (Merging): past the 1% limit the owner decides';

interface Numbers {
  readonly bytes: number;
  readonly split: { readonly initial: number; readonly total: number };
}

interface CeilingFile {
  readonly reference: string;
  readonly factor: number;
  readonly ceilings: Record<string, Numbers>;
}

const REFERENCE_VALUES: Record<string, Numbers> = {
  'typeshade/runtime': { bytes: 178698, split: { initial: 52043, total: 180803 } },
  'typeshade/emit': { bytes: 124649, split: { initial: 124649, total: 124649 } },
  'typeshade/fuse': { bytes: 123067, split: { initial: 17604, total: 123652 } },
  'typeshade/algorithms': { bytes: 71164, split: { initial: 70143, total: 70143 } },
  'typeshade/random': { bytes: 52741, split: { initial: 51835, total: 51835 } },
};

const readJson = <T>(path: string): T => JSON.parse(readFileSync(`${ROOT}${path}`, 'utf8')) as T;

const flat = (entry: Numbers | undefined): Record<string, number | undefined> => ({
  bytes: entry?.bytes,
  'split.initial': entry?.split?.initial,
  'split.total': entry?.split?.total,
});

const ceilingOf = (value: number): number => Math.floor((value * 101) / 100);

const ceilingFile = readJson<CeilingFile>('scripts/bundle-ceiling.json');
const budgets = readJson<Record<string, Numbers>>('scripts/bundle-budget.json');

describe('the 1% ceiling of the bundle budgets (CLAUDE.md, Merging)', () => {
  it('the ceiling file names the reference commit and the factor 1.01', () => {
    expect(
      { reference: ceilingFile.reference, factor: ceilingFile.factor },
      `scripts/bundle-ceiling.json: reference and factor must be ${REFERENCE} and ${FACTOR}. ${OWNER}`,
    ).toEqual({ reference: REFERENCE, factor: FACTOR });
  });

  it('each ceiling is floor(reference value * 1.01), and no bundle is added or dropped', () => {
    const names = [
      ...new Set([...Object.keys(REFERENCE_VALUES), ...Object.keys(ceilingFile.ceilings)]),
    ];
    const wrong: string[] = [];
    for (const name of names) {
      const reference = flat(REFERENCE_VALUES[name]);
      const held = flat(ceilingFile.ceilings[name]);
      for (const key of Object.keys(held)) {
        const expected = reference[key] === undefined ? undefined : ceilingOf(reference[key]);
        if (held[key] !== expected) {
          wrong.push(
            `${name} ${key}: the ceiling is ${held[key]}, floor(${reference[key]} * ${FACTOR}) is ${expected}`,
          );
        }
      }
    }
    expect(
      wrong,
      `scripts/bundle-ceiling.json differs from the reference values at ${REFERENCE}. Never raise a number of it. ${OWNER}`,
    ).toEqual([]);
  });

  it('each number of scripts/bundle-budget.json has a ceiling and stays at or under it', () => {
    const problems: string[] = [];
    for (const [name, entry] of Object.entries(budgets)) {
      const ceilings = flat(ceilingFile.ceilings[name]);
      for (const [key, value] of Object.entries(flat(entry))) {
        const ceiling = ceilings[key];
        if (value === undefined) continue;
        if (typeof value !== 'number') {
          problems.push(`${name} ${key}: the budget is ${String(value)}, not a number`);
        } else if (ceiling === undefined) {
          problems.push(`${name} ${key}: the budget is ${value} and there is no ceiling`);
        } else if (value > ceiling) {
          problems.push(`${name} ${key}: the budget is ${value}, over its ceiling of ${ceiling}`);
        }
      }
    }
    expect(
      problems,
      `A budget of scripts/bundle-budget.json is above the 1% ceiling of scripts/bundle-ceiling.json. ${OWNER}`,
    ).toEqual([]);
  });
});
