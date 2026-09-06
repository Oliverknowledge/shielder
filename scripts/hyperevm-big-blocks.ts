/**
 * Toggle HyperEVM dual-block mode for the deployer address.
 *
 * HyperEVM alternates small blocks (fast, ~2-3M gas) and big blocks (~1/min,
 * 30M gas). ShieldVault's deployment costs ~5.4M gas, so the deploy key has to
 * opt into big blocks first, then opt back out so ordinary vault transactions
 * confirm in a second again.
 *
 *   EVM_DEPLOYER_KEY=0x... bun run scripts/hyperevm-big-blocks.ts on   # big blocks
 *   EVM_DEPLOYER_KEY=0x... bun run scripts/hyperevm-big-blocks.ts off  # back to small
 *
 * The key is read from the environment and never written anywhere.
 */
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const mode = (process.argv[2] ?? "on").toLowerCase();
if (mode !== "on" && mode !== "off") {
  console.error("usage: bun run scripts/hyperevm-big-blocks.ts {on|off}");
  process.exit(1);
}
const key = process.env.EVM_DEPLOYER_KEY as Hex | undefined;
if (!key) {
  console.error("set EVM_DEPLOYER_KEY (never commit it)");
  process.exit(1);
}
const isTestnet = (process.env.EVM_CHAIN_ID ?? "998") !== "999";

const wallet = privateKeyToAccount(key);
const transport = new HttpTransport({ isTestnet });
const exchange = new ExchangeClient({ transport, wallet });
const info = new InfoClient({ transport });

console.log(`${wallet.address} → ${mode === "on" ? "big" : "small"} blocks on ${isTestnet ? "testnet" : "mainnet"}`);
await exchange.evmUserModify({ usingBigBlocks: mode === "on" });
const state = await info.userToMultiSigSigners({ user: wallet.address }).catch(() => null);
void state;
console.log("ok");
