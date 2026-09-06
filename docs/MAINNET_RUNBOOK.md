# Deploying Shield to HyperEVM mainnet

The Graph indexes HyperEVM **mainnet** and not the testnet, so a vault the
Substreams package can actually see has to live on chain 999. This is the
rehearsed procedure; every step below was executed against a fork of mainnet
state (`anvil --fork-url https://rpc.hyperliquid.xyz/evm`) before being written
down.

## What the rehearsal established

| | Result |
|---|---|
| Same contract, mainnet dependencies | Deploys and reads back: `usdc()` → `0xb88339CB…630f`, `coreDeposit()` → `0x6B9E7731…0A24` |
| Mainnet USDC | 6 decimals, symbol `USDC` — same shape as the testnet token |
| Full setup (init, 2 registrations, approve, deposit) | All succeed |
| A release through Circle's **real** mainnet CoreDepositWallet | Succeeds, **168,661 gas — identical to testnet** |
| Block gas limit | Mainnet small blocks reject the ~5.4M-gas deployment, exactly as on testnet: big blocks are required both times |

There is no behavioural difference between the two chains for this contract.

## Cost

Deployment is 5,364,724 gas at 0.1 gwei = **0.00054 HYPE, about two cents**.
Four setup transactions add well under a cent. The only real money is the USDC
you choose to protect.

You need a little native HYPE on mainnet for gas. Bridge it Core → EVM with
`scripts/hyperevm-bridge.ts` (it dust-probes first).

## The procedure

```bash
export EVM_DEPLOYER_KEY=0x…            # holds mainnet HYPE + USDC
export EVM_CHAIN_ID=999
export EVM_RPC_URL=https://rpc.hyperliquid.xyz/evm

# 1. Gas, if it is on HyperCore rather than HyperEVM
bun run scripts/hyperevm-bridge.ts HYPE 2
bun run scripts/hyperevm-bridge.ts USDC <amount>

# 2. Big blocks: the deployment does not fit a small one
bun run hyperevm:big-blocks on

cd contracts && forge create src/ShieldVault.sol:ShieldVault \
  --rpc-url $EVM_RPC_URL --private-key $EVM_DEPLOYER_KEY \
  --gas-limit 6000000 --legacy --broadcast \
  --constructor-args 0xb88339CB7199b77E23DB6E890353E22632Ba630f \
                     0x6B9E773128f453f5c2C60935Ee2DE2CBc5390A24
cd .. && bun run hyperevm:big-blocks off

# 3. Vault, destinations and deposit. NOTE: EVM_START_BLOCK must be cleared or
#    set, or the value in .env (a testnet block) is silently reused.
EVM_START_BLOCK=<deploy block> SHIELD_VAULT_ADDRESS=<deployed> \
USDC_ADDRESS=0xb88339CB7199b77E23DB6E890353E22632Ba630f \
VENUE_ADDRESS=<your Hyperliquid account> \
SHIELD_DEPOSIT_USD=… SHIELD_FLOOR=… SHIELD_DAILY=… SHIELD_LOSS_TRIGGER=… \
  bun run bootstrap:hyperevm
```

## Then, for The Graph

`substreams-evm/substreams.yaml` needs two edits before it can stream the new
vault:

1. The `blockFilter` query strings and the `params:` block must name the
   mainnet vault and `0xb88339CB…630f` instead of the testnet addresses.
2. **`initialBlock` on every module must be the vault's deploy block.** They
   are currently `0`, which makes a live run try to process 45 million blocks
   to build its stores — the CLI refuses with a `--limit-processed-blocks`
   error, and rightly so.

With those set, `scripts/substreams-live.sh hyperevm` streams the real vault,
and the server flips `source.mode` to `substreams` because `SUBSTREAMS_ACTIVE`
requires chain 999.

## Known gap

The `CHAIN_ID === 999` path in `server/evm-index.ts` turns the Substreams
source on and the demo endpoints off. It has never run against a real vault,
because until now there was no mainnet vault to point it at. Exercise it
immediately after the deploy rather than during the recording.
