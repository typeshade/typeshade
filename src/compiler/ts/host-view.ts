// Generate host TypeScript declarations and type spellings from analyzed exports and layouts.
import ts from 'typescript';
import {
  isGuard,
  type DrawBinding,
  type EntryBinding,
  type Layout,
} from '../../core/host-entry.js';
import type { HostNumber, HostType } from '../../core/host-values.js';
import type { StructDecl } from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import type { PackLayout } from '../../core/manifest-types.js';
import { type Pack } from '../../core/manifest.js';
import {
  CONSTRUCTOR,
  commentLines,
  memberKey,
  type DocBlock,
  type ExportDocs,
} from './host-docs.js';
import {
  type ClassExport,
  type FaceExport,
  type HostExport,
  type MemberCall,
} from './host-face-contracts.js';
import { baseClass, header } from './host-face-shared.js';
import { hostTypeOf } from './host-types.js';
import { keyTypeText } from './key-types.js';
import { HANDLE_TYPE_NAMES, SUPPORTED_TYPE_NAMES } from './type-map.js';

// The view spells each host value with the name of the host type family (change 0116,
// `src/runtime/host-types.ts`): a scalar, a vector, a matrix and an array by the name the shader
// writes, which `typeshade/runtime` exports as a name for the same host value. A struct goes by
// the name the view declares for it, as an argument and as a result (decision D7): the object of
// its fields for an `interface` or a `type`, and the class for an exported class. An enum, a key
// type and a `Record` keep the spelling the view gives them. The view imports the names it
// writes (`viewImports`).

/** The family's name of a vector of `n` components of `e`: `vec3`, `vec3i`, `vec3u`, `vec3b`,
 *  `vec3f64`. */
const vecName = (n: number, e: HostNumber | 'bool'): string =>
  `vec${n}${{ f32: '', i32: 'i', u32: 'u', bool: 'b', f64: 'f64' }[e]}`;

/** The family's name of a matrix of `c` columns and `r` rows: `mat4x4`, or `mat4x4<f64>`. */
const matName = (c: number, r: number, e: 'f32' | 'f64'): string =>
  `mat${c}x${r}${e === 'f64' ? '<f64>' : ''}`;

/** The TypeScript type a host passes for `t`: read-only at every level. A struct goes by the name
 *  `named` gives it (decision D7), and by its fields where the view declares no name for it. */
function argType(t: HostType, named: ReadonlyMap<string, string>): string {
  switch (t.k) {
    case 'num':
      return t.t;
    case 'bool':
      return 'bool';
    case 'key':
      return t.s;
    case 'void':
      return 'void';
    case 'vec':
      return vecName(t.n, t.e);
    case 'mat':
      return matName(t.c, t.r, t.e);
    case 'arr':
      return `array<${argType(t.e, named)}, ${t.n}>`;
    case 'rec':
      return `{ ${t.m.map((m) => `readonly ${JSON.stringify(m)}: ${argType(t.e, named)}`).join('; ')} }`;
    case 'struct':
      return (
        named.get(t.s) ??
        `{ ${t.f.map(([n, ft]) => `readonly ${n}: ${argType(ft, named)}`).join('; ')} }`
      );
  }
}

/** The `Buffer`s a value parameter of type `t`, spelled `spelled`, takes on a call on a resource
 *  (change 0138, Amendment A10, Q-C; Amendment A12, decision 4): a `Buffer` of one element for a
 *  number, a vector, a `bool` or a key; for a matrix a `Buffer` of it or of `f32` (Q3). A
 *  `Buffer<number>` (Q8) passes where a `Buffer` of `f32`, `i32` or `u32` does (`scalarBuffers`).
 *  Undefined for any other type. */
function bufferArgument(t: HostType, spelled: string): string | undefined {
  if (t.k === 'num' || t.k === 'vec' || t.k === 'bool' || t.k === 'key')
    return `Buffer<${spelled}>`;
  if (t.k === 'mat' && t.e === 'f32') return `Buffer<${spelled}> | Buffer<f32>`;
  return undefined;
}

/** No struct name: the spelling of a struct by its fields. */
const NO_NAMES: ReadonlyMap<string, string> = new Map();

/** The exported name of each struct of `exports` a signature writes by its name (decision D7): an
 *  exported `interface` or `type`, whose name is the object of its fields, and an exported class,
 *  whose name is the class. `results` leaves out an abstract class: it has no instance of its own,
 *  so a struct of it that a result holds is an object of its fields (change 0109, D1). */
export function structNames(exports: readonly FaceExport[], results: boolean): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of exports)
    if (e.kind === 'struct' || (e.kind === 'class' && !(results && e.abstract)))
      out.set(e.type.s, e.name);
  return out;
}

/** The TypeScript type a host gets back for `t`, as read-only as an argument (decision D1). An
 *  exported struct goes by its name. */
function resultType(t: HostType, named: ReadonlyMap<string, string>): string {
  switch (t.k) {
    case 'num':
    case 'bool':
    case 'key':
    case 'void':
    case 'vec':
    case 'mat':
      return argType(t, named);
    case 'arr':
      return `array<${resultType(t.e, named)}, ${t.n}>`;
    case 'rec':
      return `{ ${t.m.map((m) => `${JSON.stringify(m)}: ${resultType(t.e, named)}`).join('; ')} }`;
    case 'struct':
      return named.get(t.s) ?? structBody(t, named);
  }
}

/** The body of a type of fields, each with the spelling of its type: one line, or, when the author
 *  commented a field (change 0108), each field on its own line below its comment. */
function fieldsBody(
  fields: readonly (readonly [string, string])[],
  fieldDocs?: ReadonlyMap<string, readonly DocBlock[]>,
): string {
  if (fieldDocs === undefined || !fields.some(([n]) => fieldDocs.has(n)))
    return `{ ${fields.map(([n, t]) => `${n}: ${t}`).join('; ')} }`;
  const lines = fields.flatMap(([n, t]) => [
    ...commentLines(fieldDocs.get(n) ?? [], undefined, '  '),
    `  ${n}: ${t};`,
  ]);
  return `{\n${lines.join('\n')}\n}`;
}

