// A vitest setup file: after every test, one turn of the worker's event loop.
//
// Why (2026-10-27, pull request #783): a vitest worker reports each test to the main process
// over an RPC call whose reply is due within 60 s (birpc's default), and reads the reply only
// when its event loop reaches the poll phase. The runner awaits a synchronous test body as a
// microtask, so a run of synchronous tests, and the hooks between them, never leaves the
// microtask queue: a file of them that takes 60 s on a loaded runner (`manifest.test.ts`,
// `fuse-entry.test.ts`, `random-chain.test.ts` sit at 60 to 67 s there) fires the timer before
// the reply, which arrived long ago, is read, and the job fails on
// `[vitest-worker]: Timeout calling "onTaskUpdate"` with every test passed. Reproduced with
// 70 synchronous tests of one second each, and with one test of 65 s. `setImmediate` runs in
// the check phase, after poll, so by the time the next test starts every reply that has arrived
// has been read and its timer cleared. The turn costs nothing a test can measure.
import { afterEach } from 'vitest';

// The real one, taken before any test installs fake timers (`vi.useFakeTimers()` replaces
// `setImmediate` too, and a turn on a fake clock would never come).
const turn = setImmediate;

afterEach(() => new Promise<void>((resolve) => turn(resolve)));
