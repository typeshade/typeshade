import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderAllIndexes } from '../scripts/gen-example-registry.js';

describe('the example indexes match what scripts/gen-example-registry.ts writes', () => {
  it('renders the three indexes', async () => {
    expect((await renderAllIndexes()).size).toBe(3);
  });

  it('each checked-in index equals a fresh render', async () => {
    for (const [file, text] of await renderAllIndexes()) {
      expect(readFileSync(file, 'utf8'), file).toBe(text);
    }
  });
});
