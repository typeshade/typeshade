// The child-process checks of the user-journey gate (`scripts/gate-children.ts`, issue #923).
//
// Each check is shown to fail on a fault planted on purpose (AGENTS.md#gate-discipline). The fault
// has the shape of the old one: `npx vite` was a wrapper that started the server and went away
// when the gate sent it SIGTERM, and the server stayed alive with its port.
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import type { ChildProcess } from 'node:child_process';
import {
  isAlive,
  liveChildren,
  portIsHeld,
  startChild,
  stopChild,
  stopLiveChildren,
} from '../scripts/gate-children.js';

/** A server: it listens on the port in `argv[1]`, says so, and stays up. */
const SERVER = [
  "const net = require('node:net');",
  "net.createServer().listen(Number(process.argv[1]), '127.0.0.1', () => console.log('listening'));",
  'setInterval(() => {}, 1 << 30);',
].join('\n');

/** The same server, and it ignores SIGTERM. */
const STUBBORN = `process.on('SIGTERM', () => {});\n${SERVER}`;

/** The shape of `npx vite`: a wrapper that starts the server as its own child, prints the pid of
 *  the server, and stays up. SIGTERM ends the wrapper and not the server. */
const WRAPPER = [
  "const { spawn } = require('node:child_process');",
  `const server = spawn(process.execPath, ['-e', ${JSON.stringify(SERVER)}, process.argv[1]], { stdio: 'ignore' });`,
  'console.log(server.pid);',
  'setInterval(() => {}, 1 << 30);',
].join('\n');

/** Pids of the servers that a wrapper started. `afterEach` ends them. */
const strays: number[] = [];

afterEach(async () => {
  await stopLiveChildren(200);
  for (const pid of strays.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* the server has already gone */
    }
  }
});

function run(script: string, port: number): ChildProcess {
  return startChild(process.execPath, ['-e', script, String(port)], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

/** The first thing the child prints. */
function firstLine(child: ChildProcess): Promise<string> {
  return new Promise((done, fail) => {
    child.stdout!.once('data', (data: Buffer) => done(String(data).trim()));
    child.once('exit', () => fail(new Error('the child exited before it printed')));
  });
}

async function until(check: () => Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(`timed out while waiting for ${what}`);
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });
}

describe('the child processes of the user-journey gate (#923)', () => {
  it('stops a server that it started, and the port is free when stopChild returns', async () => {
    const port = await freePort();
    const server = run(SERVER, port);
    expect(await firstLine(server)).toBe('listening');
    expect(await portIsHeld(port)).toBe(true);
    expect(liveChildren()).toContain(server);

    await stopChild(server);

    expect(isAlive(server)).toBe(false);
    expect(liveChildren()).not.toContain(server);
    expect(await portIsHeld(port)).toBe(false);
  });

  // Windows ends a child at the first signal and has no SIGKILL to tell apart.
  it.skipIf(process.platform === 'win32')(
    'forces the end of a child that ignores SIGTERM',
    async () => {
      const port = await freePort();
      const server = run(STUBBORN, port);
      await firstLine(server);

      await stopChild(server, 200);

      expect(server.signalCode).toBe('SIGKILL');
      expect(await portIsHeld(port)).toBe(false);
    },
  );

  it('names a child that is still alive at the end of the gate, and stops it', async () => {
    const port = await freePort();
    const server = run(SERVER, port);
    await firstLine(server);

    const left = await stopLiveChildren(200);

    expect(left).toHaveLength(1);
    expect(left[0]).toContain(String(server.pid));
    expect(isAlive(server)).toBe(false);
    expect(await portIsHeld(port)).toBe(false);
    // With nothing left alive, the check names nothing.
    expect(await stopLiveChildren()).toEqual([]);
  });

  it('sees a server that a wrapper left behind, which the list of children cannot', async () => {
    const port = await freePort();
    const wrapper = run(WRAPPER, port);
    strays.push(Number(await firstLine(wrapper)));
    await until(() => portIsHeld(port), `port ${port} to be held`);

    await stopChild(wrapper); // What `server.kill()` did to `npx`.

    // The wrapper is gone, and the list of the children that the gate started is empty ...
    expect(isAlive(wrapper)).toBe(false);
    expect(liveChildren()).toEqual([]);
    // ... and the server that the wrapper started is alive, with its port: that was the leak.
    expect(await portIsHeld(port)).toBe(true);

    // The port check goes both ways: the port is free once the server has gone.
    process.kill(strays[0]!, 'SIGKILL');
    await until(async () => !(await portIsHeld(port)), `port ${port} to be free`);
  });
});
