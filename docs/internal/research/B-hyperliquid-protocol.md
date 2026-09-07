# B. Hyperliquid protocol: what each signing authority can and cannot do

Research spike, Agent B. Written 2026-09-07 against the current docs and a live
Hyperliquid TESTNET experiment. Question under test: can Shield honestly offer
FULL SESSION AUTHORITY -> REDUCED AUTHORITY -> REDUCE-ONLY AUTHORITY without
Shield becoming the trading terminal?

Short answer up front: **Hyperliquid has exactly two authority levels, master and
agent (API wallet). There is no venue-side scoping of an agent (no reduce-only,
spot-only, size-cap or leverage-cap agents), an agent can do everything trading
related including raising leverage to the asset max, and the master key always
keeps everything.** A "reduce-only authority" can only be a Shield-side policy on
a key Shield holds, which is the trading-terminal outcome we wanted to avoid. Details,
citations and the experiment transcript follow.

## 0. Sources and method

- Docs: `https://hyperliquid.gitbook.io/hyperliquid-docs` — the full text export
  (`/llms-full.txt`, 504 KB, pulled 2026-09-07) was grepped so that quotes below are
  from the current docs, not memory. Individual pages: *Exchange endpoint*, *Nonces
  and API wallets*, *Signing*, *Sub-accounts*, *Margining*, *Order types*, *Account
  abstraction modes*, *Builder codes*, *Multi-sig*, *Rate limits / error responses*.
  Note: `trading/api-wallets`, `trading/subaccounts` and `trading/unified-account` are
  404 today; the live pages are `trading/sub-accounts` and
  `trading/account-abstraction-modes`.
- Ground truth for signing: `hyperliquid-python-sdk` `hyperliquid/utils/signing.py`
  and `hyperliquid/exchange.py` (cloned at HEAD 2026-09-07), cross-checked against
  `@nktkas/hyperliquid` 0.33.3 (the SDK this repo uses), whose `_methods/*.js` each
  declare `executeL1Action` or `executeUserSignedAction`.
- Experiment: Hyperliquid TESTNET, master = the repo's `execution` key
  (`0xE7c2Adb44064e705A2e955770440C527373967A1`), throwaway agents generated in
  `/tmp/hl-exp`. Every request and response was logged (`/tmp/hl-exp/transcript*.jsonl`).
  Nothing was committed, no key was printed, mainnet was never touched. Net cost of the
  experiment: about $0.64 of test USDC in spreads/fees (perps balance 77.875 -> 77.240),
  plus 0.0098 test HYPE dust left on the spot side (below the $10 order minimum, not
  worth cleaning).

## 1. The two signing schemes

Everything on `POST /exchange` is `{ action, nonce, signature, [vaultAddress], [expiresAfter] }`.
There are two ways to produce `signature`, and **which scheme an action uses decides who
can sign it**.

### 1a. L1 actions ("phantom agent" signing)

`signing.py`:

```
action_hash = keccak( msgpack(action) ++ nonce(u64 BE) ++ (0x00 | 0x01 ++ vaultAddress) ++ [0x00 ++ expiresAfter(u64 BE)] )
phantom_agent = { source: "a" (mainnet) | "b" (testnet), connectionId: action_hash }
EIP-712 domain { name: "Exchange", version: "1", chainId: 1337, verifyingContract: 0x0 }
primaryType "Agent" { source: string, connectionId: bytes32 }
```

