use anyhow::Result;
use substreams_ethereum::Abigen;

fn main() -> Result<()> {
    prost_build::compile_protos(&["proto/shield/evm/v1/shield_evm.proto"], &["proto/"])?;
    Abigen::new("ShieldVault", "abi/ShieldVault.json")?.generate()?.write_to_file("src/abi_shield_vault.rs")?;
    println!("cargo:rerun-if-changed=abi/ShieldVault.json");
    println!("cargo:rerun-if-changed=proto/shield/evm/v1/shield_evm.proto");
    Ok(())
}
