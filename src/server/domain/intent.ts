import { z } from "zod";

/**
 * Intent — the ONLY shape the policy engine accepts (plan §3).
 *
 * The intent shape is fixed: asset, side, venue, notional, max slippage,
 * expiry, reason code. The intent is the contract the later AI service
 * plugs into. Model output is never executed as text — only the intent
 * schema is executable.
 *
 * Every intent carries a `clientId` for idempotency: retries cannot
 * double-fill (plan §10).
 */

/** Side of an intent. Includes the de-risk side `transfer-to-stables`. */
export const IntentSide = {
  Buy: "buy",
  Sell: "sell",
  Stake: "stake",
  Unstake: "unstake",
  TransferToStables: "transfer-to-stables",
} as const;
export type IntentSide = (typeof IntentSide)[keyof typeof IntentSide];

/**
 * Machine reason code. The audit log carries these short codes; the
 * human-readable explanation lives in the decision log entry's context
 * snapshot, not in a free-text blob on the intent itself.
 */
export const IntentReasonCode = {
  DriftRebalance: "drift-rebalance",
  DrawdownDeRisk: "drawdown-de-risk",
  ScheduledRebalance: "scheduled-rebalance",
  AIProposal: "ai-proposal",
  UserApprove: "user-approve",
} as const;
export type IntentReasonCode =
  (typeof IntentReasonCode)[keyof typeof IntentReasonCode];

/** Who proposed the intent. The policy engine treats them the same. */
export const IntentOrigin = {
  Rules: "rules",
  AI: "ai",
  User: "user",
} as const;
export type IntentOrigin = (typeof IntentOrigin)[keyof typeof IntentOrigin];

/**
 * Intent lifecycle. Only `signed` and `filled` are "live" in the executor
 * (see `isLive`). `kill-switched` is a terminal state set when the kill
 * switch fires after the intent was created but before it was filled.
 */
export const IntentStatus = {
  Pending: "pending",
  PolicyRejected: "policy-rejected",
  UserRejected: "user-rejected",
  Signed: "signed",
  Filled: "filled",
  Expired: "expired",
  KillSwitched: "kill-switched",
} as const;
export type IntentStatus =
  (typeof IntentStatus)[keyof typeof IntentStatus];

/**
 * Zod schema for an intent. Stored in the DB as a row; carried in the
 * PolicyContext snapshot for the decision log. `id` is a cuid generated
 * at intent-creation time. `clientId` is the idempotency key the caller
 * supplies; the DB enforces uniqueness on it.
 *
 * `notional` and `maxSlippageBps` are the only mutable fields after the
 * policy engine resizes an intent (the resized intent keeps the same
 * `id` and `clientId`).
 */
export const IntentSchema = z.object({
  id: z.string().min(1),
  clientId: z.string().min(1),
  bookId: z.string().min(1),
  assetId: z.string().min(1),
  side: z.enum([
    IntentSide.Buy,
    IntentSide.Sell,
    IntentSide.Stake,
    IntentSide.Unstake,
    IntentSide.TransferToStables,
  ]),
  venue: z.string().min(1),
  notional: z.string().min(1),
  maxSlippageBps: z.number().int().nonnegative(),
  expiresAt: z.date(),
  reasonCode: z.enum([
    IntentReasonCode.DriftRebalance,
    IntentReasonCode.DrawdownDeRisk,
    IntentReasonCode.ScheduledRebalance,
    IntentReasonCode.AIProposal,
    IntentReasonCode.UserApprove,
  ]),
  origin: z.enum([IntentOrigin.Rules, IntentOrigin.AI, IntentOrigin.User]),
  status: z
    .enum([
      IntentStatus.Pending,
      IntentStatus.PolicyRejected,
      IntentStatus.UserRejected,
      IntentStatus.Signed,
      IntentStatus.Filled,
      IntentStatus.Expired,
      IntentStatus.KillSwitched,
    ])
    .default(IntentStatus.Pending),
  createdAt: z.date(),
});

/** Inferred intent type — the executable contract. */
export type Intent = z.infer<typeof IntentSchema>;

/**
 * True only if the intent is `signed` or `filled`. Used by the executor
 * to filter the live set; used by the audit view to highlight in-flight
 * intents that have already crossed the policy gate.
 */
export function isLive(intent: Intent): boolean {
  return (
    intent.status === IntentStatus.Signed ||
    intent.status === IntentStatus.Filled
  );
}