The venue recovers the signer from the signature and then resolves *whose account the
action applies to*: if the signer is a registered agent, the action applies to the agent's
principal (`userRole` -> `{"role":"agent","data":{"user":<master>}}`); if the signer is a
normal user, it applies to that user; if `vaultAddress` is set, it applies to that
sub-account or vault, provided the signer (user or the user's agent) controls it.
**Any L1 action can be signed by an approved agent.** This is the entire trading surface.

`expiresAfter` (ms timestamp) is part of the hash and only exists for L1 actions. Docs
(*Exchange endpoint / Expires After*): "Some actions support an optional field
`expiresAfter` ... User-signed actions such as Core USDC transfer do not support the
`expiresAfter` field. Note that actions consume 5x the usual address-based rate limit when
canceled due to a stale `expiresAfter` field." Observed rejection text for a stale one:
`"Action already expired"` (run 1, step 7q).

### 1b. User-signed actions (EIP-712 typed data, wallet-readable)

`signing.py` `sign_user_signed_action`: domain
`{ name: "HyperliquidSignTransaction", version: "1", chainId: signatureChainId, verifyingContract: 0x0 }`,
primary type `HyperliquidTransaction:<Name>`, message = the action itself including
`hyperliquidChain: "Mainnet"|"Testnet"` (anti-replay across envs) and `signatureChainId`
(any chain; the SDK uses `0x66eee`, this repo's SDK uses `0x1`).

The venue recovers the signer and **the action applies to the signer's own account, full
stop**. There is no agent indirection. If an agent key signs `usdSend`, the venue treats it
as the *agent's own* (empty) account trying to send, and rejects with
`"Must deposit before performing actions. User: <agent address>"` (run 1, steps 7a-7e, 7i, 7m).
So "master only" below is not a permission flag the venue checks; it falls out of the
signature scheme. `vaultAddress` and `expiresAfter` are not part of these payloads
(`_post_action` in `exchange.py` nulls `vaultAddress` for `usdClassTransfer`/`sendAsset`;
the sub-account variant is expressed inside the message instead).

## 2. Action map

Legend. Signer: **M** = master key only (user-signed EIP-712, applies to signer's own
account), **M/A** = master or any approved agent (L1 action). Scheme: **L1** = phantom agent
(section 1a), **U** = user-signed typed data (section 1b). "Observed" = seen in the testnet
run, with the verbatim venue text.

### 2a. Trading

| Action | Signer | Scheme | Fields | Notes / observed |
|---|---|---|---|---|
| `order` | M/A | L1 | `orders[]: { a asset, b isBuy, p price(str), s size(str), r reduceOnly, t: {limit:{tif:"Alo"\|"Ioc"\|"Gtc"}} \| {trigger:{isMarket, triggerPx(str), tpsl:"tp"\|"sl"}}, c cloid? }`, `grouping: "na"\|"normalTpsl"\|"positionTpsl"\|{p:int}`, `builder?: {b addr, f tenths-of-bp}`; request-level `vaultAddress?`, `expiresAfter?` | Spot: `a = 10000 + spotPairIndex`. Min notional $10 ("Order must have minimum value of 10 {quote_token}"). Observed with an agent: perps open/close, reduce-only, positionTpsl trigger, spot buy/sell all OK. Reduce-only semantics in section 4. Per-order errors come back inside `status:"ok"` as `statuses[i].error`; pre-validation errors come back as `status:"err"`. |
| `cancel` | M/A | L1 | `cancels[]: { a asset, o oid }`, `f fast?` | Observed OK from agent (run 2, C5/C7). Error: "Order was never placed, already canceled, or filled." |
| `cancelByCloid` | M/A | L1 | `cancels[]: { asset, cloid }` | `f` rejected for trigger orders. |
| `modify` | M/A | L1 | `oid: oid\|cloid`, `order: {a,b,p,s,r,t,c?}`, `a always_place?` | Observed "Cannot modify canceled or filled order" (the target had been auto-cancelled by the reduce-only rule, run 2 C4). |
| `batchModify` | M/A | L1 | `modifies[]: { oid, order }`, `a always_place?` | Same as modify. |
| `scheduleCancel` (dead man's switch) | M/A | L1 | `time?` (ms; omit to unset) | Min 5 s ahead, max 10 triggers/day (reset 00:00 UTC). **Gated on volume:** observed `"Cannot set scheduled cancel time until enough volume traded. Required: $1000000. Traded: $12066.75."` (run 1, 6e). Not available to a retail-size account. |
| `twapOrder` | M/A | L1 | `twap: { a, b, s, r reduceOnly, m minutes, t randomize }` | 5 min-7 days, $100 min, 3% max slippage per sub-order. Observed reduce-only TWAP with no position: `"Reduce-only TWAP order would increase position."` (7p). |
| `twapCancel` | M/A | L1 | `a asset, t twapId` | |
| `updateLeverage` | M/A | L1 | `asset, isCross, leverage(int)` | Observed from agent: set 5x, lowered to 3x with position open, raised to 10x with position open, all OK. `"Cannot switch leverage type with open position."` when flipping cross->isolated. Only bound is the asset's `maxLeverage` (BTC testnet 40). |
| `updateIsolatedMargin` | M/A | L1 | `asset, isBuy(true, no effect yet), ntli(int, 6dp)` | Observed on a cross position: `"Position does not use isolated margin."` Alternative `topUpIsolatedOnlyMargin {asset, leverage(str)}`. |
| `noop` | M/A | L1 | none | Marks a nonce used; cheapest way to kill in-flight orders. |
| `reserveRequestWeight` | M/A | L1 | `weight, destination?` | Buys rate limit at 0.0005 USDC/request from the perps balance. |
| `setReferrer` | M/A | L1 | `code` | Observed from agent: `"Referral code not registered"` (i.e. the venue got as far as looking the code up; not a permission error). |
| `evmUserModify` | M/A | L1 | `usingBigBlocks` | Observed OK from an agent (7n). This is a HyperCore user flag; an agent can flip it. |
| `agentSendAsset` | **A** (designed for agents; master can too) | L1 | `destination, sourceDex, destinationDex, token "NAME:0xid", amount(str), fromSubAccount, nonce` | Docs: "Similar to send asset, but can be signed by an agent. Destination must match the source address." Observed OK perp->spot and spot->perp on the master's own account; to a third party: `"Agent can only send asset to same user or their sub-accounts."` (7g). **An agent can therefore shuffle money between spot, every perp DEX and sub-accounts of the same user, but cannot move it to another user.** |
| `agentSetAbstraction` / `agentEnableDexAbstraction` | M/A | L1 | `abstraction: "i"\|"u"\|"p"` | Agent can change the account's abstraction mode (unified / portfolio margin / standard). |
| `createSubAccount` | M/A | L1 | `name` | Volume-gated: observed `"Cannot create sub-accounts until enough volume traded. Required: $100000. Traded: $12066.75."` (7j). |
| `subAccountTransfer` | M/A | L1 | `subAccountUser, isDeposit, usd(int 6dp)` | Observed with a non-sub-account address: `"Invalid sub-account transfer from <master> to <addr>"` (the venue checked ownership, not signer class). |
| `subAccountSpotTransfer` | M/A | L1 | `subAccountUser, isDeposit, token, amount(str)` | |
| `subAccountModify` | M/A | L1 | `subAccountUser, name` | |
| `vaultTransfer` | M/A | L1 | `vaultAddress, isDeposit, usd(int)` | Observed from agent with a bogus vault: `"Vault not registered: 0x…dead"`. An agent **can** deposit the principal's USDC into a real vault (money leaves the trading account into a vault the principal owns a share of). |
| `createVault`, `vaultModify`, `vaultDistribute` | M/A | L1 | | |
| `registerReferrer`, `setDisplayName`, `claimRewards` | M/A | L1 | | |
| `spotDeploy`, `perpDeploy`, `cSignerAction`, `cValidatorAction`, `gossipPriorityBid`, `validatorL1Stream`, `hip3LiquidatorTransfer`, `userOutcome`, `activateOutcomeDeployer`, `authorizeAqav2Role`, `borrowLend`, `spotUser`, `finalizeEvmContract` | M/A | L1 | | Deployer / validator / lending surface; listed for completeness, not relevant to Shield. |

### 2b. Money movement and account administration

| Action | Signer | Scheme | Fields (message) | Notes / observed |
|---|---|---|---|---|
| `usdSend` | **M** | U `HyperliquidTransaction:UsdSend` | `hyperliquidChain, destination, amount(str), time` (+`signatureChainId`) | Perps-USDC to another Core address, instant, no bridge. Agent attempt: `"Must deposit before performing actions. User: <agent>"` (7a). |
| `spotSend` | **M** | U `…:SpotSend` | `hyperliquidChain, destination, token, amount, time` | Also the Core->EVM path (send to the token's system address, see `scripts/hyperevm-bridge.ts`). Agent: same rejection (7d). |
| `sendAsset` | **M** | U `…:SendAsset` | `hyperliquidChain, destination, sourceDex, destinationDex, token, amount, fromSubAccount, nonce` | The generalised transfer (perp DEXs, spot, other users, sub-accounts). Agent: same rejection (7b). Master used it to restore the balance in run 3 (5a). |
| `usdClassTransfer` | **M** | U `…:UsdClassTransfer` | `hyperliquidChain, amount(str, optional " subaccount:0x…" suffix), toPerp, nonce` | Spot<->perp USDC. Disabled for unified accounts (they use `sendAsset`). Agent: same rejection (7e). |
| `sendToEvmWithData` | **M** | U | `destinationRecipient, addressEncoding, destinationChainId, gasLimit, data, …` | |
| `withdraw3` | **M** | U `…:Withdraw` | `hyperliquidChain, destination, amount(str), time` | Bridge withdrawal, $1 fee, ~5 min. Agent: same rejection (7c). |
| `approveAgent` | **M** | U `…:ApproveAgent` | `hyperliquidChain, agentAddress, agentName?, nonce` | See section 3. Agent attempt: same rejection (7i), i.e. **an agent cannot approve another agent**. |
| `approveBuilderFee` | **M** | U `…:ApproveBuilderFee` | `hyperliquidChain, maxFeeRate("0.001%"), builder, nonce` | Docs (*Builder codes*): "This action must be signed by the user's main wallet, not an agent/API wallet." Observed rejection from agent (7m). Max 10 active approvals. |
| `cDeposit`, `cWithdraw`, `tokenDelegate` | **M** | U | staking | `cWithdraw` has a 7-day unstaking queue. |
| `userSetAbstraction`, `userDexAbstraction`, `userPortfolioMargin` | **M** | U | `user, abstraction/enabled, nonce` | Master-signed variants of the agent-signed ones above. |
| `convertToMultiSigUser` | **M** | U `…:ConvertToMultiSigUser` | `hyperliquidChain, signers(json str), nonce` | Section 5 discusses whether this helps. |
| `linkStakingUser`, `stakingLinkDisableTradingUser` | **M** | U | | |

`expiresAfter` applies to every L1 row and to none of the U rows.

## 3. Agents (API wallets)

**How one is approved.** Master signs `HyperliquidTransaction:ApproveAgent`
`{ hyperliquidChain, agentAddress, agentName, nonce }` (types in `signing.py sign_agent`).
Observed request (run 1, step 1):

```json
{"action":{"type":"approveAgent","signatureChainId":"0x1","hyperliquidChain":"Testnet",
 "agentAddress":"0xc6e7df1339786bf130d2e5ad9dbba05c408d8efb",
 "agentName":"shield-probe valid_until 1788787057807","nonce":1788779857807},
 "signature":{"r":"0x4994…","s":"0x6327…","v":27},"nonce":1788779857807}
-> {"status":"ok","response":{"type":"default"}}
```

After it, `info extraAgents` lists `{"name":"shield-probe","address":"0xc6e7…","validUntil":1788787057807}`
and `info userRole` on the agent address returns `{"role":"agent","data":{"user":"0xe7c2…"}}`.
The Python SDK example warns: "You should not create an agent using an agent" and the venue
enforces it (7i).

**Expiry.** Docs (*Exchange endpoint / Approve an API wallet*): "A custom expiration can be
set by appending `valid_until {timestamp}` after the name. The expiration can be at most 180
days in the future." That is the current and only mechanism (the name field carries it;
`agentName` proper is <= 16 chars, the SDK strips the suffix before checking length).
Observed:

- No suffix -> `validUntil` = now + 90 days (`n1`: approved 1788780035553, validUntil
  1796556035553 = +90.0 days).
- `+180d - 1h` accepted; `+180d + 1h` rejected with the misleading text
  `"Agent valid_until already expired."`; a timestamp in the past gets the same text.
- **Enforcement of a short expiry is lazy.** Agents approved with `valid_until` +15 s, +30 s
  and +60 s all kept executing `updateLeverage` successfully at +20 s, +46 s, +91 s and +151 s
  past approval (run 1 9e, run 3 step 2), and `extraAgents` kept listing them with the stale
  `validUntil`. The docs only say the wallet "may be pruned" when it expires. Run 4 (section
  7d) extended this: an agent with `valid_until` = approval + 30 s was still accepted at
  +3, +6, +10 and +15 min (876 s past expiry), and `extraAgents` still listed it. **`valid_until`
  is not enforced on a minutes scale**; whatever prunes expired agents runs on a coarser
  cadence (not observed within 15 min). Treat it as an hours/days backstop only and never as
  a session timer; rely on explicit revocation (`approveAgent` 0x0) instead.
- Unnamed agents are not listed by `extraAgents` at all (only `userRole` reveals them), so
  their expiry cannot be observed from the outside.

**How many.** Docs: "An account can have 1 unnamed approved wallet and up to 3 named ones. And
additional 2 named agents are allowed per subaccount." (*Sub-accounts* page repeats: "starts
at 3 for all master accounts and increases by 2 per sub-account".) Observed the 4th named
approval rejected: `"Too many extra agents for cumulative volume traded. Current limit is 3"`
(run 2, E3) — the limit is also volume-scaled in the error text.

**Can an agent approve another agent?** NO. `approveAgent` is user-signed, so an agent's
signature applies to the agent's own empty account: `"Must deposit before performing actions.
User: <agent>"` (7i).

**Can an agent withdraw or transfer funds out?** NO for every path that leaves the user
(`usdSend`, `spotSend`, `sendAsset`, `withdraw3`, `usdClassTransfer` all user-signed, all
observed rejected). YES for movement *inside* the user: `agentSendAsset` between spot, any
perp DEX and the user's sub-accounts (observed OK, 7f/7h), and `vaultTransfer` deposits into
vaults (L1 action; only a bogus vault was tried).

**Can an agent revoke another agent?** NO — revocation is an `approveAgent`, which is
user-signed (see above).

**Can the master revoke an agent?** YES, two ways, both observed:
1. Replace: `approveAgent` with the **same name and a new address**. The old address dies
   at once; `extraAgents` shows only the new one (run 1, 8a-8c). Old agent's action returns
   `"Must deposit before performing actions. User: <master>"`.
2. Remove: `approveAgent` with the same name and `agentAddress = 0x000…000`. `extraAgents`
   is empty ~1.5 s later and the agent's next action returns
   `"User or API Wallet 0x… does not exist."` (run 1 9b/9c, run 2 G2). Unnamed agents are
   removed the same way with `agentName: ""`.
   Side effect: for ~4-5 s after a removal every further `approveAgent` is rejected with
   `"User has pending agent removal"` (run 3, 1a-1b: cleared after 4.9 s).

**Does approving a new agent with the same name replace the old one?** YES (docs: "This
also happens to an existing named API Wallet when an ApproveAgent action is sent with a
matching name"; unnamed likewise). Observed for named (8a-8b) and unnamed (E7-E8). Reusing an
address under the same name is refused: `"Extra agent already used."` (run 3, 3c) — matches
the docs' warning never to reuse agent addresses because pruned nonce sets allow replay.

**Does Hyperliquid offer any per-agent permission scoping (reduce-only agents, spot-only
agents, size caps, leverage caps)?** **NO.** The only fields in `ApproveAgent` are
`agentAddress`, `agentName` (with the optional `valid_until` suffix) and `nonce`
(`signing.py sign_agent`; *Exchange endpoint / Approve an API wallet*). The docs describe
agents only as wallets that "sign on behalf of the master account or any of the sub-accounts"
(*Nonces and API wallets*). Every restriction observed in the experiment came from the
signing scheme (user-signed vs L1), from the venue's volume gates, or from the account's
own leverage/position state — never from the agent. The only "scoped delegation" primitive in
the docs is HIP-3 deployer `setSubDeployers` (deployer-side, reduce-only `order` proxying for
*DEX operators* acting on users), which is not available to a trader.

## 4. Reduce-only and risk controls on the venue side

**What `r: true` enforces (observed with an agent on BTC-PERP testnet):**

| Case | Result |
|---|---|
| Reduce-only IOC sell, no position | rejected in-band: `{"error":"Reduce only order would increase position. asset=3"}` |
| Reduce-only IOC buy while long (wrong side) | same rejection |
| Reduce-only IOC sell 0.0003 vs position 0.00015 | **capped, no error**: filled `totalSz 0.00015`, position -> null |
| Two resting reduce-only sells that together exceed the position | second accepted; the **first was auto-cancelled** (`modify` on it -> "Cannot modify canceled or filled order"; `openOrders` showed only the newer one) |
| Reduce-only trigger (`positionTpsl`, `sl`, `isMarket`) with position | accepted: `"waitingForTrigger"`, listed with `reduceOnly:true` |
| Reduce-only TWAP, no position | `{"status":{"error":"Reduce-only TWAP order would increase position."}}` |

Docs (*Order types*): "Reduce Only: An order that reduces a current position as opposed to
opening a new position in the opposite direction." Error catalogue lists `ReduceOnly ->
"Reduce only order would increase position."` and `reduceOnlyRejected`. Reduce-only is a
per-order flag; nothing stops the same signer from sending the next order with `r:false`
(observed: the agent opened the position it later reduced).

**Leverage while a position is open.** Docs (*Margining*): "Leverage can be set by a user to
any integer between 1 and the max leverage. Max leverage depends on the asset. ... The
leverage of an existing position can be increased without closing the position. Leverage is
only checked upon opening a position." Observed: lowering 5x -> 3x and raising 3x -> 10x on an
open cross position both `ok`; switching margin type rejected (`"Cannot switch leverage type
with open position."`). So an agent (or the master) can set leverage anywhere in `[1,
maxLeverage]` at any time; lowering it is allowed and just increases margin used.

**Any venue-side way to cap leverage or size for an account?** NO. `updateLeverage` is the
only leverage control and it is set by the account itself (or its agent); the ceiling is the
per-asset `maxLeverage` from `meta` (docs: "Max leverage varies by asset, ranging from 3x to
40x"). There is no account-level max, no notional cap, no per-agent cap. `expiresAfter`
bounds an *action's* validity, not authority. `scheduleCancel` is the only automatic
risk-off primitive and it (a) only cancels orders, never positions, and (b) needs $1M traded
volume (observed).

**Sub-accounts.** Docs (*Sub-accounts*): "Up to 10 sub-accounts can be created after reaching
$100,000 in volume ... up to a maximum of 50." "Subaccounts and vaults do not have private
keys. To perform actions on behalf of a subaccount or vault signing should be done by the
master account and the vaultAddress field should be set" (*Exchange endpoint*). They are
separate margin pools owned by the master; the master (or its agents, which "sign on behalf of
the master account or any of the sub-accounts") can trade them and move USDC in/out at will
(`subAccountTransfer`, `sendAsset` with `fromSubAccount`, `agentSendAsset`). **A master cannot
restrict its own sub-account** in any way — there is no permission surface; it is the same
key. Observed: `createSubAccount` from this account -> "Required: $100000. Traded: $12066.75".
Not realistic for Shield's user (volume gate) and not useful even if available (no
restriction primitive; the master retains full control).

## 5. Bypass map for a tilted user who wants more risk than an agent allows

Assume Shield holds an agent key and only signs conservative or reduce-only orders with it.

| Bypass | Possible? | How fast | Master always keeps it? |
|---|---|---|---|
| Open app.hyperliquid.xyz with the master wallet and trade | YES. The frontend is just a client that signs L1 actions with the connected wallet (or an unnamed agent the frontend creates via `approveAgent`, which is why the "1 unnamed" slot exists). | Seconds: connect wallet, one "Enable trading" signature, then every trade is a local signature. | YES. Nothing in the venue distinguishes the master from Shield's agent for trading; the master is strictly a superset. |
| Approve another agent (own bot, other terminal, phone app) | YES: one EIP-712 signature. Limits: 3 named + 1 unnamed (observed error at the 4th), each up to 180 days. Replacing a name takes effect immediately; removing one blocks new approvals for ~5 s. | ~1 s (block time). | YES. Agents cannot stop it; Shield cannot even see unnamed agents (`extraAgents` omits them). |
| Revoke Shield's agent | YES: `approveAgent` with Shield's name + `0x0`, or the same name + a new address. | ~1.5 s; the revoked key fails immediately. | YES. |
| Move funds to another account / sub-account | YES for the master: `usdSend`/`sendAsset`/`spotSend` are instant Core transfers to any address (observed master `sendAsset` ok in <2 s); sub-accounts need $100k volume but are the same key anyway. An **agent** can only move within the same user (`agentSendAsset`, vaults). | ~1 s. | YES. |
| Withdraw / use a different venue | YES: `withdraw3` to Arbitrum (~5 min, $1), or Core->EVM `spotSend` to the system address (seconds; this repo's `hyperevm-bridge.ts` does it) and then any HyperEVM DEX. Also `vaultTransfer` into a trading vault. | 5 s - 5 min. | YES. Master only (user-signed), which is exactly the key the user holds. |
| Raise leverage / size with the master key even if Shield's agent set it low | YES: `updateLeverage` is idempotent state on the *account*; the last writer wins and the master can write it. | ~1 s. | YES. |

**Fastest bypass: open the app with the master wallet (or sign one `approveAgent`), about one
second.** The master key holder retains every bypass; there is no configuration of a
Hyperliquid account in which the key that controls it has less authority than an agent.

**Is there any way to make the master weaker?** The only primitive that changes what the
master key alone can do is `convertToMultiSigUser` (*Multi-sig* page): "Once a user has been
converted into a multi-sig user, all its actions must be sent via multi-sig", with a threshold
over up to 10 authorized users, and "the leader can also be an API wallet of an authorized
user." A 2-of-2 between the user and a Shield co-signer would make `approveAgent`, `withdraw3`
and every trade require Shield's signature — which is the trading-terminal / co-custody
outcome, contradicts "self-custodial", is irreversible without the co-signer, and the docs add
"multi-sig users should not interact with the HyperEVM before or after conversion" (CoreWriter
does not work for them), which collides with ShieldVault living on HyperEVM. Not a path.

## 6. What this means for the three-tier authority idea

- **FULL SESSION AUTHORITY** = the user's master key, or any agent (both trade the whole
  account, any leverage up to asset max, spot and perps, TWAP, intra-account transfers). The
  only difference between them is that the agent cannot move money out or administer agents.
  This tier exists natively.
- **REDUCED AUTHORITY** (size cap, leverage cap, perps-only, no TWAP, ...) does **not** exist
  natively. It can only be a policy inside whoever holds the signing key. If Shield holds the
  key, Shield is the trading terminal for that tier; if the user holds it, the tier is
  advisory.
- **REDUCE-ONLY AUTHORITY** likewise does not exist natively. `r:true` is per order. A
  "reduce-only agent" is a Shield-side rule over a Shield-held agent key, and the user can
  route around it in one second with the master wallet or another agent.
- The one honest venue-native lever Shield has is the one it already uses: **gate how much
  capital reaches the Hyperliquid account at all** (ShieldVault release rules). Once USDC is in
  the account, the venue offers no further authority split that the master cannot undo.
- Things that *are* honest to say and cheap to add: (a) Shield can hold a named agent that
  only ever signs `r:true` IOC orders and `updateLeverage` downwards ("panic close" /
  "de-risk" button) — useful as a service, but not a restriction; (b) Shield can monitor
  `extraAgents` and `userRole` to show the user which named agents exist (unnamed ones are
  invisible); (c) `expiresAfter` can bound Shield's own in-flight actions.

## 7. Experiment transcript (Hyperliquid TESTNET, 2026-09-07)

Setup: master `0xE7c2Adb44064e705A2e955770440C527373967A1` (repo `execution` key), BTC-PERP
asset index 3 (`szDecimals 5`, `maxLeverage 40`), mid ≈ 79,450. Agents were fresh random
keys kept only in `/tmp/hl-exp` (run 1's agent) or in process memory (all others); the
addresses appear below, the keys nowhere. Scripts: `/tmp/hl-exp/exp.ts`, `exp2.ts`,
`exp3.ts`, `exp4.ts` (bun, `@nktkas/hyperliquid` 0.33.3 via a symlinked `node_modules`).
Full raw request/response logs: `/tmp/hl-exp/transcript.jsonl`, `transcript2.jsonl`,
`transcript3.jsonl`. The `[step] OK/ERROR …` lines below are the console logs verbatim;
`ERROR` lines print the SDK message followed by `::` and the raw venue response.

Selected raw request/response pairs (signatures are the throwaway agents' or the testnet
master's; nothing secret):

```json
// run 1, step 2: agent, reduce-only IOC sell with no position
{"action":{"type":"order","orders":[{"a":3,"b":false,"p":"78651","s":"0.00015","r":true,"t":{"limit":{"tif":"Ioc"}}}],"grouping":"na"},
 "signature":{"r":"0x330b2b2016cb6654ce7c5a8c84fe10ad72f57ceb8a42d6ee32bc7888cb326c9d","s":"0x0beb09ff54b7479025d4f91b123c7630b6fbca07960b464b6cbbc1c41d27f759","v":27},"nonce":1788779861589}
-> {"status":"ok","response":{"type":"order","data":{"statuses":[{"error":"Reduce only order would increase position. asset=3"}]}}}

// run 1, step 7a: agent signs usdSend (user-signed) -> attributed to the agent's own empty account
{"action":{"type":"usdSend","signatureChainId":"0x1","hyperliquidChain":"Testnet","destination":"0x000000000000000000000000000000000000dead","amount":"1","time":1788779881212},
 "signature":{"r":"0x0d59e758e444b9b2eca7fa08446d9f27232037371f3038cf0b36df1f0c0c6a81","s":"0x539d7a8e3b80995db4d72211da0b1e227b6af6addbe030f1d526c43a9c78df70","v":27},"nonce":1788779881212}
-> {"status":"err","response":"Must deposit before performing actions. User: 0xc6e7df1339786bf130d2e5ad9dbba05c408d8efb"}

// run 1, step 7c: agent signs withdraw3
{"action":{"type":"withdraw3","signatureChainId":"0x1","hyperliquidChain":"Testnet","destination":"0xe7c2adb44064e705a2e955770440c527373967a1","amount":"2","time":1788779881688},
 "signature":{"r":"0xd0cedc716469d2b1d97ee537334a8f1024d2397ba0652bbad8de58661971cd83","s":"0x6699640f5ec62633bb23ec67a901e5ad619dba435cc1de931c0cbec92b96cf9d","v":28},"nonce":1788779881688}
-> {"status":"err","response":"Must deposit before performing actions. User: 0xc6e7df1339786bf130d2e5ad9dbba05c408d8efb"}

// run 1, step 7f: agentSendAsset perp -> spot on the principal's own account (L1 action, agent-signed)
{"action":{"type":"agentSendAsset","destination":"0xe7c2adb44064e705a2e955770440c527373967a1","sourceDex":"","destinationDex":"spot","token":"USDC:0xeb62eee3685fc4c43992febcd9e75443","amount":"1","fromSubAccount":"","nonce":1788779882398},
 "signature":{"r":"0x6549e6c92f60da3d4de8e2d8405742359f010586901ed3e0b57567c6cdbb4005","s":"0x7aaec4b61889e75f4dc90ff0131fd67c28982865539cc7b6752804d86e5a251c","v":27},"nonce":1788779882398}
-> {"status":"ok","response":{"type":"default"}}

// run 1, step 7g: agentSendAsset to a third party
{"action":{"type":"agentSendAsset","destination":"0x000000000000000000000000000000000000dead","sourceDex":"","destinationDex":"","token":"USDC:0xeb62eee3685fc4c43992febcd9e75443","amount":"1","fromSubAccount":"","nonce":1788779884978},
 "signature":{"r":"0x985837524635276a8db4a1418602968c850cb4561cc003fe90169faf3078c940","s":"0x4261e827dc2fd6e6d1110228171d87b4d3fa04bf6d2e10c1e730ebe83d9bd64c","v":27},"nonce":1788779884978}
-> {"status":"err","response":"Agent can only send asset to same user or their sub-accounts."}

// run 1, step 7q: L1 action with expiresAfter in the past
{"action":{"type":"order","orders":[{"a":3,"b":true,"p":"80246","s":"0.00015","r":false,"t":{"limit":{"tif":"Ioc"}}}],"grouping":"na"},
 "signature":{"r":"0x9e33de52df5ae57be6b27fb4f11f6c6271ae5a010e200338dfe0e3390e969212","s":"0x336b63121b34b1375106cd42d7804c1bc3aaea8e92939407d093120a2147b4bb","v":28},"nonce":1788779897303,"expiresAfter":1788779837303}
-> {"status":"err","response":"Action already expired"}

// run 1, step 9b: master revokes the named agent by approving 0x0 under the same name
{"action":{"type":"approveAgent","signatureChainId":"0x1","hyperliquidChain":"Testnet","agentAddress":"0x0000000000000000000000000000000000000000","agentName":"shield-probe","nonce":1788779903054},
 "signature":{"r":"0x5d364a32f7005c352ec4348dc16012b6ed2fa2da77f0fbb554a0f516efe5f505","s":"0x0059fb981fedcc57d0e0d4c7935346a8bc3d457860511e85c0cde1be243b0ab0","v":27},"nonce":1788779903054}
-> {"status":"ok","response":{"type":"default"}}
```

### 7a. Run 1 console log (`/tmp/hl-exp/exp.ts`)

```
master 0xE7c2Adb44064e705A2e955770440C527373967A1
agent  0xc6E7dF1339786BF130d2e5AD9DBBa05c408D8efb
agent2 0x68bec6B637E3C6BC1C3e64A596A16944eE7ef309
BTC asset 3 mid 79444
extraAgents before: []
[1.approveAgent(named, valid_until +2h)] OK {"status":"ok","response":{"type":"default"}}
extraAgents after approve: [{"name":"shield-probe","address":"0xc6e7df1339786bf130d2e5ad9dbba05c408d8efb","validUntil":1788787057807}]
userRole(agent): {"role":"agent","data":{"user":"0xe7c2adb44064e705a2e955770440c527373967a1"}}
position now: null
[2.agent.order reduceOnly IOC sell, no position] ERROR order 0: Reduce only order would increase position. asset=3 :: {"status":"ok","response":{"type":"order","data":{"statuses":[{"error":"Reduce only order would increase position. asset=3"}]}}}
[3.agent.updateLeverage 5x cross] OK {"status":"ok","response":{"type":"default"}}
[4.agent.order open long 0.00015 IOC] OK {"status":"ok","response":{"type":"order","data":{"statuses":[{"filled":{"totalSz":"0.00015","avgPx":"79449.2","oid":59534788967}}]}}}
position now: {"coin":"BTC","szi":"0.00015","leverage":{"type":"cross","value":5},"entryPx":"79449.2","positionValue":"11.9163","unrealizedPnl":"-0.00109","returnOnEquity":"-0.0004573149","liquidationPx":null,"marginUsed":"2.38326","maxLeverage":40,"cumFunding":{"allTime":"0.0","sinceOpen":"0.0","sinceChange":"0.0"}}
[5a.agent.updateLeverage 3x while position open] OK {"status":"ok","response":{"type":"default"}}
[5b.agent.updateLeverage 10x while position open] OK {"status":"ok","response":{"type":"default"}}
[5c.agent.updateLeverage 40x isolated while cross position open] ERROR Cannot switch leverage type with open position. :: {"status":"err","response":"Cannot switch leverage type with open position."}
[6.agent.order reduceOnly IOC sell 0.0003 (> position)] OK {"status":"ok","response":{"type":"order","data":{"statuses":[{"filled":{"totalSz":"0.00015","avgPx":"79443.0","oid":59534793846}}]}}}
position now: null
[6b.agent.order reduceOnly IOC BUY while long (wrong side)] ERROR order 0: Reduce only order would increase position. asset=3 :: {"status":"ok","response":{"type":"order","data":{"statuses":[{"error":"Reduce only order would increase position. asset=3"}]}}}
[6c.agent.order reduceOnly GTC sell far from mid (rests)] ERROR order 0: Reduce only order would increase position. asset=3 :: {"status":"ok","response":{"type":"order","data":{"statuses":[{"error":"Reduce only order would increase position. asset=3"}]}}}
[6e.agent.scheduleCancel +10s] ERROR Cannot set scheduled cancel time until enough volume traded. Required: $1000000. Traded: $12066.75. :: {"status":"err","response":"Cannot set scheduled cancel time until enough volume traded. Required: $1000000. Traded: $12066.75."}
[6f.agent.scheduleCancel unset] ERROR Cannot set scheduled cancel time until enough volume traded. Required: $1000000. Traded: $12066.75. :: {"status":"err","response":"Cannot set scheduled cancel time until enough volume traded. Required: $1000000. Traded: $12066.75."}
[6g.agent.order GTC reduceOnly sell (for modify)] ERROR order 0: Reduce only order would increase position. asset=3 :: {"status":"ok","response":{"type":"order","data":{"statuses":[{"error":"Reduce only order would increase position. asset=3"}]}}}
[6j.agent.order reduceOnly IOC sell close remaining] OK "no position"
position now: null
[7a.agent.usdSend $1 -> stranger] ERROR Must deposit before performing actions. User: 0xc6e7df1339786bf130d2e5ad9dbba05c408d8efb :: {"status":"err","response":"Must deposit before performing actions. User: 0xc6e7df1339786bf130d2e5ad9dbba05c408d8efb"}
[7b.agent.sendAsset $1 perp->perp stranger] ERROR Must deposit before performing actions. User: 0xc6e7df1339786bf130d2e5ad9dbba05c408d8efb :: {"status":"err","response":"Must deposit before performing actions. User: 0xc6e7df1339786bf130d2e5ad9dbba05c408d8efb"}
[7c.agent.withdraw3 $2 -> master address] ERROR Must deposit before performing actions. User: 0xc6e7df1339786bf130d2e5ad9dbba05c408d8efb :: {"status":"err","response":"Must deposit before performing actions. User: 0xc6e7df1339786bf130d2e5ad9dbba05c408d8efb"}
[7d.agent.spotSend 1 USDC -> stranger] ERROR Must deposit before performing actions. User: 0xc6e7df1339786bf130d2e5ad9dbba05c408d8efb :: {"status":"err","response":"Must deposit before performing actions. User: 0xc6e7df1339786bf130d2e5ad9dbba05c408d8efb"}
[7e.agent.usdClassTransfer $1 perp->spot] ERROR Must deposit before performing actions. User: 0xc6e7df1339786bf130d2e5ad9dbba05c408d8efb :: {"status":"err","response":"Must deposit before performing actions. User: 0xc6e7df1339786bf130d2e5ad9dbba05c408d8efb"}
[7f.agent.agentSendAsset $1 perp->spot (self)] OK {"status":"ok","response":{"type":"default"}}
spot after 7f: [{"coin":"USDC","token":0,"total":"1.0","hold":"0.0","entryNtl":"0.0"}]
[7g.agent.agentSendAsset $1 perp->perp stranger] ERROR Agent can only send asset to same user or their sub-accounts. :: {"status":"err","response":"Agent can only send asset to same user or their sub-accounts."}
[7h.agent.agentSendAsset $1 spot->perp (self, undo 7f)] OK {"status":"ok","response":{"type":"default"}}
[7i.agent.approveAgent(another agent)] ERROR Must deposit before performing actions. User: 0xc6e7df1339786bf130d2e5ad9dbba05c408d8efb :: {"status":"err","response":"Must deposit before performing actions. User: 0xc6e7df1339786bf130d2e5ad9dbba05c408d8efb"}
[7j.agent.createSubAccount] ERROR Cannot create sub-accounts until enough volume traded. Required: $100000. Traded: $12066.75. :: {"status":"err","response":"Cannot create sub-accounts until enough volume traded. Required: $100000. Traded: $12066.75."}
[7k.agent.subAccountTransfer $1] ERROR Invalid sub-account transfer from 0xe7c2adb44064e705a2e955770440c527373967a1 to 0x000000000000000000000000000000000000dead :: {"status":"err","response":"Invalid sub-account transfer from 0xe7c2adb44064e705a2e955770440c527373967a1 to 0x000000000000000000000000000000000000dead"}
[7l.agent.vaultTransfer $1 deposit] ERROR Vault not registered: 0x000000000000000000000000000000000000dead :: {"status":"err","response":"Vault not registered: 0x000000000000000000000000000000000000dead"}
[7m.agent.approveBuilderFee] ERROR Must deposit before performing actions. User: 0xc6e7df1339786bf130d2e5ad9dbba05c408d8efb :: {"status":"err","response":"Must deposit before performing actions. User: 0xc6e7df1339786bf130d2e5ad9dbba05c408d8efb"}
[7n.agent.evmUserModify usingBigBlocks=false] OK {"status":"ok","response":{"type":"default"}}
[7o.agent.setReferrer] ERROR Referral code not registered :: {"status":"err","response":"Referral code not registered"}
[7p.agent.twapOrder reduceOnly (no position)] ERROR Reduce-only TWAP order would increase position. :: {"status":"ok","response":{"type":"twapOrder","data":{"status":{"error":"Reduce-only TWAP order would increase position."}}}}
[7q.agent.order with expiresAfter in the past] ERROR Action already expired :: {"status":"err","response":"Action already expired"}
[8a.master.approveAgent same name, new address] OK {"status":"ok","response":{"type":"default"}}
extraAgents after replace: [{"name":"shield-probe","address":"0x68bec6b637e3c6bc1c3e64a596a16944ee7ef309","validUntil":1788787057807}]
[8b.OLD agent.updateLeverage 5x (expect dead)] ERROR Must deposit before performing actions. User: 0xe7c2adb44064e705a2e955770440c527373967a1 :: {"status":"err","response":"Must deposit before performing actions. User: 0xe7c2adb44064e705a2e955770440c527373967a1"}
[8c.NEW agent.updateLeverage 5x] OK {"status":"ok","response":{"type":"default"}}
[9a.master.approveAgent same name, valid_until in the past] ERROR Agent valid_until already expired. :: {"status":"err","response":"Agent valid_until already expired."}
[9b.master.approveAgent same name, address 0x0] OK {"status":"ok","response":{"type":"default"}}
extraAgents after revoke attempts: []
[9c.agent2.updateLeverage 5x after revoke attempts] ERROR Must deposit before performing actions. User: 0xe7c2adb44064e705a2e955770440c527373967a1 :: {"status":"err","response":"Must deposit before performing actions. User: 0xe7c2adb44064e705a2e955770440c527373967a1"}
[9d.master.approveAgent same name, valid_until +15s] OK {"status":"ok","response":{"type":"default"}}
extraAgents after 20s: [{"name":"shield-probe","address":"0x68bec6b637e3c6bc1c3e64a596a16944ee7ef309","validUntil":1788779921044}]
[9e.agent2.updateLeverage after 15s expiry] OK {"status":"ok","response":{"type":"default"}}
[9f.master.approveAgent same name, valid_until 181 days] ERROR Agent valid_until already expired. :: {"status":"err","response":"Agent valid_until already expired."}
extraAgents final: [{"name":"shield-probe","address":"0x68bec6b637e3c6bc1c3e64a596a16944ee7ef309","validUntil":1788779921044}]
final position: null open orders: []
final perps withdrawable: 77.86364
```

### 7b. Run 2 console log (`/tmp/hl-exp/exp2.ts`)

Note: D4 failed with `"Invalid send"` because the amount had 8 decimals (`11.38693826`); the same transfer with 6 decimals succeeded from the master in run 3 (5a). Not a permission error.

```
A. state of the +15s agent from run 1 (0x68be…), minutes later: [{"name":"shield-probe","address":"0x68bec6b637e3c6bc1c3e64a596a16944ee7ef309","validUntil":1788779921044}] role: {"role":"agent","data":{"user":"0xe7c2adb44064e705a2e955770440c527373967a1"}}
agent(run2) 0x70028C8944550C945510FeD471Bcaf87c5D2D2Ba
[B1.master.approveAgent 'shield-probe' valid_until +60s (replaces 0x68be…)] OK {"status":"ok","response":{"type":"default"}}
agents: [{"name":"shield-probe","address":"0x70028c8944550c945510fed471bcaf87c5d2d2ba","validUntil":1788780066793}]
[C1.agent.open long 0.00015 IOC] OK {"status":"ok","response":{"type":"order","data":{"statuses":[{"filled":{"totalSz":"0.00015","avgPx":"79472.0","oid":59534920059}}]}}}
position: {"coin":"BTC","szi":"0.00015","leverage":{"type":"cross","value":5},"entryPx":"79472.0","positionValue":"11.92065","unrealizedPnl":"-0.00015","returnOnEquity":"-0.0000629152","liquidationPx":null,"marginUsed":"2.38413","maxLeverage":40,"cumFunding":{"allTime":"0.0","sinceOpen":"0.0","sinceChange":"0.0"}}
[C2.agent.rest reduceOnly GTC sell @ +20%] OK {"status":"ok","response":{"type":"order","data":{"statuses":[{"resting":{"oid":59534922489}}]}}}
[C3.agent.rest 2nd reduceOnly GTC sell @ +21% (sum > position)] OK {"status":"ok","response":{"type":"order","data":{"statuses":[{"resting":{"oid":59534923953}}]}}}
open orders: [{"coin":"BTC","side":"A","limitPx":"96161.0","sz":"0.00015","oid":59534923953,"timestamp":1788780014874,"origSz":"0.00015","reduceOnly":true}]
[C4.agent.modify resting reduce-only -> r:false] ERROR Cannot modify canceled or filled order :: {"status":"err","response":"Cannot modify canceled or filled order"}
open orders after modify: [{"coin":"BTC","side":"A","limitPx":"96161.0","sz":"0.00015","oid":59534923953,"timestamp":1788780014874,"origSz":"0.00015","reduceOnly":true}]
[C5.agent.cancel all open via cancel by oid] OK {"status":"ok","response":{"type":"cancel","data":{"statuses":["success"]}}}
[C6.agent.positionTpsl grouping: reduce-only trigger SL] OK {"status":"ok","response":{"type":"order","data":{"statuses":["waitingForTrigger"]}}}
open orders (trigger): [{"coin":"BTC","side":"A","limitPx":"71524.0","sz":"0.00015","oid":59534928822,"timestamp":1788780020402,"origSz":"0.00015","reduceOnly":true}]
[C7.agent.cancel trigger orders] OK {"status":"ok","response":{"type":"cancel","data":{"statuses":["success"]}}}
[C8.agent.updateIsolatedMargin on cross position (expect error)] ERROR Position does not use isolated margin. :: {"status":"err","response":"Position does not use isolated margin."}
[C9.agent.close reduceOnly IOC] OK {"status":"ok","response":{"type":"order","data":{"statuses":[{"filled":{"totalSz":"0.00015","avgPx":"79471.0","oid":59534932842}}]}}}
position: null
HYPE pair: {"tokens":[1105,0],"name":"@1035","index":1035,"isCanonical":false}
[D1.agent.agentSendAsset $12 perp->spot] OK {"status":"ok","response":{"type":"default"}}
HYPE mid 40.9835 coin key @1035
[D2.agent.spot order buy HYPE IOC] OK {"status":"ok","response":{"type":"order","data":{"statuses":[{"filled":{"totalSz":"0.27","avgPx":"41.353","oid":59534937488}}]}}}
spot balances: [{"coin":"USDC","token":0,"total":"0.83469","hold":"0.0","entryNtl":"0.0"},{"coin":"HYPE","token":1105,"total":"0.26981101","hold":"0.0","entryNtl":"11.16531"}]
[D3.agent.spot order sell HYPE IOC] OK {"status":"ok","response":{"type":"order","data":{"statuses":[{"filled":{"totalSz":"0.26","avgPx":"40.614","oid":59534939582}}]}}}
spot balances: [{"coin":"USDC","token":0,"total":"11.38693826","hold":"0.0","entryNtl":"0.0"},{"coin":"HYPE","token":1105,"total":"0.00981101","hold":"0.0","entryNtl":"0.40599888"}]
[D4.agent.agentSendAsset spot->perp back] ERROR Invalid send :: {"status":"err","response":"Invalid send"}
[E1.master.approveAgent named n1] OK {"status":"ok","response":{"type":"default"}}
[E2.master.approveAgent named n2] OK {"status":"ok","response":{"type":"default"}}
[E3.master.approveAgent named n3] ERROR Too many extra agents for cumulative volume traded. Current limit is 3 :: {"status":"err","response":"Too many extra agents for cumulative volume traded. Current limit is 3"}
[E4.master.approveAgent named n4] ERROR Too many extra agents for cumulative volume traded. Current limit is 3 :: {"status":"err","response":"Too many extra agents for cumulative volume traded. Current limit is 3"}
agents: [{"name":"shield-probe","address":"0x70028c8944550c945510fed471bcaf87c5d2d2ba","validUntil":1788780066793},{"name":"n1","address":"0x650541dc1d829e8a29c45cac43a3ae0aa1add2d2","validUntil":1796556035553},{"name":"n2","address":"0xc2f3e3ce49cb57ae3158c2c28d71de615198a3d7","validUntil":1796556036475}]
[E5.master.approveAgent UNNAMED] OK {"status":"ok","response":{"type":"default"}}
agents (does unnamed appear?): [{"name":"shield-probe","address":"0x70028c8944550c945510fed471bcaf87c5d2d2ba","validUntil":1788780066793},{"name":"n1","address":"0x650541dc1d829e8a29c45cac43a3ae0aa1add2d2","validUntil":1796556035553},{"name":"n2","address":"0xc2f3e3ce49cb57ae3158c2c28d71de615198a3d7","validUntil":1796556036475}] role(unnamed): {"role":"agent","data":{"user":"0xe7c2adb44064e705a2e955770440c527373967a1"}}
[E6.unnamed agent.updateLeverage 5x] OK {"status":"ok","response":{"type":"default"}}
[E7.master.approveAgent 2nd UNNAMED (replaces 1st?)] OK {"status":"ok","response":{"type":"default"}}
[E8.1st unnamed agent.updateLeverage (expect dead)] ERROR Must deposit before performing actions. User: 0xe7c2adb44064e705a2e955770440c527373967a1 :: {"status":"err","response":"Must deposit before performing actions. User: 0xe7c2adb44064e705a2e955770440c527373967a1"}
[E9.master.approveAgent n1 valid_until +180d-1h] ERROR User has pending agent removal :: {"status":"err","response":"User has pending agent removal"}
[E10.master.approveAgent n1 valid_until +180d+1h] ERROR Agent valid_until already expired. :: {"status":"err","response":"Agent valid_until already expired."}
[E11.master.approveAgent 17-char name] ERROR × Invalid length: Expected <= 16 but received 17
  → at agentName
agents: [{"name":"shield-probe","address":"0x70028c8944550c945510fed471bcaf87c5d2d2ba","validUntil":1788780066793},{"name":"n1","address":"0x650541dc1d829e8a29c45cac43a3ae0aa1add2d2","validUntil":1796556035553},{"name":"n2","address":"0xc2f3e3ce49cb57ae3158c2c28d71de615198a3d7","validUntil":1796556036475}]
agents now: [{"name":"shield-probe","address":"0x70028c8944550c945510fed471bcaf87c5d2d2ba","validUntil":1788780066793},{"name":"n1","address":"0x650541dc1d829e8a29c45cac43a3ae0aa1add2d2","validUntil":1796556035553},{"name":"n2","address":"0xc2f3e3ce49cb57ae3158c2c28d71de615198a3d7","validUntil":1796556036475}] now 1788780047438
[F1.run2 agent.updateLeverage after its 60s expiry] OK {"status":"ok","response":{"type":"default"}}
[G.revoke n1] OK {"status":"ok","response":{"type":"default"}}
[G.revoke n2] ERROR User has pending agent removal :: {"status":"err","response":"User has pending agent removal"}
[G.revoke n3] ERROR User has pending agent removal :: {"status":"err","response":"User has pending agent removal"}
[G.revoke shield-probe] ERROR User has pending agent removal :: {"status":"err","response":"User has pending agent removal"}
[G.revoke unnamed via 0x0] OK {"status":"ok","response":{"type":"default"}}
agents final: [{"name":"shield-probe","address":"0x70028c8944550c945510fed471bcaf87c5d2d2ba","validUntil":1788780066793},{"name":"n2","address":"0xc2f3e3ce49cb57ae3158c2c28d71de615198a3d7","validUntil":1796556036475}] role(un2): {"role":"agent","data":{"user":"0xe7c2adb44064e705a2e955770440c527373967a1"}}
[G2.un2.updateLeverage (expect dead)] ERROR User or API Wallet 0xee9445db6da72821f812946502be3fd1a636e1dd does not exist. :: {"status":"err","response":"User or API Wallet 0xee9445db6da72821f812946502be3fd1a636e1dd does not exist."}
[G3.master.updateLeverage back to 40x cross] OK {"status":"ok","response":{"type":"default"}}
final position: null open: [] perps: 65.852762 spot: [{"coin":"USDC","token":0,"total":"11.38693826","hold":"0.0","entryNtl":"0.0"},{"coin":"HYPE","token":1105,"total":"0.00981101","hold":"0.0","entryNtl":"0.40599888"}]
```

### 7c. Run 3 console log (`/tmp/hl-exp/exp3.ts`)

```
agents at start: [{"name":"shield-probe","address":"0x70028c8944550c945510fed471bcaf87c5d2d2ba","validUntil":1788780066793},{"name":"n2","address":"0xc2f3e3ce49cb57ae3158c2c28d71de615198a3d7","validUntil":1796556036475}]
[1788780117382] [1a.master.revoke n2 via 0x0] OK {"status":"ok","response":{"type":"default"}}
[1788780118332] [1b.poll approve fresh agent 'exp' (+987ms)] ERROR User has pending agent removal :: {"status":"err","response":"User has pending agent removal"}
[1788780121335] [1b.poll approve fresh agent 'exp' (+3937ms)] OK {"status":"ok","response":{"type":"default"}}
pending-removal window cleared after ~4939ms
agents: [{"name":"shield-probe","address":"0x70028c8944550c945510fed471bcaf87c5d2d2ba","validUntil":1788780066793},{"name":"exp","address":"0x988f1ba737685837717970d9b5633d9a515ef80e","validUntil":1788780150333}]
[1788780122471] [1c.X.updateLeverage 5x immediately] OK {"status":"ok","response":{"type":"default"}}
--- 46s after approval; extraAgents=[{"name":"shield-probe","address":"0x70028c8944550c945510fed471bcaf87c5d2d2ba","validUntil":1788780066793},{"name":"exp","address":"0x988f1ba737685837717970d9b5633d9a515ef80e","validUntil":1788780150333}] role(X)={"role":"agent","data":{"user":"0xe7c2adb44064e705a2e955770440c527373967a1"}}
[1788780168999] [2.X.updateLeverage at +46s] OK {"status":"ok","response":{"type":"default"}}
--- 90s after approval; extraAgents=[{"name":"shield-probe","address":"0x70028c8944550c945510fed471bcaf87c5d2d2ba","validUntil":1788780066793},{"name":"exp","address":"0x988f1ba737685837717970d9b5633d9a515ef80e","validUntil":1788780150333}] role(X)={"role":"agent","data":{"user":"0xe7c2adb44064e705a2e955770440c527373967a1"}}
[1788780213454] [2.X.updateLeverage at +91s] OK {"status":"ok","response":{"type":"default"}}
--- 151s after approval; extraAgents=[{"name":"shield-probe","address":"0x70028c8944550c945510fed471bcaf87c5d2d2ba","validUntil":1788780066793},{"name":"exp","address":"0x988f1ba737685837717970d9b5633d9a515ef80e","validUntil":1788780150333}] role(X)={"role":"agent","data":{"user":"0xe7c2adb44064e705a2e955770440c527373967a1"}}
[1788780273923] [2.X.updateLeverage at +151s] OK {"status":"ok","response":{"type":"default"}}
[1788780274951] [3a.approve 'b180' valid_until +180d-1h] OK {"status":"ok","response":{"type":"default"}}
[1788780275926] [3b.approve 'b180' valid_until +180d+1h] ERROR Agent valid_until already expired. :: {"status":"err","response":"Agent valid_until already expired."}
[1788780276997] [3c.approve 'b180' with no valid_until (default expiry?)] ERROR Extra agent already used. :: {"status":"err","response":"Extra agent already used."}
agents: [{"name":"shield-probe","address":"0x70028c8944550c945510fed471bcaf87c5d2d2ba","validUntil":1788780066793},{"name":"exp","address":"0x988f1ba737685837717970d9b5633d9a515ef80e","validUntil":1788780150333},{"name":"b180","address":"0x2acc5d501f6ec1f2116d11d40d51d5fbe5feaa0d","validUntil":1804328673923}] now 1788780277232 (+180d = 1804332277232 )
[1788780278224] [4.revoke exp] OK {"status":"ok","response":{"type":"default"}}
[1788780279089] [4.revoke b180] ERROR User has pending agent removal :: {"status":"err","response":"User has pending agent removal"}
[1788780281965] [4.revoke b180] OK {"status":"ok","response":{"type":"default"}}
[1788780282937] [4.revoke shield-probe] ERROR User has pending agent removal :: {"status":"err","response":"User has pending agent removal"}
[1788780285915] [4.revoke shield-probe] OK {"status":"ok","response":{"type":"default"}}
agents after cleanup: []
[1788780290009] [5a.master.sendAsset spot->perp 11.386938] OK {"status":"ok","response":{"type":"default"}}
final perps: 77.2397 spot: [{"coin":"USDC","token":0,"total":"0.00000026","hold":"0.0","entryNtl":"0.0"},{"coin":"HYPE","token":1105,"total":"0.00981101","hold":"0.0","entryNtl":"0.40599888"}] agents: [] open orders: []
```

### 7d. Run 4: 15-minute expiry probe (`/tmp/hl-exp/exp4.ts`)

Agent `exp10` approved with `valid_until` = approval + 30 s, then `updateLeverage` from it at
+3, +6, +10 and +15 min, then revoked with `approveAgent` 0x0 and leverage reset to 40x cross.

```
1788780318261 approve 'exp10' valid_until 1788780348261 {"status":"ok","response":{"type":"default"}}
1788780500400 +3min (expiry was 152s ago) OK {"status":"ok","response":{"type":"default"}} extraAgents [{"name":"exp10","address":"0x7e7418cdf16743d081546b4adf43363f3bad8518","validUntil":1788780348261}]
1788780681640 +6min (expiry was 333s ago) OK {"status":"ok","response":{"type":"default"}} extraAgents [{"name":"exp10","address":"0x7e7418cdf16743d081546b4adf43363f3bad8518","validUntil":1788780348261}]
1788780922890 +10min (expiry was 575s ago) OK {"status":"ok","response":{"type":"default"}} extraAgents [{"name":"exp10","address":"0x7e7418cdf16743d081546b4adf43363f3bad8518","validUntil":1788780348261}]
1788781224111 +15min (expiry was 876s ago) OK {"status":"ok","response":{"type":"default"}} extraAgents [{"name":"exp10","address":"0x7e7418cdf16743d081546b4adf43363f3bad8518","validUntil":1788780348261}]
revoke exp10 {"status":"ok","response":{"type":"default"}}
final agents [] leverage reset {"status":"ok","response":{"type":"default"}}
```

Result: 876 s after `validUntil` the venue still accepted the expired agent's action and
`extraAgents` still listed it with the stale `validUntil`. Revocation via 0x0 cleared it
immediately (`final agents []`). Account left clean: no agents, no orders, no position.

## 8. Summary

- Agent (API wallet) can: place/cancel/modify any order (perps and spot, any size, `r` true or
  false), TWAP, set leverage anywhere in `[1, assetMax]` at any time including with a position
  open, change isolated margin, scheduleCancel (if volume-gated in), move funds between spot /
  perp DEXs / sub-accounts / vaults of the same user (`agentSendAsset`, `vaultTransfer`),
  flip the account's abstraction mode and big-blocks flag, set a referrer.
- Only the master can: `usdSend`, `spotSend`, `sendAsset`, `usdClassTransfer`, `withdraw3`,
  `sendToEvmWithData`, staking, `approveAgent` (create / replace / revoke agents),
  `approveBuilderFee`, `convertToMultiSigUser`, user-level abstraction actions — everything
  user-signed, because a user-signed payload applies to whoever signed it.
- Venue-side scoping of an agent: **none**. No reduce-only, spot-only, size-cap or
  leverage-cap agents; the only knobs are name and `valid_until` (<= 180 days, not enforced
  within 15 min of expiry), limit 3 named + 1 unnamed. Sub-accounts need $100k volume and add no
  restriction primitive; `scheduleCancel` needs $1M volume and only cancels orders.
- Fastest bypass: open app.hyperliquid.xyz with the master wallet, or sign one
  `approveAgent` — about one second, and the master key holder always retains it.
