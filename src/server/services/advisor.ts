import type { BookState, Mark } from "../domain/book";
import type { Mandate } from "../domain/mandate";
import type { RegimeState } from "../domain/regime";
import { MarketRegime, regimeStrategyPosture } from "../domain/regime";
import type { RiskCategory, Sleeve, BankrollPrinciples } from "../domain/bankroll";
import {
  RiskCategory as RC,
  RISK_CATEGORY_ORDER,
  categorizeAsset,
} from "../domain/bankroll";
import type {
  AdvisoryOpinion,
  AllocationAdvice,
  Opportunity,
  Warning,
} from "../domain/advisory";
import { DryPowderStatus } from "../domain/advisory";
import { AdvisoryOpinionSchema } from "../domain/advisory";

/**
 * Advisor — the rådgivningsmotor (owner direction, Task 6; plan §3).
 *
 * Advisor er PROPOSER, ikke executor. AdvisoryOpinion blir til intents
 * KUN etter policy-gate og eierens godkjenning (Confirm mode) eller
 * etter Rules-motoren konsumerer den (Rules mode). The advisor never
 * emits intents; it emits advice that someone else turns into intents.
 *
 * The advisor is regime-bevisst: it reads the RegimeState, picks the
 * target posture, and shapes the allocation advice + warnings + the
 * "house edge" estimate from that posture.
 *
 * Kasino-bankroll-principper (owner direction, Task 6):
 *   - The House always has edge — compounding is slow, risk is capped.
 *   - "Tør krudt" (dry powder) — stable sleeve ALWAYS >= 30% of NAV.
 *     Below 30% = WARNING; below 20% = CRITICAL (force de-risk).
 *   - Stable profit — grow value over time with low drawdown; backtests
 *     deduct fees, slippage, funding.
 *   - Warnings against actions OUTSIDE principles — separate from
 *     Opportunities.
 *
 * Math caveat: v0 uses JS Number for arithmetic. Production MUST use a
 * fixed-point decimal lib (decimal.js or bignumber.js). Do NOT install
 * a decimal lib in v0 — this is the JSDoc warning. Values are small
 * (~$250k NAV) and the demo is review-only.
 */

/** Input to the advisor — the four things it needs at decision time. */
export interface AdvisorInput {
  bookState: BookState;
  mandate: Mandate;
  regime: RegimeState;
  principles: BankrollPrinciples;
}

/** The advisor interface — one method, pure function. */
export interface Advisor {
  advise(input: AdvisorInput): AdvisoryOpinion;
}

// ---------------------------------------------------------------------------
// Edge per sleeve — review-only defaults (owner can override later).
// These are the "expected edge per rebalance cycle" for each sleeve as
// a fraction of the sleeve's notional, in basis points. The weighted
// sum (edge × weight / 10000) gives the book-level house edge.
// ---------------------------------------------------------------------------

const SLEEVE_EDGE_BPS: Record<RiskCategory, number> = {
  stable: 30, // ~3% APY stablecoin yield, ~12 cycles/year → ~30 bps/cycle
  conservative: 80, // BTC/ETH drift + carry
  balanced: 150, // higher growth, higher vol
  aggressive: 250, // small-cap upside; often negative in practice
};

/** Allocation drift threshold (bps). Within this band = "hold". */
const DRIFT_THRESHOLD_BPS = 500;

/** Bps tolerance for "at-target" dry powder classification. */
const AT_TARGET_TOLERANCE_BPS = 50;

// ---------------------------------------------------------------------------
// HouseAdvisor — real math, demo-ready.
// ---------------------------------------------------------------------------

/**
 * HouseAdvisor — the v0 advisor. Real math; no live data. Production
 * swaps the math for a fixed-point decimal lib but keeps the shape.
 */