function structBody(
  t: HostType & { k: 'struct' },
  named: ReadonlyMap<string, string>,
  fieldDocs?: ReadonlyMap<string, readonly DocBlock[]>,
): string {
  return fieldsBody(
    t.f.map(([n, ft]) => [n, resultType(ft, named)] as const),
    fieldDocs,
  );
}

/** The type of an `enum`'s value: one line, or, when the author commented a member (change 0108),
 *  each member on its own line below its comment. */
function enumBody(
  members: readonly (readonly [string, number])[],
  memberDocs?: ReadonlyMap<string, readonly DocBlock[]>,
): string {
  if (memberDocs === undefined || !members.some(([n]) => memberDocs.has(n)))
    return `{ ${members.map(([n, v]) => `readonly ${n}: ${v}`).join('; ')}; readonly [value: number]: string }`;
  const lines = members.flatMap(([n, v]) => [
    ...commentLines(memberDocs.get(n) ?? [], undefined, '  '),
    `  readonly ${n}: ${v};`,
  ]);
  return `{\n${lines.join('\n')}\n  readonly [value: number]: string;\n}`;
}

/** `T` as the element of `T[]`, parenthesized when it would bind wrong. */
const arrayElem = (s: string): string => (s.startsWith('readonly ') ? `(${s})` : s);

const TYPED_NAME = {
  f32: 'Float32Array',
  i32: 'Int32Array',
  u32: 'Uint32Array',
  f64: 'Float64Array',
} as const;

/** What a spelling from a layout reads to write a struct by its name (change 0116, decision D7):
 *  the names the view declares, and the declarations a struct's fields are read from. A layout
 *  carries no struct's name, so the spelling walks the binding's or the parameter's type beside
 *  it. */
export interface Naming {
  readonly named: ReadonlyMap<string, string>;
  readonly structs: ReadonlyMap<string, StructDecl>;
}

/** Whether `h` holds a key or a `Record`, which a binding and an array with no size hold as ids
 *  and an array in id order (Rule 8.21), where an argument holds strings and an object. */
const holdsKey = (h: HostType): boolean =>
  h.k === 'key' ||
  h.k === 'rec' ||
  (h.k === 'arr' && holdsKey(h.e)) ||
  (h.k === 'struct' && h.f.some(([, f]) => holdsKey(f)));

/** The name a struct of type `t` goes by in a binding or in an array with no size (decision D7):
 *  the name the view declares for it, where its host value there is the one its name spells.
 *  None where the view declares no name, and none for a struct that holds a key or a `Record`,
 *  whose host value there is not the one its name spells as an argument. */
function boundName(t: ShaderType | undefined, naming: Naming | undefined): string | undefined {
  if (t?.kind !== 'struct' || naming === undefined) return undefined;
  const name = naming.named.get(t.name);
  if (name === undefined) return undefined;
  const h = hostTypeOf(t, naming.structs);
  return 'none' in h || holdsKey(h) ? undefined : name;
}

/** The type of the field `name` of the struct `t`, read from its declaration. */
const fieldType = (
  t: ShaderType | undefined,
  name: string,
  naming: Naming | undefined,
): ShaderType | undefined =>
  t?.kind === 'struct'
    ? naming?.structs.get(t.name)?.fields.find((f) => f.name === name)?.type
    : undefined;

/** The TypeScript type of a binding's host value in the bindings object, spelled with the host
 *  type family (change 0116): a struct by the name `naming` gives its type `t` (decision D7), or
 *  by its fields, read-only where the entry only reads it and mutable where the call writes it
 *  back in place (Rule 8.21). A written binding of one scalar is a typed array of length one. An
 *  array with no size inside a struct is the typed array of its scalar, or an array of its
 *  elements. */
function bindingTsType(
  l: Layout,
  writes: boolean,
  top = true,
  t?: ShaderType,
  naming?: Naming,
): string {
  const ro = writes ? '' : 'readonly ';
  switch (l.k) {
    case 's':
      return top && writes ? TYPED_NAME[l.t] : l.t;
    case 'v':
      return vecName(l.n, l.t);
    case 'm':
      return matName(l.c, l.r, 'f32');
    case 'a': {
      const e = t?.kind === 'array' ? t.elem : undefined;
      if (l.n !== null) return `array<${bindingTsType(l.e, writes, false, e, naming)}, ${l.n}>`;
      if (l.e.k === 's' || l.e.k === 'v') return TYPED_NAME[l.e.t];
      return `${ro}${arrayElem(bindingTsType(l.e, writes, false, e, naming))}[]`;
    }
    case 'o':
      return (
        boundName(t, naming) ??
        `{ ${l.f.map(([n, , fl]) => `${ro}${n}: ${bindingTsType(fl, writes, false, fieldType(t, n, naming), naming)}`).join('; ')} }`
      );
  }
}

/** The type of an array with no size that a full-screen draw takes (Rules 8.21 and 11.8):
 *  `array<T>`, the host type family's name for its host value with a `Buffer` of it (change 0116,
 *  decision D3; change 0138, Amendment A10, Q-I), a struct `T` by its name (D7). `t` is the
 *  array's type. */
const unsizedType = (
  l: Layout & { k: 'a' },
  writes: boolean,
  t?: ShaderType,
  naming?: Naming,
): string =>
  `array<${bindingTsType(l.e, writes, false, t?.kind === 'array' ? t.elem : undefined, naming)}>`;

/** The plain host value of an array with no size, which a call with plain data takes (Rule 8.21):
 *  the typed array of its scalar, or a `readonly T[]` of its elements. */
const plainArray = (l: Layout & { k: 'a' }, t?: ShaderType, naming?: Naming): string =>
  bindingTsType(l, false, true, t, naming);

/** The `Buffer`s an array with no size of scalars, vectors or matrices takes on a call on a
 *  resource (change 0138, Amendments A10, Q-I, and A11, Q5): a `Buffer` of the element, and for a
 *  vector also a `Buffer` of its scalar, and for a matrix a `Buffer<f32>` (Amendment A12, B2-1);
 *  undefined for an array of structs (`resourceTypes`, and a result's `Buffer<S>`, A12 Q6). A
 *  `Buffer<number>`, whose element the call fixes (A12, Q8), is a `Buffer<f32>`, a `Buffer<i32>`
 *  and a `Buffer<u32>` to TypeScript already: `number` is each of them, so it is not spelled, and
 *  spelling it would let a `Buffer<i32>` pass where a `Buffer<f32>` is taken. */
