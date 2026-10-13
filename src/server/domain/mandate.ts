import { z } from "zod";

/**
 * Strategy mandate (plan §4). "Most profitable" is not a usable objective
 * by itself — raw return maximisation drifts into leverage, illiquid
 * tokens, and wash venues. The mandate stores a precise objective and
 * the constraints the user actually chose.
 *
 * Mandate versions are immutable rows (plan §7). A change never
 * overwrites history. The full payload is JSON-marshalled into the
 * `MandateVersion.payload` column; the row also carries a short
 * `summary` for the audit list (see `mandateSummary`).
 *
 * Backtests must deduct fees, slippage, and funding before reporting
 * any expected return. The mandate objective is judged on the book
 * after costs, against the user's risk budget, not on a single winning
 * trade (plan §9).
 */

/**
 * Objective. Default is "maximise expected return after costs, subject to
 * a volatility and drawdown budget". The user can switch the score to
 * absolute return, but the risk caps still bind.
 */
export const MandateObjective = {
  MaxReturnAfterCostsVolDd: "max-return-after-costs-vol-dd",
  AbsoluteReturn: "absolute-return",
} as const;
export type MandateObjective =
  (typeof MandateObjective)[keyof typeof MandateObjective];

/**
 * Allowed actions. `hold` is the no-op. `rebalance-spot` covers buy and
 * sell on a venue. `stake` and `unstake` cover the staking sleeve.
 * Lending and LP are opt-in sleeves (see `OptInSleevesSchema`).
 */
export const AllowedAction = {
  Hold: "hold",
  RebalanceSpot: "rebalance-spot",
  Stake: "stake",
  Unstake: "unstake",
} as const;
export type AllowedAction =
  (typeof AllowedAction)[keyof typeof AllowedAction];

/**
 * Risk budget, set by the user (plan §4).
 *
 * - `maxSingleAssetWeightBps`: cap on a single asset's weight in the
 *   book. Enforced by the concentration check.
 * - `maxStablecoinFloorBps`: minimum stablecoin weight; enforced by the
 *   concentration check on the short side.
 * - `maxVenueConcentrationBps`: cap on a single venue's share.
 * - `maxPortfolioDrawdownBps`: drawdown from peak that forces a de-risk
 *   to stables. Enforced by the drawdown check.
 * - `leverageCap`: default 1.0. Above 1.0 is an explicit opt-in and
 *   stays off in v1. Enforced by the leverage check.
 *
 * All bps values are integers in basis points (1% = 100 bps).
 */
export const RiskBudgetSchema = z.object({
  maxSingleAssetWeightBps: z.number().int().nonnegative(),
  maxStablecoinFloorBps: z.number().int().nonnegative(),
  maxVenueConcentrationBps: z.number().int().nonnegative(),
  maxPortfolioDrawdownBps: z.number().int().nonnegative(),
  leverageCap: z.number().positive().default(1.0),
});
export type RiskBudget = z.infer<typeof RiskBudgetSchema>;

/**
 * Opt-in sleeves (plan §4). Default off. Turning one on is a recorded
 * mandate change. The mandate version row stores who made the change
 * and when; the audit log replays against the version that was live.
 */
export const OptInSleevesSchema = z.object({
  lending: z.boolean().default(false),
  lp: z.boolean().default(false),
});
export type OptInSleeves = z.infer<typeof OptInSleevesSchema>;

/**
 * The full mandate payload. Stored as JSON in `MandateVersion.payload`.
 *
 * - `objective`: which score to maximise. Risk caps bind either way.
 * - `riskBudget`: the four caps plus leverage cap.
 * - `allowedActions`: which sides the policy engine may emit. An intent
 *   whose side is not in `allowedActions` is rejected by the universe
 *   check (conceptually — the universe check also covers asset ids).
 * - `optInSleeves`: lending / LP toggles.
 * - `bookCurrency`: a stablecoin the user picks, default USDC.
 * - `universe`: array of asset ids the book may hold. The universe is a
 *   list, not a prompt (plan §12). The AI may not invent assets.
 * - `version`: monotonically increasing per book; matches the
 *   `MandateVersion.version` column.
 */
export const MandateSchema = z.object({
  objective: z
    .enum([MandateObjective.MaxReturnAfterCostsVolDd, MandateObjective.AbsoluteReturn])
    .default(MandateObjective.MaxReturnAfterCostsVolDd),
  riskBudget: RiskBudgetSchema,
  allowedActions: z
    .array(
      z.enum([
        AllowedAction.Hold,
        AllowedAction.RebalanceSpot,
        AllowedAction.Stake,
        AllowedAction.Unstake,
      ]),
    )
    .min(1),
  optInSleeves: OptInSleevesSchema.default({ lending: false, lp: false }),
  bookCurrency: z.string().default("USDC"),
  universe: z.array(z.string().min(1)).min(1),
  version: z.number().int().positive(),
});
export type Mandate = z.infer<typeof MandateSchema>;

/**
 * Short human-readable summary for the audit list. Used by the
 * `MandateVersion.summary` column so a row of many mandates can be
 * scanned at a glance. One line; enough to identify the mandate.
 *
 * Example: `v3 max-return-after-costs-vol-dd USDC cap=1 sleeves=none universe=12`
 */
export function mandateSummary(m: Mandate): string {
  const sleeves: string[] = [];
  if (m.optInSleeves.lending) sleeves.push("lending");
  if (m.optInSleeves.lp) sleeves.push("lp");
  const sleeveStr = sleeves.length > 0 ? sleeves.join(",") : "none";
  return `v${m.version} ${m.objective} ${m.bookCurrency} cap=${m.riskBudget.leverageCap} sleeves=${sleeveStr} universe=${m.universe.length}`;
}
