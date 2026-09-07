# Research spike A: Can Privy policies make a Hyperliquid "trading authority ratchet" real?

Date: 2026-09-07. Author: Agent A (Privy / Hyperliquid signing). Repo: `port-vila` worktree, branch `office-hours`.
Sources: docs.privy.io (fetched 2026-09-07 as Markdown via `<page>.md` and `llms-full.txt`),
hyperliquid.gitbook.io (fetched 2026-09-07 via `<page>.md` and `llms-full.txt`), the Hyperliquid Python SDK
`signing.py` (master), and the vendored `@nktkas/hyperliquid@0.33.3` source in `node_modules`.
Script and raw output: `/tmp/shield-spike/hl-typed-data.ts`, `/tmp/shield-spike/hl-typed-data.out` (reproduced in section 4).

## 0. Verdict in one paragraph

A Privy-policy-enforced "dynamic trading authority ratchet" on Hyperliquid is **not technically real for trading
actions**. Every Hyperliquid trading action (order, cancel, modify, updateLeverage, updateIsolatedMargin, twap,
agentSendAsset, ...) is signed as the EIP-712 struct `Agent(string source, bytes32 connectionId)` where
`connectionId = keccak256(msgpack(action) || nonce || vaultMarker || expiresAfter)`. The signer, and therefore
Privy's policy engine (which evaluates the `eth_signTypedData_v4` request inside the TEE), sees only a 1-character
`source` ("a"/"b") and a 32-byte opaque hash. Reduce-only vs. risk-expanding, size, price, leverage, asset, perps vs.
spot, action type, and `expiresAfter` are all inside the hash. Privy offers **no** Hyperliquid-aware decoder; its own
Hyperliquid recipe states policies control "User Signed Actions" (withdraw3, approveAgent, sendAsset, approveBuilderFee)
and that L1 actions are "other operations ... that can be performed by any registered agent wallet". What a Privy
policy CAN do is (i) allow/deny the entire L1 class as a block, (ii) allow/deny/constrain each user-signed action type
field by field (destination, amount, agentAddress, agentName), (iii) time-bound a signer, (iv) deny key export. And
none of it binds the *user* unless the user gives up sole ownership of the wallet (2-of-2 quorum with Shield), because
a wallet's owner can detach policies, remove signers, export the key, and approve another Hyperliquid agent with the
master key. The one real ratchet mechanism that survives is **server co-signing with preimage verification** (Shield's
server sees `action + nonce`, recomputes `connectionId`, checks risk, and co-signs the Privy request as a mandatory
quorum member), which is a *Shield-enforced* ratchet with Privy's TEE guaranteeing the co-signature is required; it
is not a Privy-policy ratchet, it makes Shield a liveness dependency, and it breaks the "self-custodial" claim.

## 1. Capability matrix

Legend: POSSIBLE = cryptographically enforced by Privy today with documented features; PARTIAL = enforceable only
as a coarse class or only under a custody configuration that changes Shield's product claims; IMPOSSIBLE = no
mechanism exists (the data is not visible to the policy engine); UNKNOWN = needs the credential-gated experiment.

