export const ARRAY_LIBRARY_DTS = `// The whole \`Array\` a \`"use typeshade"\` program has: \`lib: []\` means \`lib.es5.d.ts\` is never
// in the program, so this is the standard-library declaration the file restates (design rule
// 2.1(b)). It is also the ONE place an author-facing array member is declared: \`array<T, N>\`
// picks from it by name through \`ArrayOps\`, and the read view a binding resolves to carries
// whatever is picked through \`ReadView\`'s function-type arm, so an operation that becomes a
// method (#177) is added here and named there, and nowhere else. See the note above
// \`ArrayOps\` for what a MUTATING member costs.
interface Array<T> {
  readonly length: u32
  [n: number]: T
  // A list literal is an \`Array\` here, and it has to stay assignable to an iterable \`array<T, N>\`.
  [Symbol.iterator](): { next(): { done: false; value: T } | { done: true; value: undefined } }
  // The five methods an array has (surface §63), as lib.es5.d.ts spells them, with two changes:
  // \`this\` is the \`array<T, N>\` the call is on, so \`map\` builds an array of the same size, and
  // \`index\` is an \`i32\`, the type an unannotated counter has (design rule 7.5). No \`thisArg\`:
  // an arrow function reads the \`this\` around it already.
  //
  // \`reduce\` from a value takes the running value's type \`U\` from that value, and \`0.\` is a
  // \`number\` to TypeScript where the compiler makes it an \`f32\`. The projection writes the
  // compiler's type in as the type arguments, \`xs.reduce<f32, 3>(f, 0.)\`, and a runtime-sized
  // array, which has no size to write, leaves \`N\` to its default.
  map<U, N extends number>(this: array<T, N>, callbackfn: (value: T, index: i32, array: array<T, N>) => U): array<U, N>
  forEach<N extends number>(this: array<T, N>, callbackfn: (value: T, index: i32, array: array<T, N>) => void): void
  some<N extends number>(this: array<T, N>, predicate: (value: T, index: i32, array: array<T, N>) => bool): bool
  every<N extends number>(this: array<T, N>, predicate: (value: T, index: i32, array: array<T, N>) => bool): bool
  reduce<N extends number>(this: array<T, N>, callbackfn: (previousValue: T, currentValue: T, currentIndex: i32, array: array<T, N>) => T): T
  reduce<U, N extends number = number>(this: array<T, N>, callbackfn: (previousValue: U, currentValue: T, currentIndex: i32, array: array<T, N>) => U, initialValue: U): U
  // One element appended, as lib.es5.d.ts spells it with one value: a kernel function's loop
  // appends to an array parameter (change 0078). It gives the new length, a \`u32\` as
  // \`length\` is, which the loop must not read (Rule 8.22, R4).
  push(value: T): u32
  // The methods change 0079 adds, as lib.es5.d.ts and lib.es2023.array.d.ts spell them with one
  // argument: the index to start or stop at is not taken. \`fill\` gives back the array it
  // fills, as ECMAScript does (change 0114, S2). An index is an \`i32\`, \`-1\` where nothing
  // matches.
  fill<N extends number>(this: array<T, N>, value: T): array<T, N>
  // \`slice()\` with no argument is a new array of the same elements (change 0142, Table 3): the
  // start and the end are not taken, since an array's length is fixed.
  slice<N extends number>(this: array<T, N>): array<T, N>
  findIndex<N extends number>(this: array<T, N>, predicate: (value: T, index: i32, array: array<T, N>) => bool): i32
  findLastIndex<N extends number>(this: array<T, N>, predicate: (value: T, index: i32, array: array<T, N>) => bool): i32
  indexOf(searchElement: T): i32
  lastIndexOf(searchElement: T): i32
  includes(searchElement: T): bool
}
// \`readonly T[]\` and \`ReadonlyArray<T>\` (change 0114, S1): the array of \`Array<T>\` with the
// promise that nothing writes it. The index is read-only (TS2542 on \`xs[i] = v\`) and no member
// writes (TS2339 on \`xs.push(v)\`); the compiler says each as TS8005, and the editor keeps that.
interface ReadonlyArray<T> {
  readonly length: u32
  readonly [n: number]: T
  [Symbol.iterator](): { next(): { done: false; value: T } | { done: true; value: undefined } }
  map<U>(callbackfn: (value: T, index: i32, array: ReadonlyArray<T>) => U): array<U>
  forEach(callbackfn: (value: T, index: i32, array: ReadonlyArray<T>) => void): void
  some(predicate: (value: T, index: i32, array: ReadonlyArray<T>) => bool): bool
  every(predicate: (value: T, index: i32, array: ReadonlyArray<T>) => bool): bool
  reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: i32, array: ReadonlyArray<T>) => T): T
  reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: i32, array: ReadonlyArray<T>) => U, initialValue: U): U
  slice(): array<T>
  findIndex(predicate: (value: T, index: i32, array: ReadonlyArray<T>) => bool): i32
  findLastIndex(predicate: (value: T, index: i32, array: ReadonlyArray<T>) => bool): i32
  indexOf(searchElement: T): i32
  lastIndexOf(searchElement: T): i32
  includes(searchElement: T): bool
}
// ECMAScript's \`Array\` and \`Float32Array\` constructors, with the forms change 0114 (S2) builds
// an array with: \`new Array(N).fill(v)\`, \`Array.from({ length: N }, f)\` and
// \`new Float32Array(N)\`. A literal length gives the sized array. \`new Array(N)\` alone is an
// array of holes, which has \`fill\` and nothing else here; the compiler refuses it unfilled.
// \`Array.from\` hands its function \`undefined\` and the index, an \`i32\` as \`map\` hands it.
declare var Array: {
  new <N extends number>(arrayLength: N): { fill<T>(value: T): array<T, N>; readonly [n: number]: never }
  from<T, N extends number>(arrayLike: { readonly length: N }, mapfn?: (v: undefined, k: i32, ...rest: undefined[]) => T): array<T, N>
}
declare var Float32Array: {
  new <N extends number>(length?: N): array<f32, N>
}
// What \`[Symbol.iterator]\` above resolves through. \`Symbol\` itself is no name of the shader:
// the compiler refuses it as a value (TS8022), so declaring it gives an author nothing to write.
interface SymbolConstructor {
  readonly iterator: unique symbol
}
declare var Symbol: SymbolConstructor
// ECMAScript's Map and Set, as lib.es2015.collection.d.ts spells them, with the members a kernel
// function's parameter has (change 0080). \`add\` and \`set\` give nothing where ECMAScript gives
// the collection back: each is a statement in a loop. \`size\` is a \`u32\`, as an array's
// \`length\` is. \`get\` gives \`V | undefined\`, as ECMAScript does: the compiler takes it where
// a \`has\` of the same key guards it, and the author writes \`m.get(k)!\`.
interface Map<K, V> {
  readonly size: u32
  has(key: K): bool
  get(key: K): V | undefined
  set(key: K, value: V): void
}
interface Set<T> {
  readonly size: u32
  has(value: T): bool
  add(value: T): void
}`;
