// Implements: Rule 11.13 (docs/language-design.md; traced in reqs/).
// ═══ The planner of the fuse scope: which recorded calls become one dispatch (change 0058) ═══
//
// A plan walks its calls in the order they were made and grows a group while the next call may
// join it. A call joins a group when every fact below holds against EVERY call already in the
// group, and not against the last one alone: `add(t); mul(u); pairsum(out, t)` has no array in
// common between `mul` and `pairsum`, and `pairsum` still reads what `add` wrote at `i + 1`. A
// call that fails starts a group of its own, and the reason is kept for the report, in the
// author's words. The planner reads the facts the compiler wrote into each kernel function's face
// (`KernelFace.fuse`) and the call's own range and arrays. It analyzes no IR and builds no module;
// `core/fuse-entry.ts` builds the fused module of a group this file settled.
//
//   tier  A call joins a group only when it runs on WebGPU, as does every call in the group.
//         WebGL2 runs the calls apart (decision 5 of the change is deferred); the CPU tier never
//         fuses, so it runs them one after another and says nothing.
//   F1    The function lowers, was built with `typeshade({ fuse: true })`, has one loop, and the
//         loop neither scatters nor continues of its own accord, and runs an iteration. (A loop
//         that reduces is F6's.)
//   F2    The loop has the same start, trip count and step as the group's.
//   F3    Every array a call in the group wrote and the new call reads is written and read at
//         exactly `i`. (The write half reads the compiler's fact of the call that wrote it, the
//         read half the new call's.)
//   F4    No array the new call writes is one a call in the group reads or writes. An array both
//         read is no conflict. (One array as two parameters of one call is refused by the call's
//         own check before a plan reaches here.)
//   F5    The group and the new call bind no more distinct arrays than the device allows storage
//         buffers to a dispatch, not counting a scratch array the entry holds as a local, and
//         counting the partials binding of each variable a loop that reduces folds.
//   F6    A call that reduces joins a group as its last call, and no call joins after it. Its
//         iteration takes the iterations of the calls before it as a prologue; its fold entries
//         and its tail stay as the compiler lowered them (Rule 7.2).
//   F7    The size of the group (proposal 0067, decision D5). A call with `@workgroup_size` declares
//         a size, and every call of a group that declares one declares the same. A call with no
//         attribute declares none: it has no preference and takes the group's size, which is 64
//         when no call declares one. A group that ends in a reduction runs at the tree of 256
//         (Rule 7.2), so a call that declares another size does not join it.
//   F8    An entry call (Rule 8.24, change 0069) forms a group of its own: no call joins it, and it
//         joins none. Its dispatch is the entry's, at the workgroup its `@compute` declares.
//
// An array is known by its identity: a `Resident` by its state, a host array by the array. One
// array has one type in a group: `t` as `array<f32>` in one call and `array<vec2<f32>>` in
// another is refused, since the fused module binds it once.
//
// A scratch array (`scope.scratch()`) is contracted in a group when the entry can hold it as a
// local and bind no buffer for it. All of these must hold:
//
//   - Every call of the whole plan that names it is in the group, so that no later group sees it.
//   - Exactly one call of the group writes it, and every access of it is at exactly `i`.
//   - No call of the group names it without an index (`x.length`, `FuseLoop.bare`).
//
// Otherwise it stays a buffer: the entry binds it, F5 counts it, and the scope makes it a zeroed
// buffer for the plan. A `Resident` made by `resident()` is never contracted, since the host may
// read it after the scope. A scratch array counts as a buffer until the last call that names it
// is in the group, so a call that would fit only once a later call joins is refused at the limit.
//
// Like the rest of `typeshade/runtime` it imports no compiler, and `typeshade/fuse` is the only
// subpath that imports this file.

import type { FuseArray, FuseLoop, KernelFace } from './host-kernel.js';
import type { Tier } from './tiers.js';
import { KERNEL_TREE, KERNEL_WORKGROUP } from './kernel-tree.js';

