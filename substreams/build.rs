fn main() {
    prost_build::compile_protos(&["proto/shield/v1/shield.proto"], &["proto/"]).unwrap();
}
