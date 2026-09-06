/**
 * Move spot balances from HyperCore to HyperEVM (the "Transfer to EVM" button,
 * as a script).
 *
 *   EVM_DEPLOYER_KEY=0x… bun run scripts/hyperevm-bridge.ts USDC 700
 *   EVM_DEPLOYER_KEY=0x… bun run scripts/hyperevm-bridge.ts HYPE 2
 *
 * A Core→EVM transfer is a `spotSend` to the token's system address, and a
 * wrong address means the funds are gone. So this always sends a dust amount
 * first, waits for it to land on the EVM side, and only then sends the rest —
 * unless the caller passes --no-probe because a probe already succeeded.
 */
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, formatEther, formatUnits, type Address, type Hex } from "viem";

const [coinArg, amountArg, ...flags] = process.argv.slice(2);
const COIN = (coinArg ?? "").toUpperCase();
const AMOUNT = Number(amountArg ?? 0);
const NO_PROBE = flags.includes("--no-probe");
if (!["USDC", "HYPE"].includes(COIN) || !(AMOUNT > 0)) {
  console.error("usage: bun run scripts/hyperevm-bridge.ts {USDC|HYPE} <amount> [--no-probe]");
  process.exit(1);
}
const key = process.env.EVM_DEPLOYER_KEY as Hex | undefined;
if (!key) {
  console.error("set EVM_DEPLOYER_KEY (never commit it)");
  process.exit(1);
}

const IS_TESTNET = (process.env.EVM_CHAIN_ID || "998") !== "999";
const RPC = process.env.EVM_RPC_URL || (IS_TESTNET ? "https://rpc.hyperliquid-testnet.xyz/evm" : "https://rpc.hyperliquid.xyz/evm");
// The ERC-20 the vault holds on the EVM side (Circle's test USDC on 998).
const USDC_EVM = (process.env.USDC_ADDRESS || "0x2B3370eE501B4a559b57D449569354196457D8Ab") as Address;
const ERC20_BALANCE_OF = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const;

const wallet = privateKeyToAccount(key);
const transport = new HttpTransport({ isTestnet: IS_TESTNET });
const exchange = new ExchangeClient({ transport, wallet });
const info = new InfoClient({ transport });
const pub = createPublicClient({ transport: http(RPC) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Native HYPE has its own bridge address; every other spot token uses 0x20…00 + index. */
function systemAddress(index: number, name: string): Address {
  if (name === "HYPE") return "0x2222222222222222222222222222222222222222";
  return `0x${(0x2000000000000000000000000000000000000000n + BigInt(index)).toString(16).padStart(40, "0")}` as Address;
}

const evmBalance = async (): Promise<bigint> =>
  COIN === "HYPE"
    ? await pub.getBalance({ address: wallet.address })
    : ((await pub.readContract({ address: USDC_EVM, abi: ERC20_BALANCE_OF, functionName: "balanceOf", args: [wallet.address] })) as bigint);

const fmt = (raw: bigint) => (COIN === "HYPE" ? `${formatEther(raw)} HYPE` : `${formatUnits(raw, 6)} USDC`);

const meta = await info.spotMeta();
const token = meta.tokens.find((t) => t.name === COIN);
if (!token) throw new Error(`${COIN} is not a spot token on this network`);
const tokenId = `${token.name}:${token.tokenId}`;
const destination = systemAddress(token.index, token.name);

const coreBalance = async (): Promise<number> => {
  const s = await info.spotClearinghouseState({ user: wallet.address });
  return Number(s.balances.find((b) => b.coin === COIN)?.total ?? 0);
};

console.log(`${wallet.address} · ${IS_TESTNET ? "testnet" : "mainnet"}`);
console.log(`bridging ${COIN} Core → EVM via ${destination}`);
console.log(`  on Core: ${await coreBalance()} ${COIN}`);
console.log(`  on EVM:  ${fmt(await evmBalance())}`);

/** Send `amount` and wait for the EVM balance to grow. Returns the delta, or null if nothing arrived. */
async function bridge(amount: number, waitMs: number): Promise<bigint | null> {
  const before = await evmBalance();
  // Unified accounts reject the legacy spotSend, so use sendAsset from the spot
  // DEX; fall back to spotSend for accounts that are not unified yet.
  try {
    await exchange.sendAsset({ destination, sourceDex: "spot", destinationDex: "spot", token: tokenId, amount: String(amount) });
  } catch (e) {
    if (!/unified account/i.test(e instanceof Error ? e.message : String(e))) {
      await exchange.spotSend({ destination, token: tokenId, amount: String(amount) });
    } else {
      throw e;
    }
  }
  console.log(`  sent ${amount} ${COIN}; waiting for it on the EVM side…`);
  for (let i = 0; i < Math.ceil(waitMs / 3000); i++) {
    await sleep(3000);
    const after = await evmBalance();
    if (after > before) return after - before;
  }
  return null;
}

if (!NO_PROBE) {
  const probe = COIN === "HYPE" ? 0.05 : 1;
  console.log(`\nprobe: ${probe} ${COIN} first, so a wrong system address costs ${probe} and not ${AMOUNT}`);
  const got = await bridge(probe, 45_000);
  if (got === null) {
    console.error(`\n❌ the probe did not arrive on the EVM side within 45s.`);
    console.error(`   Stopping: do NOT send the remaining ${AMOUNT} until this is understood.`);
    console.error(`   Check ${destination} and the Hyperliquid "Transfer to/from EVM" flow in the UI.`);
    process.exit(1);
  }
  console.log(`  ✅ probe landed: +${fmt(got)}`);
}

const rest = NO_PROBE ? AMOUNT : AMOUNT - (COIN === "HYPE" ? 0.05 : 1);
if (rest > 0) {
  console.log(`\nsending the remaining ${rest} ${COIN}`);
  const got = await bridge(rest, 90_000);
  console.log(got === null ? "  ⚠️  not visible yet; check the balance again in a minute" : `  ✅ landed: +${fmt(got)}`);
}

console.log(`\nfinal:`);
console.log(`  on Core: ${await coreBalance()} ${COIN}`);
console.log(`  on EVM:  ${fmt(await evmBalance())}`);