export class HouseAdvisor implements Advisor {
  advise(input: AdvisorInput): AdvisoryOpinion {
    const { bookState, mandate, regime, principles } = input;

    // 1. NAV — mark-to-book-currency sum across all positions.
    const nav = this.computeNav(bookState);

    // 2. Sleeve grouping — categorize each asset, sum value per sleeve,
    //    compute current + target weights in bps.
    const sleeves = this.buildSleeves(bookState, regime, nav, principles);

    // 3. Dry powder status — five-zone classification.
    const stable = sleeves.find((s) => s.category === RC.Stable);
    const dryPowderBps = stable?.currentWeightBps ?? 0;
    const dryPowderStatus = this.classifyDryPowder(dryPowderBps, principles);

    // 4. Allocation advice per asset.
    const allocationAdvice = this.buildAllocationAdvice(
      bookState,
      mandate,
      sleeves,
      nav,
      principles,
    );

    // 5. Warnings — outside-principles proposals.
    const warnings = this.buildWarnings(
      bookState,
      mandate,
      sleeves,
      dryPowderBps,
      dryPowderStatus,
      principles,
    );

    // 6. Opportunities — within-principles proposals (regime-dependent).
    const opportunities = this.buildOpportunities(regime, dryPowderBps, principles);

    // 7. House edge — weighted sum of (sleeve.edge × sleeve.weight).
    const houseEdgeBps = this.computeHouseEdge(sleeves);

    // 8. Summary — one sentence.
    const summary = this.buildSummary(regime, nav, dryPowderBps, houseEdgeBps);

    const opinion: AdvisoryOpinion = {
      bookId: bookState.bookId,
      asOf: bookState.asOf,
      regime,
      principles,
      nav: this.formatMoney(nav),
      sleeves,
      dryPowderBps,
      dryPowderStatus,
      houseEdgeBps,
      allocationAdvice,
      opportunities,
      warnings,
      summary,
    };

    // Validate before returning — a malformed opinion never reaches the UI.
    return AdvisoryOpinionSchema.parse(opinion);
  }

  // -----------------------------------------------------------------------
  // NAV.
  // -----------------------------------------------------------------------

  /**
   * Compute NAV = sum of (position.quantity × mark.price) for every
   * position, in book currency. The book currency itself is a position
   * with mark price = 1.0 (set by the demo book). If a position has no
   * mark, its value is 0 — but the advisor also emits a warning for it
   * (see buildWarnings).
   */
  private computeNav(bookState: BookState): number {
    let nav = 0;
    for (const position of bookState.positions) {
      const mark = bookState.marks[position.assetId];
      const price = mark ? Number(mark.price) : 0;
      const qty = Number(position.quantity);
      nav += qty * price;
    }
    return nav;
  }

  // -----------------------------------------------------------------------
  // Sleeves.
  // -----------------------------------------------------------------------

  /**
   * Build the four sleeves (stable / conservative / balanced /
   * aggressive). For each:
   *   - collect the assets held in that sleeve
   *   - sum their mark-to-book-currency value
   *   - convert to bps of NAV
   *   - look up the regime posture target and convert to bps
   *   - apply the sleeve-specific floor (stable) and cap (aggressive)
   */
  private buildSleeves(
    bookState: BookState,
    regime: RegimeState,
    nav: number,
    principles: BankrollPrinciples,
  ): Sleeve[] {
    if (nav <= 0) {
      // Degenerate: zero NAV. Return empty sleeves with zero weights so
      // the opinion is still schema-valid.
      return RISK_CATEGORY_ORDER.map((category) => ({
        category,
        assets: [],
        targetWeightBps: 0,
        currentWeightBps: 0,
      }));
    }

    const posture = regimeStrategyPosture(regime.regime);
    const targetByCategory: Record<RiskCategory, number> = {
      stable: Math.round(posture.stable * 10000),
      conservative: Math.round(posture.conservative * 10000),
      balanced: Math.round(posture.balanced * 10000),
      aggressive: Math.round(posture.aggressive * 10000),
    };

    // Bucket each position by its risk category.
    const assetsByCategory: Record<RiskCategory, string[]> = {
      stable: [],
      conservative: [],
      balanced: [],
      aggressive: [],
    };
    const valueByCategory: Record<RiskCategory, number> = {
      stable: 0,
      conservative: 0,
      balanced: 0,
      aggressive: 0,
    };

    for (const position of bookState.positions) {
      const category = categorizeAsset(position.assetId);
      const mark = bookState.marks[position.assetId];
      const price = mark ? Number(mark.price) : 0;
      const qty = Number(position.quantity);
      const value = qty * price;
      if (!assetsByCategory[category].includes(position.assetId)) {
        assetsByCategory[category].push(position.assetId);
      }
      valueByCategory[category] += value;
    }

    return RISK_CATEGORY_ORDER.map((category) => {
      const currentBps = Math.round((valueByCategory[category] / nav) * 10000);
      const sleeve: Sleeve = {
        category,
        assets: assetsByCategory[category],
        targetWeightBps: targetByCategory[category],
        currentWeightBps: currentBps,
      };
      // Propagate the principle-level floor/cap onto the sleeve so the
      // opinion is self-contained — a later replay does not need the
      // principles object to know what the floor was for the stable
      // sleeve or what the cap was for the aggressive sleeve.
      if (category === RC.Stable) {
        sleeve.floorBps = principles.dryPowderFloorBps;
      }
      if (category === RC.Aggressive) {
        sleeve.capBps = principles.maxAggressiveWeightBps;
      }
      return sleeve;
    });
  }

