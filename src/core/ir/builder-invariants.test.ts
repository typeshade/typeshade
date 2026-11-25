import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  Builder,
  Loop,
  NODE_BRAND,
  Return,
  Switch,
  If,
  Let,
  Var,
  boolT,
  builtin,
  constDecl,
  f32,
  f32T,
  fn,
  location,
  module,
  storageBuffer,
  structDecl,
  u32T,
  uniformStruct,
  vec3uT,
  vec4,
  vec4fT,
  voidT,
  type Node,
  type ReadonlyNode,
} from './index.js';
import { getLoc, setSourceTracing } from '../diagnostics/loc.js';

const SCOPE_STACK = Symbol.for('typeshade.scopeStack');
const INSTANCE_LOADED = Symbol.for('typeshade.instanceLoaded');
const FN_AUTO_ID = Symbol.for('typeshade.fnAutoId');
const globals = globalThis as Record<symbol, unknown>;

const foreignNode = (n: ReadonlyNode, extra: Record<string, unknown> = {}): ReadonlyNode => {
  const alien = Object.create(null) as Record<string | symbol, unknown>;
  alien.expr = n.expr;
  alien.type = n.type;
  alien[NODE_BRAND] = true;
  Object.assign(alien, extra);
  return alien as unknown as ReadonlyNode;
};

const callArgs = (n: Node): unknown[] => (n.expr as unknown as { args: unknown[] }).args;
const callName = (n: Node): string => (n.expr as unknown as { fn: string }).fn;

afterEach(() => {
  setSourceTracing(false);
  vi.restoreAllMocks();
});

describe('Builder scopes', () => {
  it('cancel() removes a reserved var that no branch assigned', () => {
    const b = new Builder();
    const reserved = b.inferredVar();
    expect(b.stmts).toHaveLength(1);
    reserved.cancel();
    expect(b.stmts).toHaveLength(0);
    reserved.cancel();
    expect(b.stmts).toHaveLength(0);
  });

  it('pops the ambient scope when a body throws', () => {
    expect(() =>
      fn('boom', {}, () => {
        throw new Error('author error');
      }),
    ).toThrow('author error');
    expect((globals[SCOPE_STACK] as unknown[]).length).toBe(0);
    expect(() => Let(f32(1))).toThrow(/SD0013/);
  });
});

describe('state shared across package copies', () => {
  const saved = {
    stack: globals[SCOPE_STACK],
    loaded: globals[INSTANCE_LOADED],
    autoId: globals[FN_AUTO_ID],
  };
  afterEach(() => {
    globals[SCOPE_STACK] = saved.stack;
    globals[INSTANCE_LOADED] = saved.loaded;
    globals[FN_AUTO_ID] = saved.autoId;
  });
  const loadCopy = async (): Promise<typeof import('./index.js')> => {
    vi.resetModules();
    return import('./index.js');
  };

  it('a second copy pushes onto the scope stack that already exists', async () => {
    const existing: unknown[] = [];
    globals[SCOPE_STACK] = existing;
    const copy = await loadCopy();
    let depth = -1;
    copy.fn('probe', {}, () => {
      depth = existing.length;
    });
    expect(depth).toBe(1);
  });

  it('warns once, when a second copy loads, and not on the first load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    delete globals[INSTANCE_LOADED];
    await loadCopy();
    expect(warn).not.toHaveBeenCalled();
    await loadCopy();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('second copy');
  });

  it('a second copy continues the anonymous fn counter; explicit names do not consume it', async () => {
    globals[FN_AUTO_ID] = { n: 41 };
    const copy = await loadCopy();
    const first = copy.fn({ x: copy.f32T }, ({ x }) => x);
    copy.fn('explicit', { x: copy.f32T }, ({ x }) => x);
    const second = copy.fn({ x: copy.f32T }, ({ x }) => x);
    expect([first.decl.name, second.decl.name]).toEqual(['_fn41', '_fn42']);
  });
});

