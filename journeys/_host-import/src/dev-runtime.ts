// The dev journey loads the runtime before its shader host, so a late fuse import cannot hide
// inside the first dependency optimization. No shader or fuse import belongs in this module.
export { buildInfo } from 'typeshade/runtime';
