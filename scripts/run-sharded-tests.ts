// Run selected shards in Node, with stable identities before Vitest's configured partitioner.
// Vitest discovers projects concurrently. Its default path hash ties when a file occurs in
// two projects, so discovery order alone can otherwise duplicate one and omit the other.
import { startVitest, type ResolvedConfig, type Vitest } from 'vitest/node';
import type {} from 'vitest/config';
import type { Plugin } from 'vite';

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function stableShardInput(): Plugin {
  const configured = new WeakSet<Vitest>();
  return {
    name: 'typeshade-stable-shard-input',
    configureServer(server) {
      // The root server always exists, even when projects use separate Vite servers.
      // onInit runs after project hooks; append to the resolved reporters to retain defaults.
      const config = server.config.test as ResolvedConfig;
      config.reporters.push({
        onInit(vitest) {
          if (configured.has(vitest)) return;
          configured.add(vitest);
          const Sequencer = vitest.config.sequence.sequencer;
          vitest.config.sequence.sequencer = class extends Sequencer {
            constructor(ctx: Vitest) {
              super(ctx);
              const shard = this.shard.bind(this);
              this.shard = (specs) =>
                shard(
                  [...specs].sort(
                    (a, b) =>
                      compare(a.moduleId, b.moduleId) ||
                      compare(a.project.name, b.project.name) ||
                      compare(a.pool, b.pool),
                  ),
                );
            }
          };
        },
      });
    },
  };
}

if (import.meta.main) {
  const { tests, ...options } = JSON.parse(process.argv[2]!) as {
    tests: string[];
    root: string;
    config?: string;
    shard: string;
  };
  const ctx = await startVitest(
    tests,
    { ...options, run: true },
    { plugins: [stableShardInput()] },
  );
  if (!ctx.shouldKeepServer()) await ctx.exit();
}
