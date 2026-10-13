import { z } from "zod";

/**
 * Market regime detection (owner direction, Task 6; plan §4 risk budget).
 *
 * The owner's direction (Task 6):
 *   "holde øje med og lægge strategi i forhold til, hvilket marked
 *   (Bull, Bear or ranging) som er det pt. herskende trend"
 *
 * Strategy per regime (owner direction, Task 6):
 *   - Bull  : lift balanced/aggressive; reduce dry powder toward 30% floor.
 *   - Bear  : raise dry powder toward 55–60%; cut balanced/aggressive;
 *             keep conservative blue-chips only.
 *   - Ranging : harvest stable/LP-sleeve yield; neutral balanced weight;
 *               aggressive down.
 *
 * Regime detection is NOT a black-box LLM. It is deterministic, reviewable
 * signals — SMA-200 vs current price, 30/90-day momentum, realized
 * volatility, drawdown from peak. The owner can revise any signal. Until
 * Phase 1 Observe ships live market data, the DemoRegimeDetector returns
 * `ranging` with sample evidence so the advisor has something to chew on.
 */

/**
 * Market regime. transitional is the "signals disagree / unclear" state —
 * used when bull-weight and bear-weight are within a small band of each
 * other. The advisor treats transitional as defensive-leaning.
 */
export const MarketRegime = {
  Bull: "bull",
  Bear: "bear",
  Ranging: "ranging",
  Transitional: "transitional",
} as const;
export type MarketRegime = (typeof MarketRegime)[keyof typeof MarketRegime];

/**
 * One regime signal — an indicator with a direction and a weight.
 *
 * Example signals:
 *   - sma-200            : price vs 200-day SMA (golden/death cross-style).
 *   - momentum-30        : 30-day log-return.
 *   - realized-vol       : 60-day annualized realized vol. Reported as
 *                          a signal, NOT directly regime-determining —
 *                          high vol with up-trend is still bull.
 *   - drawdown-from-peak : bear if drawdown > 25%.
 *
 * `weight` is the signal's contribution to the regime vote (0..1). The
 * detector sums bull-weights and bear-weights separately and computes
 * confidence as (bull - bear) / total. Ties go to `ranging`; near-ties
 * go to `transitional`.
 */
export const RegimeSignalSchema = z.object({
  name: z.string().min(1),
  direction: z.enum(["bull", "bear", "neutral"]),
  evidence: z.string().min(1),
  weight: z.number().positive(),
});
export type RegimeSignal = z.infer<typeof RegimeSignalSchema>;

/**
 * The full regime state — the regime call, the confidence, and the
 * evidence trail. The evidence trail is what makes the call reviewable:
 * the owner can see WHICH signals pointed which way.
 *
 * `confidence` is in [0, 1]. It is the strength of the regime call, not
 * the strength of the trade — the advisor treats low confidence as
 * transitional regardless of which regime the signals point to.
 */
export const RegimeStateSchema = z.object({
  regime: z.enum([
    MarketRegime.Bull,
    MarketRegime.Bear,
    MarketRegime.Ranging,
    MarketRegime.Transitional,
  ]),
  confidence: z.number().min(0).max(1),
  signals: z.array(RegimeSignalSchema),
  observedAt: z.date(),
  summary: z.string().min(1),
});
export type RegimeState = z.infer<typeof RegimeStateSchema>;

/**
 * Target sleeve weights per regime (owner direction, Task 6).
 *
 * Returns decimals that sum to 1.00. The advisor multiplies by 10000 to
 * get basis points (bps) for the sleeve-level target. The owner can
 * override these via a mandate-level sleeve-target field (planned for a
 * later phase). Until then, the advisor uses these defaults verbatim.
 *
 * Posture rationale (owner direction):
 *   - bull         : deploy dry powder; lift balanced/aggressive.
 *                    stable at 30% floor; aggressive at 10% cap.
 *   - bear         : raise dry powder to 55%; cut balanced to 8% and
 *                    aggressive to 2%; keep conservative blue-chips.
 *   - ranging      : hold neutral posture; harvest stable-sleeve yield.
 *   - transitional : between calls; defensive-leaning. Slightly more
 *                    dry powder than ranging, slightly less aggressive.
 */
export function regimeStrategyPosture(
  regime: MarketRegime,
): Record<
  "stable" | "conservative" | "balanced" | "aggressive",
  number
> {
  switch (regime) {
    case MarketRegime.Bull:
      return {
        stable: 0.30,
        conservative: 0.40,
        balanced: 0.20,
        aggressive: 0.10,
      };
    case MarketRegime.Bear:
      return {
        stable: 0.55,
        conservative: 0.35,
        balanced: 0.08,
        aggressive: 0.02,
      };
    case MarketRegime.Ranging:
      return {
        stable: 0.40,
        conservative: 0.30,
        balanced: 0.20,
        aggressive: 0.10,
      };
    case MarketRegime.Transitional:
      return {
        stable: 0.45,
        conservative: 0.35,
        balanced: 0.15,
        aggressive: 0.05,
      };
  }
}
