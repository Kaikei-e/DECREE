fn main() -> Result<(), Box<dyn std::error::Error>> {
    let descriptor_path =
        std::path::PathBuf::from(std::env::var("OUT_DIR")?).join("proto_descriptor.bin");

    // Step 1: compile protos with prost, emitting a file descriptor set
    let mut config = prost_build::Config::new();
    config.file_descriptor_set_path(&descriptor_path);
    config.compile_protos(&["../../proto/scanner/v1/scanner.proto"], &["../../proto"])?;

    // Step 2: generate serde impls from the descriptor set
    let descriptor_set = std::fs::read(&descriptor_path)?;
    pbjson_build::Builder::new()
        .register_descriptors(&descriptor_set)?
        .build(&[".scanner.v1"])?;

    Ok(())
}