const scalarBuffers = (l: Layout & { k: 'a' }): string | undefined => {
  // A matrix takes a `Buffer` of it and of `f32` (Amendment A12, B2-1).
  if (l.e.k === 's') return `Buffer<${l.e.t}>`;
  if (l.e.k === 'v') return `Buffer<${vecName(l.e.n, l.e.t)}> | Buffer<${l.e.t}>`;
  if (l.e.k === 'm') return `Buffer<${matName(l.e.c, l.e.r, 'f32')}> | Buffer<f32>`;
  return undefined;
};

/** The `Buffer`s a kernel function called on a resource returns for its result (change 0138,
 *  Amendment A10, Q-C): a `Buffer` of one element for a number, a vector, a `bool`, a key or a
 *  matrix of `f32` (Amendment A12, Q1, Q2 and Q4), a `Buffer` of `N` elements for an `array<T, N>`
 *  of them or of structs (A12, Q6), and for a struct or a `Record` an object of them with its own
 *  fields or members (Amendment A11, Q6; A12, Q5). Undefined for a result no `Buffer` holds: a
 *  matrix of `f64`, an `array<Record<K, T>, N>`, a nested sized array, a struct of a `Record`
 *  field as an array's element, and a struct that holds one (A12, decision 4). */
function bufferResult(t: HostType, named: ReadonlyMap<string, string>): string | undefined {
  const element = (e: HostType): string | undefined => {
    if (e.k === 'mat' && e.e === 'f64') return undefined;
    if (e.k === 'struct') return structElement(e) ? `Buffer<${argType(e, named)}>` : undefined;
    return e.k === 'num' || e.k === 'bool' || e.k === 'key' || e.k === 'vec' || e.k === 'mat'
      ? `Buffer<${argType(e, named)}>`
      : undefined;
  };
  switch (t.k) {
    case 'arr':
      return element(t.e);
    case 'struct':
    case 'rec': {
      const fields: string[] = [];
      const of: readonly (readonly [string, HostType])[] =
        t.k === 'struct' ? t.f : t.m.map((m) => [m, t.e] as const);
      for (const [n, ft] of of) {
        const b = bufferResult(ft, named);
        if (b === undefined) return undefined;
        fields.push(`readonly ${t.k === 'rec' ? JSON.stringify(n) : n}: ${b}`);
      }
      return `{ ${fields.join('; ')} }`;
    }
    case 'void':
      return undefined;
    default:
      return element(t);
  }
}

/** The `Buffer<S>` a result of an `array<S, N>` gives, spelled as a result spells `S`, for an
 *  `array<S>` parameter `type` whose `S` holds a key (Amendment A12, Q4 and Q6): the plain array
 *  holds the key's id, and the result's `S` its member. Undefined for any other parameter. */
function keyedResult(
  type: ShaderType | undefined,
  naming: Naming,
  named: ReadonlyMap<string, string>,
): string | undefined {
  if (type?.kind !== 'array') return undefined;
  const h = hostTypeOf(type.elem, naming.structs);
  if ('none' in h || !holdsKey(h)) return undefined;
  return `Buffer<${argType(h, named)}>`;
}

/** Whether a struct can be the element of a result `Buffer<S>` (Amendment A12, Q6): no field of
 *  it, at any depth, is a `Record` or a matrix of `f64`. */
function structElement(t: HostType): boolean {
  switch (t.k) {
    case 'rec':
      return false;
    case 'mat':
      return t.e === 'f32';
    case 'arr':
      return structElement(t.e);
    case 'struct':
      return t.f.every(([, ft]) => structElement(ft));
    default:
      return true;
  }
}

/** The fields of the bindings object of an entry (Rule 8.24), `typeOf` giving each binding's
 *  type, and with a struct by the name `naming` gives it (change 0116, decision D7). `types` are
 *  the call with plain data: each storage array with no size its plain host value. `draw` are a
 *  full-screen draw's, which also takes a `Buffer` of it. `queued` are the call on a resource
 *  (change 0138, R2): each written storage array with no size a `Buffer` alone (Amendment A10,
 *  Q-I), each read one also its plain value. `waiting` are the call on a resource that waits,
 *  where a written one may be its plain value too (Amendment A11, Q7). A `Buffer` or a `Uniform`
 *  of a class is added by `classResources`. The `_fp64` guard is the runtime's to bind and is
 *  left out. */
export function bindingsTypes(
  bindings: readonly DrawBinding[],
  typeOf: (name: string) => ShaderType | undefined,
  naming?: Naming,
): { types: string[]; draw: string[]; queued: string[]; waiting: string[] } {
  const types: string[] = [];
  const draw: string[] = [];
  const queued: string[] = [];
  const waiting: string[] = [];
  const all = (field: string): void => {
    types.push(field);
    draw.push(field);
    queued.push(field);
    waiting.push(field);
  };
  for (const b of bindings) {
    if ('guard' in b) continue;
    if (b.space === 'texture') {
      all(`readonly ${b.name}: ${IMAGE_SOURCE}`);
      continue;
    }
    if (b.space === 'sampler') {
      all(`readonly ${b.name}?: ${SAMPLING}`);
      continue;
    }
    if (!isBufferBinding(b)) continue;
    const t = typeOf(b.name);
    if (b.space === 'storage' && b.layout.k === 'a' && b.layout.n === null) {
      const plain = plainArray(b.layout, t, naming);
      const buffers = scalarBuffers(b.layout);
      const either = buffers === undefined ? plain : `${plain} | ${buffers}`;
      types.push(`readonly ${b.name}: ${plain}`);
      draw.push(`readonly ${b.name}: ${unsizedType(b.layout, b.writes, t, naming)}`);
      queued.push(`readonly ${b.name}: ${b.writes ? (buffers ?? 'never') : either}`);
      waiting.push(`readonly ${b.name}: ${either}`);
    } else all(`readonly ${b.name}: ${bindingTsType(b.layout, b.writes, true, t, naming)}`);
  }
  return { types, draw, queued, waiting };
}

