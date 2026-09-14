// Stable diagnostic codes (Phase 10 / 12). Messages stay readable.
//
// Numbering: `TS8` + a zero-padded sequential number, assigned in the order a code was added.
// A gap (8011 is retired) is never reused. `UNSUPPORTED` (TS8099) is the one deliberate
// exception to "sequential": it is the catch-all for a diagnostic whose site does not yet
// deserve its own code, so it stays parked past the sequential range instead of at its head.

export const TS_CODES = {
  MISSING_DIRECTIVE: 'TS8001',
  UNKNOWN_TYPE: 'TS8002',
  TYPE_MISMATCH: 'TS8003',
  UNKNOWN_FN: 'TS8004',
  CONST_ASSIGN: 'TS8005',
  LOOP_BOUND: 'TS8006',
  LOOP_INFINITE: 'TS8007',
  LOOP_INDUCTION: 'TS8008',
  BREAK_OUTSIDE: 'TS8009',
  STRUCT_FIELD: 'TS8010',
  HOST_API: 'TS8012',
  HOST_STMT: 'TS8013',
  TOP_LEVEL: 'TS8014',
  BACKEND: 'TS8015',
  INDEX_OOB: 'TS8016',
  /** Invalid `switch` case: not a numeric literal, or a fall-through case body. */
  SWITCH_CASE: 'TS8017',
  /** An assignment or `++`/`--` target that is not a writable name (not an identifier, unknown, or a non-writable parameter). Assigning to a known immutable binding is `CONST_ASSIGN` instead. */
  ASSIGN_TARGET: 'TS8018',
  /** Wrong number of arguments, elements, or fields at a call or constructor site. */
  ARITY_MISMATCH: 'TS8019',
  /** A function declaration or parameter shape TypeShade does not support (missing name or body, optional/rest/destructured parameter). */
  FUNCTION_SHAPE: 'TS8020',
  /** A `return` shape problem: bare `return` where a value is required, or a function with no return type annotation. */
  RETURN_SHAPE: 'TS8021',
  /** Reference to a name TypeShade cannot resolve (identifier, struct field, or struct shape) that is not a function call (`UNKNOWN_FN`) or a type name (`UNKNOWN_TYPE`). */
  UNKNOWN_NAME: 'TS8022',
  /** The same function or binding name declared twice in one scope. */
  DUPLICATE_SYMBOL: 'TS8023',
  /** `@builtin("...")` names an id outside WGSL's builtin vocabulary (`WgslBuiltinName` in `core/sot.ts`). */
  BUILTIN_NAME: 'TS8024',
  /** A `@builtin(...)` id used as the wrong stage's input or output, e.g. `frag_depth` on a vertex return, or `front_facing` on a vertex parameter. */
  BUILTIN_STAGE: 'TS8025',
  /** `@compute([x, y, z])` with `y` or `z` other than `1`: the backend only carries the first workgroup axis today, so a shape it would silently drop is rejected instead. */
  WORKGROUP_SHAPE: 'TS8026',
  /** `mat2`/`mat3`: not implemented (only `mat4`/`mat4x4` maps to a real WGSL type), so authoring one is rejected instead of silently widening to `mat4x4`. */
  MAT_UNSUPPORTED: 'TS8027',
  UNSUPPORTED: 'TS8099',
} as const

export type TsCode = (typeof TS_CODES)[keyof typeof TS_CODES]