describe('call factory', () => {
  it('leaves a cross-instance node that carries a $ key alone', () => {
    const h = fn('brand_probe', { x: f32T }, ({ x }) => x);
    const local = f32(2);
    const alien = foreignNode(local, { $: 1 });
    expect(callArgs(h(alien))[0]).toBe(local.expr);
  });

  it('lifts a raw number of the object form to the declared parameter type', () => {
    const h = fn('lift_probe', { n: u32T }, ({ n }) => n);
    expect(callArgs(h({ n: 2 }))[0]).toEqual({ op: 'lit', type: u32T, value: 2 });
  });

  it('spells a call built after a key rename with the renamed name', () => {
    const h = fn('before_rename', { x: f32T }, ({ x }) => x);
    module({ funcs: { after_rename: h } });
    expect(callName(h(f32(1)))).toBe('after_rename');
  });
});

describe('Var', () => {
  it('seeds from a cross-instance node by its brand', () => {
    const h = fn('var_brand', {}, () => {
      (Var as (init: ReadonlyNode) => Node)(foreignNode(f32(1)));
    });
    expect(h.decl.body[0]).toMatchObject({ s: 'var', type: f32T });
  });
});

describe('fn() without a return type', () => {
  const guardBodies: Record<string, () => unknown> = {
    'an if arm': () =>
      fn('g_arm', { c: boolT }, ({ c }) => {
        If(c, () => {
          Return(f32(1));
        });
      }),
    'an else block': () =>
      fn('g_else', { c: boolT }, ({ c }) => {
        If(c, () => {}).else(() => {
          Return(f32(1));
        });
      }),
    'a loop body': () =>
      fn('g_loop', {}, () => {
        Loop(2, () => {
          Return(f32(1));
        });
      }),
    'a switch case': () =>
      fn('g_case', { n: u32T }, ({ n }) => {
        Switch(n)
          .case(1, () => {
            Return(f32(1));
          })
          .default();
      }),
    'a switch default': () =>
      fn('g_default', { n: u32T }, ({ n }) => {
        Switch(n)
          .case(1, () => {})
          .default(() => {
            Return(f32(1));
          });
      }),
  };
  for (const [where, build] of Object.entries(guardBodies))
    it(`finds a value returned from ${where} and turns it away (SD0113)`, () => {
      expect(build).toThrow(/SD0113/);
    });
});

describe('fn() entry declarations', () => {
  it('threads location, builtin and interpolate of each entry parameter into the decl', () => {
    const h = fn(
      'entry_io',
      {
        uv: location(1, f32T, 'flat'),
        vid: builtin('vertex_index', u32T),
      },
      () => vec4(0, 0, 0, 1),
      { stage: 'vertex', retAttr: builtin('position', vec4fT) },
    );
    expect(h.decl.params[0]).toMatchObject({ name: 'uv', location: 1, interpolate: 'flat' });
    expect(h.decl.params[1]).toMatchObject({ name: 'vid', builtin: 'vertex_index' });
    expect(h.decl.params[0]).not.toHaveProperty('builtin');
    expect(h.decl.params[1]).not.toHaveProperty('location');
  });

  it('keeps the structured builtin id of a FieldSpec return attribute', () => {
    const spec = fn('ret_builtin', {}, () => vec4(0, 0, 0, 1), {
      stage: 'vertex',
      retAttr: builtin('position', vec4fT),
    });
    expect(spec.decl.retAttr).toBe('@builtin(position)');
    expect(spec.decl.retBuiltin).toBe('position');
    const text = fn('ret_text', {}, () => vec4(0, 0, 0, 1), {
      stage: 'vertex',
      retAttr: '@builtin(position)',
    });
    expect(text.decl.retBuiltin).toBeUndefined();
  });

  it('defaults a bare fragment return to @location(0), except for a void return', () => {
    const colour = fn('fs_colour', {}, () => vec4(0, 0, 0, 1), { stage: 'fragment' });
    expect(colour.decl.retAttr).toBe('@location(0)');
    const nothing = fn('fs_void', {}, voidT, () => {}, { stage: 'fragment' });
    expect(nothing.decl.retAttr).toBeUndefined();
    const helper = fn('plain_helper', {}, () => vec4(0, 0, 0, 1));
    expect(helper.decl.retAttr).toBeUndefined();
  });

  it('carries a workgroup shape only when y or z differs from 1', () => {
    const gid = builtin('global_invocation_id', vec3uT);
    const body = (): void => {};
    const flat = fn('wg_flat', { gid }, voidT, body, { stage: 'compute', workgroupSize: 8 });
    expect(flat.decl.workgroupSize).toBe(8);
    expect(flat.decl).not.toHaveProperty('workgroupShape');
    const grid = fn('wg_grid', { gid }, voidT, body, {
      stage: 'compute',
      workgroupSize: [8, 4, 1],
    });
    expect(grid.decl.workgroupShape).toEqual([8, 4, 1]);
    const deep = fn('wg_deep', { gid }, voidT, body, {
      stage: 'compute',
      workgroupSize: [8, 1, 2],
    });
    expect(deep.decl.workgroupShape).toEqual([8, 1, 2]);
  });

  it('stamps the handle with its authored location only while tracing is on', () => {
    const quiet = fn('loc_off', {}, () => f32(1));
    expect(getLoc(quiet)).toBeUndefined();
    setSourceTracing(true);
    const traced = fn('loc_on', {}, () => f32(1));
    expect(getLoc(traced)).toBeDefined();
  });
});

