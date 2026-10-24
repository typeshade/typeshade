// Run the existing fake gh as a real child process on every OS, without a shell/PATH shim.
// This preload affects only the dedicated Bun CLI child the backtest tests start.
import { mock } from 'bun:test';
import childProcess from 'node:child_process';
import { fileURLToPath } from 'node:url';

const execFileSync = childProcess.execFileSync;
const fakeGh = fileURLToPath(new URL('./fake-gh.mjs', import.meta.url));
mock.module('node:child_process', () => ({
  ...childProcess,
  execFileSync(command, args, options) {
    return command === 'gh'
      ? execFileSync(process.execPath, [fakeGh, ...args], options)
      : execFileSync(command, args, options);
  },
}));
