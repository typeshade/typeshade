//! Experimental batch interning, not a TypeShade optimizer or a public IR format.
//! Input: node count, then (label ID, child count, earlier child IDs) for each node.
//! Labels are assigned by the JS adapter. Hash collisions are resolved by full key equality.
use std::collections::HashMap;

fn intern(input: &[u32], output: &mut [u32]) -> Result<(), ()> {
    let count = *input.first().ok_or(())? as usize;
    if count > output.len() || count > (input.len() - 1) / 2 {
        return Err(());
    }
    let mut classes = HashMap::with_capacity(count);
    let mut cursor = 1;
    for node in 0..count {
        let label = *input.get(cursor).ok_or(())?;
        let arity = *input.get(cursor + 1).ok_or(())? as usize;
        cursor += 2;
        if arity > input.len() - cursor {
            return Err(());
        }
        let mut key = Vec::with_capacity(arity + 1);
        key.push(label);
        for &child in &input[cursor..cursor + arity] {
            if child as usize >= node {
                return Err(());
            }
            key.push(output[child as usize]);
        }
        cursor += arity;
        let next = classes.len() as u32;
        output[node] = *classes.entry(key).or_insert(next);
    }
    if cursor != input.len() {
        return Err(());
    }
    Ok(())
}

// The benchmark owns these allocations. This raw ABI is not exposed to package consumers.
// The caller must supply live, disjoint allocations with the exact lengths it allocated.
#[no_mangle]
pub extern "C" fn alloc_words(len: u32) -> *mut u32 {
    if len == 0 || len > 16_777_216 {
        return std::ptr::null_mut();
    }
    Box::into_raw(vec![0u32; len as usize].into_boxed_slice()) as *mut u32
}

/// # Safety
/// `ptr` and `len` must describe one live allocation returned by `alloc_words`.
#[no_mangle]
pub unsafe extern "C" fn free_words(ptr: *mut u32, len: u32) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
        ptr,
        len as usize,
    )));
}

/// # Safety
/// Both slices must be live, disjoint allocations with their actual allocated lengths.
#[no_mangle]
pub unsafe extern "C" fn intern_batch(
    input: *const u32,
    len: u32,
    output: *mut u32,
    out_len: u32,
) -> u32 {
    let input = std::slice::from_raw_parts(input, len as usize);
    let output = std::slice::from_raw_parts_mut(output, out_len as usize);
    u32::from(intern(input, output).is_err())
}

#[cfg(test)]
mod tests {
    use super::intern;

    #[test]
    fn interns_equal_children_even_when_their_input_ids_differ() {
        let input = [5, 7, 0, 7, 0, 8, 1, 0, 8, 1, 1, 8, 2, 0, 1];
        let mut output = [0; 5];
        assert_eq!(intern(&input, &mut output), Ok(()));
        assert_eq!(output, [0, 0, 1, 1, 2]);
    }

    #[test]
    fn rejects_truncated_forward_and_trailing_input() {
        for input in [&[][..], &[1, 0], &[1, 0, 1, 0], &[0, 5], &[1, 0, 5]] {
            assert_eq!(intern(input, &mut [0; 10]), Err(()));
        }
        assert_eq!(intern(&[1, 0, 0], &mut []), Err(()));
    }

    #[test]
    fn preserves_child_order_and_labels() {
        let input = [5, 1, 0, 2, 0, 3, 2, 0, 1, 3, 2, 1, 0, 4, 2, 0, 1];
        let mut output = [0; 5];
        assert_eq!(intern(&input, &mut output), Ok(()));
        assert_eq!(output, [0, 1, 2, 3, 4]);
        assert_eq!(intern(&[0], &mut []), Ok(()));
    }
}
