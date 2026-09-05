import { motion, type Variants } from "motion/react";
import { usd } from "../lib/format";

/**
 * Capital moving from the protected treasury to the trading bankroll.
 * `phase` drives the story: idle -> moving -> done, or moving -> blocked
 * (the dot hits the wall and rebounds into the treasury).
 */
export function FlowScene({
  treasury,
  bankroll,
  amount,
  phase,
  bankrollLabel = "Trading bankroll",
}: {
  treasury: bigint;
  bankroll: bigint | null;
  amount: bigint;
  phase: "idle" | "moving" | "done" | "blocked";
  bankrollLabel?: string;
}) {
  const dotVariants: Variants = {
    idle: { left: "0%", opacity: 0 },
    moving: { left: ["0%", "50%", "100%"], opacity: [0, 1, 0], transition: { duration: 1.1, ease: "easeInOut", times: [0, 0.5, 1] } },
    done: { left: "100%", opacity: 0 },
    blocked: { left: ["0%", "48%", "0%"], opacity: [0, 1, 0], transition: { duration: 1.2, ease: ["easeIn", "easeOut"], times: [0, 0.45, 1] } },
  };

  return (
    <div className="flow-scene" aria-hidden>
      <div className="flow-box">
        <div className="eyebrow">Protected treasury</div>
        <div className="money-m">{usd(treasury)}</div>
      </div>
      <div className="flow-lane">
        <motion.div className={`flow-dot ${phase === "blocked" ? "blocked" : ""}`} variants={dotVariants} animate={phase} initial="idle" />
        <motion.div
          className="flow-wall"
          animate={phase === "blocked" ? { opacity: [0, 1, 1, 0.9], scaleY: [0.6, 1.1, 1, 1] } : { opacity: 0 }}
          transition={{ duration: 0.6, delay: phase === "blocked" ? 0.45 : 0 }}
        />
      </div>
      <div className="flow-box">
        <div className="eyebrow">{bankrollLabel}</div>
        <div className="money-m">{bankroll === null ? "—" : usd(bankroll)}</div>
        {amount > 0n && phase !== "idle" && (
          <div className={`tiny ${phase === "blocked" ? "" : "muted"}`} style={{ color: phase === "blocked" ? "var(--blocked)" : undefined }}>
            {phase === "blocked" ? `${usd(amount)} did not move` : phase === "done" ? `+${usd(amount)}` : `sending ${usd(amount)}`}
          </div>
        )}
      </div>
    </div>
  );
}
