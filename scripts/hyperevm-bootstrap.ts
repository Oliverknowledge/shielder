/**
 * Bootstrap Alex's vault on a real HyperEVM network (testnet 998 / mainnet 999)
 * against an already-deployed ShieldVault, the canonical USDC and Circle's
 * CoreDepositWallet. The Anvil twin is scripts/anvil-demo.ts, which also has to
 * deploy the mocks; here the token and the deposit wallet already exist.
 *
 *   EVM_DEPLOYER_KEY=0x... SHIELD_VAULT_ADDRESS=0x... bun run scripts/hyperevm-bootstrap.ts
 *
 * The deployer key is the vault authority ("Alex"). Monitor, relayer, trading
 * and cold keys are generated once into .shield/hyperevm-keys.json (gitignored)
 * and reused on later runs. Registration has to happen while the vault is empty,
 * so this runs before any deposit; the deposit itself happens only if the
 * authority already holds USDC (on testnet that needs the Hyperliquid drip).
 */
import { createPublicClient, createWalletClient, formatEther, getAddress, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SHIELD_VAULT_ABI } from "../client/abi/ShieldVault";
import { MOCK_USDC_ABI } from "../client/abi/MockUSDC"; // ERC20 subset: approve/balanceOf/transfer
import { encodeLabel, viemChain, type EvmConfig } from "../client/evm";
import { evmNetworkName, evmStatePath, readEvmState } from "../client/evm-state";
import { OwnerKind, Route } from "../client/views";

const STATE_DIR = process.env.SHIELD_STATE_DIR || ".shield";
const KEYS_FILE = `${STATE_DIR}/hyperevm-keys.json`;
const CHAIN_ID = Number(process.env.EVM_CHAIN_ID || 998);
const RPC = process.env.EVM_RPC_URL || (CHAIN_ID === 999 ? "https://rpc.hyperliquid.xyz/evm" : "https://rpc.hyperliquid-testnet.xyz/evm");
// Canonical HyperEVM addresses. Testnet USDC is Circle's test token; the deposit
// wallet is the contract spotMeta lists as USDC's `evmContract`.
const DEFAULTS: Record<number, { usdc: Address; coreDeposit: Address }> = {
  998: { usdc: "0x2B3370eE501B4a559b57D449569354196457D8Ab", coreDeposit: "0x0B80659a4076E9E93C7DbE0f10675A16a3e5C206" },
  // Mainnet: pass USDC_ADDRESS explicitly (Circle's HyperEVM listing) rather than guess it here.
  999: { usdc: "" as Address, coreDeposit: "0x6B9E773128f453f5c2C60935Ee2DE2CBc5390A24" },
};

// EVM_DEPLOYER_KEY funds the vault (gas + USDC). SHIELD_AUTHORITY_KEY owns it.
// They are the same key by default; splitting them matches how the product
// actually works, where the Shield wallet and the venue account are different
// addresses, and it lets a fresh vault be created without moving the money.
const deployerKey = process.env.EVM_DEPLOYER_KEY as Hex | undefined;
if (!deployerKey) throw new Error("set EVM_DEPLOYER_KEY (funds the vault; never commit it)");
const vault = getAddress(process.env.SHIELD_VAULT_ADDRESS || "") as Address;
const usdcRaw = process.env.USDC_ADDRESS || DEFAULTS[CHAIN_ID]?.usdc;
if (!usdcRaw) throw new Error(`set USDC_ADDRESS for chain ${CHAIN_ID}`);
const usdc = getAddress(usdcRaw) as Address;
const coreDeposit = getAddress(process.env.CORE_DEPOSIT_ADDRESS || DEFAULTS[CHAIN_ID]?.coreDeposit || "") as Address;

type Keys = { verifier: Hex; relayer: Hex; execution: Hex; cold: Hex; authority?: Hex };
mkdirSync(STATE_DIR, { recursive: true });
const keys: Keys = existsSync(KEYS_FILE)
  ? (JSON.parse(readFileSync(KEYS_FILE, "utf8")) as Keys)
  : { verifier: generatePrivateKey(), relayer: generatePrivateKey(), execution: generatePrivateKey(), cold: generatePrivateKey() };
if (!keys.authority) keys.authority = generatePrivateKey();
writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));

// The trading destination can be any Hyperliquid account: pass VENUE_ADDRESS to
// point the vault at one that actually trades, so the app's venue panel reads
// live equity and fills instead of an empty account.
const venueOverride = process.env.VENUE_ADDRESS ? (getAddress(process.env.VENUE_ADDRESS) as Address) : null;