/** A `texture_2d<f32>`'s host value (Rule 8.21), in the host view. */
const IMAGE_SOURCE =
  'ImageBitmap | ImageData | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | OffscreenCanvas | Texture';

/** A `sampler`'s host value (Rule 8.21), in the host view. */
const SAMPLING =
  "{ readonly filter?: 'nearest' | 'linear'; readonly address?: 'clamp' | 'repeat' | 'mirror' }";

export const isBufferBinding = (b: DrawBinding): b is EntryBinding =>
  b.space === 'uniform' || b.space === 'storage';

/** An object type of these members, `{}` for none. */
export const objectType = (members: readonly string[]): string =>
  members.length === 0 ? '{}' : `{ ${members.join('; ')} }`;

/** The text of the host view: what `tsc` reads for `import … from './name.shade.ts'`. */
/** What a draw or a dispatch may bind for a buffer of the host's own (change 0025): the shape
 *  of a `GPUBuffer`, which the runtime tells by `mapAsync` and `getMappedRange`. */
const GPU_BUFFER = '{ readonly mapAsync: unknown; readonly getMappedRange: unknown }';

/** Any typed array of numbers, which the runtime takes for a vector, a matrix or an array with
 *  a size, by its length. */
const NUMBERS = 'Float32Array | Int32Array | Uint32Array | Float64Array';

/** A buffer binding's host value (Rule 8.21) as a draw or a dispatch passes it, from its
 *  manifest layout: what the runtime's `pack` takes for each shape, spelled with the host type
 *  family (change 0116), and any typed array of numbers for a vector, a matrix and an array of
 *  scalars with a size, which the runtime takes by its length. A struct is the packed form of its
 *  fields, with its name beside it where `naming` gives its type `t` one (decision D8). An array
 *  with no size inside a struct is the typed array of its scalar, or an array of its elements. */
function packHostType(l: PackLayout, t?: ShaderType, naming?: Naming): string {
  switch (l.kind) {
    case 'scalar':
      return l.type;
    case 'vector':
      return `${vecName(l.size, l.type)} | ${NUMBERS}`;
    case 'matrix':
      return `${matName(l.columns, l.rows, 'f32')} | ${NUMBERS}`;
    case 'array': {
      const e = l.element;
      const te = t?.kind === 'array' ? t.elem : undefined;
      if (l.length === null)
        return e.kind === 'scalar' || e.kind === 'vector'
          ? TYPED_NAME[e.type]
          : `readonly (${packHostType(e, te, naming)})[]`;
      if (e.kind === 'scalar') return `array<${e.type}, ${l.length}> | ${NUMBERS}`;
      return `array<${packHostType(e, te, naming)}, ${l.length}>`;
    }
    case 'struct': {
      const packed = `{ ${l.fields.map((f) => `readonly ${f.name}: ${packHostType(f.layout, fieldType(t, f.name, naming), naming)}`).join('; ')} }`;
      const name = boundName(t, naming);
      return name === undefined ? packed : `${name} | ${packed}`;
    }
  }
}

/** A binding's array with no size as a draw or a dispatch passes it as plain data: the typed array
 *  of its scalar, or a `readonly T[]` with each element as the runtime's `pack` takes it (change
 *  0116, decision D3). `t` is the array's type. */
function packUnsizedType(
  l: PackLayout & { kind: 'array' },
  t?: ShaderType,
  naming?: Naming,
): string {
  const e = l.element;
  return e.kind === 'scalar' || e.kind === 'vector'
    ? TYPED_NAME[e.type]
    : `readonly (${packHostType(e, t?.kind === 'array' ? t.elem : undefined, naming)})[]`;
}

/** The type argument of the view's `Pack`: for each entry, the bindings it reaches, each with
 *  the values a draw or a dispatch may pass for it (change 0030). A buffer takes its host value
 *  or the host's own buffer, and a storage array with no size also a `Buffer` of its scalars,
 *  which holds its values on the device (change 0025; change 0138, Amendment A10, Q-I); a texture or a sampler takes the runtime's or the
 *  host's own object. A binding the emit adds is the runtime's to bind and is left out. */
function programType(pack: Pack, types?: ViewTypes): string {
  const byName = new Map(pack.bindings.map((b) => [b.name, b]));
  const entries = pack.entries.map((e) => {
    const fields = (e.bindings ?? []).flatMap(({ name }) => {
      const b = byName.get(name);
      if (b === undefined || b.injected === true) return [];
      const kind = b.resource.resourceKind;
      if (kind !== 'uniform-buffer' && kind !== 'storage-buffer')
        return [`readonly ${name}: object`];
      if (b.layout === undefined) return [`readonly ${name}: ${GPU_BUFFER}`];
      const type = types?.binding(name);
      // An array with no size is its plain host value or a `Buffer` of its scalars (change 0116;
      // Amendment A10, Q-I).
      if (b.layout.kind === 'array' && b.layout.length === null) {
        const e = b.layout.element;
        const buffers =
          e.kind === 'scalar'
            ? ` | Buffer<${e.type}>`
            : e.kind === 'vector'
              ? ` | Buffer<${vecName(e.size, e.type)}> | Buffer<${e.type}>`
              : '';
        return [
          `readonly ${name}: ${packUnsizedType(b.layout, type, types?.naming)}${buffers} | ${GPU_BUFFER}`,
        ];
      }
      const t = packHostType(b.layout, type, types?.naming);
      return [`readonly ${name}: ${t} | ${GPU_BUFFER}`];
    });
    return `readonly ${e.name}: { ${fields.join('; ')} }`;
  });
  return `{ ${entries.join('; ')} }`;
}

/** The workgroup count of an entry call in the host view (Rule 8.24): `n`, `[x, y?, z?]`, or the
 *  three counts at element `offset` of a `Buffer<u32>` (change 0075; change 0138, Amendment A10,
 *  Q-I), which a `Buffer<number>` is too: the call fixes it as `u32` (Amendment A12, D3). */
