import * as direct from './alias-target.shade.ts';
import * as alias from './alias-one.shade.ts';
import * as chain from './alias-chain.shade.ts';
import * as emptyDirect from './alias-empty-target.shade.ts';
import * as emptyAlias from './alias-empty-one.shade.ts';
import * as emptyChain from './alias-empty-chain.shade.ts';
import { runAliasFixture, verifyAliasArtifacts, type AliasFixture } from './pure-alias-checks.ts';

// Structural assignment checks the generated host signatures too: only reached bindings are
// required, and an empty fragment keeps its optional argument despite the retained uniform.
const fixtures: readonly AliasFixture[] = [
  { name: 'direct', module: direct, empty: emptyDirect },
  { name: 'alias', module: alias, empty: emptyAlias },
  { name: 'chain', module: chain, empty: emptyChain },
];

export async function pureAliasDraws(): Promise<Record<string, number[] | string>> {
  const out: Record<string, number[] | string> = {};
  try {
    verifyAliasArtifacts(fixtures);
    out['alias artifacts'] = [1];
  } catch (e) {
    out['alias artifacts'] = String(e);
  }
  for (const fixture of fixtures)
    for (const [key, value] of Object.entries(await runAliasFixture(fixture)))
      out[`alias ${fixture.name} ${key}`] = value;
  return out;
}
