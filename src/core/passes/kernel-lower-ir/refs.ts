import type { Expr } from '../../ir/nodes.js';
import type { ShaderType } from '../../ir/types.js';
import { u32T } from '../../ir/types.js';

export const boolT: ShaderType = { kind: 'scalar', scalar: 'bool' };

export const kRef: Expr = { op: 'varref', type: u32T, name: '_k' };

export const liveRef: Expr = { op: 'varref', type: boolT, name: '_live' };