| # | Can a Privy policy prevent a Shield-controlled HL signer from ... | Verdict | Reason (evidence section) |
|---|---|---|---|
| 1 | increasing exposure | **IMPOSSIBLE** | Order side/size/reduceOnly are inside `connectionId`; policy sees `{source, connectionId}` only (4a vs 4a'). No stateful aggregation for `eth_signTypedData_v4` (3.4). |
| 2 | opening new positions | **IMPOSSIBLE** | Same: `r` (reduceOnly) flag is hashed (4a vs 4a' produce different opaque hashes, identical typed-data shape). |
| 3 | exceeding a leverage level | **IMPOSSIBLE** | `updateLeverage.leverage` is hashed (4b vs 4b'). Only whole-class deny of all L1 actions is expressible. |
| 4 | exceeding a position size | **IMPOSSIBLE** | `s` is hashed; and even if visible, Privy aggregations only support `eth_signTransaction`/`eth_signUserOperation` (3.4). |
| 5 | doing anything except reduce/close | **IMPOSSIBLE** | Reduce-only orders and opening orders are indistinguishable to the policy engine (4a vs 4a'). |
| 6 | trading perps while permitting spot | **IMPOSSIBLE** | Asset index (`a`: 0 vs 10000) is hashed (4a vs 4c). |
| 7 | performing certain HL action types | **PARTIAL** | Policy can distinguish (and allow/deny/constrain by field) each **user-signed** type via `primary_type` + `types` match and `ethereum_typed_data_domain.chainId` (1337 = L1 vs signatureChainId = user-signed). It cannot distinguish between L1 action types (order vs cancel vs updateLeverage): all are `Agent`. Privy's own Hyperliquid recipe only shows withdraw/sendAsset/approveAgent policies (3.2). |
| 8 | continuing after a specified expiry | **POSSIBLE** (two layers) | Privy: `field_source: system, field: current_unix_timestamp` conditions on the signer's override policy (3.3, time-bound example). Hyperliquid: `approveAgent` name suffix `valid_until {ms}`, max 180 days (2.3). Neither expires an already-exported key. |
| 9 | being bypassed by another signer (second agent, master key, key export) | **PARTIAL** | Only if the HL master account IS a Privy wallet whose owner is a quorum that requires Shield (e.g. 2-of-2 user+Shield) or Shield alone, with a `DENY HyperliquidTransaction:ApproveAgent` rule and a `DENY exportPrivateKey` rule, created fresh with no prior agents/exports. With the default self-custodial embedded wallet (user is sole owner) the user can remove signers ("revoke consent"), detach policies, export the key, and approve any agent. With an external master wallet (MetaMask) nothing can be enforced (3.5, 3.6). |
| 10 | changing/removing its own policy | **POSSIBLE for the signer, NOT for the wallet owner** | Signers "cannot update a wallet's owner, signers, or policies"; policy `owner_id` quorum signature is required to modify a policy. But the wallet OWNER can "update the policies assigned to a wallet" (detach/replace) regardless of the policy's owner. So it binds a delegated signer, not the user (3.5). |

Underlying question: **does the phantom-agent hashing hide order contents from a typed-data policy?** Yes,
completely (section 4). **Does Privy offer a Hyperliquid-aware policy that decodes the action?** No. The full
Privy docs (`llms-full.txt`, 4.27 MB) contain zero occurrences of `connectionId`, `phantom`, `msgpack`, or the
`Exchange`/1337 domain; the only Hyperliquid policy content is the recipe in 3.2, whose three examples are all
user-signed types.

## 2. Hyperliquid signing model (verified against current docs and code)

### 2.1 Two signing schemes

Hyperliquid docs, Signing page (https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/signing):
> "Not realizing that there are two signing schemes (the Python SDK methods are `sign_l1_action` vs `sign_user_signed_action`)."

Python SDK `hyperliquid/utils/signing.py` (master), verbatim:
```python
def action_hash(action, vault_address, nonce, expires_after):
    data = msgpack.packb(action)
    data += nonce.to_bytes(8, "big")
    if vault_address is None:
        data += b"\x00"
    else:
        data += b"\x01"
        data += address_to_bytes(vault_address)
    if expires_after is not None:
        data += b"\x00"
        data += expires_after.to_bytes(8, "big")
    return keccak(data)

def construct_phantom_agent(hash, is_mainnet):
    return {"source": "a" if is_mainnet else "b", "connectionId": hash}

def l1_payload(phantom_agent):
    return {
        "domain": {"chainId": 1337, "name": "Exchange", "verifyingContract": "0x0000000000000000000000000000000000000000", "version": "1"},
        "types": {"Agent": [{"name": "source", "type": "string"}, {"name": "connectionId", "type": "bytes32"}], "EIP712Domain": [...]},
        "primaryType": "Agent",
        "message": phantom_agent,
    }

def user_signed_payload(primary_type, payload_types, action):
    chain_id = int(action["signatureChainId"], 16)
    return {
        "domain": {"name": "HyperliquidSignTransaction", "version": "1", "chainId": chain_id, "verifyingContract": "0x0000000000000000000000000000000000000000"},
        "types": {primary_type: payload_types, "EIP712Domain": [...]},
        "primaryType": primary_type,
        "message": action,
    }
```

The vendored TypeScript SDK does the same. `node_modules/@nktkas/hyperliquid/esm/signing/_l1.js`:
```js
export function createL1ActionHash(args) {
  const { action, nonce, vaultAddress, expiresAfter } = args;
  const actionBytes = encodeMsgpack(adjust(action));
  const nonceBytes = toUint64Bytes(nonce);
  const vaultMarker = vaultAddress ? new Uint8Array([1]) : new Uint8Array([0]);
  const vaultBytes = vaultAddress ? hexToBytes(vaultAddress.slice(2)) : new Uint8Array();
  const expiresMarker = expiresAfter !== undefined ? new Uint8Array([0]) : new Uint8Array();
  const expiresBytes = expiresAfter !== undefined ? toUint64Bytes(expiresAfter) : new Uint8Array();
  const bytes = concatBytes(actionBytes, nonceBytes, vaultMarker, vaultBytes, expiresMarker, expiresBytes);
  return `0x${bytesToHex(keccak_256(bytes))}`;
}
export async function signL1Action(args) {
  ...
  return await signTypedData({ wallet,
    domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: "0x0000000000000000000000000000000000000000" },
    types: { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] },
    primaryType: "Agent",
    message: { source: isTestnet ? "b" : "a", connectionId: actionHash } });
}
```
`signing/_userSigned.js`:
```js
export async function signUserSignedAction(args) {
  const { wallet, action, types } = args;
  return await signTypedData({ wallet,
    domain: { name: "HyperliquidSignTransaction", version: "1", chainId: parseInt(action.signatureChainId), verifyingContract: "0x0000000000000000000000000000000000000000" },
    types, primaryType: Object.keys(types)[0], message: action });
}
```
Which method uses which scheme (`api/exchange/_methods/*.js`): `order`, `cancel`, `cancelByCloid`, `modify`,
`batchModify`, `updateLeverage`, `updateIsolatedMargin`, `twapOrder`, `twapCancel`, `scheduleCancel`, `agentSendAsset`,
`agentSetAbstraction`, `vaultTransfer`, `createSubAccount`, `noop` ... call `executeL1Action`; `usdSend`, `spotSend`,
`withdraw3`, `sendAsset`, `usdClassTransfer`, `approveAgent`, `approveBuilderFee`, `tokenDelegate`, `cDeposit`,
`cWithdraw`, `convertToMultiSigUser`, `userSetAbstraction`... call `executeUserSignedAction` with a
`HyperliquidTransaction:<Type>` EIP-712 type (e.g. `HyperliquidTransaction:UsdSend`
`[hyperliquidChain string, destination string, amount string, time uint64]`;
`HyperliquidTransaction:ApproveAgent` `[hyperliquidChain string, agentAddress address, agentName string, nonce uint64]`;
`HyperliquidTransaction:SendAsset` `[hyperliquidChain, destination, sourceDex, destinationDex, token, amount, fromSubAccount, nonce]`).

Note the SDK's `signTypedData` (`_abstractWallet.js`) filters the message to the fields declared in `types[primaryType]`
before handing it to the wallet, so a wallet never even sees the wire `type`/`signatureChainId` fields.

### 2.2 Which actions need the master key

Hyperliquid Exchange endpoint page (https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint):
> "Subaccounts and vaults do not have private keys. To perform actions on behalf of a subaccount or vault signing should be done by the master account and the vaultAddress field should be set to the address of the subaccount or vault."
> "Some actions support an optional field `expiresAfter` which is a timestamp in milliseconds after which the action will be rejected. User-signed actions such as Core USDC transfer do not support the `expiresAfter` field."
> Agent Send Asset: "Similar to send asset, but can be signed by an agent. Destination must match the source address."
> Builder codes: "This action must be signed by the user's main wallet, not an agent/API wallet."

Nonces and API wallets page (https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets):
> "These are also known as `agent wallets` in the docs. A master account can approve API wallets to sign on behalf of the master account or any of the sub-accounts."
> "Note that API wallets are only used to sign."
> "Nonces are tracked per signer, which is the user address if signed with private key of the address, or the agent address if signed with an API wallet."
> Pruning: "1. The wallet is deregistered. This happens to an existing unnamed API Wallet when an ApproveAgent action is sent to register a new unnamed API Wallet. This also happens to an existing named API Wallet when an ApproveAgent action is sent with a matching name. 2. The wallet expires. 3. The account that registered the agent no longer has funds."
> "Once an agent is deregistered, its used nonce state may be pruned. ... previously signed actions can be replayed once the nonce set is pruned."

Privy's Hyperliquid quickstart (https://docs.privy.io/recipes/hyperliquid-guide) confirms the split:
> "Withdrawals are **User Signed Actions** and must be signed by the master wallet. Agent wallets cannot initiate withdrawals directly."

Hyperliquid's own docs do not carry a single sentence "API wallets cannot sign user-signed actions"; the constraint is
structural (user-signed payloads are verified against the account address, agents have a separate `agentSendAsset`
variant with the destination pinned to the source). The previous research's claim is verified in substance.

### 2.3 Agent expiry and limits (approveAgent)

Exchange endpoint, "Approve an API wallet", verbatim from the `agentName` field:
> "Optional name for the API wallet. An account can have 1 unnamed approved wallet and up to 3 named ones. And additional 2 named agents are allowed per subaccount. A custom expiration can be set by appending `valid_until {timestamp}` after the name. The expiration can be at most 180 days in the future"

The SDK enforces `baseName.length <= 16` after stripping ` valid_until \d+` (`_methods/approveAgent.js`).

## 3. Privy policy engine and control model (verified against current docs)

### 3.1 What a policy can see for `eth_signTypedData_v4`

Policies overview (https://docs.privy.io/controls/policies/overview):
> "A **policy** is composed from a **list of rules for each RPC method that a wallet can execute** ... `DENY` actions take precedence over `ALLOW` actions. If no rules resolve, the policy will default to `DENY`."
> "If a wallet's policy **does not** include a rule for a given RPC method or wallet action API, **usage of that RPC method or API will be denied.**"
> "By default, the trusted execution environment (secure enclave) enforces policies when processing wallet actions, such as signature requests, transactions, and key export. ... Privy enforces some policies at the API level. For example, limiting transfer sizes requires transaction simulation which runs outside the enclave today."
> Rule `method`: `'eth_sendTransaction' | 'eth_signTransaction' | 'eth_signUserOperation' | 'eth_signTypedData_v4' | 'personal_sign' | 'eth_sign7702Authorization' | 'wallet_sendCalls' | ... | 'exportPrivateKey' | 'exportSeedPhrase' | ... | 'transfer' | '*'`
> Condition `field_source`: `'ethereum_transaction' | 'ethereum_calldata' | 'ethereum_typed_data_domain' | 'ethereum_typed_data_message' | 'ethereum_7702_authorization' | ... | 'message' | 'action_request_body' | 'system' | 'reference'`
> Condition `operator`: `'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'in' | 'in_condition_set' | 'contains' | 'starts_with' | 'ends_with'`
> `'ethereum_typed_data_domain'` — "Attributes from the signing domain that will verify the signature." Example fields: `chainId`, `verifyingContract`.
> `'ethereum_typed_data_message'` — "`types` and `primary_type` attributes of the TypedData JSON object defined in EIP-712." Example fields: "dot-separated path to value in `message` object, i.e. `to.wallet`".
> "`ethereum_typed_data_message` conditions require a `typed_data` parameter to define the schema for the typed data message."

Ethereum examples (https://docs.privy.io/controls/policies/example-policies/ethereum), "Restrict parameters of a typed data message":
> "An `ethereum_typed_data_message` condition only evaluates when the `types` map declared in the policy matches the `types` map in the signing request **exactly**. That includes `EIP712Domain` and every other type the client sends, even types the condition's `field` path never traverses, and the fields within each type must appear in the same order. On a mismatch the condition evaluates to `false` rather than skipping: in a DENY rule this means the rule never fires, and a permissive ALLOW rule on the same method signs the request. Copy the `types` map verbatim from what the client emits."

Consequence for Hyperliquid: for every L1 action the `types` map is exactly
`{EIP712Domain:[name,version,chainId,verifyingContract], Agent:[source string, connectionId bytes32]}` and the message is
`{source, connectionId}`. The only addressable fields are `source` (constant "a"/"b") and `connectionId` (unique per action
because the nonce is inside the hash). A condition on `connectionId` with `eq`/`in` is a one-shot allowlist of specific
pre-hashed actions, which would require a policy-owner-signed PATCH per trade (section 6, experiment E2 tests whether
`bytes32` is even accepted; condition sets are documented for "address fields on `ethereum_typed_data_message`" only).

Domain conditions can separate the two classes: L1 actions always carry `chainId: 1337`; user-signed actions carry the
`signatureChainId` (998 for the app's HyperEVM provider, 0xa4b1 Arbitrum, 0x66eee in the Python SDK). Both classes
use `verifyingContract: 0x0`, and domain `name` is not a documented condition field.

### 3.2 Privy's own Hyperliquid policy recipe

https://docs.privy.io/recipes/hyperliquid/policies-and-offline-actions:
> "Hyperliquid operations are divided into two categories:"
> "### User Signed Actions — These are sensitive operations that require the master account's signature. Policies can be applied to control any User Signed Action, including: **Withdrawals** ... **Approving Agents** ... **Account Transfers** - Moving funds between master account and subaccounts using `sendAsset` ... **Approving Builder Fees**"
> "### L1 Actions — Other operations are L1 Actions that can be performed by any registered agent wallet without requiring master account approval. These include: Placing orders, Canceling orders, Modifying orders, Setting leverage, Other trading operations"
> "This separation allows you to enable automated trading through agent wallets while maintaining strict control over sensitive account operations."

The three example policies on that page are `DENY Withdrawal from account` (type `HyperliquidTransaction:Withdraw`,
field `hyperliquidChain` `in ["Testnet","Mainnet"]`), `DENY Account Transfers` (`HyperliquidTransaction:SendAsset`), and
`ALLOW Approve Agent` (`HyperliquidTransaction:ApproveAgent`). There is no example, and no field source, for an order.

https://docs.privy.io/recipes/hyperliquid/client-side-usage:
> "### L1 Actions (Trading Operations) — These actions can be executed by agent wallets without requiring the master wallet's signature: Placing orders, Canceling orders, Modifying leverage, Setting position sizes"
> "### User Signed Actions — These sensitive operations require the master wallet's signature: Withdrawing funds, Approving agents, Account transfers, Approving builder fees"

https://docs.privy.io/recipes/hyperliquid/agents-and-subaccounts:
> "Agent wallets (also known as **API wallets**) are permissioned signers that do not hold funds but can execute Hyperliquid actions for a master account and its subaccounts."
> "## Setting Agent Expiration — You can set an expiration timestamp for agent wallets using the agent name: ... `agentName: \`Trading Bot valid_until ${expirationTimestamp}\``"

### 3.3 Time-bound signers and export denial

https://docs.privy.io/controls/policies/example-policies/timebound:
```ts
{ version: '1.0', name: 'Time-bound signer policy', chain_type: 'ethereum',
  rules: [{ name: 'Allow all actions before 9/8/2026', method: '*',
    conditions: [{ field_source: 'system', field: 'current_unix_timestamp', operator: 'lt', value: '1788840000' }],
    action: 'ALLOW' }] }
```
Ethereum examples: "Prevent private key exports while allowing other actions" uses `method: 'exportPrivateKey'`,
`conditions: []`, `action: 'DENY'` plus `method: '*'` ALLOW.

Export page (https://docs.privy.io/wallets/wallets/export):
> "To prevent users from unilaterally exporting keys, applications can set up a 2-of-2 key quorum as the wallet owner, consisting of the user and an authorization key controlled by the application's server. This requires authorization from both parties to export the wallet."
> "Wallet export is restricted to wallet owners and enabled by default, unless explicitly disabled by a `DENY` policy. Wallets without owners cannot be exported."

### 3.4 Stateful policies (cumulative caps) do not reach typed data

https://docs.privy.io/controls/policies/stateful-policies:
> "## Supported RPC methods — Aggregations can be configured for the following RPC methods: `eth_signTransaction` (Ethereum) ... `eth_signUserOperation` (Ethereum)"
> Metric `field_source`: `'ethereum_transaction' | 'ethereum_calldata'`; "Currently, only `'sum'` is supported."

So even a hypothetical visible size field could not be summed across orders.

### 3.5 Owners, signers, quorums, policy mutation

https://docs.privy.io/controls/authorization-keys/owners/overview:
> "With wallets, owners have the ability to: sign and transact with the wallet (within the scope of the wallet's policies); update the policies assigned to a wallet; update the additional signers assigned to the wallet, and the policies assigned to each signer; update the owner of the wallet; export the wallet's private key; delete the wallet"
> "With policies, owners have the ability to: update the rules of the policy; update the owner of the policy; delete the policy"
> "Signers **cannot update a wallet's owner, signers, or policies** and **cannot export the wallet's private key**. They can only take actions (signatures and transactions) with the wallet subject to their policies."
> Permissions table: Update policies — Owners yes / Signers no; Export wallet — Owners yes / Signers no; "Can be configured with policies" — both yes.

https://docs.privy.io/controls/policies/create-a-policy:
> "Policies optionally have owners, which represent the signatures required to modify the policy after creation"
> "We highly recommend specifying owners for your policies to further restrict the parties that can modify them. Without an owner, the policies can be updated by your app secret alone."
> Response `owner_id`: "The key quorum ID of the owner of the policy, whose signature is required to modify the policy."

https://docs.privy.io/wallets/wallets/update-a-wallet:
> "Wallets with `owner_id` present must provide an authorization signature as a request header."
> `policy_ids`: "New policy IDs to enforce on the wallet. Currently, only one policy is supported per wallet."

https://docs.privy.io/controls/authorization-keys/owners/configuration/user/overview:
> "**Creating wallets with a user owner.** This configures wallets such that users are the only entity that can update policies, add additional signers, export the wallet, or change the wallet's owner. If you create wallets via one of Privy's client-side SDKs, your app's wallets are automatically created with user owners."

https://docs.privy.io/wallets/using-wallets/signers/remove-signers:
> "**Once** a wallet has signers, they may also revoke consent to prevent your app from taking any further wallet actions on their behalf."
> "When invoked, the `removeSigners` method will remove all the signers, so only the user can transact on the wallet."

https://docs.privy.io/wallets/using-wallets/signers/add-signers: `policyIds` — "Note that at this time, each signer can only have one override policy." (REST: "The wallet owner must sign the request.")

https://docs.privy.io/controls/key-quorum/overview:
> "All authorization thresholds — both at the parent and nested level — are enforced within Privy's TEE infrastructure, so approval requirements cannot be bypassed by any single party."

https://docs.privy.io/recipes/wallets/two-of-two-server-in-the-loop:
> "A **2-of-2 key quorum** achieves this: one quorum member is the user, the other is an authorization key controlled by your server. Both must sign every request to Privy's API."
> "Every request to the Privy API that acts on this wallet must include signatures from both the user and the server. The flow below applies to transactions, wallet updates, and key export."

https://docs.privy.io/controls/authorization-keys/owners/configuration/user/server-export:
> "As a satisfying member of the key quorum that owns the wallet, **your server's authorization key can unilaterally export the wallet**" (1-of-k quorum). This is the anti-pattern for a ratchet: never put Shield in a 1-of-k owner quorum.

Privy FAQ (llms-full, "Who controls the key?"):
> "Privy's embedded wallets use a 2-of-2 key-share architecture where both shares are required to produce a signature. ... developers can optionally configure session signers or agent signers that allow a server to sign within policy constraints without per-transaction user approval -- in those configurations, signing authority is shared between the user and the developer's backend according to the policies set."

### 3.6 Key expiry and the "agent" docs

Authorization keys (P-256) have no documented expiry field at creation (`/controls/authorization-keys/keys/create/key`).
The only time-bound keys are user authorization keys issued from a JWT (`expires_at` "The expiration time of the
authorization key in seconds since the epoch", `/controls/authorization-keys/keys/create/user/request`) and the Agent
CLI's ephemeral keys (`/recipes/agent-integrations/agent-authorization`: refresh token 30 days, access token 15 min,
"Users can list and revoke active agent authorizations at any time"). Time-bounding a server signer is therefore done
with a `system.current_unix_timestamp` policy condition (3.3), not with key expiry.

Agent wallets overview (https://docs.privy.io/wallets/overview/solutions/agent-wallets):
> "**Delegated signing** lets an agent transact on behalf of a user's existing wallet. Users grant the agent an authorization key with a defined scope via policies. the agent signs transactions within that scope, and the user can revoke access at any time."

That sentence is the design intent: Privy policies scope what a delegate may do *to the user's wallet*; they are not a
tool for a user to bind their own future self.

## 4. Typed-data dumps (what the policy engine actually receives)

Script: `/tmp/shield-spike/hl-typed-data.ts` (run with `bun run` from the repo root; no network, no real keys). It
constructs the real `ExchangeClient` from `node_modules/@nktkas/hyperliquid/esm/mod.js` with a spy wallet (viem
LocalAccount shape) that records the typed data it is asked to sign and returns a dummy signature, and a stub transport
that records the wire payload. Nonce fixed to `1757203200000`, `signatureChainId: "0x3e6"` (998, what the app's Privy
provider on HyperEVM testnet reports), `isTestnet: true` (so `source: "b"`). Full output: `/tmp/shield-spike/hl-typed-data.out`.

Common L1 envelope (identical for a, a', b, b', c, f, g; only `connectionId` differs):
```json
{
  "domain": { "name": "Exchange", "version": "1", "chainId": 1337, "verifyingContract": "0x0000000000000000000000000000000000000000" },
  "types": {
    "EIP712Domain": [ {"name":"name","type":"string"}, {"name":"version","type":"string"}, {"name":"chainId","type":"uint256"}, {"name":"verifyingContract","type":"address"} ],
    "Agent": [ {"name":"source","type":"string"}, {"name":"connectionId","type":"bytes32"} ]
  },
  "primaryType": "Agent",
  "message": { "source": "b", "connectionId": "<see table>" }
}
```

| Case | Wire `action` (what Hyperliquid receives; NOT visible to the signer) | `connectionId` (the only variable the policy sees) |
|---|---|---|
| (a) perps limit order, reduceOnly=true | `{"type":"order","orders":[{"a":0,"b":false,"p":"60000","s":"0.01","r":true,"t":{"limit":{"tif":"Ioc"}}}],"grouping":"na"}` | `0x48dae8d19376339d753b2437fa03a3237285fa98963e5a85aed60ccc44307fff` |
| (a') same order, reduceOnly=false | `{"type":"order","orders":[{"a":0,"b":false,"p":"60000","s":"0.01","r":false,"t":{"limit":{"tif":"Ioc"}}}],"grouping":"na"}` | `0xb21e5dddb31ed6e0e24e917e0af339889f34eaa49a78c4be1c85c36f1b073b49` |
| (b) updateLeverage BTC cross 5x | `{"type":"updateLeverage","asset":0,"isCross":true,"leverage":5}` | `0x6244a6287bda2e49f437c24a315b29799d4720a31a91128501a0cc78799f3ec4` |
| (b') updateLeverage BTC cross 40x | `{"type":"updateLeverage","asset":0,"isCross":true,"leverage":40}` | `0x6d982f38fe3562e0d85aa7cf16fa2cf8f8a00db8e3f73ab8ae36bc5354ff6beb` |
| (c) spot order PURR/USDC (asset 10000) | `{"type":"order","orders":[{"a":10000,"b":true,"p":"0.5","s":"10","r":false,"t":{"limit":{"tif":"Gtc"}}}],"grouping":"na"}` | `0xb5249b2fee6308f99a4eb94f72880ec010857ab5bf10e31d0cce748ccf4f43db` |
| (f) cancel oid 12345 | `{"type":"cancel","cancels":[{"a":0,"o":12345}]}` | `0x41987b27814fec87e6e7698cb6d562608cc3c24e05339f8ad9e8a717a99d86f4` |
| (g) same as (a) with `expiresAfter: 1757203260000` | as (a), wire adds `"expiresAfter":1757203260000` | `0x1398cbd404a615049273ac3881017fe40994168eeb04b65bf7bdd7fb2a8f7336` |

For (a): `msgpack(action) = 0x83a474797065a56f72646572a66f72646572739186a16100a162c2a170a53630303030a173a4302e3031a172c3a17481a56c696d697481a3746966a3496f63a867726f7570696e67a26e61`;
the script recomputes `keccak256(msgpack(action) || nonce_be64 || 0x00)` and confirms it equals the `connectionId` handed
to the signer for every L1 case ("connectionId in typed data matches recomputed hash: true" x7). The single byte that
differs between (a) and (a') is `a172c3` vs `a172c2` (`"r": true` vs `false`) inside the msgpack, which becomes an
unrelated 32-byte hash.

(d) `usdSend` 5 USDC — the policy sees every field:
```json
{
  "domain": { "name": "HyperliquidSignTransaction", "version": "1", "chainId": 998, "verifyingContract": "0x0000000000000000000000000000000000000000" },
  "types": {
    "EIP712Domain": [ {"name":"name","type":"string"}, {"name":"version","type":"string"}, {"name":"chainId","type":"uint256"}, {"name":"verifyingContract","type":"address"} ],
    "HyperliquidTransaction:UsdSend": [ {"name":"hyperliquidChain","type":"string"}, {"name":"destination","type":"string"}, {"name":"amount","type":"string"}, {"name":"time","type":"uint64"} ]
  },
  "primaryType": "HyperliquidTransaction:UsdSend",
  "message": { "hyperliquidChain": "Testnet", "destination": "0x2222222222222222222222222222222222222222", "amount": "5", "time": 1757203200000 }
}
```
Wire: `{"type":"usdSend","signatureChainId":"0x3e6","hyperliquidChain":"Testnet","destination":"0x2222...2222","amount":"5","time":1757203200000}`.

(e) `approveAgent` — the policy sees `agentAddress` and `agentName` (including the `valid_until` suffix):
```json
{
  "domain": { "name": "HyperliquidSignTransaction", "version": "1", "chainId": 998, "verifyingContract": "0x0000000000000000000000000000000000000000" },
  "types": {
    "EIP712Domain": [ ... ],
    "HyperliquidTransaction:ApproveAgent": [ {"name":"hyperliquidChain","type":"string"}, {"name":"agentAddress","type":"address"}, {"name":"agentName","type":"string"}, {"name":"nonce","type":"uint64"} ]
  },
  "primaryType": "HyperliquidTransaction:ApproveAgent",
  "message": { "hyperliquidChain": "Testnet", "agentAddress": "0x3333333333333333333333333333333333333333", "agentName": "shield valid_until 1757300000000", "nonce": 1757203200000 }
}
```
Note: `amount` and `agentName` are EIP-712 `string`s, so numeric operators (`lte`) on them are string comparisons in
Privy's engine ("The policy engine evaluates numerical data exactly as passed in the request body"); a max-amount rule on
`usdSend.amount` must be validated on testnet before relying on it (experiment E6).

## 5. Previous research (2026-09-06) checked against current docs

| Claim | Status |
|---|---|
| Agent/API wallets sign only L1 actions via `Agent(string source, bytes32 connectionId)`, `connectionId` = hash of msgpack action | **Verified** (2.1, 4). Precise formula: `keccak256(msgpack(action) ‖ nonce_be64 ‖ (0x00 | 0x01‖vault20) ‖ [0x00‖expiresAfter_be64])`. |
| User-signed actions (withdraw3, usdSend, spotSend, sendAsset, approveAgent) need the master key and use plain EIP-712 with visible fields | **Verified** (2.2, 3.2, 4d/4e). Addendum: `agentSendAsset` is an L1 action an agent may sign, with destination pinned to source; `approveBuilderFee` also master-only. |
| Privy policies are enforced in Privy's TEE | **Verified with a caveat**: "By default, the trusted execution environment (secure enclave) enforces policies ... Privy enforces some policies at the API level. For example, limiting transfer sizes requires transaction simulation which runs outside the enclave today." Typed-data rules are enclave-side. |
| Privy users can export keys unless a quorum/owner setup prevents it | **Verified** (3.3). Export is owner-only, enabled by default, deniable by policy, or gated by a 2-of-2 owner quorum. |
| (Implicit) Privy might have a Hyperliquid-aware policy | **Refuted**: none exists; Privy's recipe explicitly scopes policies to user-signed actions. |

## 6. Credential-gated experiments (need `PRIVY_APP_SECRET`; ~10 minutes)

Preconditions: Privy app with server API access, one P-256 authorization key (`openssl ecparam -name prime256v1 -genkey
-noout -out private.pem && openssl ec -in private.pem -pubout -out public.pem`, then register the public key in Dashboard
-> Wallets -> Authorization keys), and the `privy-authorization-signature` header generated with
`generateAuthorizationSignature` from `@privy-io/node` for every owner-signed request. All calls use
`-u "$PRIVY_APP_ID:$PRIVY_APP_SECRET" -H "privy-app-id: $PRIVY_APP_ID" -H 'Content-Type: application/json'`.
The typed-data bodies below are copied verbatim from section 4 so the `types` maps match exactly.

E0. Create a server wallet owned by the auth key (so it is a legal HL master account for testnet).
```
POST https://api.privy.io/v1/wallets
{"chain_type":"ethereum","owner":{"public_key":"<DER base64 P-256 pubkey>"}}
```
Then fund it on testnet (`claimDrip` requires a mainnet-activated address; otherwise bridge 5 USDC on Arbitrum as in the Privy quickstart) — only needed if you want Hyperliquid to accept the signatures; the policy verdicts (E1-E5) do not need funds.

E1. Class-level control: DENY all L1 actions, ALLOW usdSend. Expected: (a) and (a') both rejected with a policy error; (d) signed.
```
POST https://api.privy.io/v1/policies
{"version":"1.0","name":"HL deny L1 allow usdSend","chain_type":"ethereum","owner":{"public_key":"<pubkey>"},
 "rules":[
  {"name":"deny all phantom-agent L1 actions","method":"eth_signTypedData_v4","action":"DENY",
   "conditions":[{"field_source":"ethereum_typed_data_domain","field":"chainId","operator":"eq","value":"1337"}]},
  {"name":"allow usdSend on testnet","method":"eth_signTypedData_v4","action":"ALLOW",
   "conditions":[{"field_source":"ethereum_typed_data_message","field":"hyperliquidChain","operator":"eq","value":"Testnet",
     "typed_data":{"primary_type":"HyperliquidTransaction:UsdSend","types":{
       "EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}],
       "HyperliquidTransaction:UsdSend":[{"name":"hyperliquidChain","type":"string"},{"name":"destination","type":"string"},{"name":"amount","type":"string"},{"name":"time","type":"uint64"}]}}}]}
 ]}
PATCH https://api.privy.io/v1/wallets/<wallet_id>   (owner-signed)
{"policy_ids":["<policy_id>"]}
POST https://api.privy.io/v1/wallets/<wallet_id>/rpc   (owner-signed)  -- run once with 4(a) and once with 4(a') and once with 4(d)
{"method":"eth_signTypedData_v4","params":{"typed_data":<paste the typed data object from section 4>}}
```

E2. Does the engine accept a `bytes32` field condition on `connectionId`? (Tests the only conceivable per-action allowlist.)
```
POST https://api.privy.io/v1/policies
{"version":"1.0","name":"HL allow one exact action","chain_type":"ethereum","owner":{"public_key":"<pubkey>"},
 "rules":[{"name":"allow exactly the reduce-only order hash","method":"eth_signTypedData_v4","action":"ALLOW",
   "conditions":[{"field_source":"ethereum_typed_data_message","field":"connectionId","operator":"eq",
     "value":"0x48dae8d19376339d753b2437fa03a3237285fa98963e5a85aed60ccc44307fff",
     "typed_data":{"primary_type":"Agent","types":{
       "EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}],
       "Agent":[{"name":"source","type":"string"},{"name":"connectionId","type":"bytes32"}]}}}]}]}
```
Expected: either a 400 on policy creation (bytes32 unsupported) or: 4(a) signed, 4(a') denied. Even if it works it is
a one-shot allowlist that needs a policy-owner-signed PATCH per trade, i.e. Shield's server pre-approves every action.

E3. Attempt to reference an order field (documents the negative). Same as E2 but `"field":"orders.0.r"` — expected 400
(`field` must be a path in the `Agent` message; there is no such field). Keep the error body as evidence.

E4. Export gating and policy self-protection. With the wallet owned by a 2-of-2 quorum
(`POST /v1/key_quorums {"public_keys":["<shield-pubkey>"],"user_ids":["<privy-user-id>"],"authorization_threshold":2}`, then
`PATCH /v1/wallets/<id> {"owner_id":"<quorum_id>"}`), call `POST /v1/wallets/<id>/export` with only the user's
signature (via `useAuthorizationSignature` on the client) — expected 401/403. Then `PATCH /v1/wallets/<id> {"policy_ids":[]}`
with only the user's signature — expected rejection; with both — expected success (this is the "wallet owner can
always detach a policy" fact from 3.5, and why the quorum, not the policy, is the binding element).

E5. Time-bound signer: add Shield's second key as an additional signer with the time-bound override policy from 3.3
(`PATCH /v1/wallets/<id> {"additional_signers":[{"signer_id":"<signer_quorum_id>","override_policy_ids":["<timebound_policy_id>"]}]}`),
set `value` to now+120s, sign 4(a) with that key before and after. Expected: signed, then denied.

E6. String-typed amount caps: rule `ALLOW HyperliquidTransaction:UsdSend where amount lte "10"`; sign 4(d) with
`amount:"5"`, `"9.5"`, `"100"`, `"2"`. Expected if lexicographic: "100" allowed (bug), "2" allowed, "9.5" allowed; if numeric:
"100" denied. Result determines whether Privy's engine can cap user-signed transfer sizes at all.

## 7. What is real, and what it would cost Shield

1. **Custody-side ratchet on user-signed actions is real** (Q7 partial, Q8, Q10 for delegates): a Privy policy can
   deny `withdraw3`, `spotSend`, `usdSend`, `sendAsset` to non-allowlisted destinations, deny `approveAgent` (or allow it
   only with `agentAddress in [Shield-known agents]` and `agentName ends_with`-style constraints), and time-bound a
   signer. This is exactly what Privy built the feature for. It complements ShieldVault (which gates the release of
   capital *into* the account) with control over movement *out of / around* the account.
2. **Trading-side ratchet via Privy policy is not real** (Q1-Q6): opaque hash, no decoder, no aggregation on typed data.
3. **The only enforceable trading ratchet is server co-signing with preimage verification**: make the Hyperliquid
   trading signer a Privy wallet whose owner (or the additional signer used for trading) is a quorum that requires a
   Shield authorization key; the client sends `{action, nonce, vaultAddress?, expiresAfter?}` alongside the Privy RPC
   payload; Shield recomputes `createL1ActionHash(...)`, checks it equals `message.connectionId`, evaluates its own risk
   rules on the plaintext action (reduce-only, leverage cap, notional cap, asset class), and only then produces the
   `privy-authorization-signature`. Privy's TEE guarantees the signature cannot be produced without Shield. Costs:
   Shield is a liveness dependency for every trade; the user is no longer sole owner (2-of-2 means no unilateral
   export or policy change — the point, but it contradicts the current "self-custodial" claim and the demo-key path);
   the HL master account must be created fresh inside Privy (an existing MetaMask master account can approve agents
   and trade directly forever); the user-signed `approveAgent` must be denied or Shield-gated; and Hyperliquid's nonce
   window (`(T-2 days, T+1 day)`) means a pre-signed action can be held and submitted later, so Shield should require
   `expiresAfter` in the hashed preimage and refuse to co-sign without it.
4. **Hyperliquid-native levers that need no Privy policy**: agent `valid_until` (<= 180 days) for a hard expiry of any
   delegated trading key; subaccounts (funds isolated, master-only `sendAsset` to move capital) so ShieldVault-released
   capital can land in a subaccount the trading agent controls while the master balance stays untouched; and
   `scheduleCancel` as a dead-man's switch. None of these limit exposure within the funded balance.

## 8. Open questions

- E2: whether Privy's engine accepts `eq`/`in`/`in_condition_set` on a `bytes32` typed-data field (docs only promise
  address fields for condition sets). If yes, a "pre-approved action hash" allowlist exists but is impractical (owner-signed
  policy PATCH per trade).
- E6: whether string-typed `amount` fields compare numerically; this decides whether Privy can cap `usdSend`/`withdraw3`
  sizes at all, or only allowlist destinations.
- Whether Privy's React SDK lets an app attach a *wallet-level* policy at embedded-wallet creation (`createWallet({signers})`
  attaches signer override policies; a wallet-level `policy_ids` at client-side creation is not documented). If not, any
  policy on a user-owned embedded wallet requires a user-signed PATCH and the user can undo it.
- Privy's "Privy enforces some policies at the API level" — which typed-data rules, if any, fall outside the enclave.
  The docs only name transfer-size simulation.
- Hyperliquid has not published a signed, structured order format that exposes fields to the signer; if it ever adds a
  user-signed `order` variant (as it did for `sendAsset` vs `agentSendAsset`), this analysis flips for that variant.
