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
import { baseClass, header, propName, sameField } from './host-face-shared.js';
import { madeView, TYPED_NAME } from './host-face/made.js';
import { bufferArgument } from './host-view/buffer-argument.js';
import { hostTypeOf } from './host-types.js';
import { keyTypeText } from './key-types.js';
import { HANDLE_TYPE_NAMES, SUPPORTED_TYPE_NAMES } from './type-map.js';

const vecName = (n: number, e: HostNumber | 'bool'): string =>
  `vec${n}${{ f32: '', i32: 'i', u32: 'u', bool: 'b', f64: 'f64' }[e]}`;

const matName = (c: number, r: number, e: 'f32' | 'f64'): string =>
  `mat${c}x${r}${e === 'f64' ? '<f64>' : ''}`;

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
        `{ ${t.f.map(([n, ft]) => `readonly ${propName(n)}: ${argType(ft, named)}`).join('; ')} }`
      );
  }
}

const NO_NAMES: ReadonlyMap<string, string> = new Map();

export function structNames(exports: readonly FaceExport[], results: boolean): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of exports)
    if (e.kind === 'struct' || (e.kind === 'class' && !(results && e.abstract)))
      out.set(e.type.s, e.name);
  return out;
}

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

function fieldsBody(
  fields: readonly (readonly [string, string])[],
  fieldDocs?: ReadonlyMap<string, readonly DocBlock[]>,
): string {
  if (fieldDocs === undefined || !fields.some(([n]) => fieldDocs.has(n)))
    return `{ ${fields.map(([n, t]) => `${propName(n)}: ${t}`).join('; ')} }`;
  const lines = fields.flatMap(([n, t]) => [
    ...commentLines(fieldDocs.get(n) ?? [], undefined, '  '),
    `  ${propName(n)}: ${t};`,
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

const arrayElem = (s: string): string => (s.startsWith('readonly ') ? `(${s})` : s);

export interface Naming {
  readonly named: ReadonlyMap<string, string>;
  readonly structs: ReadonlyMap<string, StructDecl>;
}

const holdsKey = (h: HostType): boolean =>
  h.k === 'key' ||
  h.k === 'rec' ||
  (h.k === 'arr' && holdsKey(h.e)) ||
  (h.k === 'struct' && h.f.some(([, f]) => holdsKey(f)));

function boundName(t: ShaderType | undefined, naming: Naming | undefined): string | undefined {
  if (t?.kind !== 'struct' || naming === undefined) return undefined;
  const name = naming.named.get(t.name);
  if (name === undefined) return undefined;
  const h = hostTypeOf(t, naming.structs);
  return 'none' in h || holdsKey(h) ? undefined : name;
}

const fieldType = (
  t: ShaderType | undefined,
  name: string,
  naming: Naming | undefined,
): ShaderType | undefined =>
  t?.kind === 'struct'
    ? naming?.structs.get(t.name)?.fields.find((f) => sameField(f.name, name))?.type
    : undefined;

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
        `{ ${l.f.map(([n, , fl]) => `${ro}${propName(n)}: ${bindingTsType(fl, writes, false, fieldType(t, n, naming), naming)}`).join('; ')} }`
      );
  }
}

const unsizedType = (
  l: Layout & { k: 'a' },
  writes: boolean,
  t?: ShaderType,
  naming?: Naming,
): string =>
  `array<${bindingTsType(l.e, writes, false, t?.kind === 'array' ? t.elem : undefined, naming)}>`;

const plainArray = (l: Layout & { k: 'a' }, t?: ShaderType, naming?: Naming): string =>
  bindingTsType(l, false, true, t, naming);

const scalarBuffers = (l: Layout & { k: 'a' }): string | undefined => {
  if (l.e.k === 's') return `Buffer<${l.e.t}>`;
  if (l.e.k === 'v') return `Buffer<${vecName(l.e.n, l.e.t)}> | Buffer<${l.e.t}>`;
  if (l.e.k === 'm') return `Buffer<${matName(l.e.c, l.e.r, 'f32')}> | Buffer<f32>`;
  return undefined;
};

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

