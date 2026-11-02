// Child processes that the user-journey gate starts and has to stop (issue #923).
//
// The gate started the dev server of the import journey as `npx vite` and stopped it with
// `kill()`. That ends `npx`, and `npx` does not pass the signal on. The `vite` it ran stayed alive
// under init, with its port and its file watchers, after the gate had ended. Three rules keep
// that from happening again:
//
//   1. Start a server as the process that serves (`node <the vite entry>`), never behind a
//      wrapper (`npx`, `npm exec`, a shell), so that the signal reaches the server.
//   2. Stop a child with `stopChild`. It signals the child, waits until the child has exited,
//      and forces the end if the child does not stop.
//   3. End the gate with `stopLiveChildren`. It names each child that the gate started and that
//      is still alive, and stops it. The gate fails if it names one.
//
// `portIsHeld` covers what the list of direct children cannot see: a server that a wrapper
// started stays alive after the wrapper has gone, and it still holds its port.
//
// Each check can fail: `src/gate-children.test.ts` runs a wrapper that leaves its server behind,
// as `npx` did (AGENTS.md#gate-discipline, prove the instrument).
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { connect } from 'node:net';

/** Every child that `startChild` made in this process. */
const started = new Set<ChildProcess>();

/** Start a child that `stopChild` or `stopLiveChildren` has to stop. */
export function startChild(
  command: string,
  args: readonly string[],
  options: SpawnOptions = {},
): ChildProcess {
  const child = spawn(command, args, options);
  // A command that cannot start emits `error` and never `exit`. It has no pid, so it is not alive.
  child.once('error', (error) => console.error(`${command}: ${error.message}`));
  started.add(child);
  return child;
}

/** A child is alive from its start until its exit. A command that did not start has no pid. */
export function isAlive(child: ChildProcess): boolean {
  return child.pid !== undefined && child.exitCode === null && child.signalCode === null;
}

/** The children that `startChild` made and that are still alive. */
export function liveChildren(): ChildProcess[] {
  return [...started].filter(isAlive);
}

/** Stop a child: send SIGTERM, send SIGKILL after `graceMs`, and resolve when the child has exited. */
export async function stopChild(child: ChildProcess, graceMs = 10_000): Promise<void> {
  if (!isAlive(child)) return;
  const exited = new Promise<void>((done) => child.once('exit', () => done()));
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), graceMs);
  try {
    await exited;
  } finally {
    clearTimeout(force);
  }
}

/** Stop every child that is still alive, and name each one as `pid command arguments`. The gate
 *  calls it last, so a name in the result is a leak. */
export async function stopLiveChildren(graceMs?: number): Promise<string[]> {
  const live = liveChildren();
  const names = live.map((child) => `${child.pid} ${child.spawnargs.join(' ')}`);
  await Promise.all(live.map((child) => stopChild(child, graceMs)));
  return names;
}

/** Whether a process accepts a connection on the port. A server that was stopped must not. */
export function portIsHeld(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ port, host });
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', () => done(false));
  });
}
