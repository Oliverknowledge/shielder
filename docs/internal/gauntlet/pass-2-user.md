# Pass 2 — user gauntlet

Eight specialists, each holding one lens: a 19-year-old meeting the product cold;
a convenience extremist; an angry user actively trying to defeat it; someone who
just wants out; personalisation; information architecture; mobile; and design
plus the behavioural-science literature. They worked from screenshots of every
screen at 1280, 375 and 320 pixels, the rendered copy, and the source.

One methodological note worth keeping: `browse` runs a single shared browser, so
eight agents could not each drive the app. They analysed captured artefacts and
source instead, and I ran the interactive checks. That worked, with one gap —
the Welcome and Setup screens were never captured, because the harness was
already signed in and `Welcome.tsx` redirects. Findings about onboarding in this
pass come from reading the code, not from seeing it.

## The finding that mattered

Home showed **"+$5.06 realised today over 3 fills"** four inches from **"your
loss rule fired after $69.5 in losses"**. The blocked screen put the venue's
green session result directly beneath Shield's red one. Five of the eight agents
found it independently, and every one of them reached the same conclusion in the
same words: *one of these is a bug, and it locked my money using the broken one.*

Both numbers were real. Only one was right. The flow view books money that left
the vault and has not come back, and cannot tell capital that was lost from
capital that is still deployed — so a session that sent $100, got $30.50 back and
still held $246 at the venue read as a $69.50 loss, while Hyperliquid reported
the account **up $5.06 with no open positions**. Shield paused that account for
twelve hours. Twice.

That is the worst thing this product can do. The entire proposition is that the
rule is yours and it is fair; a user blocked while winning never believes it
again. Fixed by making the venue authoritative wherever it answers, with the flow
view kept as the fallback for an unreachable venue or a destination with no API.

## What else was verified and fixed

**Mobile — where being blocked actually happens.**
The cooldown countdown was hidden below 400px on both Home and Protection, so on
every phone a refusal came with no "when". The 90-second reset screen was fixed,
centred and unscrollable, putting its two buttons off the bottom of a 568px
phone with no way to reach them — that is the screen reached by tapping "I still
really want to trade". The tab bar laid four tabs in a five-column grid. On the
blocked screen every action sat below the evidence, and the countdown a screen
and a half down at 26px beneath a 40px decorative headline.

**Honesty.**
The landing page offered to "close a position, move idle capital back": Shield
has no order entry and cannot pull funds out of Hyperliquid. The reset screen
captioned its disabled buttons "Options unlock when the timer ends" — the exact
word a tilted user is hunting for, used to mean its opposite, in front of a
ninety-second wait that protected nothing, since the vault had already refused
and the capital could not move. "The trade will still exist in 90 seconds" is a
claim about the market Shield is in no position to make. Home labelled the whole
balance PROTECTED when only the floor is. Behaviour attributed the user's own
deposit to the trading venue.

**Friction pointing the wrong way.**
Getting safe required a two-second press-and-hold, on the one path the landing
page promises is instant. Every deposit cost two wallet prompts because the
approve was unconditional, on the one action Shield never gates. Onboarding
promised "one transaction" and then sent two or three, each with its own prompt,
at the highest-abandonment moment in the product.

**One bug with an ugly failure mode.** A single stale read could throw a
signed-in user into onboarding and offer to create the vault they already owned:
one load-balanced node answering `exists: false` was enough to null the vault. A
vault can genuinely disappear after an uninstall, so a disappearance now has to
be seen twice before it is believed.

## Judged and deliberately not changed

- **Merging Behaviour into Activity.** Argued well — the two screens show the
  same transactions with different labels. But it is a structural change six days
  out, on a product that works, and the risk outweighs the tidiness.
- **Rebuilding the Home hero around a two-segment bar.** Same reasoning. The
  label was corrected; the layout was left alone.
- **Personalised insight on the blocked screen** ("you normally reload 41 minutes
  after a loss; it's been 26"). The best idea in the pass, and the data is
  already computed. It needs the venue address sourced from the on-chain registry
  rather than localStorage, and that is a change worth making carefully rather
  than at speed.
- **Anything that made the product more of a wellbeing app.** Out of scope by
  instruction, and correctly so.

## What the agents said not to touch

Consistent across all eight, and worth recording so a later pass does not
"improve" it:

- The blocked sequence: `RELEASE BLOCKED` → **"Not tonight."** → *"You decided
  this before you started trading."* → the rule quoted in the user's own words →
  what is still protected. Four beats, right order, emotional weight on the right
  word.
- **"What is already in Hyperliquid is still yours to trade."** The most
  de-escalating sentence in the product.
- Making **"Open Hyperliquid"** the loudest button on Home. Pointing at the
  venue you are not competing with is the clearest trust signal in the app.
- Protection's monitor panel, which states the monitor's limits unprompted, in
  the exact place a user goes looking to kill it.
- The two one-line proofs at the foot of the blocked screen: present for the
  sceptic, small, mono, last.