const funder = privateKeyToAccount(deployerKey);
// SHIELD_AUTHORITY_KEY=self reuses the funder as the authority (the old behaviour).
const authorityKey = (process.env.SHIELD_AUTHORITY_KEY === "self" ? deployerKey : (process.env.SHIELD_AUTHORITY_KEY as Hex | undefined) ?? keys.authority!) as Hex;
const alex = privateKeyToAccount(authorityKey);
const verifier = privateKeyToAccount(keys.verifier);
const relayer = privateKeyToAccount(keys.relayer);
const axiomKeyed = privateKeyToAccount(keys.execution);
const axiom = { address: venueOverride ?? axiomKeyed.address };
const ledger = privateKeyToAccount(keys.cold);

const USD = 1_000_000n;
const usdEnv = (name: string, fallback: number) => BigInt(Math.round(Number(process.env[name] || fallback) * 1e6));
const RULES = {
  floor: usdEnv("SHIELD_FLOOR", 6000),
  daily: usdEnv("SHIELD_DAILY", 2000),
  lossTrigger: usdEnv("SHIELD_LOSS_TRIGGER", 1000),
  emergencyCap: usdEnv("SHIELD_EMERGENCY_CAP", 200),
  cooldownSecs: BigInt(Math.round(Number(process.env.SHIELD_LOSS_COOLDOWN_HOURS || 18) * 3600)),
  thresholdBps: Math.round(Number(process.env.SHIELD_THRESHOLD_PCT || 20) * 100),
};

const cfg: EvmConfig = { rpcUrl: RPC, chainId: CHAIN_ID, vault, usdc };
const chain = viemChain(cfg);
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account: alex, chain, transport: http(RPC) });
const funderWallet = createWalletClient({ account: funder, chain, transport: http(RPC) });
/** Vault calls are signed by the authority; `by: "funder"` is for the money. */
async function send(label: string, tx: { address: Address; abi: readonly unknown[]; functionName: string; args: unknown[]; by?: "authority" | "funder" }) {
  const w = tx.by === "funder" ? funderWallet : wallet;
  const hash = await w.writeContract({ address: tx.address, abi: tx.abi as never, functionName: tx.functionName as never, args: tx.args as never });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  console.log(`${rcpt.status === "success" ? "✅" : "❌"} ${label}: ${hash}`);
  if (rcpt.status !== "success") throw new Error(`${label} reverted`);
  return rcpt;
}

const vaultOf = (authority: Address) => pub.readContract({ address: vault, abi: SHIELD_VAULT_ABI, functionName: "getVault", args: [authority] }) as Promise<{ exists: boolean; balance: bigint; riskVerifier: Address }>;

console.log(`chain ${CHAIN_ID} via ${RPC}\nvault     ${vault}\nusdc      ${usdc}\ncore      ${coreDeposit}\nAuthority ${alex.address}${alex.address === funder.address ? " (also the funder)" : " (owns the vault)"}\nFunder    ${funder.address} (gas + USDC)\nVerifier  ${verifier.address}\nRelayer   ${relayer.address}\nVenue     ${axiom.address} (Hyperliquid, HyperCore route)${venueOverride ? " [VENUE_ADDRESS]" : ""}\nSafe      ${ledger.address} (cold)`);

const deployedCode = await pub.getCode({ address: vault });
if (!deployedCode || deployedCode === "0x") throw new Error(`no contract at ${vault} on chain ${CHAIN_ID}`);
console.log(`\ndeployed bytecode: ${(deployedCode.length - 2) / 2} bytes`);
const onchainCore = (await pub.readContract({ address: vault, abi: SHIELD_VAULT_ABI, functionName: "coreDeposit" })) as Address;
if (getAddress(onchainCore) !== coreDeposit) throw new Error(`vault's coreDeposit is ${onchainCore}, expected ${coreDeposit}`);

let gas = await pub.getBalance({ address: alex.address });
console.log(`\nauthority gas: ${formatEther(gas)} ${chain.nativeCurrency.symbol}`);
const GAS_FLOOR = BigInt(Math.round(Number(process.env.SHIELD_AUTHORITY_GAS || 0.2) * 1e18));
if (gas < GAS_FLOOR && alex.address !== funder.address) {
  const top = GAS_FLOOR - gas;
  const hash = await funderWallet.sendTransaction({ account: funder, chain, to: alex.address, value: top });
  await pub.waitForTransactionReceipt({ hash });
  gas = await pub.getBalance({ address: alex.address });
  console.log(`✅ funded the authority with ${formatEther(top)} ${chain.nativeCurrency.symbol}: ${hash}`);
}

