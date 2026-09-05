# Demo script

Everything shown is real: a deployed program, real transactions, real
rejections you can open on the explorer, real indexed flows. No step
depends on an LLM. The only "actor" is a terminal command that makes the
trading-wallet stand-in send money back, which is exactly what a real venue
does.

## Pre-demo state (5 minutes, once)

```bash
scripts/deploy.sh local                                  # validator with the program (or: devnet, see HUMAN_ACTIONS)
SHIELD_RPC_URL=http://127.0.0.1:8899 bun run scripts/bootstrap-demo.ts   # $10,000 vault, Axiom + Ledger registered
bun run server/index.ts &                                # indexer + monitor + relayer on :8787
bun run dev:app &                                        # http://localhost:5173
```

In the browser: Welcome → "Continue with a demo key" → paste
`~/.config/solana/id.json` → Overview shows **$10,000 protected**. Have a
second terminal ready with `bun run client/demo.ts`. Keep the Overview open
in a 1280-wide window; keep a phone-width window ready for the mobile beat.

State checklist before recording: no cooldown, no pending changes, bankroll
$0, Behaviour shows $0 sent.

## 30-second pitch

"Crypto wallets protect your keys. Shield protects you from your own
decisions. You keep most of your capital in a treasury and trade from a
small bankroll. Refilling the bankroll is governed by rules you set while
calm: a floor, a daily limit, and a loss rule that reads your real on-chain
history. Tightening is instant. Loosening waits 24 hours. After a real
loss, the money simply cannot move. Solana program, The Graph for memory,
Chainlink CRE for a monitor even we can't lean on."

## 2-minute version (the video)

| Time | Screen | Do | Say |
|---|---|---|---|
| 0:00 | Overview | the capital bar: floor · refillable · trading, all green, "You can top up $2,000 more today" | "Wallets protect your keys. They don't protect you from yourself. This is $10,000 in a Shield treasury. $6,000 is a floor nothing can touch. $2,000 a day can go to my trading wallet." |
| 0:15 | Top up | type 1500, press Top up; watch the dot cross | "I move $1,500 to Axiom. Instant. Shield never gates trades, only refills." |
| 0:25 | terminal | `bun run client/demo.ts return 80` | "I trade. It goes badly. $80 comes back. That transfer is a plain SPL transfer; Axiom never talks to Shield." |
| 0:35 | Overview (auto-updates) | status flips to **Loss cooldown**; the refillable slice of the bar greys out; the strip reads "Top-ups paused until 6:02 PM · your loss rule fired after $1,420 in losses · 17h 59m" | "Within seconds The Graph pipeline sees $1,500 out, $80 back. My rule says: $1,000 realised loss pauses top-ups for 18 hours. A signed verdict lands on-chain. The vault armed the pause itself." |
| 0:50 | Top up | type 500, press Top up; the dot hits the wall and recoils; **"$500 stays protected."** with the reason, the countdown, the evidence lines and the rejection signature | "This isn't an alert. The program rejected it. That's the rejection signature. $8,580 stays protected. 17 hours 58 minutes." |
| 1:05 | Behaviour | "You sent $1,500 to Axiom. $80 came back." with the came-back/lost bar; What Shield noticed; tap Evidence | "Sent $1,500. $80 came back. Net −$1,420. Every number is a transaction, and the hash of this evidence is stored in the vault with the verdict." |
| 1:20 | Protection | Change daily limit → 3000: the sheet says **Activates in 24 hours**; schedule it; the **Weakening change scheduled** card counts down from 23:59:5x, "Your current $2,000 stays in force until then" | "Making myself less safe waits 24 hours, and I can cancel it the whole time." |
| 1:27 | Protection | Change floor → 7000: **Applies instantly** → Tighten now; the value flashes green and the pending weakening flips to **Superseded** | "Making myself safer is instant. And the moment I tighten anything, whatever I'd scheduled to weaken is thrown out. Tighten fast, loosen slowly." |
| 1:30 | Protection | Start the exit → 7 days pending | "Leaving entirely takes 7 days. Not trapped: just a decision instead of a reflex." |
| 1:38 | Protection | Move funds → $150 to Ledger → confirmed | "De-risking is always instant, even during the cooldown." |
| 1:46 | Activity | scroll the feed: the blocked top-up sits between the verdict and the tighten, with its rejection signature | "Every event, on-chain, with the verdict and its evidence. Even the top-up that didn't happen." |
| 1:53 | Overview | hold | "Shield turns your own history into protection future-you can't rage-click away." |

## 3–4 minute version

Add, after 1:05:

- **Setup wizard** (fresh key): "Where does your money go?" → "Choose your
  protection" → "Your rules, in plain English" → activate + deposit. Say:
  "Rules are written like a contract with yourself, then enforced by code."
- **Mobile**: the same Overview and the blocked state on a phone width.
- **Recovery**: in a terminal, `bun run client/recovery-cli.ts status
  <authority>` with the server killed. Say: "If Shield the company
  disappears, this CLI and an RPC URL are all you need. The rules still
  work; the exits still work."
- **Monitor trust**: `bun run cre/shield-risk/dryrun.ts` (or the CRE
  simulation once keyed): "The verdict is signed inside a Chainlink
  confidential workflow. Not even we can soften it for one user. And the
  vault only accepts a verdict that meets *your* trigger, for *your* pause
  length."
- **Tests**: `bun test` → 53 passing: "Every attack in the threat model has
  a test that runs the real program with a warpable clock."

## Fallbacks

- Server down: the Overview still shows the vault, floor, limit and cooldown
  from RPC; Behaviour says "unavailable". Say so, keep going; the top-up
  rejection still works because it's the program.
- Verdict not yet applied when you get to the top-up: press "Evaluate now"
  via `bun run client/demo.ts evaluate`, or wait one poll (4 s).
- Wallet extension trouble: use the demo key path; it signs locally and
  lands rejections on-chain with `skipPreflight`.
- Devnet RPC flaky: run the whole thing on the local validator; every
  explorer link works with `?cluster=custom`.

## Judge Q&A pre-empts

See `docs/JUDGE_QA.md`. The three to have ready: "isn't this just a
spending limit?", "can't the user bypass it?", "what if The Graph or
Chainlink is down?"
