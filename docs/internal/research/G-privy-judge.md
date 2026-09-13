# G. Privy judge pass: Best Financial Flow, read ungenerously

Agent G, 2026-09-07. Persona: Privy senior DevRel judging ETHOnline 2026 "Best
Financial Flow" ($2,500). Only authority for qualification:
`docs/internal/gauntlet/CRITERIA.md`. Every code claim was checked against the
file named; every Privy claim against docs.privy.io fetched today (URLs inline,
`.md` variants of the pages). Nothing was built; the repo has no Privy app
secret and no server-side Privy code, which matters for most of section 2.

Read in full: `app/src/lib/privy.tsx`, `app/src/lib/shield.tsx`,
`app/src/lib/evm-engine.ts`, `app/src/pages/Welcome.tsx`, `Setup.tsx`,
`TopUp.tsx` (submit path), `Protection.tsx` (action list),
`docs/SPONSOR_INTEGRATIONS.md` (Privy section), `docs/DEMO_SCRIPT.md`,
`HUMAN_ACTIONS.md`, `docs/internal/gauntlet/FACTS.md`,
`docs/internal/research/A-privy-hyperliquid-signing.md`,
`B-hyperliquid-protocol.md` (§3, §5, §6, §8), `02-synthesis.md`.

The question I kept asking: would this be one of the most sophisticated and
useful demonstrations of Privy in the hackathon? Today, no. It is a correct,
honest, minimal one. Below is why, and what would change it without theatre.

---

## 1. Score against the verbatim clauses