  // -----------------------------------------------------------------------
  // Dry powder status.
  // -----------------------------------------------------------------------

  /**
   * Five-zone dry-powder classification. The advisor uses this to pick
   * the right Warning severity and the right Opportunity copy.
   */
  private classifyDryPowder(
    dryPowderBps: number,
    principles: BankrollPrinciples,
  ): DryPowderStatus {
    const { dryPowderFloorBps, dryPowderCriticalBps, dryPowderTargetBps } =
      principles;
    if (dryPowderBps < dryPowderCriticalBps) return DryPowderStatus.Critical;
    if (dryPowderBps < dryPowderFloorBps) return DryPowderStatus.BelowFloor;
    if (
      Math.abs(dryPowderBps - dryPowderTargetBps) <= AT_TARGET_TOLERANCE_BPS
    ) {
      return DryPowderStatus.AtTarget;
    }
    if (dryPowderBps > dryPowderTargetBps) return DryPowderStatus.AboveTarget;
    return DryPowderStatus.AboveFloor;
  }

  // -----------------------------------------------------------------------
  // Allocation advice per asset.
  // -----------------------------------------------------------------------

  /**
   * Per-asset allocation advice. For each asset held:
   *   - look up the sleeve and the sleeve's target weight.
   *   - distribute the sleeve target across the sleeve's assets
   *     proportional to their current intra-sleeve weights (preserves
   *     relative bets inside a sleeve).
   *   - compute the per-asset target weight in bps.
   *   - compute drift = target - current.
   *   - if drift > +500 bps → "add", delta = +min(drift, maxSingleBetBps)
   *   - if drift < -500 bps → "reduce", delta = -min(|drift|, maxSingleBetBps)
   *   - else → "hold", delta = 0.
   *   - if the asset is NOT in the mandate universe → "exit" instead.
   *
   * notionalChange = (delta/10000) × NAV, formatted as a money string.
   */
  private buildAllocationAdvice(
    bookState: BookState,
    mandate: Mandate,
    sleeves: Sleeve[],
    nav: number,
    principles: BankrollPrinciples,
  ): AllocationAdvice[] {
    if (nav <= 0) return [];

    // Per-sleeve: total current value (so we can proportion the target).
    const valueByCategory = this.valueByCategory(bookState);
    const advice: AllocationAdvice[] = [];

    for (const position of bookState.positions) {
      const mark = bookState.marks[position.assetId];
      const price = mark ? Number(mark.price) : 0;
      const qty = Number(position.quantity);
      const value = qty * price;
      const currentBps = Math.round((value / nav) * 10000);

      const category = categorizeAsset(position.assetId);
      const sleeve = sleeves.find((s) => s.category === category);
      if (!sleeve) continue; // unreachable: every position has a category

      // Distribute sleeve target proportional to intra-sleeve value.
      const sleeveValue = valueByCategory[category];
      const intraShare = sleeveValue > 0 ? value / sleeveValue : 0;
      const targetBps = Math.round(sleeve.targetWeightBps * intraShare);

      const driftBps = targetBps - currentBps;

      // Universe check — assets outside the universe get "exit".
      const inUniverse = mandate.universe.includes(position.assetId);

      let action: AllocationAdvice["action"];
      let deltaBps: number;
      let reason: string;

      if (!inUniverse) {
        action = "exit";
        deltaBps = -currentBps;
        reason = `${position.assetId} is not in the mandate universe; exit recommended.`;
      } else if (driftBps > DRIFT_THRESHOLD_BPS) {
        action = "add";
        deltaBps = Math.min(driftBps, principles.maxSingleBetBps);
        reason = `${position.assetId} below ${category} target by ${driftBps} bps; add up to max bet.`;
      } else if (driftBps < -DRIFT_THRESHOLD_BPS) {
        action = "reduce";
        deltaBps = -Math.min(-driftBps, principles.maxSingleBetBps);
        reason = `${position.assetId} above ${category} target by ${-driftBps} bps; reduce toward target.`;
      } else {
        action = "hold";
        deltaBps = 0;
        reason = `${position.assetId} within ${DRIFT_THRESHOLD_BPS} bps of ${category} target; hold.`;
      }

      const notionalChange = (deltaBps / 10000) * nav;

      advice.push({
        assetId: position.assetId,
        riskCategory: category,
        action,
        currentWeightBps: currentBps,
        targetWeightBps: targetBps,
        deltaBps,
        notionalChange: this.formatSignedMoney(notionalChange),
        reason,
      });
    }

    return advice;
  }