let v = await vaultOf(alex.address);
if (v.exists) {
  console.log(`\nvault already initialized (verifier ${v.riskVerifier}, balance $${Number(v.balance) / 1e6})`);
} else {
  const $ = (r: bigint) => `$${(Number(r) / 1e6).toLocaleString("en-US")}`;
  await send(`initialize vault (${$(RULES.floor)} floor, ${$(RULES.daily)}/day, ${$(RULES.lossTrigger)} loss → ${Number(RULES.cooldownSecs) / 3600}h pause)`, {
    address: vault, abi: SHIELD_VAULT_ABI, functionName: "initializeVault",
    args: [{ riskVerifier: verifier.address, protectedFloor: RULES.floor, topUpThresholdBps: RULES.thresholdBps, emergencyCap: RULES.emergencyCap, velocityThreshold: RULES.daily, lossTriggerUsdc: RULES.lossTrigger, lossCooldownSecs: RULES.cooldownSecs }],
  });
  v = await vaultOf(alex.address);
}

const registered = (await pub.readContract({ address: vault, abi: SHIELD_VAULT_ABI, functionName: "getRegistryOwners", args: [alex.address] })) as Address[];
const has = (a: Address) => registered.some((r) => getAddress(r) === getAddress(a));
if (v.balance === 0n) {
  if (!has(axiom.address)) await send("register the Hyperliquid account (HyperCore route)", { address: vault, abi: SHIELD_VAULT_ABI, functionName: "registerOwner", args: [axiom.address, OwnerKind.Execution, Route.HyperCore, encodeLabel("Hyperliquid")] });
  if (!has(ledger.address)) await send("register the safe wallet (cold)", { address: vault, abi: SHIELD_VAULT_ABI, functionName: "registerOwner", args: [ledger.address, OwnerKind.Cold, Route.Evm, encodeLabel("Safe wallet")] });
} else if (!has(axiom.address) || !has(ledger.address)) {
  console.log("\n⚠️  vault is funded: adding a destination is now the delayed path (proposeLoosen), not registerOwner.");
}

// `deposit(authority, amount)` pulls from msg.sender, so the funder can fill a
// vault it does not own — the money never has to touch the authority address.
const walletUsdc = (await pub.readContract({ address: usdc, abi: MOCK_USDC_ABI, functionName: "balanceOf", args: [funder.address] })) as bigint;
console.log(`\nfunder USDC: $${Number(walletUsdc) / 1e6}`);
const target = usdEnv("SHIELD_DEPOSIT_USD", 10_000);
if (v.balance === 0n && walletUsdc >= target) {
  await send(`approve $${Number(target) / 1e6}`, { address: usdc, abi: MOCK_USDC_ABI, functionName: "approve", args: [vault, target], by: "funder" });
  await send(`deposit $${Number(target) / 1e6}`, { address: vault, abi: SHIELD_VAULT_ABI, functionName: "deposit", args: [alex.address, target], by: "funder" });
  v = await vaultOf(alex.address);
} else if (v.balance === 0n) {
  console.log(`skipping the deposit: the funder holds $${Number(walletUsdc) / 1e6}, needs $${Number(target) / 1e6}.`);
  console.log(CHAIN_ID === 998 ? "Claim testnet USDC at https://app.hyperliquid-testnet.xyz/drip, move it Core → EVM, then re-run this script." : "Send USDC to the authority on HyperEVM, then re-run this script.");
}

const network = evmNetworkName(CHAIN_ID);
const statePath = evmStatePath(STATE_DIR, network);
const prev = readEvmState(STATE_DIR, network) as Record<string, unknown>;
const startBlock = Number(process.env.EVM_START_BLOCK || (typeof prev.startBlock === "number" && prev.startBlock > 0 && prev.chainId === CHAIN_ID ? prev.startBlock : await pub.getBlockNumber()));
writeFileSync(statePath, JSON.stringify({
  chain: "evm", network,
  rpcUrl: RPC, chainId: CHAIN_ID, vault, usdc, coreDeposit: null, authority: alex.address,
  executionWallet: axiom.address, coldWallet: ledger.address, riskVerifier: verifier.address,
  verifierKeyNote: `generated into ${KEYS_FILE} (gitignored)`, relayer: relayer.address,
  startBlock, createdAt: new Date().toISOString(),
}, null, 2));
console.log(`\nstate written to ${statePath} · vault balance $${Number((await vaultOf(alex.address)).balance) / 1e6} · start block ${startBlock}`);
console.log(`\nrun the server with:\n  SHIELD_EVM_VERIFIER_KEY=<.shield/hyperevm-keys.json .verifier> SHIELD_EVM_RELAYER_KEY=<.relayer> bun run server:evm`);
