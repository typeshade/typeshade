export const COMPUTE_BUILTINS = new Set([
  'global_invocation_id',
  'local_invocation_id',
  'local_invocation_index',
  'workgroup_id',
  'num_workgroups',
]);

export const STORAGE_ACCESS = {
  read: 'read-only',
  write: 'write-only',
  read_write: 'read-write',
} as const;

export const FRAGMENT_BUILTINS = new Set(['position', 'front_facing']);
