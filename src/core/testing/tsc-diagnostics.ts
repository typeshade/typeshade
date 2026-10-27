// The diagnostics `tsc` reports for a program, computed on a worker thread so that the test
// that asked keeps its event loop. Test support only: `tsconfig.json` excludes it from dist/.
//
// Why a thread (2026-10-27, pull request #783): a host-view test builds a program over the
// DOM lib with `ts.createProgram` and reads `getPreEmitDiagnostics`, which is 20–37 s of
// synchronous work on a loaded CI runner. Vitest's worker reports each test to the main
// process over an RPC whose reply is due within 60 s (birpc's default), and the call for
// "this test started" is in flight when the body runs. A body that blocks the worker's event
// loop past the 60 s fires that timer before the reply, which has long arrived, is read:
// `[vitest-worker]: Timeout calling "onTaskUpdate"`, an unhandled error that fails the job
// with every test passed. Reproduced with a test whose body spins for 65 s. On a thread the
// same program costs the same time and blocks nothing.
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import type ts from 'typescript';

/** One diagnostic, as the thread reports it: `line` counts from 1 in `fileName`. */
export interface TscDiagnostic {
  readonly code: number;
  readonly fileName?: string;
  readonly line?: number;
  readonly message: string;
}

// The `typescript` the test itself imports: on CI's TypeScript legs that is the swapped
// version, and the thread must read the same one.
const TYPESCRIPT = createRequire(import.meta.url).resolve('typescript');

const PROGRAM = `
const { parentPort, workerData } = require('node:worker_threads');
const ts = require(workerData.typescript);
const program = ts.createProgram(workerData.rootNames, workerData.options);
parentPort.postMessage(
  ts.getPreEmitDiagnostics(program).map((d) => ({
    code: d.code,
    fileName: d.file?.fileName,
    line: d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : undefined,
    message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
  })),
);
`;

/** `ts.getPreEmitDiagnostics(ts.createProgram(rootNames, options))`, on a worker thread. The
 *  files are read from disk there, so write them before calling. */
export function tscDiagnostics(
  rootNames: readonly string[],
  options: ts.CompilerOptions,
): Promise<TscDiagnostic[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(PROGRAM, {
      eval: true,
      workerData: { typescript: TYPESCRIPT, rootNames: [...rootNames], options },
    });
    worker.once('message', (diagnostics: TscDiagnostic[]) => {
      resolve(diagnostics);
      void worker.terminate();
    });
    worker.once('error', (e) => {
      reject(e);
      void worker.terminate();
    });
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`the tsc thread exited with code ${code}`));
    });
  });
}
