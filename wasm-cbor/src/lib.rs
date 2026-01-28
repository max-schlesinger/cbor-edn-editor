use wasm_bindgen::prelude::*;
use cbor_diag::parse_bytes;

#[wasm_bindgen]
pub fn get_annotated_hex(data: &[u8]) -> String {
   
    match parse_bytes(data) {
        Ok(item) => item.to_hex(), 
        Err(_) => "Error: Invalid CBOR".to_string(),
    }
}