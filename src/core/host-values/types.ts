export type HostNumber = 'f32' | 'f64' | 'i32' | 'u32';

export type HostType =
  | { readonly k: 'num'; readonly t: HostNumber; readonly s: string }
  | { readonly k: 'bool'; readonly s: string }
  // A key type (change 0081): the host passes and gets one of the members `m`, in id order, and
  // the shader holds its index as a u32.
  | { readonly k: 'key'; readonly m: readonly string[]; readonly s: string }
  | { readonly k: 'void'; readonly s: string }
  | {
      readonly k: 'vec';
      readonly n: number;
      readonly e: HostNumber | 'bool';
      readonly s: string;
    }
  | {
      readonly k: 'mat';
      readonly c: number;
      readonly r: number;
      readonly e: 'f32' | 'f64';
      readonly s: string;
    }
  | { readonly k: 'arr'; readonly n: number; readonly e: HostType; readonly s: string }
  // A `Record` over a key type (change 0081): an object with one property per key `m` on the
  // host, the array of its values in id order in the shader.
  | {
      readonly k: 'rec';
      readonly m: readonly string[];
      readonly e: HostType;
      readonly s: string;
    }
  | {
      readonly k: 'struct';
      readonly f: readonly (readonly [string, HostType])[];
      readonly s: string;
    };

export type HostClasses = ReadonlyMap<string, object>;
