#!/usr/bin/env bash
# Build and deploy the Shield vault program.
#
#   scripts/deploy.sh local     # start a fresh local validator with the program preloaded (immutable)
#   scripts/deploy.sh devnet    # deploy (or upgrade) on devnet with the repo's program keypair
#   scripts/deploy.sh finalize  # burn the devnet upgrade authority (Invariant: enforcement can't be swapped)
#
# The program ID is fixed by target/deploy/shield_vault-keypair.json and
# declared in programs/shield-vault/src/lib.rs. Never commit that keypair.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
PROGRAM_ID="4Z46Kz8ygX5Efw22ABbQ2LTf329N3nD2J81Z3CAY5Hyx"
SO="target/deploy/shield_vault.so"
KEYPAIR="target/deploy/shield_vault-keypair.json"

build() {
  echo "==> cargo build-sbf"
  cargo build-sbf --manifest-path programs/shield-vault/Cargo.toml 2>&1 | grep -E "^(error|Finished)" || true
  test -f "$SO" || { echo "build failed: $SO missing"; exit 1; }
  ls -la "$SO"
}

case "${1:-}" in
  local)
    build
    pkill -f solana-test-validator || true
    sleep 1
    echo "==> starting solana-test-validator with the program preloaded"
    nohup solana-test-validator --reset --quiet --ledger /tmp/shield-test-ledger \
      --bpf-program "$PROGRAM_ID" "$SO" > /tmp/shield-validator.log 2>&1 &
    for i in $(seq 1 30); do
      if solana cluster-version --url http://127.0.0.1:8899 >/dev/null 2>&1; then break; fi
      sleep 1
    done
    solana cluster-version --url http://127.0.0.1:8899
    solana airdrop 100 --url http://127.0.0.1:8899 >/dev/null
    echo "validator up at http://127.0.0.1:8899 (log: /tmp/shield-validator.log)"
    ;;
  devnet)
    build
    test -f "$KEYPAIR" || { echo "missing $KEYPAIR (the program keypair)"; exit 1; }
    echo "==> deploying to devnet as $PROGRAM_ID"
    solana program deploy "$SO" --program-id "$KEYPAIR" --url https://api.devnet.solana.com \
      --with-compute-unit-price 1000 --max-sign-attempts 30 --use-rpc
    solana program show "$PROGRAM_ID" --url https://api.devnet.solana.com
    ;;
  finalize)
    echo "==> making the devnet program immutable (irreversible)"
    solana program set-upgrade-authority "$PROGRAM_ID" --final --url https://api.devnet.solana.com
    solana program show "$PROGRAM_ID" --url https://api.devnet.solana.com
    ;;
  *)
    echo "usage: $0 {local|devnet|finalize}"; exit 1 ;;
esac