/** One recorded call as the planner reads it, after the call's own check. */
export interface GroupCall {
  readonly k: KernelFace;
  /** For each parameter in order, the array bound to it, known by identity: a `Resident`'s state
   *  or a host array. Undefined for a parameter that is a value. */
  readonly arrays: readonly (object | undefined)[];
  /** The loop's first index and trip count, from the range function; undefined for a function
   *  that runs on the CPU. */
  readonly range: { readonly start: number; readonly n: number } | undefined;
  /** The tier the call will run on. */
  readonly tier: Tier;
}

/** One entry call as the planner reads it (Rule 8.24, change 0069). It forms a group of its own
 *  (F8), so no fact is read of its arrays. */
export interface EntryCall {
  /** The entry's name, as the report names it. */
  readonly entry: string;
  /** The tier the call will run on. */
  readonly tier: Tier;
}

/** A call the planner groups: a kernel call or an entry call. */
export type PlannedCall = GroupCall | EntryCall;

/** A group of calls the planner settled, as indices into the calls it was given. */
export interface Group {
  readonly calls: readonly number[];
  /** Whether the calls run as one dispatch: more than one call is in the group. */
  readonly fused: boolean;
  /** Why the group stands apart from the one before it, in the author's words. */
  readonly why?: string;
  /** The workgroup size the group's calls run at (F7), when they run on WebGPU: the size they
   *  declare, else 64, else the tree of 256 for a group that reduces. */
  readonly workgroupSize?: number;
  /** The scratch arrays the entry of a fused group holds as locals and binds no buffer for. */
  readonly contracted: readonly object[];
}

/** The words a refusal on WebGL2 gives; the report of a scope on that tier says it of each group
 *  but the first. */
export const WEBGL2_APART = 'WebGL2 runs the calls apart';

/** The default of `maxStorageBuffersPerShaderStage`, for a device that reports none. */
export const DEFAULT_STORAGE_BUFFERS = 8;

/** How a call reaches one array. */
interface Access {
  readonly param: string;
  /** The TypeShade type of the parameter, `array<f32>`. */
  readonly type: string;
  readonly reads: boolean;
  readonly writes: boolean;
  readonly atI: boolean;
  /** Whether the call's iteration names the array without an index (`FuseLoop.bare`). */
  readonly bare: boolean;
  readonly first?: FuseArray['first'];
}

/** What the planner needs of one call, worked out once. */
interface Info {
  readonly name: string;
  readonly tier: Tier;
  /** Whether the function itself runs on the CPU, which its face says: `k.gpu` is absent. */
  readonly onCpu: boolean;
  /** What stops the call joining any group, as the words that follow its name; undefined when
   *  nothing does (F1). */
  readonly apart: string | undefined;
  /** Whether its loop reduces (F6): then no call may join after it. */
  readonly reduces: boolean;
  /** The workgroup size its loop runs at: 256, the declared size or 64 (F7). */
  readonly wg: number | undefined;
  /** The workgroup size the call declares with `@workgroup_size` (F7); undefined when it declares
   *  none. */
  readonly declared: { readonly size: number; readonly name: string } | undefined;
  /** How many partials bindings the entry of a loop that reduces binds, one for each variable it
   *  folds (F5); none for a loop that maps. */
  readonly partials: number;
  readonly range: GroupCall['range'];
  readonly step: number;
  readonly by: ReadonlyMap<object, Access>;
  /** Whether the call is an entry call, which forms a group of its own (F8). */
  readonly entry: boolean;
}

function apartOf(call: GroupCall): string | undefined {
  const { k, range } = call;
  if (k.gpu === undefined || range === undefined) return `runs on the CPU, ${k.noGpu ?? 'unknown'}`;
  if (k.fuse === undefined) return 'was built without typeshade({ fuse: true })';
  if (k.fuse.facts.length !== 1) return 'has more than one loop';
  const loop = k.fuse.facts[0]!;
  if (loop.scatters) return 'scatters';
  if (loop.continues) return 'has a loop with a `continue`';
  if (range.n === 0) return 'has a loop that runs no iteration';
  return undefined;
}

