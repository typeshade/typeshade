import { describe, it, expect } from 'vitest'
import { cse, licm } from './index.js'
import {
  member,
  module,
  fn,
  f32,
  f32T,
  i32,
  u32T,
  vec3uT,
  voidT,
  arrayT,
  bindingRef,
  structT,
  type ModuleDecl,
} from '../../ir/index.js'
import { emitModule } from '../../backends/wgsl.js'

// Regression (architect-found): CSE/LICM must NOT hoist a read of a WRITTEN binding.
// A read_write storage member read 2x AND stored is NOT invariant; hoisting it
// rewrites the store target into the immutable temp -> invalid WGSL (let-mutation)
// + a dropped store. The oracle (f64, single-fn, let-mutation-permissive) cannot
// catch this, so the assertion is on emitted-WGSL structure: no temp is introduced
// for a written binding.
const buf = bindingRef('buf', structT('Buf'))

const cseWitness = (): ModuleDecl =>
  module({
    structs: [{ name: 'Buf', fields: [{ name: 'v', type: f32T }] }],
    bindings: [
      {
        group: 0,
        binding: 0,
        name: 'buf',
        space: 'storage' as const,
        access: 'read_write' as const,
        type: structT('Buf'),
      },
    ],
    funcs: [
      fn('k', {}, f32T, (_p, b) => {
        const a = b.let('a', member(buf, 'v', f32T).add(member(buf, 'v', f32T))) // buf.v read 2x
        b.assign(member(buf, 'v', f32T), f32(7)) // store to buf.v
        b.ret(a)
      }),
    ],
  })

const licmWitness = (): ModuleDecl =>
  module({
    structs: [{ name: 'Buf', fields: [{ name: 'v', type: f32T }] }],
    bindings: [
      {
        group: 0,
        binding: 0,
        name: 'buf',
        space: 'storage' as const,
        access: 'read_write' as const,
        type: structT('Buf'),
      },
    ],
    funcs: [
      fn('k', {}, f32T, (_p, b) => {
        const acc = b.var('acc', f32T, f32(0))
        b.forRange(
          'i',
          i32(0),
          (i) => i.lt(i32(4)),
          (cb) => {
            cb.addAssign(acc, member(buf, 'v', f32T)) // read buf.v in the loop
            cb.assign(member(buf, 'v', f32T), member(buf, 'v', f32T).add(1)) // ...and mutate it
          },
        )
        b.ret(acc)
      }),
    ],
  })

// The same hazard with the root spelled as a `constref` instead of a `varref` (#8 A2 review).
// `bindingRef` above builds the EDSL's varref-rooted binding read; the "use typeshade" front
// end spells the very same read as a `constref`, and `targetRoot` / `refsLocal` in
// expr-utils.ts matched `varref` alone — so a store through a constref root was invisible and
// CSE hoisted the lvalue into an immutable `let`. The index is computed on purpose: it is
// what makes the whole `ps[gid.x + 1u]` navigation a CSE candidate in the first place, and it
// is still legitimately hoisted (only the lvalue must not be).
const P_FIELDS = [
  { name: 'a', type: f32T },
  { name: 'b', type: f32T },
]

const psType = arrayT(structT('P'))
const gid = { op: 'param', type: vec3uT, name: 'gid' } as const
const idx = {
  op: 'binop',
  type: u32T,
  bop: '+',
  a: { op: 'member', type: u32T, base: gid, field: 'x' },
  b: { op: 'lit', type: u32T, value: 1 },
} as const
const elem = {
  op: 'index',
  type: structT('P'),
  base: { op: 'constref', type: psType, name: 'ps' },
  idx,
} as const
const fieldA = { op: 'member', type: f32T, base: elem, field: 'a' } as const

const constRefRootWitness = (): ModuleDecl => ({
  consts: [],
  structs: [{ name: 'P', fields: P_FIELDS }],
  bindings: [
    {
      group: 0,
      binding: 0,
      name: 'ps',
      space: 'storage' as const,
      access: 'read_write' as const,
      type: psType,
    },
  ],
  funcs: [
    {
      name: 'k',
      params: [{ name: 'gid', type: vec3uT }],
      ret: voidT,
      stage: 'compute' as const,
      workgroupSize: 64,
      body: [
        {
          s: 'assign',
          target: { op: 'member', type: f32T, base: elem, field: 'b' },
          expr: { op: 'binop', type: f32T, bop: '*', a: fieldA, b: fieldA },
        },
      ],
    },
  ],
})

describe('optimizer — written bindings are not invariant (lvalue regression)', () => {
  it('CSE does not hoist a read of a written read_write binding', () => {
    expect(emitModule(cse(cseWitness()))).not.toContain('_cse')
  })

  it('LICM does not hoist a binding read that is mutated inside the loop', () => {
    expect(emitModule(licm(licmWitness()))).not.toContain('_licm')
  })

  it('CSE does not hoist an lvalue whose root is a constref binding read', () => {
    const out = emitModule(cse(constRefRootWitness()))
    // The store still targets the buffer itself.
    expect(out).toMatch(/ps\[[^\]]*\]\.b = /)
    // …and not a temp: `let _cse1 = ps[i]; _cse1.b = …` is what Tint answered "cannot assign
    // to value of type 'f32'" to. Hoisting the READ `ps[i].a`, which this emit still does, is
    // both legal and the point of the pass — it is only the lvalue that may not move.
    expect(out).not.toMatch(/_\w+\.b = /)
    expect(out).not.toMatch(/let \w+ = ps\[[^\]]*\];/)
  })
})
