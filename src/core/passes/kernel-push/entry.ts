import type { Expr, FuncDecl, Stmt } from '../../ir/nodes.js';
import { u32T } from '../../ir/types.js';
import { KERNEL_TREE, KERNEL_WORKGROUP } from '../../kernel-tree.js';
import { invocationIndex, u, vec3u, workgroupFirst } from '../../kernel-workgroup.js';
import { boolT, kRef } from '../kernel-lower-ir.js';

export const kcRef: Expr = { op: 'varref', type: u32T, name: '_kc' };

export function laneScaffold(wg: number, n: Expr): Stmt[] {
  return [
    invocationIndex(wg),
    {
      s: 'if',
      arms: [
        {
          cond: { op: 'compare', type: boolT, cop: '>=', a: workgroupFirst(wg), b: n },
          body: [{ s: 'return' }],
        },
      ],
    },
    { s: 'let', name: '_live', expr: { op: 'compare', type: boolT, cop: '<', a: kRef, b: n } },
    {
      s: 'let',
      name: '_kc',
      expr: {
        op: 'call',
        type: u32T,
        fn: 'min',
        args: [kRef, { op: 'binop', type: u32T, bop: '-', a: n, b: u(1) }],
      },
    },
  ];
}

function entryParams(tree: boolean, subgroup = false): FuncDecl['params'] {
  return [
    { name: '_gid', type: vec3u, builtin: 'global_invocation_id' },
    { name: '_nwg', type: vec3u, builtin: 'num_workgroups' },
    { name: '_wid', type: vec3u, builtin: 'workgroup_id' },
    ...(tree ? [{ name: '_lid', type: u32T, builtin: 'local_invocation_index' }] : []),
    ...(subgroup
      ? [
          { name: '_sgi', type: u32T, builtin: 'subgroup_invocation_id' },
          { name: '_sgid', type: u32T, builtin: 'subgroup_id' },
          { name: '_nsg', type: u32T, builtin: 'num_subgroups' },
        ]
      : []),
  ];
}

export function computeEntry(
  name: string,
  body: Stmt[],
  tree: boolean,
  size: number = KERNEL_WORKGROUP,
  variant?: 'reduce' | 'scatter',
): FuncDecl {
  const wg = tree ? KERNEL_TREE : size;
  return {
    name,
    params: entryParams(tree, variant === 'reduce'),
    ret: { kind: 'void' },
    body,
    stage: 'compute',
    workgroupSize: wg,
    // Why: the scatter fold branches on subgroupAny, uniform by construction, but Tint (Chrome for Testing 153, 2026-11-03) does not read it as uniform.
    attrs: [
      `@compute @workgroup_size(${wg})`,
      ...(variant === 'scatter' ? ['@diagnostic(off, subgroup_uniformity)'] : []),
    ],
  };
}
