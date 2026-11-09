import { spawnSync } from 'node:child_process';

// Re-bakes src/__api__/author-names.md, the snapshot of every author-facing name
// (src/author-names.test.ts). An added name also needs an accepted proposal (changes/README.md).
const bun = process.platform === 'win32' ? 'bun.exe' : 'bun';
const result = spawnSync(bun, ['run', 'test', 'src/author-names.test.ts'], {
  env: { ...process.env, UPDATE_AUTHOR_NAMES: '1' },
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
