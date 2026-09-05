import { motion, type Variants } from "motion/react";
import { usd } from "../lib/format";

/**
 * Capital moving from the protected treasury to the trading wallet.
 * `phase` drives the story: idle -> moving -> done, or moving -> blocked
 * (the dot hits the wall and rebounds into the treasury).
 */
export function FlowScene({
  treasury,
  bankroll,
  amount,
  phase,
  bankrollLabel = "Trading wallet",
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
    blocked: { left: ["0%", "48%", "44%", "0%"], opacity: [0, 1, 1, 0], transition: { duration: 1.25, ease: ["easeIn", "easeOut", "easeInOut"], times: [0, 0.42, 0.5, 1] } },
  };

  return (
    <div className="flow-scene" aria-hidden>
      <div className="flow-box protect">
        <div className="lbl">Protected treasury</div>
        <div className="v">{usd(treasury)}</div>
        <div className="sub">{phase === "blocked" && amount > 0n ? "unchanged" : phase === "moving" && amount > 0n ? `−${usd(amount)}` : ""}</div>
      </div>
      <div className="flow-lane">
        <motion.div className={`flow-dot ${phase === "blocked" ? "blocked" : ""}`} variants={dotVariants} animate={phase} initial="idle" />
        <motion.div
          className="flow-wall"
          animate={phase === "blocked" ? { opacity: [0, 1, 1, 0.9], scaleY: [0.6, 1.15, 1, 1] } : { opacity: 0 }}
          transition={{ duration: 0.6, delay: phase === "blocked" ? 0.45 : 0 }}
        />
      </div>
      <motion.div
        className="flow-box trade"
        animate={phase === "blocked" ? { x: [0, 0, -4, 4, -2, 0], transition: { duration: 0.9, times: [0, 0.5, 0.6, 0.7, 0.85, 1] } } : phase === "done" ? { scale: [1, 1.02, 1], transition: { duration: 0.35 } } : { x: 0, scale: 1 }}
      >
        <div className="lbl">{bankrollLabel}</div>
        <div className="v">{bankroll === null ? "—" : usd(bankroll)}</div>
        <div className="sub" style={{ color: phase === "blocked" ? "var(--blocked)" : phase === "done" ? "var(--protect)" : undefined, fontWeight: phase === "idle" ? 400 : 500 }}>
          {amount > 0n && phase !== "idle" ? (phase === "blocked" ? `${usd(amount)} did not move` : phase === "done" ? `+${usd(amount)}` : `receiving ${usd(amount)}`) : ""}
        </div>
      </motion.div>
    </div>
  );
}
