import { type ConstDecl, type Expr, type ModuleDecl } from './ir/nodes.js';
import { eachStmtExpr } from './ir/visit.js';
import { reflect } from './reflect.js';
import type { EmitPlugin } from './emit.js';
import type {
  SemanticAspect,
  SemanticDiffOptions,
  SemanticDiff,
  ExplainedDiffEntry,
  ClassifiedSemanticDiff,
} from './semantic-diff/result.js';
import { EMPTY_CANON, buildCanon, typeSig, subStructs, type Canon } from './semantic-diff/canon.js';
import { subExprs, exprSig, controlFlowFacts } from './semantic-diff/skeleton.js';
export { isSemanticallyEqual } from './semantic-diff/result.js';
export type {
  SemanticAspect,
  SemanticDiffOptions,
  SemanticDiff,
  SemanticDiffBucket,
  ExplainedDiffEntry,
  ClassifiedSemanticDiff,
} from './semantic-diff/result.js';

function interfaceFacts(m: ModuleDecl, c: Canon): string[] {
  const r = reflect(m);
  const out: string[] = [];
  for (const e of r.entries) {
    const inputs = e.inputs.map((i) => subStructs(i, c)).join(',');
    const wg = e.workgroupShape?.join('x').replace(/(x1)+$/, '') ?? '-';
    const wgOverrides = e.workgroupSizeOverrides?.map((name) => name ?? '-').join(',');
    out.push(
      `entry ${e.name} stage=${e.stage} wg=${wg}${wgOverrides === undefined ? '' : `[${wgOverrides}]`} in=[${inputs}] out=${subStructs(e.output, c)}`,
    );
  }
  if (r.vertex) {
    out.push(`vertex stride=${r.vertex.arrayStride}`);
    for (const a of r.vertex.attributes)
      out.push(`vertex.attr ${a.name} loc=${a.location} ${subStructs(a.type, c)} off=${a.offset}`);
  }
  return out;
}

function resourceFacts(m: ModuleDecl, c: Canon): string[] {
  const r = reflect(m);
  const out: string[] = [];
  for (const g of r.bindGroups)
    for (const e of g.entries)
      out.push(
        `bind ${e.group}:${e.binding} ${e.name} ${e.space}${e.access ? '/' + e.access : ''} ` +
          `${e.resourceKind} struct=${e.structName ?? '-'} dim=${e.textureDim ?? '-'} elem=${e.textureElem ?? '-'}`,
      );
  for (const [kind, layouts] of [
    ['std140', r.uniforms],
    ['std430', r.storage],
  ] as const)
    for (const l of layouts) {
      out.push(
        `layout ${kind} ${subStructs(`struct:${l.name}`, c)} size=${l.size} align=${l.align}`,
      );
      for (const f of l.fields)
        out.push(
          `field ${l.name}.${f.name} ${subStructs(f.type, c)} off=${f.offset} align=${f.align} size=${f.size}`,
        );
    }
  for (const cap of r.requiredFeatures) out.push(`cap ${cap}`);
  return out;
}

function literalFacts(m: ModuleDecl, c: Canon): string[] {
  const out: string[] = [];
  const walkE = (e: Expr): void => {
    if (e.op === 'lit') out.push(`lit ${typeSig(e.type, c)}=${String(e.value)}`);
    for (const sub of subExprs(e)) walkE(sub);
  };
  for (const f of m.funcs) for (const s of f.body) eachStmtExpr(s, walkE);
  return out;
}

function constantFacts(m: ModuleDecl, c: Canon): string[] {
  const out: string[] = [];
  for (const o of m.overrides ?? [])
    out.push(`override ${o.name} ${typeSig(o.type, c)} = ${String(o.default)}`);
  for (const k of m.consts) out.push(constFact(k, c));
  out.push(...literalFacts(m, c));
  return out;
}

const constFact = (k: ConstDecl, c: Canon): string =>
  `const ${c.consts.get(k.name) ?? k.name} ${typeSig(k.type, c)} ` +
  `wgsl=${k.wgslValue} cpu=${k.cpuValue}` +
  (k.valueExpr === undefined ? '' : ` expr=${exprSig(k.valueExpr, c, new Map())}`);

function diffFacts(a: readonly string[], b: readonly string[], ignoreOrder: boolean): string[] {
  const key = (xs: readonly string[]): string[] =>
    ignoreOrder ? [...xs].sort() : xs.map((x, i) => `@${i} ${x}`);
  const left = key(a);
  const right = key(b);
  const counts = new Map<string, number>();
  for (const x of left) counts.set(x, (counts.get(x) ?? 0) + 1);
  for (const x of right) counts.set(x, (counts.get(x) ?? 0) - 1);
  const out: string[] = [];
  for (const [line, n] of counts) {
    for (let i = 0; i < n; i++) out.push(`-${line}`);
    for (let i = 0; i < -n; i++) out.push(`+${line}`);
  }
  return out.sort();
}

interface ModuleFacts {
  readonly interface: readonly string[];
  readonly resources: readonly string[];
  readonly constants: readonly string[];
  readonly controlFlow: readonly string[];
}

const BUCKETS = ['interface', 'resources', 'constants', 'controlFlow'] as const;