const WORKGROUPS =
  'number | readonly [number, number?, number?] | { readonly indirect: Buffer<u32>; readonly offset?: number }';

/** The sentence of the view for what a host cannot call (Rule 8.20): an export, and a member or the
 *  constructor of an exported class declared `never` (change 0109). */
const notCallable = (reason: string): string =>
  `Not callable from host code (Rule 8.20): ${reason}.`;

/** How a call is made, which the sentence of a kernel function and of a `@compute` entry say where
 *  the developer reads (change 0108; change 0138, R2, Amendments A10 and A11). */
const callForms =
  ' Called with plain data, the call is awaited and writes back each array it writes (Rule 8.21). Called on a resource (a Buffer, a Uniform, or a binding the module exports), it does not block: the runtime submits it when the current microtask checkpoint ends or at the next read() or call, each call sees the values of its own call, and its error is thrown at the next read() or call with the line of the call (change 0138, R2). A call on a resource that writes a plain array waits, fills it, and gives its result as plain data (Amendment A11, Q7).';

/** The resource types a call on a resource takes in place of a value of the exported class
 *  `cls` (change 0138, R2): a `Uniform` of it where it has a uniform layout, a `Buffer` of it
 *  for an array with no size where it has a storage layout. Each is written as the type of an
 *  exported binding, which a `Uniform` or a `Buffer` the host makes is assignable to. */
function resourceTypes(
  exports: readonly FaceExport[],
): (cls: string, kind: 'uniform' | 'buffer') => string | undefined {
  const classes = new Map(
    exports.flatMap((e) => (e.kind === 'class' && !e.abstract ? [[e.name, e] as const] : [])),
  );
  return (cls, kind) => {
    const c = classes.get(cls);
    if (c === undefined) return undefined;
    if (kind === 'uniform')
      return c.layouts.u === undefined
        ? undefined
        : `Omit<Uniform<${cls}>, 'dispose' | keyof Disposable>`;
    return c.layouts.s === undefined
      ? undefined
      : `Omit<Buffer<${cls}>, 'dispose' | keyof Disposable>`;
  };
}

/** What the view reads beside the exports to write a struct by its name (change 0116, decisions
 *  D7 and D8): the names, and the type of each binding and of each parameter of a function. */
export interface ViewTypes {
  readonly naming: Naming;
  readonly binding: (name: string) => ShaderType | undefined;
  readonly param: (fn: string, name: string) => ShaderType | undefined;
}

/** The bindings object `fields` of a `@compute` entry's call on a resource (Rule 8.24; change
 *  0138, R2), with a `Uniform` of the class where a uniform binding holds one, and a `Buffer` of
 *  it where a storage array with no size holds them. */
function classResources(
  e: HostExport & { kind: 'compute' },
  fields: readonly string[],
  types: ViewTypes,
  resource: (cls: string, kind: 'uniform' | 'buffer') => string | undefined,
): string {
  return objectType(
    fields.map((field) => {
      const b = e.entry.bindings.find((x) => field.startsWith(`readonly ${x.name}: `));
      if (b === undefined || !isBufferBinding(b)) return field;
      const t = types.binding(b.name);
      let extra: string | undefined;
      if (b.space === 'uniform')
        extra = resource(bindingTsType(b.layout, false, true, t, types.naming), 'uniform');
      else if (b.layout.k === 'a' && b.layout.n === null && b.layout.e.k === 'o')
        extra = resource(
          bindingTsType(
            b.layout.e,
            b.writes,
            false,
            t?.kind === 'array' ? t.elem : undefined,
            types.naming,
          ),
          'buffer',
        );
      if (extra === undefined) return field;
      return field.endsWith(': never') ? field.replace(/never$/, extra) : `${field} | ${extra}`;
    }),
  );
}