const IMAGE_SOURCE =
  'ImageBitmap | ImageData | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | OffscreenCanvas | Texture';

const SAMPLING =
  "{ readonly filter?: 'nearest' | 'linear'; readonly address?: 'clamp' | 'repeat' | 'mirror' }";

export const isBufferBinding = (b: DrawBinding): b is EntryBinding =>
  b.space === 'uniform' || b.space === 'storage';

export const objectType = (members: readonly string[]): string =>
  members.length === 0 ? '{}' : `{ ${members.join('; ')} }`;

const GPU_BUFFER = '{ readonly mapAsync: unknown; readonly getMappedRange: unknown }';

const NUMBERS = 'Float32Array | Int32Array | Uint32Array | Float64Array';

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
      const packed = `{ ${l.fields.map((f) => `readonly ${propName(f.name)}: ${packHostType(f.layout, fieldType(t, f.name, naming), naming)}`).join('; ')} }`;
      const name = boundName(t, naming);
      return name === undefined ? packed : `${name} | ${packed}`;
    }
  }
}

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

const WORKGROUPS =
  'number | readonly [number, number?, number?] | { readonly indirect: Buffer<u32>; readonly offset?: number }';

const notCallable = (reason: string): string =>
  `Not callable from host code (Rule 8.20): ${reason}.`;

const callForms =
  ' Called with plain data, the call is awaited and writes back each array it writes (Rule 8.21). Called on a resource (a Buffer, a Uniform, or a binding the module exports), it does not block: the runtime submits it when the current microtask checkpoint ends or at the next read() or call, each call sees the values of its own call, and its error is thrown at the next read() or call with the line of the call (change 0138, R2). A call on a resource that writes a plain array waits, fills it, and gives its result as plain data (Amendment A11, Q7).';

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

