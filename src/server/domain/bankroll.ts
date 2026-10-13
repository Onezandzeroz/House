import { z } from "zod";

/**
 * Bankroll principles — the kasino-bankroll rules (owner direction, Task 6;
 * plan §4 risk budget).
 *
 * Owner's words (Task 6):
 *   "Ligesom en bankroll manager for et kasino (der af Huset) skal den
 *   have fokus på at gro værdien af porteføljen og rådgive muligheder
 *   og advarsler i mod handlinger der falder ude for principper som
 *   30% 'tør krudt' (Stabil valuta) altid parat til en god handel."
 *
 * What this means in code:
 *   - The House always has edge — the app compounds slowly with capped
 *     risk. It does NOT chase single trades; it grows the house edge =
 *     expected growth rate at current posture.
 *   - "Tør krudt" (dry powder) — a stablecoin sleeve ALWAYS >= 30% of
 *     NAV, ready to deploy when a regime change or an opportunity
 *     arrives. Less than 30% = WARNING; under 20% = CRITICAL.
 *   - Stable profit — the objective is to grow value over time with
 *     low drawdown, not to maximise raw return. Backtests deduct
 *     fees, slippage, funding.
 *   - Warnings against actions OUTSIDE principles — emitted as Warning
 *     objects (separate from Opportunity). Warnings are proposals the
 *     owner SHOULD reject.
 *
 * Risk categories (owner direction: "hvor mange, hvor store og i hvilke
 * risiko kategori"):
 *   - stable       : stablecoins (USDC/USDT/DAI) + liquid staking
 *                    receipts (stETH/rETH/cbETH). This is dry powder.
 *                    Hard floor 30%.
 *   - conservative : blue-chip crypto (BTC, ETH, WBTC). Liquid, low vol.
 *   - balanced     : established L1/L2 tokens (SOL, ARB, OP, AVAX) and
 *                    DeFi blue-chips (UNI, AAVE, LDO).
 *   - aggressive   : smaller caps, LP positions, leverage (>1.0x is
 *                    opt-in, OFF in v1). Cap 10% in v1.
 */

/**
 * Risk category — the four sleeves. Maps 1:1 to the sleeves on the book.
 * Order is low-to-high risk; `RISK_CATEGORY_ORDER` is the canonical sort.
 */
export const RiskCategory = {
  Stable: "stable",
  Conservative: "conservative",
  Balanced: "balanced",
  Aggressive: "aggressive",
} as const;
export type RiskCategory = (typeof RiskCategory)[keyof typeof RiskCategory];

/**
 * Risk category order, low to high. Used to keep sleeve displays and
 * allocation tables in a stable order across the UI.
 */
export const RISK_CATEGORY_ORDER: RiskCategory[] = [
  RiskCategory.Stable,
  RiskCategory.Conservative,
  RiskCategory.Balanced,
  RiskCategory.Aggressive,
];

/**
 * One sleeve — a category's allocation slice on the book.
 *
 *   - `targetWeightBps`  : the posture target (from regimeStrategyPosture,
 *                            possibly overridden by mandate).
 *   - `currentWeightBps` : the actual mark-to-book-currency weight.
 *   - `floorBps`         : minimum weight (hard). Only the stable sleeve
 *                            has a floor (= dryPowderFloorBps).
 *   - `capBps`           : maximum weight. Aggressive has a cap
 *                            (= maxAggressiveWeightBps). Other sleeves
 *                            have no explicit cap in v1 — their effective
 *                            cap is the residual after the floor.
 *
 * Weights are integers in basis points (1% = 100 bps; max 10000 = 100%).
 */
export const SleeveSchema = z.object({
  category: z.enum([
    RiskCategory.Stable,
    RiskCategory.Conservative,
    RiskCategory.Balanced,
    RiskCategory.Aggressive,
  ]),
  assets: z.array(z.string().min(1)),
  targetWeightBps: z.number().int().min(0).max(10000),
  currentWeightBps: z.number().int().min(0).max(10000),
  floorBps: z.number().int().min(0).max(10000).optional(),
  capBps: z.number().int().min(0).max(10000).optional(),
});
export type Sleeve = z.infer<typeof SleeveSchema>;

