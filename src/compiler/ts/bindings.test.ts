import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'

describe('uniform / storage', () => {
  it('collects uniform<f32>({ binding: 0 }) and reads it', () => {
    const r = compileTsSource(`
      "use typeshade";
      const scale = uniform<f32>({ binding: 0 });
      export function f(x: f32): f32 {
        return x * scale;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.bindings).toHaveLength(1)
    expect(r.bindings[0]).toMatchObject({ name: 'scale', space: 'uniform', binding: 0, group: 0 })
    expect(r.wgsl).toMatch(/var<uniform>/)
  })

  it('collects storage with read_write', () => {
    const r = compileTsSource(`
      "use typeshade";
      const xs = storage<array<f32, 4>, "read_write">({ binding: 1 });
      export function f(): f32 {
        return 0.;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.bindings[0]).toMatchObject({
      name: 'xs',
      space: 'storage',
      binding: 1,
      access: 'read_write',
    })
    expect(r.wgsl).toMatch(/var<storage/)
  })

  it('collects storage with no second type argument as read', () => {
    const r = compileTsSource(`
      "use typeshade";
      const xs = storage<array<f32, 4>>({ binding: 1 });
      export function f(): f32 {
        return xs[0];
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.bindings[0]).toMatchObject({ name: 'xs', space: 'storage', access: 'read' })
  })

  // The option is gone, and it must not be dropped silently: the whole point of moving the mode
  // into the type is that an author who asks for a writable buffer gets one. The remedy names
  // the mode they asked for, with the option removed from the object they wrote.
  it('refuses the retired { access } option and names the type-argument spelling', () => {
    const r = compileTsSource(`
      "use typeshade";
      const ys = storage<array<f32, 4>>({ binding: 3, access: "read_write" });
      export function f(): f32 { return ys[0]; }
    `)
    const errors = r.diagnostics.filter((d) => d.category === 'error')
    expect(errors.map((d) => `${d.code} ${d.message}`)).toEqual([
      "TS8099 The { access } option is gone: a storage binding's access mode is its second " +
        'type argument. Write "const ys = storage<array<f32, 4>, \"read_write\">({ binding: 3 })".',
    ])
    // Reported and ignored: the mode comes from the type argument, which says nothing here.
    expect(r.bindings[0]).toMatchObject({ name: 'ys', binding: 3, access: 'read' })
  })

  // A UNIFORM has no access mode, so the storage sentence was false about it twice over: it
  // opened "a storage binding's access mode is its second type argument" about a binding that
  // has none, and the line it named was a two-type-argument `uniform<...>`, which the same
  // commit refuses with TS8002. The uniform arm has its own sentence.
  it('refuses the retired { access } option on a uniform with its own sentence', () => {
    const r = compileTsSource(`
      "use typeshade";
      const cam = uniform<f32>({ binding: 3, access: "read_write" });
      export function f(): f32 { return cam; }
    `)
    const errors = r.diagnostics.filter((d) => d.category === 'error')
    expect(errors.map((d) => `${d.code} ${d.message}`)).toEqual([
      'TS8099 The { access } option is gone, and a uniform buffer is read-only: it has no ' +
        'access mode to ask for. Write "const cam = uniform<f32>({ binding: 3 })".',
    ])
    expect(r.bindings[0]).toMatchObject({ name: 'cam', space: 'uniform', access: undefined })
  })

  // The word is VALIDATED before it is named. Echoing the author's own word back made the
  // remedy quote a line the same file refuses: `{ access: "write" }` was answered with
  // `storage<..., "write">`, which is TS8002 the moment it is written.
  it("names read_write, not the author's word, when the word is not one of the two", () => {
    const r = compileTsSource(`
      "use typeshade";
      const ys = storage<array<f32, 4>>({ binding: 3, access: "write" });
      @compute([1, 1, 1])
      export function k(): void { ys[0] = 1.; }
    `)
    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toContain(
      "TS8099 The { access } option is gone: a storage binding's access mode is its second " +
        'type argument. Write "const ys = storage<array<f32, 4>, \"read_write\">({ binding: 3 })".',
    )
  })

  // Widened from a uniform-only guard: a storage binding written `let` is refused with the same
  // sentence shape, and the storage arm names the type argument rather than the keyword.
  it('refuses a call-form binding declared let, for both kinds', () => {
    const storageForm = compileTsSource(`
      "use typeshade";
      let xs = storage<f32>();
      export function f(): f32 { return 0.; }
    `)
    expect(storageForm.diagnostics.map((d) => `${d.code} ${d.message}`)).toContain(
      'TS8099 "xs" is a storage binding, and a binding is declared const: write ' +
        '"const xs = storage<f32, \"read_write\">()". A storage binding\'s access mode is its ' +
        'second type argument, not the declaration keyword.',
    )
    const uniformForm = compileTsSource(`
      "use typeshade";
      let gain = uniform<f32>();
      export function f(): f32 { return 0.; }
    `)
    expect(uniformForm.diagnostics.map((d) => `${d.code} ${d.message}`)).toContain(
      'TS8099 "gain" is a uniform binding, and a binding is declared const: write ' +
        '"const gain = uniform<f32>()". A uniform buffer is read-only, so there is no writable ' +
        'form of it to ask for.',
    )
  })

  it('refuses a second type argument on a uniform call form', () => {
    const r = compileTsSource(`
      "use typeshade";
      const cam = uniform<f32, "read">();
      export function f(): f32 { return cam; }
    `)
    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toContain(
      'TS8002 uniform<T>() takes one type argument. A uniform buffer is read-only, so it has ' +
        'no access mode to write.',
    )
  })

  it('rejects writes to a uniform', () => {
    const r = compileTsSource(`
      "use typeshade";
      const scale = uniform<f32>({ binding: 0 });
      export function f(): void {
        scale = 1.;
      }
    `)
    expect(r.diagnostics.some((d) => /read-only|read_write/.test(d.message))).toBe(true)
  })

  it('does not treat a resource as a module const', () => {
    const r = compileTsSource(`
      "use typeshade";
      const scale = uniform<f32>({ binding: 0 });
      export function f(): f32 { return scale; }
    `)
    expect(r.consts).toEqual([])
    expect(r.bindings).toHaveLength(1)
  })
})