  /** Sum of mark-to-book-currency value per risk category. */
  private valueByCategory(bookState: BookState): Record<RiskCategory, number> {
    const out: Record<RiskCategory, number> = {
      stable: 0,
      conservative: 0,
      balanced: 0,
      aggressive: 0,
    };
    for (const position of bookState.positions) {
      const mark = bookState.marks[position.assetId];
      const price = mark ? Number(mark.price) : 0;
      const qty = Number(position.quantity);
      out[categorizeAsset(position.assetId)] += qty * price;
    }
    return out;
  }

  // -----------------------------------------------------------------------
  // Warnings.
  // -----------------------------------------------------------------------

  /**
   * Warnings — outside-principles proposals. The owner SHOULD reject
   * whatever the warning flags. Severity:
   *   - critical : force de-risk (dry powder < critical, leverage > cap)
   *   - warn     : soft breach (dry powder < floor, single-asset > cap,
   *                 aggressive > cap)
   *   - info     : informational (uncategorized asset)
   */
  private buildWarnings(
    bookState: BookState,
    mandate: Mandate,
    sleeves: Sleeve[],
    dryPowderBps: number,
    dryPowderStatus: DryPowderStatus,
    principles: BankrollPrinciples,
  ): Warning[] {
    const warnings: Warning[] = [];

    // Dry powder — critical and floor.
    if (dryPowderStatus === DryPowderStatus.Critical) {
      warnings.push({
        id: "warn-dry-powder-critical",
        severity: "critical",
        code: "dry-powder-critical",
        title: "Dry powder under critical threshold",
        message: `Stable sleeve at ${dryPowderBps} bps is below the critical ${principles.dryPowderCriticalBps} bps threshold. Force de-risk to stables.`,
        remediation:
          "Reduce conservative + balanced + aggressive sleeves immediately; route proceeds into stables until dry powder >= dryPowderFloorBps.",
      });
    } else if (dryPowderStatus === DryPowderStatus.BelowFloor) {
      warnings.push({
        id: "warn-dry-powder-floor",
        severity: "warn",
        code: "dry-powder-floor",
        title: "Dry powder under 30% floor",
        message: `Stable sleeve at ${dryPowderBps} bps is below the 30% floor (${principles.dryPowderFloorBps} bps). The book is outside the dry-powder principle.`,
        remediation:
          "Trim a portion of the balanced/aggressive sleeve toward stables at the next rebalance.",
      });
    }

    // Single-asset concentration.
    const maxSingle = mandate.riskBudget.maxSingleAssetWeightBps;
    const nav = this.computeNav(bookState);
    if (nav > 0) {
      const valueByAsset: Record<string, number> = {};
      for (const position of bookState.positions) {
        const mark = bookState.marks[position.assetId];
        const price = mark ? Number(mark.price) : 0;
        const qty = Number(position.quantity);
        valueByAsset[position.assetId] =
          (valueByAsset[position.assetId] ?? 0) + qty * price;
      }
      for (const [assetId, value] of Object.entries(valueByAsset)) {
        const bps = Math.round((value / nav) * 10000);
        if (bps > maxSingle) {
          warnings.push({
            id: `warn-concentration-${assetId}`,
            severity: "warn",
            code: "concentration-single-asset",
            title: `${assetId} above single-asset cap`,
            message: `${assetId} at ${bps} bps exceeds the mandate single-asset cap of ${maxSingle} bps.`,
            remediation: `Reduce ${assetId} toward the cap at the next rebalance.`,
          });
        }
      }
    }

    // Aggressive sleeve above cap.
    const aggressive = sleeves.find((s) => s.category === RC.Aggressive);
    if (aggressive && aggressive.currentWeightBps > principles.maxAggressiveWeightBps) {
      warnings.push({
        id: "warn-aggressive-cap",
        severity: "warn",
        code: "aggressive-cap",
        title: "Aggressive sleeve above cap",
        message: `Aggressive sleeve at ${aggressive.currentWeightBps} bps exceeds the v1 cap of ${principles.maxAggressiveWeightBps} bps.`,
        remediation: "Trim aggressive-sleeve positions down to the cap.",
      });
    }

    // Leverage above cap. (v1 cap is 1.0 — anything above is a hard
    // breach. v0 does not compute leverage from positions directly —
    // we surface the principle and leave the real calc to Phase 2.)
    if (mandate.riskBudget.leverageCap > principles.leverageCap) {
      // Mandate allows more than principles — flag as critical.
      warnings.push({
        id: "warn-leverage-cap",
        severity: "critical",
        code: "leverage-cap",
        title: "Leverage above principles cap",
        message: `Mandate leverageCap ${mandate.riskBudget.leverageCap} exceeds principles cap ${principles.leverageCap}. v1 keeps leverage at 1.0 (off).`,
        remediation:
          "Lower the mandate leverageCap to 1.0; >1.0 is opt-in and OFF in v1.",
      });
    }

    // Uncategorized assets — info. categorizeAsset defaults to aggressive;
    // if an asset falls to the default because it is not in the known
    // mapping, surface it so the owner can place it deliberately.
    const knownAssets = new Set([
      "usdc", "usdt", "dai", "frax", "steth", "reth", "cbeth",
      "btc", "wbtc", "eth",
      "sol", "arb", "op", "avax", "uni", "aave", "ldo",
    ]);
    for (const position of bookState.positions) {
      if (!knownAssets.has(position.assetId.toLowerCase())) {
        warnings.push({
          id: `info-uncategorized-${position.assetId}`,
          severity: "info",
          code: "uncategorized-asset",
          title: `${position.assetId} not categorised`,
          message: `${position.assetId} defaulted to the aggressive sleeve because it is not in the categorisation table. The owner can move it as a recorded mandate change.`,
          remediation:
            "Review the asset; if it belongs in a lower-risk sleeve, record a mandate change moving it.",
        });
      }
    }

    return warnings;
  }