export interface ViewTypes {
  readonly naming: Naming;
  readonly binding: (name: string) => ShaderType | undefined;
  readonly param: (fn: string, name: string) => ShaderType | undefined;
}

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
  const named = structNames(exports, true);
  const args = types.naming.named;
  const resource = resourceTypes(exports);
  const out: string[] = [];
  for (const e of exports) {
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
          `export declare function ${e.name}(bindings: ${e.bindingsType}, workgroups: ${WORKGROUPS}, ${constants}): Promise<void>;`,
        );
        if (e.queuedType !== undefined) {
          const { queued, waiting } = bindingsTypes(e.entry.bindings, types.binding, types.naming);
          const onResource = classResources(e, queued, types, resource);
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
        const shown = madeView(
          e.face,
          (t) => resultType(t, named),
          (cls) => resource(cls, 'buffer') !== undefined,
        );
        const f = shown.face;
        const params = (mode: 'plain' | 'resource' | 'waits'): string =>
          f.params
            .map((p) => {
              if (p.k === 'value') {
                const t = argType(p.type, args);
                if (mode === 'plain' || shown.plain.has(p.name)) return `${p.name}: ${t}`;
                const u = resource(t, 'uniform');
                const one = bufferArgument(p.type, t);
                return `${p.name}: ${[t, u, one].filter((x) => x !== undefined).join(' | ')}`;
              }
              if (p.k === 'texture')
                return `${p.name}: ${p.storage !== undefined ? 'Texture' : IMAGE_SOURCE}`;
              if (p.k === 'collection')
                return p.value === undefined
                  ? `${p.name}: Set<${p.keys === undefined ? p.key : keyTypeText(p.keys)}>`
                  : `${p.name}: Map<${p.keys === undefined ? p.key : keyTypeText(p.keys)}, ${argType(p.value, args)}>`;
              const type = types.param(f.fn, p.name);
              const plain = plainArray(p.layout, type, types.naming);
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
                p.keys !== undefined ? `Buffer<${keyTypeText(p.keys)}>` : undefined,
                element !== undefined
                  ? (resource(element, 'buffer') ?? `Buffer<${element}>`)
                  : undefined,
                element !== undefined ? keyedResult(type, types.naming, args) : undefined,
              ].filter((x) => x !== undefined);
              const either = buffers.length === 0 ? plain : `${plain} | ${buffers.join(' | ')}`;
              const array =
                mode === 'plain'
                  ? plain
                  : mode === 'resource' && p.writes
                    ? buffers.join(' | ') || 'never'
                    : either;
              return p.pushed === true && mode !== 'plain'
                ? `${p.name}: ${array} | { readonly array: ${array}; readonly length: Buffer<u32>; readonly offset?: number }`
                : `${p.name}: ${array}`;
            })
            .join(', ');
        const where =
          f.gpu === undefined
            ? `It runs on the CPU: ${f.noGpu ?? 'unknown'}`
            : f.gpu.loops.length === 0
              ? 'Its stores run on the GPU in one invocation where there is WebGPU, and on the CPU otherwise'
              : 'Each of its loops runs on the GPU, one invocation per iteration, where there is WebGPU, and on the CPU otherwise';
        const pushes = f.params.some((p) => p.k === 'array' && p.pushed === true)
          ? ' An array it pushes onto may come as { array, length, offset? }: its pushes start at the length the Buffer<u32> length holds at offset, and the call leaves the new length there (Rule 8.23).'
          : '';
        const counted =
          f.gpu?.loops.some((l) => l.device !== undefined) === true
            ? " A loop whose trip count it reads from an array runs from a count the GPU computes, with nothing read back, and its writes past an array's end are dropped (Rule 8.21)."
            : '';
        const buffers = f.result.k === 'void' ? 'void' : bufferResult(f.result, named);
        const returns =
          f.result.k === 'void'
            ? ''
            : buffers === undefined
              ? ` Its result is ${f.result.s}, which no Buffer holds, so a call on a resource that does not wait is refused.`
              : ' Called on a resource, it returns its result at once as Buffers: one element for a number, a vector, a bool, a key or a matrix, N for an array<T, N>, and for a struct or a Record an object of them by field; another call takes each as an argument, and read() gives its values (Amendment A10, Q-C; Amendment A12, decision 4).';
        out.push(
          ...above(
            `A kernel function (Rule 8.22). ${where}.${counted}${pushes}${callForms}${returns}${shown.note}`,
          ),
          `export declare function ${e.name}(${params('plain')}): Promise<${shown.result ?? resultType(f.result, named)}>;`,
        );
        const noBuffer = f.params.some(
          (p) => p.k === 'array' && p.writes && params('resource').includes(`${p.name}: never`),
        );
        const onResource = shown.result === undefined ? buffers : shown.onResource;
        if (onResource !== undefined && !noBuffer && params('resource') !== params('plain'))
          out.push(`export declare function ${e.name}(${params('resource')}): ${onResource};`);
        if (
          f.params.some((p) => p.k === 'array' && p.writes) &&
          params('waits') !== params('plain')
        )
          out.push(
            `export declare function ${e.name}(${params('waits')}): Promise<${shown.result ?? resultType(f.result, named)}>;`,
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

const FAMILY_NAMES: readonly string[] = [
  ...SUPPORTED_TYPE_NAMES.filter((n) => !HANDLE_TYPE_NAMES.has(n)),
  'array',
];

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
    ...(used.has('Texture') ? [`import type { Texture } from ${from};`] : []),
    ...(used.has('Uniform') ? [`import type { Uniform } from ${from};`] : []),
    ...(used.has('Buffer') ? [`import type { Buffer } from ${from};`] : []),
  ];
}

interface MemberView {
  readonly kind: 'method' | 'accessor' | 'never';
  readonly declarations: readonly { readonly keys: readonly string[]; readonly line: string }[];
  readonly reason?: string;
}

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

const sameMember = (a: MemberView, b: MemberView): boolean =>
  a.kind === b.kind &&
  a.reason === b.reason &&
  a.declarations.length === b.declarations.length &&
  a.declarations.every((d, i) => d.line === b.declarations[i]!.line);

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

function constType(t: HostType): string {
  return argType(t, NO_NAMES);
}