export function viewText(
  stem: string,
  exports: readonly FaceExport[],
  runtime: string,
  pack: Pack,
  docs: ReadonlyMap<string, ExportDocs>,
  types: ViewTypes,
): string {
  const program = programType(pack, types);
  // An exported struct goes by its exported name wherever it stands in a result, and so does
  // an exported class, whose instance a result is (change 0109); an abstract class has no
  // instance, so its struct stays an object of its fields. An argument takes the name of every
  // exported struct and class (change 0116, decision D7).
  const named = structNames(exports, true);
  const args = types.naming.named;
  // The resources a call on a resource takes (change 0138, R2).
  const resource = resourceTypes(exports);
  // The declarations first: the imports are the names they write (`viewImports`).
  const out: string[] = [];
  for (const e of exports) {
    // The comment above an export: the author's JSDoc, and the view's own sentence, if it writes
    // one, at the end of the last block (change 0108).
    const doc = docs.get(e.name);
    const above = (sentence?: string): string[] => commentLines(doc?.blocks ?? [], sentence);
    switch (e.kind) {
      case 'function': {
        const params = e.params.map((p) => `${p.name}: ${argType(p.type, args)}`).join(', ');
        out.push(
          ...above(),
          `export declare function ${e.name}(${params}): ${resultType(e.result, named)};`,
        );
        break;
      }
      case 'const':
        out.push(...above(), `export declare const ${e.name}: ${constType(e.type)};`);
        break;
      case 'enum': {
        const values = [...new Set(e.members.map(([, v]) => v))].join(' | ') || 'never';
        out.push(
          ...above(),
          `export declare const ${e.name}: ${enumBody(e.members, doc?.members)};`,
          `export type ${e.name} = ${values};`,
        );
        break;
      }
      case 'struct':
        out.push(
          ...above(),
          `export interface ${e.name} ${structBody(e.type, named, doc?.members)}`,
        );
        break;
      case 'class':
        out.push(...classView(e, exports, named, args, doc));
        break;
      case 'shape':
        out.push(
          ...above(`A type with no host value (Rule 8.21): ${e.reason}.`),
          `export interface ${e.name} ${fieldsBody(
            e.fields.map(
              ([n, t]) => [n, t === undefined ? 'never' : resultType(t, named)] as const,
            ),
            doc?.members,
          )}`,
        );
        break;
      case 'compute': {
        const [x, y, z] = e.entry.wg;
        const constants =
          'options?: { readonly constants?: Readonly<Record<string, number | boolean>> }';
        out.push(
          ...above(
            `An \`@compute([${x}, ${y}, ${z}])\` entry: \`workgroups\` counts workgroups, dispatched as written, or is \`{ indirect, offset? }\`, the three counts at element \`offset\` of a Buffer<u32> a call wrote (change 0075). The shape shown is its default; options.constants selects declared overrides without changing workgroups (Rules 8.24 and 11.8).${callForms}`,
          ),
          // A call with plain data, awaited (Rule 8.21).
          `export declare function ${e.name}(bindings: ${e.bindingsType}, workgroups: ${WORKGROUPS}, ${constants}): Promise<void>;`,
        );
        if (e.queuedType !== undefined) {
          // A call on a resource does not block (change 0138, R2); one that writes a plain array
          // waits (Amendment A11, Q7).
          const { queued, waiting } = bindingsTypes(e.entry.bindings, types.binding, types.naming);
          const onResource = classResources(e, queued, types, resource);
          // A written array of structs of no class takes no `Buffer` (Amendment A11, Q4).
          if (!/: never(;| })/.test(onResource))
            out.push(
              `export declare function ${e.name}(bindings: ${onResource}, workgroups: ${WORKGROUPS}, ${constants}): void;`,
            );
          out.push(
            `export declare function ${e.name}(bindings: ${classResources(e, waiting, types, resource)}, workgroups: ${WORKGROUPS}, ${constants}): Promise<void>;`,
          );
        }
        break;
      }
      case 'kernel': {
        const f = e.face;
        // The parameters of a call with plain data (`plain`), of a call on a resource that does not
        // block (`resource`), and of one that waits (`waits`, Amendment A11, Q7).
        const params = (mode: 'plain' | 'resource' | 'waits'): string =>
          f.params
            .map((p) => {
              if (p.k === 'value') {
                const t = argType(p.type, args);
                if (mode === 'plain') return `${p.name}: ${t}`;
                // A uniform of the class (change 0138, R2), and for a number or a vector a
                // `Buffer` of one element, another call's result (Amendment A10, Q-C).
                const u = resource(t, 'uniform');
                const one = bufferArgument(p.type, t);
                return `${p.name}: ${[t, u, one].filter((x) => x !== undefined).join(' | ')}`;
              }
              // A storage texture is a device's texture; a sampled one any image (change 0077).
              if (p.k === 'texture')
                return `${p.name}: ${p.storage !== undefined ? 'Texture' : IMAGE_SOURCE}`;
              // ECMAScript's own Map and Set, by reference (change 0080).
              if (p.k === 'collection')
                return p.value === undefined
                  ? `${p.name}: Set<${p.keys === undefined ? p.key : keyTypeText(p.keys)}>`
                  : `${p.name}: Map<${p.keys === undefined ? p.key : keyTypeText(p.keys)}, ${argType(p.value, args)}>`;
              const type = types.param(f.fn, p.name);
              const plain = plainArray(p.layout, type, types.naming);
              // A `Buffer` of the scalars (Amendment A10, Q-I), or of the class (R2).
              const element =
                p.layout.e.k === 'o'
                  ? bindingTsType(
                      p.layout.e,
                      p.writes,
                      false,
                      type?.kind === 'array' ? type.elem : undefined,
                      types.naming,
                    )
                  : undefined;
              const buffers = [
                scalarBuffers(p.layout),
                // A `Buffer<K>` of the same key (Amendment A12, B2-2).
                p.keys !== undefined ? `Buffer<${keyTypeText(p.keys)}>` : undefined,
                // A `Buffer` of the class (R2), and a result's `Buffer<S>` (Amendment A12, Q6).
                element !== undefined
                  ? (resource(element, 'buffer') ?? `Buffer<${element}>`)
                  : undefined,
                // A result's `Buffer<S>` of an `S` that holds a key is spelled with its members,
                // where the plain array holds ids (Rule 8.21; A12, Q4 and Q6).
                element !== undefined ? keyedResult(type, types.naming, args) : undefined,
              ].filter((x) => x !== undefined);
              const either = buffers.length === 0 ? plain : `${plain} | ${buffers.join(' | ')}`;
              const array =
                mode === 'plain'
                  ? plain
                  : mode === 'resource' && p.writes
                    ? buffers.join(' | ') || 'never'
                    : either;
              // An array a loop pushes onto may come with its length, a `Buffer<u32>` (change
              // 0094, decision D5; Amendment A10, confirmation item 3), on a call on a resource.
              return p.pushed === true && p.out !== true && mode !== 'plain'
                ? `${p.name}: ${array} | { readonly array: ${array}; readonly length: Buffer<u32>; readonly offset?: number }`
                : `${p.name}: ${array}`;
            })
            .join(', ');
        // A function with no loop is its stores alone, one invocation (change 0094, D7).
        const where =
          f.gpu === undefined
            ? `It runs on the CPU: ${f.noGpu ?? 'unknown'}`
            : f.gpu.loops.length === 0
              ? 'Its stores run on the GPU in one invocation where there is WebGPU, and on the CPU otherwise'
              : 'Each of its loops runs on the GPU, one invocation per iteration, where there is WebGPU, and on the CPU otherwise';
        // A held length (change 0094), on the arrays a loop pushes onto.
        const pushes = f.params.some((p) => p.k === 'array' && p.pushed === true && p.out !== true)
          ? ' An array it pushes onto may come as { array, length, offset? }: its pushes start at the length the Buffer<u32> length holds at offset, and the call leaves the new length there (Rule 8.23).'
          : '';
        // A range the device holds (change 0094, part 1).
        const counted =
          f.gpu?.loops.some((l) => l.device !== undefined) === true
            ? " A loop whose trip count it reads from an array runs from a count the GPU computes, with nothing read back, and its writes past an array's end are dropped (Rule 8.21)."
            : '';
        // What a call on a resource returns (Amendment A10, Q-C): nothing, or its `Buffer`s.
        const buffers = f.result.k === 'void' ? 'void' : bufferResult(f.result, named);
        const returns =
          f.result.k === 'void'
            ? ''
            : buffers === undefined
              ? ` Its result is ${f.result.s}, which no Buffer holds, so a call on a resource that does not wait is refused.`
              : ' Called on a resource, it returns its result at once as Buffers: one element for a number, a vector, a bool, a key or a matrix, N for an array<T, N>, and for a struct or a Record an object of them by field; another call takes each as an argument, and read() gives its values (Amendment A10, Q-C; Amendment A12, decision 4).';
        out.push(
          ...above(
            `A kernel function (Rule 8.22). ${where}.${counted}${pushes}${callForms}${returns}`,
          ),
          `export declare function ${e.name}(${params('plain')}): Promise<${resultType(f.result, named)}>;`,
        );
        // A call on a resource (change 0138, R2): one that does not block, and one that writes a
        // plain array and waits (Amendment A11, Q7).
        // An array of structs of no class takes no `Buffer` (Amendment A11, Q4): a call that writes
        // one on a resource waits.
        const noBuffer = f.params.some(
          (p) => p.k === 'array' && p.writes && params('resource').includes(`${p.name}: never`),
        );
        if (buffers !== undefined && !noBuffer && params('resource') !== params('plain'))
          out.push(`export declare function ${e.name}(${params('resource')}): ${buffers};`);
        if (
          f.params.some((p) => p.k === 'array' && p.writes) &&
          params('waits') !== params('plain')
        )
          out.push(
            `export declare function ${e.name}(${params('waits')}): Promise<${resultType(f.result, named)}>;`,
          );
        break;
      }
      case 'fragment':
        out.push(
          ...above(
            `A full-screen \`@fragment\` entry: draws one frame into \`target\`, filling its width by height, on WebGPU, then WebGL2, then the CPU. The first draw into a canvas decides its tier. The promise resolves when the frame is submitted; nothing is read back (Rule 8.24).`,
          ),
          `export declare function ${e.name}(target: HTMLCanvasElement | OffscreenCanvas, bindings${e.entry.bindings.every(isGuard) ? '?' : ''}: ${e.bindingsType}): Promise<void>;`,
        );
        break;
      case 'resource': {
        // It lives as long as its module, so its type has no `dispose()` and no
        // `[Symbol.dispose]()` (Amendment A5, D7); `keyof Disposable` is `never` under a `lib`
        // that declares no `Symbol.dispose`.
        const type = `Omit<${e.length === undefined ? 'Uniform' : 'Buffer'}<${e.cls}>, 'dispose' | keyof Disposable>`;
        out.push(
          ...above(
            `A binding of the module, a host resource (Rule 6.1, change 0138): set its fields with \`set\` and read them with \`get\`; each \`set\` writes only what changed and marks its bytes dirty. It lives as long as the module, so it has no \`dispose()\`.${e.length === null ? ' The shader states no size for this storage array, so the host sets its length: call \`resize(n)\` or \`set(data)\` before \`at\` or \`read\`, which throw a \`TypeError\` until then.' : ''}${typeof e.length === 'number' ? ' A kernel function takes it as an argument, and such a call does not block; an entry call refuses it with a TypeError and takes a plain array of its elements, as before (Rules 8.21 and 8.24).' : ' An entry call takes it in its bindings object, and a kernel function as an argument; such a call does not block (Rules 8.21 and 8.24).'}`,
          ),
          `export declare const ${e.name}: ${type};`,
        );
        break;
      }
      case 'never': {
        out.push(...above(notCallable(e.reason)));
        if (e.typeOnly) out.push(`export type ${e.name} = never;`);
        else out.push(`export declare const ${e.name}: never;`);
        break;
      }
    }
  }
  out.push(
    '/** The compiled program, its manifest: the shader text, each binding with its byte layout and each entry with the bindings it reaches, which the program runtime loads (Rule 11.10). */',
    `declare const program: Pack<${program}>;`,
    'export default program;',
  );
  return `${[header(stem), ...viewImports(out.join('\n'), runtime), ...out].join('\n')}\n`;
}