  // -----------------------------------------------------------------------
  // Opportunities (regime-dependent).
  // -----------------------------------------------------------------------

  /**
   * Opportunities — within-principles proposals. Subjective in v0; the
   * owner reviews and may convert to intents via the policy gate.
   *
   *   bull + dry powder > target → "Deploy dry powder: lift balanced."
   *   bear                          → "Raise dry powder toward 55%."
   *   ranging                       → "Harvest stable-sleeve yield (LP opt-in)."
   *   transitional                  → none.
   */
  private buildOpportunities(
    regime: RegimeState,
    dryPowderBps: number,
    principles: BankrollPrinciples,
  ): Opportunity[] {
    const opportunities: Opportunity[] = [];

    if (regime.regime === MarketRegime.Bull && dryPowderBps > principles.dryPowderTargetBps) {
      opportunities.push({
        id: "opp-deploy-dry-powder",
        title: "Deploy dry powder into balanced sleeve",
        description:
          "Bull regime with above-target dry powder. Move a portion of the stable sleeve toward the balanced target (SOL/ARB class) to capture trend.",
        riskCategory: RC.Balanced,
        expectedEdgeBps: 150,
        window: "this-week",
        confidence: 0.6,
      });
    }

    if (regime.regime === MarketRegime.Bear) {
      opportunities.push({
        id: "opp-raise-dry-powder",
        title: "Raise dry powder toward 55%",
        description:
          "Bear regime. Cut balanced/aggressive toward the floor; route proceeds into stables until dry powder approaches the 55% bear-posture target.",
        riskCategory: RC.Stable,
        expectedEdgeBps: 80,
        window: "now",
        confidence: 0.7,
      });
    }

    if (regime.regime === MarketRegime.Ranging) {
      opportunities.push({
        id: "opp-harvest-stable-yield",
        title: "Harvest stable-sleeve yield (LP opt-in)",
        description:
          "Ranging regime. Move a small slice of the stable sleeve into a known LP (opt-in sleeve) to harvest fees while mean-reversion persists.",
        riskCategory: RC.Stable,
        expectedEdgeBps: 60,
        window: "this-month",
        confidence: 0.5,
      });
    }

    return opportunities;
  }

