/**
 * Stage a real capital-flow history on a chain The Graph indexes (Ethereum
 * Sepolia), so the Substreams package streams rows from a Graph Market
 * provider. Same ShieldVault bytecode, ROUTE_EVM only (no CoreDepositWallet on
 * Sepolia), MockUSDC minted freely. Testnet only.
 *
 *   EVM_DEPLOYER_KEY=0x… SHIELD_VAULT_ADDRESS=0x… USDC_ADDRESS=0x… bun run scripts/sepolia-demo.ts [top_up_usd=1500] [return_usd=80]
 */
import { createPublicClient, createWalletClient, getAddress, http, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync } from "node:fs";
import { SHIELD_VAULT_ABI } from "../client/abi/ShieldVault";
import { MOCK_USDC_ABI } from "../client/abi/MockUSDC";
import { encodeLabel, viemChain, type EvmConfig } from "../client/evm";
import { OwnerKind, Route } from "../client/views";

const RPC = process.env.EVM_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const CHAIN_ID = Number(process.env.EVM_CHAIN_ID || 11155111);
if (CHAIN_ID === 1 || CHAIN_ID === 999) throw new Error("testnet only");
const vault = getAddress(process.env.SHIELD_VAULT_ADDRESS!) as Address;
const usdc = getAddress(process.env.USDC_ADDRESS!) as Address;
const keys = JSON.parse(readFileSync(".shield/hyperevm-keys.json", "utf8")) as Record<string, Hex>;
const TOP_UP = BigInt(Math.round(Number(process.argv[2] ?? 1500) * 1e6));
const RETURN = BigInt(Math.round(Number(process.argv[3] ?? 80) * 1e6));
const USD = 1_000_000n;

const cfg: EvmConfig = { rpcUrl: RPC, chainId: CHAIN_ID, vault, usdc };
const chain = viemChain(cfg);
const pub = createPublicClient({ chain, transport: http(RPC) });
// The block the indexer should start from. This script stages history onto an
// already-deployed twin rather than deploying it, so there is no deploy receipt
// to read: default to the head at the moment staging begins, which covers every
// flow below, and let EVM_START_BLOCK pin the twin's real deploy block instead.
const DEPLOY_BLOCK = Number(process.env.EVM_START_BLOCK || (await pub.getBlockNumber()));
const acct = (k: Hex) => privateKeyToAccount(k);
const funder = acct(process.env.EVM_DEPLOYER_KEY as Hex);
const alex = acct(keys.authority), venue = acct(keys.execution), safe = acct(keys.cold), verifier = acct(keys.verifier);
const wallet = (a: ReturnType<typeof acct>) => createWalletClient({ account: a, chain, transport: http(RPC) });
const send = async (label: string, by: ReturnType<typeof acct>, req: Parameters<ReturnType<typeof wallet>["writeContract"]>[0]) => {
  const hash = await wallet(by).writeContract(req);
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`${r.status === "success" ? "✅" : "❌"} ${label}: ${hash} (block ${r.blockNumber})`);
  if (r.status !== "success") throw new Error(label);
  return r;
};
const gas = async (to: Address, eth: string) => {
  if ((await pub.getBalance({ address: to })) < parseEther(eth) / 2n) {
    const hash = await wallet(funder).sendTransaction({ to, value: parseEther(eth) });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`⛽ ${to} funded with ${eth} ETH`);
  }
};

console.log(`chain ${CHAIN_ID} vault ${vault} usdc ${usdc}\nauthority ${alex.address} venue ${venue.address} safe ${safe.address} verifier ${verifier.address}`);
await gas(alex.address, "0.01"); await gas(venue.address, "0.005");
const v = (await pub.readContract({ address: vault, abi: SHIELD_VAULT_ABI, functionName: "getVault", args: [alex.address] })) as { exists: boolean; balance: bigint };
if (!v.exists) {
  await send("initialize vault ($6,000 floor, $2,000/day, $300 loss → 12h)", alex, { address: vault, abi: SHIELD_VAULT_ABI, functionName: "initializeVault", args: [{ riskVerifier: verifier.address, protectedFloor: 6_000n * USD, topUpThresholdBps: 2000, emergencyCap: 200n * USD, velocityThreshold: 2_000n * USD, lossTriggerUsdc: 300n * USD, lossCooldownSecs: 12n * 3600n }] });
  await send("register the trading wallet (EVM route)", alex, { address: vault, abi: SHIELD_VAULT_ABI, functionName: "registerOwner", args: [venue.address, OwnerKind.Execution, Route.Evm, encodeLabel("Trading wallet")] });
  await send("register the safe wallet (cold)", alex, { address: vault, abi: SHIELD_VAULT_ABI, functionName: "registerOwner", args: [safe.address, OwnerKind.Cold, Route.Evm, encodeLabel("Safe wallet")] });
  await send("mint $10,000 mock USDC to the authority", funder, { address: usdc, abi: MOCK_USDC_ABI, functionName: "mint", args: [alex.address, 10_000n * USD] });
  await send("approve", alex, { address: usdc, abi: MOCK_USDC_ABI, functionName: "approve", args: [vault, 10_000n * USD] });
  await send("deposit $10,000", alex, { address: vault, abi: SHIELD_VAULT_ABI, functionName: "deposit", args: [alex.address, 10_000n * USD] });
}
await send(`release $${Number(TOP_UP) / 1e6} to the trading wallet`, alex, { address: vault, abi: SHIELD_VAULT_ABI, functionName: "instantTopUp", args: [venue.address, TOP_UP] });
await send("venue approves the return", venue, { address: usdc, abi: MOCK_USDC_ABI, functionName: "approve", args: [vault, RETURN] });
await send(`$${Number(RETURN) / 1e6} comes back via deposit()`, venue, { address: vault, abi: SHIELD_VAULT_ABI, functionName: "deposit", args: [alex.address, RETURN] });
const after = (await pub.readContract({ address: vault, abi: SHIELD_VAULT_ABI, functionName: "getVault", args: [alex.address] })) as { balance: bigint };
console.log(`vault balance now $${Number(after.balance) / 1e6}`);
writeFileSync(".shield/demo-state.evm.sepolia.json", JSON.stringify({ chain: "evm", network: "sepolia", rpcUrl: RPC, chainId: CHAIN_ID, vault, usdc, startBlock: DEPLOY_BLOCK, authority: alex.address, executionWallet: venue.address, coldWallet: safe.address, riskVerifier: verifier.address, createdAt: new Date().toISOString() }, null, 2));
