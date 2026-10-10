// The experiment stays outside TypeShade Core. Run its independent Node test suite in CI.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';

it('validates MNIST softmax regression against the independent reference', () => {
  execFileSync('node', ['--experimental-strip-types', '--test', 'journeys/mnist/test.mjs'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    stdio: 'pipe',
  });
});

it('typechecks MNIST host orchestration and dataset handling', () => {
  execFileSync('node', ['node_modules/typescript/bin/tsc', '-p', 'journeys/mnist/tsconfig.json'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    stdio: 'pipe',
  });
});
