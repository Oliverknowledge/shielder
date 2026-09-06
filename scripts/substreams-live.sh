#!/usr/bin/env bash
# Run a Shield Substreams package against its live Graph Market endpoint.
#
#   scripts/substreams-live.sh hyperevm [start_block] [range]   # default: head-20, +20
#   scripts/substreams-live.sh solana   [start_slot]  [range]
#
# Reads SUBSTREAMS_API_TOKEN (shared JWT) or SUBSTREAMS_<STACK>_API_TOKEN and
# SUBSTREAMS_<STACK>_ENDPOINT from the environment or .env. The token is passed
# to the CLI only via the environment and is never printed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STACK="${1:-hyperevm}"; START="${2:-}"; RANGE="${3:-+20}"
[ -f "$ROOT/.env" ] && { set -a; . "$ROOT/.env"; set +a; }
SUBSTREAMS_BIN="${SUBSTREAMS_BIN:-$(command -v substreams || echo "$HOME/.local/bin/substreams")}"
[ -x "$SUBSTREAMS_BIN" ] || { echo "substreams CLI not found (install: docs/substreams-one-prompt.md)"; exit 2; }

case "$STACK" in
  hyperevm)
    ENDPOINT="${SUBSTREAMS_HYPEREVM_ENDPOINT:-hyperevm.substreams.pinax.network:443}"
    TOKEN="${SUBSTREAMS_HYPEREVM_API_TOKEN:-${SUBSTREAMS_API_TOKEN:-}}"
    DIR="$ROOT/substreams-evm"; MANIFEST="substreams.yaml"; MODULE="map_vault_flows"
    if [ -z "$START" ]; then
      RPC="${HYPEREVM_RPC_URL:-https://rpc.hyperliquid.xyz/evm}"
      HEAD_HEX=$(curl -s -X POST "$RPC" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | sed -E 's/.*"result":"0x([0-9a-f]+)".*/\1/')
      START=$(( 16#$HEAD_HEX - 20 ))
    fi
    EXTRA=()
    # Point the block index at the deployed mainnet vault + native USDC when both are configured.
    if [ "${EVM_CHAIN_ID:-}" = "999" ] && [ -n "${SHIELD_VAULT_ADDRESS:-}" ] && [ -n "${USDC_ADDRESS:-}" ]; then
      EXTRA+=(-p "map_shield_events=evt_addr:${SHIELD_VAULT_ADDRESS}" -p "map_vault_flows=evt_addr:${SHIELD_VAULT_ADDRESS} || evt_addr:${USDC_ADDRESS}")
    fi
    ;;
  solana)
    ENDPOINT="${SUBSTREAMS_SOLANA_ENDPOINT:-${SUBSTREAMS_ENDPOINT:-devnet.sol.streamingfast.io:443}}"
    TOKEN="${SUBSTREAMS_SOLANA_API_TOKEN:-${SUBSTREAMS_API_TOKEN:-}}"
    DIR="$ROOT/substreams"; MANIFEST="shield-behavioral-memory-v0.2.0.spkg"; MODULE="map_vault_flows"
    [ -n "$START" ] || START="${SUBSTREAMS_START_SLOT:-0}"
    EXTRA=()
    ;;
  *) echo "usage: $0 hyperevm|solana [start] [range]"; exit 2 ;;
esac

TOKEN_NOTE="no token (expect an authentication error)"
if [ -n "$TOKEN" ]; then
  EXP=$(printf '%s' "$TOKEN" | cut -d. -f2 | tr '_-' '/+' | { p=$(cat); pad=$(( (4 - ${#p} % 4) % 4 )); printf '%s' "$p"; printf '=%.0s' $(seq 1 $pad 2>/dev/null); } | base64 -d 2>/dev/null | sed -E 's/.*"exp":([0-9]+).*/\1/' || true)
  TOKEN_NOTE="token present (${#TOKEN} chars${EXP:+, exp $(date -r "$EXP" -u +%Y-%m-%dT%H:%MZ 2>/dev/null || echo "$EXP")})"
fi
echo "stack=$STACK endpoint=$ENDPOINT module=$MODULE start=$START range=$RANGE $TOKEN_NOTE"
cd "$DIR"
SUBSTREAMS_API_TOKEN="$TOKEN" exec "$SUBSTREAMS_BIN" run "$MANIFEST" "$MODULE" -e "$ENDPOINT" -s "$START" -t "$RANGE" -o jsonl ${EXTRA[@]+"${EXTRA[@]}"}
