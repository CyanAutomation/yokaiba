use std::ptr;
use std::slice;

#[no_mangle]
pub extern "C" fn allocate_words(length: u32) -> u32 {
    if length == 0 {
        return 0;
    }
    let buffer = vec![0_u32; length as usize].into_boxed_slice();
    Box::into_raw(buffer) as *mut u32 as u32
}

#[no_mangle]
pub extern "C" fn release_words(pointer: u32, length: u32) {
    if pointer == 0 || length == 0 {
        return;
    }
    let raw_slice = ptr::slice_from_raw_parts_mut(pointer as *mut u32, length as usize);
    // The caller releases only slices returned by allocate_words or solve_words.
    unsafe { drop(Box::from_raw(raw_slice)) };
}

#[no_mangle]
pub extern "C" fn solve_words(pointer: u32, length: u32) -> u64 {
    if pointer == 0 || length == 0 {
        return 1;
    }
    // The JavaScript adapter owns this allocation and supplies its exact word length.
    let input = unsafe { slice::from_raw_parts(pointer as *const u32, length as usize) };
    match super::solve_wire(input) {
        Ok(words) => {
            let length = words.len() as u32;
            let buffer = words.into_boxed_slice();
            let pointer = Box::into_raw(buffer) as *mut u32 as u32;
            ((pointer as u64) << 32) | length as u64
        }
        Err(error) => error as u64,
    }
}