/** The names of the host type family (change 0116) in the order a view imports them: each
 *  authorable value type the compiler maps by its name, and `array`. `host-types.test.ts` holds
 *  `src/runtime/host-types.ts` to the same names, through the ambient library. */
const FAMILY_NAMES: readonly string[] = [
  ...SUPPORTED_TYPE_NAMES.filter((n) => !HANDLE_TYPE_NAMES.has(n)),
  'array',
];

/** The import lines of a view whose declarations are `body`: each name of the host type family
 *  the declarations write as a type (change 0116), `Buffer` and `Texture` where they write
 *  them, and `Pack`, which the default export always writes. A name is imported only where a
 *  declaration writes it, so a host project that refuses an unused import (`noUnusedLocals`)
 *  takes the view; the names are read off the declarations as TypeScript parses them, so a
 *  comment, a string and a name of a field or a parameter are no use of a type. */
function viewImports(body: string, runtime: string): string[] {
  const sf = ts.createSourceFile('view.ts', body, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const used = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName)) used.add(n.typeName.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const from = JSON.stringify(runtime);
  const family = FAMILY_NAMES.filter((n) => used.has(n));
  return [
    ...(family.length > 0 ? [`import type { ${family.join(', ')} } from ${from};`] : []),
    `import type { Pack } from ${from};`,
    // A texture binding also takes a program runtime's Texture, bound as it is (change 0025).
    ...(used.has('Texture') ? [`import type { Texture } from ${from};`] : []),
    // An exported binding is a host resource (change 0138, R10).
    ...(used.has('Uniform') ? [`import type { Uniform } from ${from};`] : []),
    ...(used.has('Buffer') ? [`import type { Buffer } from ${from};`] : []),
  ];
}

