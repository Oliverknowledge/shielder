/**
 * Local EVM demo: deploy MockUSDC, MockCoreDepositWallet and ShieldVault on
 * Anvil, then set Alex up the way the onboarding wizard does.
 *
 * $10,000 of capital, split the way the product describes: $1,500 is the
 * trading bankroll and already sits in the venue account, $8,500 goes into
 * Shield ($6,000 of it a floor that can never be released), $2,000/day
 * reload limit, $750 of realised loss pauses new capital for 12 hours.
 *
 *   anvil --chain-id 31337 &            # in another terminal
 *   bun run scripts/anvil-demo.ts       # writes .shield/demo-state.evm.anvil.json
 *
 * Keys are Anvil's well-known dev accounts; nothing here is a secret.
 */
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { SHIELD_VAULT_ABI } from "../client/abi/ShieldVault";
import { MOCK_USDC_ABI } from "../client/abi/MockUSDC";
import { MOCK_CORE_DEPOSIT_ABI } from "../client/abi/MockCoreDepositWallet";
import { encodeLabel, viemChain, type EvmConfig } from "../client/evm";
import { evmNetworkName, evmStatePath } from "../client/evm-state";
import { OwnerKind, Route } from "../client/views";

const RPC = process.env.EVM_RPC_URL ?? "http://127.0.0.1:8545";
const CHAIN_ID = Number(process.env.EVM_CHAIN_ID ?? 31337);
// Anvil dev accounts (public test keys)
const ALEX_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex; // account 0
const VENUE_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex; // account 1: the Hyperliquid account
const SAFE_PK = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex; // account 2: the safe wallet
const VERIFIER_PK = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex; // account 3 (Shield monitor)

const USD = 1_000_000n;

function artifact(name: string): { abi: unknown; bytecode: Hex } {
  const file = name.startsWith("Mock") ? "Mocks" : name;
  const j = JSON.parse(readFileSync(`contracts/out/${file}.sol/${name}.json`, "utf8")) as { abi: unknown; bytecode: { object: Hex } };
  return { abi: j.abi, bytecode: j.bytecode.object };
}

async function main() {
  const cfg0 = { rpcUrl: RPC, chainId: CHAIN_ID, vault: "0x0000000000000000000000000000000000000000" as Address, usdc: "0x0000000000000000000000000000000000000000" as Address };
  const chain = viemChain(cfg0);
  const pub = createPublicClient({ chain, transport: http(RPC) });
  const alex = privateKeyToAccount(ALEX_PK);
  const venue = privateKeyToAccount(VENUE_PK);
  const safe = privateKeyToAccount(SAFE_PK);
  const verifier = privateKeyToAccount(VERIFIER_PK);
  const wallet = createWalletClient({ account: alex, chain, transport: http(RPC) });
  console.log(`chain ${CHAIN_ID} via ${RPC}\nAlex      ${alex.address}\nVenue     ${venue.address} (Hyperliquid, HyperCore route)\nSafe      ${safe.address} (cold)\nVerifier  ${verifier.address}`);

  const deploy = async (name: string, args: unknown[]) => {
    const a = artifact(name);
    const hash = await wallet.deployContract({ abi: a.abi as never, bytecode: a.bytecode, args: args as never });
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    if (!rcpt.contractAddress) throw new Error(`${name} deploy failed`);
    console.log(`${name.padEnd(22)} ${rcpt.contractAddress}`);
    return rcpt.contractAddress;
  };
  const usdc = await deploy("MockUSDC", []);
  const core = await deploy("MockCoreDepositWallet", [usdc]);
  const vault = await deploy("ShieldVault", [usdc, core]);
  const cfg: EvmConfig = { rpcUrl: RPC, chainId: CHAIN_ID, vault, usdc };

  const send = async (label: string, tx: { address: Address; abi: readonly unknown[]; functionName: string; args: unknown[] }) => {
    const hash = await wallet.writeContract({ address: tx.address, abi: tx.abi as never, functionName: tx.functionName as never, args: tx.args as never });
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    console.log(`${rcpt.status === "success" ? "✅" : "❌"} ${label}: ${hash}`);
    return hash;
  };

  await send("mint $100,000 test USDC to Alex", { address: usdc, abi: MOCK_USDC_ABI, functionName: "mint", args: [alex.address, 100_000n * USD] });
  await send("initialize vault ($6,000 floor, $2,000/day, $750 loss → 12h)", { address: vault, abi: SHIELD_VAULT_ABI, functionName: "initializeVault", args: [{ riskVerifier: verifier.address, protectedFloor: 6_000n * USD, topUpThresholdBps: 2000, emergencyCap: 200n * USD, velocityThreshold: 2_000n * USD, lossTriggerUsdc: 750n * USD, lossCooldownSecs: 12n * 3600n }] });
  await send("register the Hyperliquid account (HyperCore route)", { address: vault, abi: SHIELD_VAULT_ABI, functionName: "registerOwner", args: [venue.address, OwnerKind.Execution, Route.HyperCore, encodeLabel("Hyperliquid")] });
  await send("register the safe wallet (cold)", { address: vault, abi: SHIELD_VAULT_ABI, functionName: "registerOwner", args: [safe.address, OwnerKind.Cold, Route.Evm, encodeLabel("Safe wallet")] });
  await send("approve vault", { address: usdc, abi: MOCK_USDC_ABI, functionName: "approve", args: [vault, 10_000n * USD] });
  await send("deposit $8,500 into the treasury", { address: vault, abi: SHIELD_VAULT_ABI, functionName: "deposit", args: [alex.address, 8_500n * USD] });
  // The $1,500 bankroll never goes through Shield: the user funds their own
  // venue account, exactly as they would on Hyperliquid today.
  await send("approve the deposit wallet", { address: usdc, abi: MOCK_USDC_ABI, functionName: "approve", args: [core, 1_500n * USD] });
  await send("fund the venue account with the $1,500 bankroll", { address: core, abi: MOCK_CORE_DEPOSIT_ABI, functionName: "depositFor", args: [venue.address, 1_500n * USD, 0] });

  const deployBlock = Number(await pub.getBlockNumber());
  mkdirSync(".shield", { recursive: true });
  const network = evmNetworkName(CHAIN_ID);
  const state = {
    chain: "evm", network,
    rpcUrl: RPC, chainId: CHAIN_ID, vault, usdc, coreDeposit: core, authority: alex.address, executionWallet: venue.address, coldWallet: safe.address,
    riskVerifier: verifier.address, verifierKeyNote: "anvil dev account 3", startBlock: Math.max(0, deployBlock - 10), createdAt: new Date().toISOString(),
  };
  const statePath = evmStatePath(".shield", network);
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log(`\nstate written to ${statePath}\nvault ${vault} · balance ${(await pub.readContract({ address: vault, abi: SHIELD_VAULT_ABI, functionName: "getVault", args: [alex.address] }) as { balance: bigint }).balance / USD} USDC`);
  void parseAbi;
}

main().catch((e) => { console.error(e); process.exit(1); });