/** What the planner needs of an entry call: it joins no group (F8), so no fact is read of it. */
function entryInfoOf(call: EntryCall): Info {
  return {
    name: call.entry,
    tier: call.tier,
    onCpu: false,
    apart: undefined,
    reduces: false,
    wg: undefined,
    declared: undefined,
    partials: 0,
    range: undefined,
    step: 1,
    by: new Map(),
    entry: true,
  };
}

function infoOf(call: PlannedCall): Info {
  if ('entry' in call) return entryInfoOf(call);
  const { k } = call;
  const loop: FuseLoop | undefined = k.fuse?.facts.length === 1 ? k.fuse.facts[0] : undefined;
  const by = new Map<object, Access>();
  k.params.forEach((p, i) => {
    const key = call.arrays[i];
    if (p.k !== 'array' || key === undefined) return;
    const fact = loop?.arrays.find((a) => a.param === p.name);
    const here: Access = {
      param: p.name,
      type: p.s,
      reads: fact?.access === 'read' || fact?.access === 'readwrite',
      writes: fact?.access === 'write' || fact?.access === 'readwrite',
      atI: fact?.atI ?? true,
      bare: loop?.bare?.some((b) => b.param === p.name) === true,
      ...(fact?.first !== undefined ? { first: fact.first } : {}),
    };
    const had = by.get(key);
    // A host array may be two parameters of one call; both only read it.
    by.set(
      key,
      had === undefined
        ? here
        : {
            param: had.param,
            type: had.type,
            reads: had.reads || here.reads,
            writes: had.writes || here.writes,
            atI: had.atI && here.atI,
            bare: had.bare || here.bare,
            ...((had.first ?? here.first) !== undefined ? { first: had.first ?? here.first } : {}),
          },
    );
  });
  return {
    name: k.name,
    tier: call.tier,
    onCpu: k.gpu === undefined || call.range === undefined,
    apart: apartOf(call),
    reduces: loop?.reduces === true,
    wg: k.gpu?.loops[0]?.wg,
    declared:
      loop?.declared === true && k.gpu !== undefined
        ? { size: k.gpu.loops[0]!.wg, name: k.name }
        : undefined,
    partials: loop?.reduces === true ? (k.gpu?.loops[0]?.reduce?.vars.length ?? 0) : 0,
    range: call.range,
    step: k.gpu?.loops[0]?.step ?? 1,
    by,
    entry: false,
  };
}

const pair = (a: string, b: string, because: string): string =>
  `${a} and ${b} run as two dispatches because ${because}`;

/** An access in the author's words: `t[i - 1]` and its line. */
const placed = (first: NonNullable<FuseArray['first']>): string =>
  `\`${first.text}\`${first.line !== undefined ? ` (line ${first.line})` : ''}`;

/** The size the calls of `group` declare, with the first call that declares it: F7 says every
 *  call that declares one declares this one. Undefined when no call declares a size. */
function declaredIn(
  infos: readonly Info[],
  group: readonly number[],
): { readonly size: number; readonly name: string } | undefined {
  for (const g of group) {
    const d = infos[g]!.declared;
    if (d !== undefined) return d;
  }
  return undefined;
}

/**
 * Why `next` may not join the calls in `group`, or undefined when it may. `why` is absent from a
 * refusal that has nothing to say: a call that runs on the CPU tier, which never fuses.
 */
