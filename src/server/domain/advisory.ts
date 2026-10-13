import { z } from "zod";
import type { RiskCategory } from "./bankroll";
import type { RegimeState } from "./regime";
import type { BankrollPrinciples } from "./bankroll";
import type { Sleeve } from "./bankroll";

/**
 * Advisory opinion (plan §3 — the AI is a proposer, not an executor).
 *
 * The AdvisoryOpinion is rådgivning, IKKE en executable intent. It
 * becomes intents ONLY after the policy gate AND either the owner's
 * approval (Confirm mode) OR the rules engine consuming it (Rules mode).
 *
 * Per the owner direction (Task 6): the advisor must produce:
 *   - AllocationAdvice per asset (where, how big, which risk category)
 *   - Opportunities    (proposed actions WITHIN principles)
 *   - Warnings          (proposed actions OUTSIDE principles; should be
 *                         rejected by the owner or by the policy gate)
 *
 * The opinion is regime-bevisst: it carries the regime state and the
 * corresponding target posture so the owner can see WHY the advice is
 * what it is. The summary is one sentence (posture: tilt / defensive /
 * neutral).
 *
 * Math caveat: in v0 we compute NAV, sleeve weights, and deltas using
 * JS Number. The values are small (~$250k NAV) and the demo is meant
 * for review only. PRODUCTION code MUST use a fixed-point decimal lib
 * (decimal.js or bignumber.js) for any money arithmetic — JS Number is
 * IEEE-754 double and accumulates rounding error at the bps level.
 * (We do NOT install a decimal lib in v0; this is the JSDoc warning.)
 */

/**
 * Allocation advice for one asset — proposed action + delta.
 *
 *   - `action`: "add" (buy more), "reduce" (sell some), "hold" (no
 *      change), "exit" (sell all). The advisor emits "exit" only when
 *      an asset is outside the universe or below a meaningful floor.
 *   - `currentWeightBps` / `targetWeightBps`: the weights the advisor
 *      is comparing. `target` is derived from regime posture, broken
 *      down to the asset level (proportional to current intra-sleeve
 *      weights — preserves relative bets inside a sleeve).
 *   - `deltaBps`       : target - current, in bps. May be negative for
 *      "reduce". Clamped to ±maxSingleBetBps per trade.
 *   - `notionalChange` : delta × NAV / 10000, in book currency. String
 *      for fixed-point display. Negative for "reduce".
 *   - `reason`         : one sentence — why this action.
 */
export const AllocationAdviceSchema = z.object({
  assetId: z.string().min(1),
  riskCategory: z.enum([
    "stable",
    "conservative",
    "balanced",
    "aggressive",
  ]),
  action: z.enum(["add", "reduce", "hold", "exit"]),
  currentWeightBps: z.number().int(),
  targetWeightBps: z.number().int(),
  deltaBps: z.number().int(),
  notionalChange: z.string(),
  reason: z.string().min(1),
});
export type AllocationAdvice = z.infer<typeof AllocationAdviceSchema>;

/**
 * Opportunity — a proposed action WITHIN principles (owner direction).
 *
 * Distinct from a Warning: an Opportunity is something the owner MAY
 * want to do; a Warning is something the owner SHOULD NOT do. The
 * policy gate would accept an opportunity-shaped intent (subject to
 * the normal checks); a warning-shaped intent would be rejected.
 *
 *   - `expectedEdgeBps` : the advisor's estimate of the edge over the
 *      bench (risk-free stable yield). Subjective in v0 — review-only.
 *   - `window`          : how long the opportunity is likely to last.
 *      "now" = deploy this cycle; "this-week" = within 7 days;
 *      "this-month" = within 30 days.
 *   - `confidence`     : 0..1 — the advisor's confidence in the call.
 */
export const OpportunitySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  assetId: z.string().optional(),
  riskCategory: z
    .enum(["stable", "conservative", "balanced", "aggressive"])
    .optional(),
  expectedEdgeBps: z.number().int(),
  window: z.enum(["now", "this-week", "this-month"]),
  confidence: z.number().min(0).max(1),
});
export type Opportunity = z.infer<typeof OpportunitySchema>;

/**
 * Warning — a proposed action OUTSIDE principles (owner direction).
 *
 * Warnings are SEPARATE from Opportunities. The owner's words:
 *   "advarsler i mod handlingar der falder ude for principper som 30%
 *    'tør krudt' ... og lignende regler for et stabilt profit."
 *
 * Severity:
 *   - info     : informational — not a breach, but worth surfacing
 *                (e.g. an asset fell back to the aggressive default
 *                because it was not in the categorisation table).
 *   - warn     : a soft breach — the book is outside principles but
 *                recoverable by a normal rebalance (e.g. dry powder
 *                below the 30% floor but above the 20% critical line).
 *   - critical : a hard breach — the book is in a state the owner
 *                should force-de-risk out of (e.g. dry powder below
 *                critical, or leverage above the cap).
 *
 * `code` is a machine-stable identifier the UI groups by; `message`
 * and `remediation` are English prose.
 */
