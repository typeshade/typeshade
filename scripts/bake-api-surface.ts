import { spawnSync } from 'node:child_process'

const bun = process.platform === 'win32' ? 'bun.exe' : 'bun'
const result = spawnSync(bun, ['run', 'test', 'src/api-surface.test.ts'], {
  env: { ...process.env, UPDATE_API_SURFACE: '1' },
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