function refusal(
  infos: readonly Info[],
  group: readonly number[],
  next: number,
  limit: number,
  held: (members: readonly number[]) => ReadonlySet<object>,
): { readonly why?: string } | undefined {
  const c = infos[next]!;
  const last = infos[group[group.length - 1]!]!;
  // F8, an entry call forms a group of its own: neither it nor a call after it joins.
  if (c.entry || last.entry) {
    const entry = c.entry ? c.name : last.name;
    return {
      why: pair(last.name, c.name, `${entry} is an entry call, which forms a group of its own`),
    };
  }
  // The tier. Only WebGPU dispatches can become one.
  if (c.tier === 'webgl2') return { why: WEBGL2_APART };
  if (c.tier === 'cpu') return c.onCpu ? { why: `${c.name} ${c.apart}` } : {};
  if (last.tier !== 'webgpu')
    return {
      why: `${c.name} runs apart from ${last.name}, which runs ${last.tier === 'cpu' ? 'on the CPU' : 'on WebGL2'}`,
    };
  // F1, the new call first and then the one it would join.
  if (c.apart !== undefined) return { why: pair(last.name, c.name, `${c.name} ${c.apart}`) };
  if (last.apart !== undefined)
    return { why: pair(last.name, c.name, `${last.name} ${last.apart}`) };
  // F6, a call that reduces ends its group: only the last call of a group can, so the last call
  // is the one to ask.
  if (last.reduces) return { why: pair(last.name, c.name, `${last.name} reduces`) };
  // F2, against the group: its calls share one range.
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
  // F7, the size. A call that reduces runs at the tree of 256, and a call that declares a size
  // runs at it: a declared size joins a group only when it is the group's, and a reducing call
  // joins only a group whose declared size, if any, is the tree's.
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
  // F3 and F4 against every call of the group, in the order they were made.
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
  // F5, the distinct arrays the one dispatch would bind: the scratch arrays it holds as locals
  // bind none, and the entry of a loop that reduces binds the partials of each variable it folds.
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

/**
 * Group `calls`, in the order they were made. Each call joins the group before it when it may, and
 * otherwise starts a group of its own, with the reason. The first group has none to stand apart
 * from, so it carries no reason. `limit` is how many storage buffers one dispatch may bind.
 * `scratch` holds the arrays of the plan that are scratch arrays of its scope; a fused group
 * says which of them it contracts.
 */
export function groupCalls(
  calls: readonly PlannedCall[],
  limit: number,
  scratch: ReadonlySet<object> = new Set(),
): Group[] {
  const infos = calls.map(infoOf);
  // The calls of the whole plan that name each array.
  const users = new Map<object, number[]>();
  infos.forEach((info, i) => {
    for (const key of info.by.keys()) users.set(key, [...(users.get(key) ?? []), i]);
  });
  const held = (members: readonly number[]): ReadonlySet<object> => {
    const inside = new Set(members);
    const out = new Set<object>();
    for (const key of scratch) {
      const named = users.get(key);
      if (named === undefined || !named.every((i) => inside.has(i))) continue;
      const seen = named.map((i) => infos[i]!.by.get(key)!);
      if (seen.filter((a) => a.writes).length === 1 && seen.every((a) => a.atI && !a.bare))
        out.add(key);
    }
    return out;
  };
  const groups: { calls: number[]; why?: string }[] = [];
  infos.forEach((_, i) => {
    const last = groups[groups.length - 1];
    const no = last === undefined ? {} : refusal(infos, last.calls, i, limit, held);
    if (last !== undefined && no === undefined) last.calls.push(i);
    else groups.push({ calls: [i], ...(no?.why !== undefined ? { why: no.why } : {}) });
  });
  return groups.map((g) => {
    const members = g.calls.map((i) => infos[i]!);
    // The size the group runs at. A call on its own runs at its loop's size. A group of several
    // calls runs at the tree when it reduces, else at the size the calls declare, or 64 (F7).
    const size =
      members.length === 1
        ? members[0]!.wg
        : members.some((m) => m.reduces)
          ? KERNEL_TREE
          : (declaredIn(infos, g.calls)?.size ?? KERNEL_WORKGROUP);
    return {
      ...g,
      fused: g.calls.length > 1,
      ...(members.every((m) => m.tier === 'webgpu') && size !== undefined
        ? { workgroupSize: size }
        : {}),
      contracted: g.calls.length > 1 ? [...held(g.calls)] : [],
    };
  });
}

/**
 * The slot each array parameter of a group's calls binds to, one slot for each distinct array in
 * the order the calls first reach them, and the arrays themselves. The fused module declares one
 * storage binding for each.
 */
export function assignSlots(calls: readonly GroupCall[]): {
  readonly slots: readonly (readonly (number | undefined)[])[];
  readonly arrays: readonly object[];
} {
  const arrays: object[] = [];
  const slots = calls.map((c) =>
    c.arrays.map((a) => {
      if (a === undefined) return undefined;
      const at = arrays.indexOf(a);
      return at >= 0 ? at : arrays.push(a) - 1;
    }),
  );
  return { slots, arrays };
}