export const WarningSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["info", "warn", "critical"]),
  code: z.string().min(1),
  title: z.string().min(1),
  message: z.string().min(1),
  remediation: z.string().min(1),
});
export type Warning = z.infer<typeof WarningSchema>;

/**
 * Dry-powder status — the five-zone classification the advisor uses to
 * pick the right Warning severity and the right opportunity copy.
 *
 *   - above-target : stable weight > target  → deployable cushion.
 *   - at-target    : within ±50 bps of target  → healthy.
 *   - above-floor  : below target but above floor → no warning, but
 *                     the advisor should note dry powder is below target.
 *   - below-floor  : below floor but above critical → WARN severity.
 *   - critical     : below critical → CRITICAL severity; force de-risk.
 */
export const DryPowderStatus = {
  AboveTarget: "above-target",
  AtTarget: "at-target",
  AboveFloor: "above-floor",
  BelowFloor: "below-floor",
  Critical: "critical",
} as const;
export type DryPowderStatus =
  (typeof DryPowderStatus)[keyof typeof DryPowderStatus];

/**
 * AdvisoryOpinion — the proposer's full output for one book at one
 * moment. The BFF returns this verbatim; the UI renders it; the owner
 * acts on it. It is NOT executable.
 *
 * Field map:
 *   - `bookId`            : which book this opinion is for.
 *   - `asOf`             : when the snapshot was taken (regime observed,
 *                            marks pulled).
 *   - `regime`           : the regime state (regime + confidence + signals).
 *   - `principles`       : the bankroll principles used (so a later replay
 *                            can show what rules were live).
 *   - `nav`              : mark-to-book-currency NAV. String for fixed-point.
 *   - `sleeves`         : per-category slices with current + target + drift.
 *   - `dryPowderBps`    : current stable-sleeve weight (also in `sleeves`
 *                            but promoted for visibility).
 *   - `dryPowderStatus` : one of the five zones (see DryPowderStatus).
 *   - `houseEdgeBps`    : weighted edge per sleeve × sleeve weight
 *                            (see Advisor houseEdgeBps). Compared against
 *                            `principles.targetHouseEdgeBps` to gauge
 *                            whether posture is on-target for "stabilt
 *                            profit".
 *   - `allocationAdvice`: per-asset advice (one row per position).
 *   - `opportunities`  : WITHIN-principles proposals.
 *   - `warnings`        : OUTSIDE-principles proposals (should be rejected).
 *   - `summary`         : one sentence — regime + NAV + dry powder + edge
 *                            + posture (tilt / defensive / neutral).
 *
 * Validation: the schema composes the RegimeState, BankrollPrinciples,
 * and Sleeve schemas by referencing their zod objects. Production code
 * should `.parse()` the opinion before returning it from the BFF so a
 * malformed advisor output never reaches the UI.
 */
export const AdvisoryOpinionSchema = z.object({
  bookId: z.string().min(1),
  asOf: z.date(),
  regime: z.custom<RegimeState>((v) => typeof v === "object" && v !== null, {
    message: "regime must be a RegimeState object",
  }),
  principles: z.custom<BankrollPrinciples>(
    (v) => typeof v === "object" && v !== null,
    { message: "principles must be a BankrollPrinciples object" },
  ),
  nav: z.string().min(1),
  sleeves: z.array(
    z.custom<Sleeve>(
      (v) => typeof v === "object" && v !== null && "category" in v,
      { message: "each sleeve must be a Sleeve object" },
    ),
  ),
  dryPowderBps: z.number().int().min(0).max(10000),
  dryPowderStatus: z.enum([
    DryPowderStatus.AboveTarget,
    DryPowderStatus.AtTarget,
    DryPowderStatus.AboveFloor,
    DryPowderStatus.BelowFloor,
    DryPowderStatus.Critical,
  ]),
  houseEdgeBps: z.number(),
  allocationAdvice: z.array(AllocationAdviceSchema),
  opportunities: z.array(OpportunitySchema),
  warnings: z.array(WarningSchema),
  summary: z.string().min(1),
});
export type AdvisoryOpinion = z.infer<typeof AdvisoryOpinionSchema>;

/** Re-export the cycle-sensitive RiskCategory type for advisor callers. */
export type { RiskCategory };
