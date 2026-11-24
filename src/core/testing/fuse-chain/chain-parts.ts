import { f32T } from '../../ir/index.js';
import type { ChainAccess, ChainArray } from '../random-ir.js';

export const accessOf = (
  param: string,
  array: string,
  reads: ChainAccess['reads'],
  writes: ChainAccess['writes'],
): ChainAccess => ({ param, array, reads, writes, conditional: false, measures: false });

export const arrayOfN = (id: string, o: { written: boolean; scratch: boolean }): ChainArray => ({
  id,
  elem: f32T,
  length: { of: 'n', times: 1 },
  ...o,
});
