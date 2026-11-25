import type { ImportHooks } from '../../compiler/ts/link.js';
import type { TypeshadeLanguageService } from './types.js';

export const readers = new WeakMap<TypeshadeLanguageService, ImportHooks>();

export function importHooksOf(service: TypeshadeLanguageService): ImportHooks {
  return readers.get(service) ?? {};
}
