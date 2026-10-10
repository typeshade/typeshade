// The experiment stays outside TypeShade Core. Run its independent Node test suite in CI.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';

it('validates MNIST softmax regression against the independent reference', () => {
  execFileSync('node', ['--test', 'journeys/mnist/test.mjs'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    stdio: 'pipe',
  });
});