/** A member of an exported class as the view writes it (Rule 8.20, D3). */
interface MemberView {
  readonly kind: 'method' | 'accessor' | 'never';
  /** What the view declares for it: one line for a method, a line for each half of an accessor
   *  (a getter and a setter), one line for a member declared `never`. Each line has the keys of
   *  the author's blocks that stand above it (change 0108): those of the method, of the half, and,
   *  for a member declared `never`, of every declaration of it. */
  readonly declarations: readonly { readonly keys: readonly string[]; readonly line: string }[];
  /** Why a host cannot call a member declared `never`; its sentence ends the last block. */
  readonly reason?: string;
}

/** The view's declarations of each member of an exported class, by the name and whether it is
 *  static: its signature in host types, or `never` with the reason (Rule 8.20, D3). A result names
 *  a struct by `named`, and an argument by `args` (change 0116, decision D7). */
function memberLines(
  e: ClassExport,
  named: ReadonlyMap<string, string>,
  args: ReadonlyMap<string, string>,
): Map<string, MemberView> {
  const out = new Map<string, MemberView>();
  const params = (call: MemberCall): string =>
    call.params.map((p) => `${p.name}: ${argType(p.type, args)}`).join(', ');
  for (const m of e.members) {
    const lead = `${m.abstract ? 'abstract ' : ''}${m.static ? 'static ' : ''}`;
    const key = `${m.static ? 'static ' : ''}${m.name}`;
    const refused = (keys: readonly string[], reason: string): MemberView => ({
      kind: 'never',
      declarations: [{ keys, line: `  ${key}: never;` }],
      reason,
    });
    if (m.kind === 'method') {
      const call = m.call;
      out.set(
        key,
        'reason' in call
          ? refused([memberKey(m.name, { isStatic: m.static })], call.reason)
          : {
              kind: 'method',
              declarations: [
                {
                  keys: [memberKey(m.name, { isStatic: m.static })],
                  line: `  ${lead}${m.name}(${params(call)}): ${call.self ? e.name : resultType(call.result, named)};`,
                },
              ],
            },
      );
      continue;
    }
    const half = (h: 'get' | 'set') => memberKey(m.name, { isStatic: m.static, half: h });
    if (m.reason !== undefined) {
      out.set(key, refused([half('get'), half('set')], m.reason));
      continue;
    }
    const declarations: { keys: string[]; line: string }[] = [];
    if (m.get !== undefined)
      declarations.push({
        keys: [half('get')],
        line: `  ${lead}get ${m.name}(): ${resultType(m.get.result, named)};`,
      });
    if (m.set !== undefined) {
      const p = m.set.params[0];
      declarations.push({
        keys: [half('set')],
        line: `  ${lead}set ${m.name}(${p === undefined ? '' : `${p.name}: ${argType(p.type, args)}`});`,
      });
    }
    out.set(key, { kind: 'accessor', declarations });
  }
  return out;
}

/** Whether the view declares two members alike: the same lines, and the same reason. The author's
 *  blocks are not compared, so a member the view takes from the class above stands there. */
const sameMember = (a: MemberView, b: MemberView): boolean =>
  a.kind === b.kind &&
  a.reason === b.reason &&
  a.declarations.length === b.declarations.length &&
  a.declarations.every((d, i) => d.line === b.declarations[i]!.line);

/** The declaration of an exported class in the view (change 0109): `export declare class`, or
 *  `abstract class`, with its constructor, its fields and its members in host types, and its
 *  `extends` when the class above it is exported as a class too (D2). A class below declares
 *  what it adds or changes; one whose member would change the kind of the one above it (a method
 *  where the class above is `never`) is declared whole, with no `extends`. The author's comment
 *  of the class stands above it, and that of each field, the constructor and each member the view
 *  declares on its line (change 0108); a member declared `never` has the sentence of change 0109
 *  at the end of the last block. */
function classView(
  e: ClassExport,
  exports: readonly FaceExport[],
  named: ReadonlyMap<string, string>,
  args: ReadonlyMap<string, string>,
  doc?: ExportDocs,
): string[] {
  const own = memberLines(e, named, args);
  let base = baseClass(e, exports);
  const above = base === undefined ? new Map<string, MemberView>() : memberLines(base, named, args);
  for (const [key, m] of own) {
    const was = above.get(key);
    if (was !== undefined && was.kind !== m.kind) base = undefined;
  }
  /** The author's blocks kept under `keys`, in the order of the keys. */
  const blocks = (keys: readonly string[]): DocBlock[] =>
    keys.flatMap((k) => doc?.members.get(k) ?? []);
  const lines: string[] = [];
  const ctor = e.ctor;
  if (ctor !== undefined) {
    if ('reason' in ctor)
      lines.push(
        ...commentLines(blocks([CONSTRUCTOR]), notCallable(ctor.reason), '  '),
        '  protected constructor();',
      );
    else
      lines.push(
        ...commentLines(blocks([CONSTRUCTOR]), undefined, '  '),
        `  constructor(${'fn' in ctor ? ctor.params.map((p) => `${p.name}: ${argType(p.type, args)}`).join(', ') : ''});`,
      );
  }
  const inherited = new Set(base?.type.f.map(([n]) => n) ?? []);
  for (const f of e.fields)
    if (!inherited.has(f.name))
      lines.push(
        ...commentLines(blocks([f.name]), undefined, '  '),
        `  ${f.access !== undefined ? `${f.access} ` : ''}${f.readonly ? 'readonly ' : ''}${f.name}: ${resultType(f.type, named)};`,
      );
  for (const [key, m] of own) {
    const was = above.get(key);
    if (base !== undefined && was !== undefined && sameMember(was, m)) continue;
    const sentence = m.reason === undefined ? undefined : notCallable(m.reason);
    for (const d of m.declarations)
      lines.push(...commentLines(blocks(d.keys), sentence, '  '), d.line);
  }
  return [
    ...commentLines(doc?.blocks ?? []),
    `export declare ${e.abstract ? 'abstract ' : ''}class ${e.name}${base !== undefined ? ` extends ${base.name}` : ''} {`,
    ...lines,
    '}',
  ];
}

/** A constant's host type: read-only at every level, since the host gets a frozen copy. A struct
 *  is the object of its fields, since the copy is one and no instance of a class (change 0109),
 *  and is no argument or result for the name of decision D7 (change 0116). */
function constType(t: HostType): string {
  return argType(t, NO_NAMES);
}
