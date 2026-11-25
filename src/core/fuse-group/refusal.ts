import type { FuseArray } from '../host-kernel.js';
import { KERNEL_TREE } from '../kernel-tree.js';
import { WEBGL2_APART } from './tier-words.js';
import type { Info } from './call-info.js';

const pair = (a: string, b: string, because: string): string =>
  `${a} and ${b} run as two dispatches because ${because}`;

const placed = (first: NonNullable<FuseArray['first']>): string =>
  `\`${first.text}\`${first.line !== undefined ? ` (line ${first.line})` : ''}`;

export function declaredIn(
  infos: readonly Info[],
  group: readonly number[],
): { readonly size: number; readonly name: string } | undefined {
  for (const g of group) {
    const d = infos[g]!.declared;
    if (d !== undefined) return d;
  }
  return undefined;
}

export function refusal(
  infos: readonly Info[],
  group: readonly number[],
  next: number,
  limit: number,
  held: (members: readonly number[]) => ReadonlySet<object>,
): { readonly why?: string } | undefined {
  const c = infos[next]!;
  const last = infos[group[group.length - 1]!]!;
  if (c.entry || last.entry) {
    const entry = c.entry ? c.name : last.name;
    return {
      why: pair(last.name, c.name, `${entry} is an entry call, which forms a group of its own`),
    };
  }
  if (c.tier === 'webgl2') return { why: WEBGL2_APART };
  if (c.tier === 'cpu') return c.onCpu ? { why: `${c.name} ${c.apart}` } : {};
  if (last.tier !== 'webgpu')
    return {
      why: `${c.name} runs apart from ${last.name}, which runs ${last.tier === 'cpu' ? 'on the CPU' : 'on WebGL2'}`,
    };
  if (c.apart !== undefined) return { why: pair(last.name, c.name, `${c.name} ${c.apart}`) };
  if (last.apart !== undefined)
    return { why: pair(last.name, c.name, `${last.name} ${last.apart}`) };
  if (last.reduces) return { why: pair(last.name, c.name, `${last.name} reduces`) };
  const first = infos[group[0]!]!;
  const [a, b] = [first.range!, c.range!];
  if (a.n !== b.n)
    return {
      why: pair(last.name, c.name, `the trip counts differ (${a.n} and ${b.n})`),
    };
  if (a.start !== b.start)
    return {
      why: pair(
        last.name,
        c.name,
        `the loops start at different indices (${a.start} and ${b.start})`,
      ),
    };
  if (first.step !== c.step)
    return {
      why: pair(
        last.name,
        c.name,
        `the loops step by different amounts (${first.step} and ${c.step})`,
      ),
    };
  const declared = declaredIn(infos, group);
  if (c.reduces) {
    if (declared !== undefined && declared.size !== KERNEL_TREE)
      return {
        why: pair(
          last.name,
          c.name,
          `workgroup size ${declared.size} of ${declared.name}() differs from the tree size ${KERNEL_TREE} of ${c.name}()`,
        ),
      };
  } else if (
    c.declared !== undefined &&
    declared !== undefined &&
    c.declared.size !== declared.size
  ) {
    return {
      why: pair(
        last.name,
        c.name,
        `workgroup size ${c.declared.size} of ${c.name}() differs from ${declared.size} of ${declared.name}()`,
      ),
    };
  }
  for (const m of group.map((g) => infos[g]!)) {
    for (const [key, mine] of m.by) {
      const theirs = c.by.get(key);
      if (theirs === undefined) continue;
      if (theirs.type !== mine.type)
        return {
          why: pair(
            m.name,
            c.name,
            `they see one array as ${mine.type} in ${m.name} and ${theirs.type} in ${c.name}`,
          ),
        };
      if (mine.writes && theirs.writes)
        return { why: pair(m.name, c.name, `${c.name} writes an array ${m.name} also writes`) };
      if (theirs.writes && mine.reads)
        return { why: pair(m.name, c.name, `${c.name} writes an array ${m.name} reads`) };
      if (mine.writes && theirs.reads) {
        if (!theirs.atI)
          return {
            why: pair(
              m.name,
              c.name,
              theirs.first !== undefined
                ? `${c.name} reads ${placed(theirs.first)}`
                : `${c.name} reads \`${theirs.param}\` other than at its loop's counter`,
            ),
          };
        if (!mine.atI)
          return {
            why: pair(
              m.name,
              c.name,
              mine.first !== undefined
                ? `${m.name} writes ${placed(mine.first)}`
                : `${m.name} writes \`${mine.param}\` other than at its loop's counter`,
            ),
          };
      }
    }
  }
  const bound = new Set<object>();
  for (const g of group) for (const key of infos[g]!.by.keys()) bound.add(key);
  for (const key of c.by.keys()) bound.add(key);
  for (const key of held([...group, next])) bound.delete(key);
  const binds = bound.size + c.partials;
  if (binds > limit)
    return {
      why: pair(
        last.name,
        c.name,
        `one dispatch would bind ${binds} storage buffers, and the device allows ${limit}`,
      ),
    };
  return undefined;
}