describe('module() assembly', () => {
  it('keeps its bookkeeping symbols off the enumerable keys of a decl', () => {
    const h = fn('enum_probe', { x: f32T }, ({ x }) => x);
    module({ funcs: { enum_key: h } });
    const symbols = Object.getOwnPropertySymbols(h.decl);
    expect(symbols.length).toBeGreaterThan(0);
    for (const s of symbols)
      expect(Object.prototype.propertyIsEnumerable.call(h.decl, s)).toBe(false);
  });

  it('pins the name of an array-form decl against a later rename', () => {
    const h = fn('pinned', { x: f32T }, ({ x }) => x);
    module({ funcs: [h] });
    expect(() => module({ funcs: { other: h } })).toThrow(/already assembled as 'pinned'/);
    expect(() => module({ funcs: { pinned: h } })).not.toThrow();
  });

  it('adds a derived decl once and leaves explicit arrays untouched', () => {
    const S = structDecl('InvS', { a: f32T });
    const C = constDecl('INV_C', f32T, { wgsl: 1, cpu: 1 });
    const U = uniformStruct('InvU', { group: 0, binding: 0, as: 'u_inv' }, { v: f32T });
    expect(module({ structs: [S.decl], uses: [S] }).structs).toHaveLength(1);
    expect(module({ structs: [S.decl, S.decl] }).structs).toHaveLength(2);
    expect(module({ uses: [S, S] }).structs).toHaveLength(1);
    expect(module({ consts: [C.decl], uses: [C] }).consts).toHaveLength(1);
    expect(module({ uses: [C, C] }).consts).toEqual([C.decl]);
    const both = module({ uses: [U, U] });
    expect(both.bindings).toHaveLength(1);
    expect(both.structs).toHaveLength(1);
  });

  it('derives a storage buffer element struct and its binding from uses', () => {
    const Element = structDecl('InvElement', { a: f32T });
    const buf = storageBuffer('inv_buf', Element, { group: 0, binding: 1, access: 'read' });
    const m = module({ uses: [buf] });
    expect(m.structs.map((s) => s.name)).toEqual(['InvElement']);
    expect(m.bindings.map((x) => x.name)).toEqual(['inv_buf']);
  });

  it('omits overrides, externs and enables when the author gave none', () => {
    expect(Object.keys(module({}))).toEqual(['consts', 'structs', 'bindings', 'funcs']);
    expect(Object.keys(module({ enables: ['floatRenderTarget'] }))).toContain('enables');
  });
});
