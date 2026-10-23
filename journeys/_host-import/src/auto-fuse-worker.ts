import { run } from './auto-fuse.ts';

const worker = globalThis as unknown as { postMessage(value: unknown): void };
void run().then(
  (result) => worker.postMessage({ result }),
  (error: unknown) => worker.postMessage({ error: String(error) }),
);