  // -----------------------------------------------------------------------
  // House edge.
  // -----------------------------------------------------------------------

  /**
   * House edge — weighted sum of (sleeve.edge × sleeve.weight / 10000).
   * Hardcoded edges per sleeve are review-only defaults; Phase 5 will
   * derive them from backtests. The number is the expected growth per
   * rebalance cycle at current posture, in bps of NAV.
   */
  private computeHouseEdge(sleeves: Sleeve[]): number {
    let edge = 0;
    for (const sleeve of sleeves) {
      edge += SLEEVE_EDGE_BPS[sleeve.category] * sleeve.currentWeightBps / 10000;
    }
    return Math.round(edge * 100) / 100;
  }

  // -----------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------

  /**
   * One-sentence summary: regime + NAV + dry powder + house edge +
   * posture (tilt / defensive / neutral).
   */
  private buildSummary(
    regime: RegimeState,
    nav: number,
    dryPowderBps: number,
    houseEdgeBps: number,
  ): string {
    const posture =
      regime.regime === MarketRegime.Bull
        ? "tilt"
        : regime.regime === MarketRegime.Bear
        ? "defensive"
        : "neutral";
    const regimeCap = regime.regime.charAt(0).toUpperCase() + regime.regime.slice(1);
    return `${regimeCap} regime; NAV ${this.formatMoney(nav)}; dry powder ${(dryPowderBps / 100).toFixed(2)}%; house edge ${houseEdgeBps.toFixed(1)} bps — posture: ${posture}.`;
  }

  // -----------------------------------------------------------------------
  // Formatting helpers.
  // -----------------------------------------------------------------------

  /**
   * Format a money amount as a string with two decimals. Production
   * MUST use a fixed-point decimal lib; this Number-based formatter
   * is good enough for v0 review only.
   */
  private formatMoney(n: number): string {
    return n.toFixed(2);
  }

  /** Format a signed money amount (positive for adds, negative for reduces). */
  private formatSignedMoney(n: number): string {
    const sign = n >= 0 ? "+" : "-";
    return sign + Math.abs(n).toFixed(2);
  }
}

/**
 * Factory. Returns the v0 HouseAdvisor. A later phase can swap in a
 * different advisor (e.g. one that pulls backtest edges from a store)
 * by replacing this factory body.
 */
export function createAdvisor(): Advisor {
  return new HouseAdvisor();
}

/** Re-export so callers can import everything from the advisor module. */
export type { Mark };