function moduleFacts(m: ModuleDecl, canonNames: boolean): ModuleFacts {
  const c = canonNames ? buildCanon(m) : EMPTY_CANON;
  return {
    interface: interfaceFacts(m, c),
    resources: resourceFacts(m, c),
    constants: constantFacts(m, c),
    controlFlow: controlFlowFacts(m, c),
  };
}

const diffAllFacts = (fa: ModuleFacts, fb: ModuleFacts, order: boolean): SemanticDiff => ({
  interface: diffFacts(fa.interface, fb.interface, order),
  resources: diffFacts(fa.resources, fb.resources, order),
  constants: diffFacts(fa.constants, fb.constants, order),
  controlFlow: diffFacts(fa.controlFlow, fb.controlFlow, order),
});

function resolvedLines(prev: readonly string[], next: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const l of prev) counts.set(l, (counts.get(l) ?? 0) + 1);
  for (const l of next) {
    const n = counts.get(l);
    if (n !== undefined) counts.set(l, n - 1);
  }
  const out: string[] = [];
  for (const [line, n] of counts) for (let i = 0; i < n; i++) out.push(line);
  return out;
}

/** Compare two modules at the IR and reflection layer. A textual diff of emitted source is
 *  hard to read once the optimizer and the production plugins have run; this comparison
 *  works above that noise.
 *
 *  It reports four buckets: the entry and vertex `interface`, the bind-group and layout
 *  `resources`, the `constants` (module consts, overrides, and the multiset of body literals),
 *  and the per-statement `controlFlow` skeleton. Empty in all four means the two modules agree
 *  on everything a host binds to and everything the code does. Each line is prefixed `-` for a
 *  fact only in `a` and `+` for one only in `b`, and {@link isSemanticallyEqual} is the
 *  all-empty test.
 *
 *  A pass that legitimately changes the program is not expected to be empty here. Inlining
 *  rewrites call sites and duplicates literals, which is exactly what the buckets report.
 *  Declare such a pass in `transforms`, the same plugin array the production emit takes, and
 *  every difference the declared pipeline provably causes moves into `explained`, one entry
 *  naming the plugin, the bucket and the line.
 *
 *  A line moves to `explained` only when applying that plugin's own `transformIR` to the
 *  reference side actually removes the line from the diff. A regression that merely looks like
 *  an optimizer rewrite stays in its bucket, so a check that compares a development build
 *  against a production build fails only on the unexplained differences.
 *
 *  Text-stage plugins explain nothing, because the comparison never sees emitted text. Declaring
 *  the full production array is therefore safe: {@link minify} and {@link aliasTypes}
 *  contribute no `explained` entries and remove no coverage, so you can pass the array you
 *  actually ship.
 *
 *  Renaming with {@link mangle} produces no differences under the default options, because
 *  `'names'` canonicalizes exactly the identifiers that pass is free to rewrite.
 *
 *  Exported from `typeshade`.
 *
 *  @param a - the reference module, the development side when `transforms` is declared.
 *  @param b - the module to compare against it, the transformed side.
 *  @param opts - the axes to disregard, `names` and `declOrder` by default, and optionally the
 *    declared transform pipeline.
 *  @returns the four buckets, and `explained` when `transforms` was declared.
 *
 *  @example
 *  ```ts
 *  import { semanticDiff, isSemanticallyEqual } from 'typeshade'
 *  import { inline, obfuscate } from 'typeshade/emit-prod'
 *
 *  const d = semanticDiff(devModule, prodModule, { transforms: [inline(), ...obfuscate()] })
 *  isSemanticallyEqual(d) // true when prod differs from dev only as the declared pipeline dictates
 *  d.explained // [{ transform: 'inline', bucket: 'controlFlow', line: '…' }, …]
 *  ```
 *
 *  @see {@link isSemanticallyEqual} for the all-empty test.
 *  @see {@link obfuscate} for the array to declare.
 */
export function semanticDiff(
  a: ModuleDecl,
  b: ModuleDecl,
  opts: SemanticDiffOptions & { readonly transforms: readonly EmitPlugin[] },
): ClassifiedSemanticDiff;
export function semanticDiff(
  a: ModuleDecl,
  b: ModuleDecl,
  opts?: SemanticDiffOptions,
): SemanticDiff;
export function semanticDiff(
  a: ModuleDecl,
  b: ModuleDecl,
  opts?: SemanticDiffOptions,
): SemanticDiff | ClassifiedSemanticDiff {
  const ignore = new Set<SemanticAspect>(opts?.ignore ?? ['names', 'declOrder']);
  const names = ignore.has('names');
  const order = ignore.has('declOrder');
  const fb = moduleFacts(b, names);
  let diff = diffAllFacts(moduleFacts(a, names), fb, order);
  if (opts?.transforms === undefined) return diff;
  const explained: ExplainedDiffEntry[] = [];
  let current = a;
  for (const p of opts.transforms) {
    if (p.transformIR === undefined) continue;
    current = p.transformIR(current);
    const next = diffAllFacts(moduleFacts(current, names), fb, order);
    const transform = p.identity ?? p.name;
    for (const bucket of BUCKETS)
      for (const line of resolvedLines(diff[bucket], next[bucket]))
        explained.push({ transform, bucket, line });
    diff = next;
  }
  return { ...diff, explained };
}
