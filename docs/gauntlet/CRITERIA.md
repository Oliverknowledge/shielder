# Verbatim sponsor criteria — ETHOnline 2026
Fetched 2026-09-06 from https://ethglobal.com/events/ethonline2026/prizes
This file is the ONLY authority for qualification. Do not work from memory.

## The Graph — $15,000 total

### Track: Best Use of Composable or Standardized Graph Products — $5,000 (1st $2,500 / 2nd $1,500 / 3rd $1,000)
Description: "Build on The Graph's composable and standardized data products. Use Standardized
Subgraphs (one shared schema across every protocol of a type) to run a single query across many
protocols, compose reusable Substreams packages into new pipelines, or layer the Subgraph MCP on
top for cross-protocol analysis."

Qualification requirements (verbatim):
- "Either compose two or more of The Graph's products, or build meaningfully on a standardized schema"
- "Consume live data from a Graph provider, for example Subgraph Studio for Subgraphs or The Graph Market for Substreams"
- "Simply querying one Subgraph with no composition or standardization does not qualify"
- "Authoring or extending a Standardized Subgraph, or contributing a reusable composable Substreams module, is in scope"
- "Make the standards leverage clear: show what became easier because a shared schema or composed product was used"
- "Submit a public repository and a short demo video (two to four minutes)"

### Track: Best AI Tooling or AI Use Case with The Graph (From Scratch) — $5,000 (1st $2,500 / 2nd $1,500 / 3rd $1,000)
Qualification requirements (verbatim):
- "Use The Graph as a load-bearing part of the project: either the AI tooling targets The Graph's products or AI Suite"
- "Consume live data from a Graph provider, for example querying Subgraphs with an API key from Subgraph Studio"
- "Do meaningful work with the data: reasoning, decisions, automation, or a natural-language interface"
- "Open-source the code with a clear README or SKILL.md so judges can run it"
- "Select the pool that matches how you built: Start Fresh for net-new, Continuity for extending an existing repo"
- "For the Substreams one-prompt deployment challenge: demonstrate deploying a working Substreams pipeline"

### Track: Best AI Tooling or AI Use Case (Continuity) — $5,000
Same as above but for extending an existing open-source repo. Shield is net-new => Start Fresh pool.

## Privy — $5,000 total

### Track: Best Financial Flow — $2,500
Description: "Build seamless experiences for funding, moving, trading, or spending digital assets with Privy."
Qualification requirements (verbatim):
- "Integrate Privy as a core part of the product"
- "Create or use at least one Privy wallet"
- "Complete at least one functional financial flow using a generally available Privy feature"
- "Eligible flows include transfers, bridging, stablecoin conversions, swaps, self-service Earn vaults, onramps"
- "Provide a working demo and access to the project's source code"
- "Clearly explain how Privy improves the user experience"
Note: Privy Cards require a mocked experience but a LIVE Privy flow is still required for eligibility.

### Track: Best B2B Financial Product — $2,500
Requires a B2B use case and Privy control primitives (policies, signers, quorums, intents). Shield is B2C;
this track is a stretch unless the "calm-you sets policy for tilted-you" framing is genuinely built on
Privy policies. Do NOT claim it unless the code actually uses them.

## Chainlink — $3,000 total

### Track: Best Confidential Workflow — $2,000 (up to 2 teams x $1,000)
Description: "Build a privacy-preserving Web3 application with Chainlink Runtime Environment (CRE)
Confidential Workflows. With Confidential Workflows, developers can designate sensitive parts of a CRE
Workflow to execute inside a hardware-isolated Trusted Execution Environment (TEE)."
Qualification requirements (verbatim):
- "Build a CRE Workflow that uses the Confidential Workflows to execute a meaningful part"
- "The workflow must register and use a confidential TEE handler, such as handlerInTee in TypeScript or cre.HandlerInTee"
- "The confidential portion must process at least one sensitive input, secret, confidential API response, private parameter"
- "The Confidential Workflow must be meaningfully integrated into the project's core functionality"
- "Demonstrate successful execution through simulation using the CRE CLI or live deployment on the CRE network"
- "Provide evidence of successful simulation or deployment in the submission, such as demo video or execution logs"

### Track: Best Chainlink-Powered Upgrade (Continuity) — $500
- "Integrate at least one Chainlink service directly within smart contract logic or onchain workflows"
- "The Chainlink integration must contribute to a state change on a blockchain"
- "The submission must clearly demonstrate how the Chainlink-powered upgrade improves the existing project"
Eligible tech: CRE, Price Feeds, Data Streams, Proof of Reserve, VRF.

### Track: Automated Liquidation Protection Challenge — $500
Out of scope for Shield (virtual ETH/USDC position on Sepolia, join() by deadline).
