import type { Intent } from "./intent";
import type { BookState, Mark } from "./book";
import type { Mandate } from "./mandate";
import type { EthicsList } from "./ethics";

/**
 * Policy verdict (plan §3, §6). The policy engine is a pure function from
 * book state plus mandate to allow / resize / reject.
 *
 *   allow   — intent passes the gate; the signer may sign.
 *   resize  — intent is too aggressive; the engine resizes it down and
 *             emits a new intent (id stays, only the resized intent
 *             moves forward).
 *   reject  — intent is rejected. The decision is still written to the
 *             append-only log.
 *
 * Verdict semantics are normative: the executor MUST NOT call the signer
 * on a `reject` verdict, and SHOULD treat a `resize` verdict as the
 * resized intent (signing the original notional is a contract violation).
 */
export const PolicyVerdict = {
  Allow: "allow",
  Resize: "resize",
  Reject: "reject",
} as const;
export type PolicyVerdict = (typeof PolicyVerdict)[keyof typeof PolicyVerdict];

/**
 * Named policy checks (plan §3, §10). The order is enforced by the
 * canonical engine in `services/policy-engine.ts`. The names are stable
 * so the audit log can be queried by check.
 *
 *   universe        — asset must be in `mandate.universe`.
 *   ethics          — hard excludes; AI may NOT override.
 *   concentration   — single-asset weight + venue concentration caps.
 *   drawdown        — drawdown from peak forces de-risk to stables.
 *   daily-turnover  — running turnover + this notional <= daily cap.
 *   venue-health    — venue must be healthy.
 *   leverage        — total exposure after the intent <= leverageCap.
 *   kill-switch     — if active, immediately reject with kill-switched.
 */
export const PolicyCheckName = {
  KillSwitch: "kill-switch",
  Universe: "universe",
  Ethics: "ethics",
  Concentration: "concentration",
  Drawdown: "drawdown",
  DailyTurnover: "daily-turnover",
  VenueHealth: "venue-health",
  Leverage: "leverage",
} as const;
export type PolicyCheckName =
  (typeof PolicyCheckName)[keyof typeof PolicyCheckName];

/**
 * A single check's result.
 *
 * - `verdict: "reject"` — the engine STOPS; the intent is rejected.
 * - `verdict: "resize"` — the engine continues; `resizeTo` carries the
 *   suggested new notional and (optionally) a tighter max slippage. The
 *   final resized intent is composed from all resize verdicts.
 * - `verdict: "allow"` — the check passed; the engine continues.
 *
 * `reason` is English prose, not a code. Machine codes live in the error
 * classes thrown when the executor acts on a reject.
 */
export interface PolicyCheckResult {
  name: PolicyCheckName;
  verdict: PolicyVerdict;
  reason: string;
  resizeTo?: {
    notional: string;
    maxSlippageBps?: number;
  };
}

/**
 * Everything the policy engine needs at decision time. The context is
 * snapshotted into the decision log (serialised as JSON in the
 * `DecisionLogEntry.context` column) so a later replay uses the same
 * inputs that were live that day.
 *
 * `dailyTurnoverSoFar` is a string (book currency) for fixed-point
 * precision. `killSwitchActive` duplicates `bookState.killSwitchActive`
 * so the snapshot is self-contained.
 */
export interface PolicyContext {
  bookState: BookState;
  mandate: Mandate;
  ethics: EthicsList;
  marks: Record<string, Mark>;
  dailyTurnoverSoFar: string;
  killSwitchActive: boolean;
}

/**
 * A complete policy decision. The intent id stays the same even when
 * the verdict is `resize`; the `resizedTo` field carries the new intent
 * that moves forward. `checks` is the ordered list of check results;
 * every check that ran is recorded (the engine stops at the first
 * `reject`, so checks after a reject are absent).
 *
 * `reason` is the human-readable summary used by the audit view. It is
 * the reason of the deciding check (the reject reason, the last resize
 * reason, or "All checks passed.").
 */
export interface PolicyDecision {
  intentId: string;
  verdict: PolicyVerdict;
  checks: PolicyCheckResult[];
  resizedTo?: Intent;
  reason: string;
  decidedAt: Date;
}