| Clause (verbatim) | Verdict | Why, specifically |
|---|---|---|
| "Integrate Privy as a core part of the product" | **Partial** | The wiring is real: `privy.tsx:37-42` takes the embedded wallet's EIP-1193 provider, `shield.tsx:132` hands it to `evmEngine`, and `evm-engine.ts:72-78` builds the viem wallet client from it, so every vault transaction is signed by the Privy wallet and the contract makes that address the sole authority. But `MaybePrivy` (`privy.tsx:58-59`) makes Privy an optional login provider: without `VITE_PRIVY_APP_ID` the app runs on a pasted private key, and `Welcome.tsx:110-137` still offers "Continue with a demo key" on testnet even when Privy is configured. A Privy judge reads that as "Privy is the front door, not the house". Core to the *onboarding*, not to the *product*. |
| "Create or use at least one Privy wallet" | **Pass** | `createOnLogin: "users-without-wallets"` (`privy.tsx:70`; the doc cites `:67`, it is line 70 today). Wallet `0x83144b99…`, nonce 4, signed four transactions. Clean. |
| "Complete at least one functional financial flow using a generally available Privy feature" | **Pass, thin** | The $5 release (tx `0x94960d1f…`, block 63581864) is a real transfer that also crosses HyperEVM to HyperCore through Circle's `CoreDepositWallet`. That is a good flow. But (i) it is on the superseded v1 contract; (ii) the vault was funded by a different address, so the money never *entered* through the Privy wallet, only the authority did; (iii) the "generally available Privy feature" used is the most basic one there is: an embedded EOA signing `eth_sendTransaction`. Nothing from Privy's financial-flow surface (funding, deposits, policies, signers, smart wallets, gas sponsorship) is touched. |
| "Eligible flows include transfers, bridging, stablecoin conversions, swaps, self-service Earn vaults, onramps" | **Pass** | A USDC transfer that bridges to HyperCore in one transaction. Legitimately two of the listed flows at once. The best fact in the submission. |
| "Provide a working demo and access to the project's source code" | **Fail today** | Repository private (`HUMAN_ACTIONS.md` #1), no video, no hosted URL. A judge who cannot open the repo scores zero regardless of the rest. |
| "Clearly explain how Privy improves the user experience" | **Pass** | The explanation in `SPONSOR_INTEGRATIONS.md` ("a seed-phrase ceremony at the front door would lose the user before the premise is ever tested") is the right argument for this product, and the in-app copy at `Welcome.tsx:88` says it to the user. The "Feedback for Privy" paragraph (chain object drift, embedded vs external wallet ambiguity) is the kind of thing a DevRel judge remembers. |

**Overall: 5/10 on the merits as it stands; 3/10 as submittable today** (private
repo, no video). With the already-planned on-camera v2 onboarding funded *from*
the Privy wallet, a public repo and a video: **6/10**. That is a plausible
honourable mention in a weak field and a miss in a strong one.

### What a first-place financial-flow entry shows that Shield does not

1. **Money enters through Privy.** An onramp, a `useAddFunds`/deposit
   address, a bridge, or at minimum a funding screen the wallet is watched
   on. Shield's Privy wallet was topped up by the deployer off-camera.
2. **Several flows in one sitting.** Fund, move, spend/trade, withdraw. Shield
   has deposit, release, cold transfer and full exit *implemented*
   (`evm-engine.ts:151-165`), but has only ever filmed or recorded one.
3. **One-tap UX.** Winners hide the wallet: no confirmation modal per call,
   batches feel like one action. Shield's `activate()` is 2-3 prompts
   (`Setup.tsx:150`, counted honestly on screen at `:425`) and `deposit` is
   `[approve, deposit]` = 2 prompts (`evm-engine.ts:152`, with the
   redundant-approve skip at `:178-181`). Nothing uses
   `showWalletUIs: false` (see 3.6).
4. **A hosted URL.** Judges open it on their phone. Shield needs a Bun
   server, an `.env`, Foundry and a funded testnet key to see anything.
5. **Privy's control surface doing real work**: a signer scoped by a policy, a
   time-bound key, a quorum. Shield's own doc says "Privy policies, quorums,
   session signers, Cards and `useFundWallet` are not used anywhere". Correct
   and honest; also the reason it cannot be "most sophisticated".
6. **Mainnet.** Testnet is fine for eligibility, but the winner's tx hash opens
   in an explorer. Shield's testnet has no working explorer at all
   (`evm-engine.ts:97-103`), so verification is `cast tx` in a terminal.

---

## 2. Which Privy features would deepen the flow without theatre

First, the number that decides most of this section. **How many signatures
does a Shield "session" involve?** The user trades on Hyperliquid, not in
Shield (`SPONSOR_INTEGRATIONS.md`, "Shield has no order entry"). Shield signs
only vault actions. In a 6h protected session with a $300 daily budget and a
20% reload threshold (`Setup.tsx:56-59` defaults), the vault will accept at
most a couple of `instantTopUp`s and possibly one `proposeTopUp`
(`TopUp.tsx:77-86`). Realistically **0-2 signatures per session**, each one a
deliberate "move protected money" decision. Onboarding is 4-5 prompts once.
There is no per-action ceremony to remove.

| Option | Real UX gain? | Effort | Needs app secret / server wallet? | GA status (docs fetched 2026-09-07) | Would a Privy judge count it? |
|---|---|---|---|---|---|
| **(a) Deposit from the Privy wallet into the v2 vault** (planned) | **Yes.** It closes the "money never passed through the Privy wallet" hole and gives the video its first real transfer. | 0 dev hours; 10 min on camera. Optionally 2-3h for a funding screen (3.6, rec. 2). | No. | Embedded wallets, GA. | **Yes.** This is the flow. Film it. |
| **(b) Time-bound signer to sign vault txs during a session** | **No.** There are 0-2 signatures to remove, and each is the one moment the product *wants* deliberate. Worse: a signer is "your app's authorization key" that lets "your servers" transact from the user's wallet (docs, 3.2). Shield's pitch is "no one at Shield can make an exception" (`Welcome.tsx:74`). Giving Shield a key that can call `instantTopUp` from the user's wallet contradicts the product on camera. | 8-12h: dashboard key quorum, `useSigners().addSigners`, a server holding the P-256 private key, NodeJS SDK calls, plus a time-bound policy. | **Yes**, both. Signers are used "from your server" with "the signing key you configured in the dashboard"; there is no such server in the repo. | GA. Privy renamed "session signers" to "signers"; the old `/session-signers/` URL is a 404 today (3.2). | Counts as a GA feature, but not as "completing a financial flow". Theatre for this product. **Do not build.** |
| **(c) Policy on the embedded wallet denying `approveAgent` / withdraw to non-allowlisted destinations** | **No, for a structural reason:** the Privy wallet is the *vault authority*, not the Hyperliquid master. The trading account is a separately pasted address (`Setup.tsx:241`, `FACTS.md`: `0xE7c2…`). A policy on the Privy wallet's typed-data signing constrains a wallet that never signs a Hyperliquid action. To make it bite, the Privy wallet must become the HL master (a product change), and then the sole owner can still detach it (A §3.5). | 10-16h if the Privy wallet became the HL master; plus policy creation is server-side. | **Yes.** `POST /v1/policies` needs app ID + app secret; attaching to a user-owned wallet needs `PATCH /v1/wallets` with the owner's (user's) authorization signature. Client `createWallet` accepts `signers[].policyIds` only, no wallet-level `policyIds` (3.4). | GA. | It is "custody-side rules you set while calm", honestly labelled soft. But it is B2B-track material, and `CRITERIA.md` says not to claim that track. For Financial Flow it moves nothing. **Not worth building for this prize.** |
| **(d) Privy-managed Hyperliquid agent key with `valid_until` ("your session key expires at 02:00")** | **Only if Shield has order entry.** An agent key is a key that *trades*. Shield deliberately has no trade ticket. Whose UI would use the agent? The user trades on app.hyperliquid.xyz with the master key, where the agent is irrelevant. Without order entry it is a key nobody uses; with order entry Shield becomes a trading terminal (20h+ and a different product). Expiry is also lazily enforced by the venue: agents kept executing 152 s past `valid_until` (B §3); treat as an hours-scale backstop. | 6-10h for the key (client-side is possible: React `createWallet({createAdditional: true})` makes a second embedded wallet, master signs `approveAgent` via `signTypedData`), **plus** 20h+ for order entry. | No, if done client-side with an additional embedded wallet. Privy's recipe does it server-side with `PrivyClient.createWallet` (3.3). | GA (Hyperliquid recipe). | Counts as a real Privy+Hyperliquid pattern, and it is the one Privy wrote a recipe for. But for Shield it is a key with no consumer. **Build only if the product decision is "Shield ships order entry"** — which the research says makes it a soft control anyway (B §5: master trades around it in ~1 s). |
| **(e) 2-of-2 co-signing quorum (user + Shield key) on the wallet** | Hard control, but: docs call key quorums "an advanced feature" to reach out about (3.5); quorums with user IDs must be created server-side; every request then needs both signatures, so Shield is a liveness dependency; "self-custodial" becomes false; the demo-key path dies; `Welcome.tsx:81` ("Your wallet is the only authority") becomes untrue. | 20-40h, and a product rewrite of the trust story. | **Yes.** Server, app secret, authorization key, proxying every wallet call. | GA but gated ("reach out"). | A judge would be impressed by the engineering and then ask why a self-custody product has a co-signer. **No.** |

Two things Shield could do that *are* real, cheap, GA, and zero-server, that
the brief did not list:

- **(f) `showWalletUIs: false` on the never-gated calls.** Per-call
  `uiOptions.showWalletUIs` hides Privy's confirmation modal (3.6). Use it on
  `approve` inside `[approve, deposit]` and on the `registerOwner` calls that
  follow `initializeVault`, so activation and deposit are each one click.
  Keep the modal on `instantTopUp`, `instantColdTransfer`, `executeFullExit`:
  those are the moments the product is about. 1-2h. Honest framing on camera:
  "Privy lets us hide the wallet where nothing is at stake and show it where
  something is." This is exactly the kind of UX judgement Privy DevRel likes.
- **(g) A funding screen for the Privy wallet.** Address, copy button, live
  USDC/HYPE balance (`walletUsdc` is already read at `evm-engine.ts:118`),
  and the one instruction that works on this chain: "send USDC from
  Hyperliquid to this address" (Core->EVM `spotSend` to the system address,
  `scripts/hyperevm-bridge.ts` already does it). `useAddFunds` is mainnet
  only in the docs (Base, Solana mainnet CAIP-2 examples; no testnet), so do
  not wire it for 998; but the *screen* is the funding path a judge looks for.
  2-3h. On mainnet later, `useAddFunds` drops in.

---

## 3. GA / limitation verification (current docs, fetched 2026-09-07)

3.1 **Policies.** https://docs.privy.io/controls/policies/overview.md — created
"through the Privy Dashboard, `nodeJS` SDK, or via the REST API"; conditions
on `ethereum_transaction` (`to`, `value`, `chain_id`),
`ethereum_typed_data_domain` (`chainId`, `verifyingContract`),
`ethereum_typed_data_message` (dot-path into `message`); "Time-bound signers"
listed as a capability; `in` operator up to 100 values. No beta label.
https://docs.privy.io/controls/policies/create-a-policy.md — REST needs app ID
+ app secret basic auth and a `privy-authorization-signature`; "Without an
owner, the policies can be updated by your app secret alone."
https://docs.privy.io/controls/policies/example-policies/timebound.md —
expiry is `field_source: 'system', field: 'current_unix_timestamp'` with
`lt`/`gte`/`lte`. Research A §3.4: stateful aggregations only on
`eth_signTransaction`/`eth_signUserOperation`, not typed data.

3.2 **Signers (formerly session signers).**
https://docs.privy.io/wallets/using-wallets/signers/quickstart.md — generate a
P-256 key, register it in the dashboard as a 1-of-1 key quorum, then "use the
`addSigners` method of `useSigners` hook to add your app's authorization key
as a signer on the wallet"; afterwards "your app must sign transaction
requests to Privy's API with the private key of the authorization key".
https://docs.privy.io/wallets/using-wallets/signers/use-signers.md — "Execute
transactions on user wallets from your server"; wallets with signers carry
`delegated: true`. https://docs.privy.io/wallets/using-wallets/signers/add-signers.md
— params `address`, `signerId` (key quorum ID), optional `policyIds`; "each
signer can only have one override policy" (A §3.5).
https://docs.privy.io/wallets/using-wallets/signers/remove-signers.md — the
user "may also revoke consent"; `removeSigners` removes all signers. The URL
`/wallets/using-wallets/session-signers/overview.md` returns **404**; the
quickstart still uses "session signers" as an example name. GA, no plan gate
mentioned. **Requires a server holding the authorization private key.**

3.3 **Hyperliquid recipe.**
https://docs.privy.io/recipes/hyperliquid/policies-and-offline-actions.md —
policies control User Signed Actions (withdrawals, agent approvals, `sendAsset`
transfers, builder fees) and cannot restrict L1 actions ("Placing orders,
Canceling orders, Modifying orders, Setting leverage, Other trading
operations"). https://docs.privy.io/recipes/hyperliquid/agents-and-subaccounts.md
— agent wallet created server-side with `privy.wallets().createWallet(...)`,
registered with `registerAgent`, expiry via `agentName: \`Trading Bot
valid_until ${expirationTimestamp}\``.
https://docs.privy.io/recipes/hyperliquid/client-side-usage.md — client path
uses `usePrivy`/`useWallets`, `toViemAccount({ wallet: embeddedWallet })`, an
`ExchangeClient`, and `client.approveAgent({ agentAddress, agentName })`.
https://docs.privy.io/recipes/hyperliquid-guide.md — server-side NodeJS
quickstart; testnet faucet "$1000 USDC", "once per address", requires prior
mainnet activation. https://docs.privy.io/recipes/hyperliquid/hyperevm.md —
HyperEVM testnet 998 shown; ERC-4337 smart wallets and gas sponsorship via
ZeroDev/Alchemy/Biconomy paymasters; nothing on HyperEVM->HyperCore bridging.
No beta labels on any of these.

3.4 **Client-side wallet creation.**
https://docs.privy.io/wallets/wallets/create/create-a-wallet.md — React
`createWallet` accepts `createAdditional` and `signers: {signerId, policyIds?}[]`;
no wallet-level `policyIds` from the client. Server-side creation uses
`-u '<app-id>:<app-secret>'`.

3.5 **Owners and quorums.**
https://docs.privy.io/controls/authorization-keys/owners/types.md — owners are
users, authorization keys, or key quorums; "You can create user non-custodial
wallets by setting a user as the owner of the wallet."
https://docs.privy.io/controls/key-quorum/overview.md — m-of-n, "Key quorums
are an advanced feature" (reach out first).
https://docs.privy.io/recipes/wallets/two-of-two-server-in-the-loop.md —
"Key quorums containing both user IDs and authorization keys must be created
via the SDK or REST API"; every request carries
`privy-authorization-signature: <user-signature>,<server-signature>`.
https://docs.privy.io/wallets/wallets/export.md — export "enabled by default,
unless explicitly disabled by a `DENY` policy"; the anti-unilateral-export
pattern is the 2-of-2 quorum.

3.6 **Wallet UI and funding.**
https://docs.privy.io/wallets/using-wallets/ethereum/send-a-transaction.md —
"To hide confirmation modals, set `options.uiOptions.showWalletUIs` to
`false`", per call. https://docs.privy.io/wallets/funding/add-funds.md —
`useAddFunds` "opens the onramp modal"; methods are card/bank fiat and crypto
transfer; chains given as CAIP-2 mainnet ids (`eip155:8453`, Solana mainnet);
requires enabling methods on the dashboard's Account Funding page; React
only. No testnet support stated; treat as mainnet-only.
https://docs.privy.io/financial-flows/deposits/overview.md — fiat deposits
(VBANs), crypto deposits with routing, onramp modal (React), card onramps;
chains and status not stated on that page. A batch-transactions page
(`/wallets/using-wallets/ethereum/batch-transactions.md`) does not exist
(404), so do not promise EIP-5792 batching for the embedded EOA.

---

## 4. The hosted demo question

"Provide a working demo and access to the project's source code." A Privy
judge with 40 entries opens a URL first and clones second, if at all. Today
Shield offers neither, and the local run needs `.env`, Foundry, Bun, the
server on 8788 and a funded 998 key (`DEMO_SCRIPT.md` pre-flight).

**A static hosted build is better than none, for this judge specifically,**
because everything Privy is judging on is client-side: `vite build` already
produces `app/dist`; `evmCfg` is satisfied from `VITE_SHIELD_VAULT_ADDRESS`
and `VITE_USDC_ADDRESS` without the server (`shield.tsx:113-116`,
`.env.example` says so); login, wallet creation, vault reads, deposit, release
and cold transfer are chain + Privy only. Server-dependent surfaces already
degrade with honest copy: "Activity needs the Shield server. The vault itself
is unaffected." (`Activity.tsx:88`), Behaviour says "It isn't reachable ... Your
rules keep working without it" (`Behaviour.tsx:59`). `Setup` step 0 sets
`connected` before the history read and shows the fetch error inline
(`Setup.tsx:87-104`), so onboarding proceeds; the monitor toggle is simply off
because `health` is null (`Setup.tsx:143`).

What breaks, and what to do about it before pointing a judge at it:

1. **The judge's fresh wallet has no test USDC** and the faucet button is
   gated on `health?.demo` (`Setup.tsx:466`), so a static build ends at
   "Deposit $X" disabled. Mitigation in order of cost: (i) put the demo
   account's read-only view on the landing page so a judge sees a funded
   vault without signing in; (ii) a "Get test USDC" link with the exact
   `cast send` for someone who has a 998 key; (iii) host the Bun server too
   (Fly/Railway, 2-4h) and keep the faucet. (iii) is the real answer.
2. `VITE_SHIELD_API` must not point at localhost on the hosted build; set it
   to the hosted server or to an obviously-dead URL so the failure copy shows
   at once rather than after a timeout.
3. The Privy dashboard must list the hosted origin under allowed domains, or
   login fails silently.
4. Public HyperEVM RPC rate limits: the app already backs off at 20 s polls
   on 998 (`shield.tsx:36-38`). Fine for one judge, not for ten at once.
5. Say on the page which tabs are degraded and why. Judges forgive "needs the
   server, run it locally for this tab"; they do not forgive a blank panel.

Verdict: static hosted build **yes**, today, even before the server is
hosted; it turns "clone and configure" into "log in with your email and watch
a vault get created for you", which is the Privy pitch in one screen.

---

## 5. What makes a Privy judge care in 20 seconds of video

Cut straight to this, no landing page, no terminal:

1. Email typed, code entered (2 s). Address appears with "created by Privy,
   no seed phrase" on screen (2 s).
2. The wallet shows a USDC balance; the deposit button; **one** click; vault
   balance goes from $0 to the deposit (6 s). Narration: "the money and the
   only key to it both live in the wallet Privy just made."
3. Release $5: the Privy modal appears once, the Hyperliquid account balance
   ticks up live (6 s). Narration: "one signature, HyperEVM to HyperCore,
   through Circle's deposit contract."
4. Try again: the vault refuses (`CooldownActive` or budget), and the
   on-screen copy says no one at Shield can override it (4 s).

Twenty seconds, two flows, one Privy wallet doing both the custody and the
signing. Do not spend those seconds on policies, signers or TEEs; the Privy
judge is not scoring them.

---

## 6. Ranked recommendations

| # | Recommendation | Effort | Score delta (of 10) | Notes |
|---|---|---|---|---|
| 1 | **Make the repo public, record the video, host the static build** (and the server if there is time). | 0.5h + 2h + 1-4h | 3 -> 6 | Everything else is worth zero until this is done. Fix the `privy.tsx:67` line reference in `SPONSOR_INTEGRATIONS.md` while there (it is `:70`). |
| 2 | **Film the full money path from the Privy wallet on v2**: deposit, release to Hyperliquid, and one `instantColdTransfer` to the safe wallet. Add a funding screen (address, live balance, "send USDC from Hyperliquid to this address"). | 0h to film + 2-3h for the screen | +0.5 to +1 | Turns one flow into three and closes the "money never passed through the wallet" weakness on camera, not in a footnote. |
| 3 | **`showWalletUIs: false` on the never-gated calls** (`approve`, follow-up `registerOwner`s), keep it on releases and exits; say why on screen. | 1-2h | +0.5 | Real UX, GA, zero server, and it is a *judgement* about Privy's UI rather than a checkbox. |
| 4 | **Remove or hide the demo-key path when Privy is configured** on 998, or move it behind a `?demo` query. | 1h | +0.25 | "Integrate Privy as a core part" reads better when Privy is the only way in on the demo network. |
| 5 | **Update `SPONSOR_INTEGRATIONS.md`** with the v2 transactions, the three flows, and a one-line "what we chose not to use and why" for signers/policies/quorums (drawing on research A and this doc). | 1h | +0.25 | Judges reward a team that knows what a feature is for and declined it on purpose. |

Ceiling with all five: **7-7.5/10**. The gap to a confident first place is the
missing funding/onramp surface and mainnet, neither of which is reachable
honestly on HyperEVM testnet this week.

### What NOT to do

- **Do not claim policies restrict trading.** They cannot see inside
  Hyperliquid L1 actions (A §1, §4); Privy's own recipe says so.
- **Do not claim the B2B track.** `CRITERIA.md` requires control primitives
  and a B2B use case; Shield has neither.
- **Do not add a signer that lets Shield's server sign from the user's
  wallet.** It contradicts `Welcome.tsx:74` and `:81` on camera.
- **Do not build an agent key without order entry.** A key nobody uses is
  theatre, and the expiry is lazy by minutes (B §3).
- **Do not present `valid_until` or a Privy policy as enforcement.** The
  only hard thing in the product is the vault; say so and stop.
- **Do not wire `useAddFunds` on testnet.** The docs show mainnet chains
  only; a broken onramp modal is worse than a copy-address screen.
- **Do not hide the demo-key fallback from the README**; hide it from the
  UI on the demo network.