/**
 * Bankroll principles — the kasino-bankroll rules. Owner-set; the
 * defaults below are reviewable. The advisor reads these to compute
 * dry-powder status and to emit warnings when the book breaches them.
 *
 *   - `dryPowderFloorBps` (default 3000 = 30%) — hard floor for the
 *      stable sleeve. Below this = WARNING (hard).
 *   - `dryPowderCriticalBps` (default 2000 = 20%) — under this = force
 *      de-risk. CRITICAL WARNING.
 *   - `dryPowderTargetBps` (default 3500 = 35%) — a small cushion above
 *      the floor. The advisor treats being at-target as healthy.
 *   - `maxSingleBetBps` (default 1000 = 10%) — kasino-style max bet
 *      size as fraction of NAV per trade. Per-trade notional is clamped
 *      to this so a single intent cannot move the book too far.
 *   - `kellyFraction` (default 0.25 = quarter-Kelly) — conservative
 *      sizing. Kelly criterion / 4 caps the bet size for volatile edges.
 *   - `maxAggressiveWeightBps` (default 1000 = 10%) — cap on the
 *      aggressive sleeve in v1. Above the cap = WARNING.
 *   - `leverageCap` (default 1.0) — over 1.0 is opt-in, OFF in v1.
 *      Leverage above the cap = CRITICAL WARNING.
 *   - `targetHouseEdgeBps` (default 50 = 0.5% per rebalance cycle) —
 *      the "stable profit" goal. Compared against the computed
 *      houseEdgeBps in the AdvisoryOpinion to gauge whether the current
 *      posture is growing the book at the target rate.
 *
 * Bps values are non-negative integers; leverageCap is a positive number
 * (1.0 means no leverage).
 */
export const BankrollPrinciplesSchema = z.object({
  dryPowderFloorBps: z.number().int().nonnegative().max(10000).default(3000),
  dryPowderCriticalBps: z.number().int().nonnegative().max(10000).default(2000),
  dryPowderTargetBps: z.number().int().nonnegative().max(10000).default(3500),
  maxSingleBetBps: z.number().int().nonnegative().max(10000).default(1000),
  kellyFraction: z.number().positive().max(1).default(0.25),
  maxAggressiveWeightBps: z
    .number()
    .int()
    .nonnegative()
    .max(10000)
    .default(1000),
  leverageCap: z.number().positive().default(1.0),
  targetHouseEdgeBps: z.number().int().nonnegative().max(10000).default(50),
});
export type BankrollPrinciples = z.infer<typeof BankrollPrinciplesSchema>;

/**
 * Asset -> risk category mapping (reviewable defaults).
 *
 * These are REVIEW-ONLY defaults. The owner can move an asset to a
 * different category as a recorded mandate change (a new MandateVersion
 * row, per plan §7). The default mapping is intentionally conservative:
 * unknown assets fall into the `aggressive` sleeve — the owner must
 * opt them down to a lower-risk sleeve deliberately.
 *
 * Mappings:
 *   stable       : USDC, USDT, DAI, FRAX, stETH, rETH, cbETH
 *                  (liquid staking receipts count as stable because
 *                   they trade ~1:1 with the underlying and can be
 *                   unwound to stables quickly).
 *   conservative : BTC, WBTC, ETH
 *   balanced     : SOL, ARB, OP, AVAX, UNI, AAVE, LDO
 *   aggressive   : everything else (default)
 */
const ASSET_CATEGORIES: Readonly<Record<string, RiskCategory>> = Object.freeze({
  // stable
  usdc: RiskCategory.Stable,
  usdt: RiskCategory.Stable,
  dai: RiskCategory.Stable,
  frax: RiskCategory.Stable,
  rlusd: RiskCategory.Stable, // Ripple's stablecoin
  steth: RiskCategory.Stable,
  reth: RiskCategory.Stable,
  cbeth: RiskCategory.Stable,
  // conservative
  btc: RiskCategory.Conservative,
  wbtc: RiskCategory.Conservative,
  eth: RiskCategory.Conservative,
  // balanced — established L1/L2 + DeFi blue-chips
  sol: RiskCategory.Balanced,
  arb: RiskCategory.Balanced,
  op: RiskCategory.Balanced,
  avax: RiskCategory.Balanced,
  uni: RiskCategory.Balanced,
  aave: RiskCategory.Balanced,
  ldo: RiskCategory.Balanced,
  // XRP-ecosystem L1s (per eier direction — default portfolio)
  xrp: RiskCategory.Balanced,
  xlm: RiskCategory.Balanced,
  flr: RiskCategory.Balanced,
});

/**
 * Categorize an asset by id. Case-insensitive. Unknown assets default
 * to `aggressive` — the owner must opt them down deliberately.
 *
 * This is a pure lookup; it has no side effects and no I/O. The advisor
 * calls it once per position. The mandate may carry overrides (planned
 * in a later phase); until then, this mapping is the single source of
 * truth for "which sleeve is this asset in".
 */
export function categorizeAsset(assetId: string): RiskCategory {
  return ASSET_CATEGORIES[assetId.toLowerCase()] ?? RiskCategory.Aggressive;
}
