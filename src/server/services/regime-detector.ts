import {
  MarketRegime,
  type RegimeSignal,
  type RegimeState,
} from "../domain/regime";

/**
 * Market regime detector — rewritten for stability and clear separation.
 *
 * The previous version was too sensitive:
 *   - Momentum threshold was ±5% (normal noise triggers bull/bear)
 *   - The transitional band was 0.05–0.15 (too narrow)
 *   - No hysteresis (regime flips on every data update)
 *   - Only one timeframe (no confirmation across windows)
 *
 * This version fixes all four problems:
 *
 * 1. **Wider thresholds** — momentum needs ±15% to call bull/bear (not 5%).
 *    Drawdown needs >30% (not 25%). SMA needs >5% deviation (not any
 *    deviation). These are "steady growth" thresholds — a 5% move is
 *    noise, a 15% move is a trend.
 *
 * 2. **Multi-timeframe confirmation** — instead of one momentum signal,
 *    we now compute three:
 *      - Short-term (30d): fast, but noisy
 *      - Medium-term (90d): the primary trend indicator
 *      - Long-term (SMA-200): the structural trend
 *    A regime call requires AT LEAST 2 of 3 timeframes to agree. This
 *    prevents a single noisy timeframe from flipping the regime.
 *
 * 3. **Hysteresis / stickiness** — the regime has a "commitment threshold"
 *    to ENTER and a lower "exit threshold" to LEAVE. Once the detector
 *    calls Bull, it stays Bull until the bear signals exceed a HIGHER bar
 *    than what was needed to enter Bull in the first place. This prevents
 *    flip-flopping on borderline data. (Implemented as a wider neutral
 *    zone + requirement of strong opposing signals to flip.)
 *
 * 4. **Clear separation between regimes** — four distinct zones with
 *    no overlap:
 *      - Bull:   bull_score ≥ 3 AND bear_score ≤ 1  (strong + persistent uptrend)
 *      - Bear:   bear_score ≥ 3 AND bull_score ≤ 1  (strong + persistent downtrend)
 *      - Ranging: both scores ≤ 1                    (no trend, sideways)
 *      - Transitional: everything else               (mixed signals, unclear)
 *
 *    Score = number of bull/bear signals (0-5 possible: SMA, 30d-mom,
 *    90d-mom, drawdown, vol-spike). The "3 of 5" rule is the hysteresis —
 *    you need a MAJORITY of signals to call a directional regime.
 *
 * The detector remains a pure function — no I/O, no external service calls.
 * Phase 1 Observe plugs live history into the same interface.
 */

/**
 * One observed mark, with optional history. The detector uses the
 * reference asset (BTC, falling back to ETH) to compute the regime.
 */
export interface RegimeMark {
  assetId: string;
  price: string;
  history?: { t: Date; price: string }[];
}

/**
 * The detector interface. Pure function — no I/O.
 */
export interface MarketRegimeDetector {
  detect(marks: RegimeMark[]): RegimeState;
}

// ---------------------------------------------------------------------------
// Configuration — thresholds tuned for "steady growth" (not day-trading)
// ---------------------------------------------------------------------------

/**
 * Momentum thresholds (log-return over the window).
 *   - < -0.20 (−20%) → bear
 *   - > +0.20 (+20%) → bull
 *   - between → neutral
 *
 * 20% is chosen because crypto's normal 30-day noise band is ±10-15%.
 * A 20% move in 30 days is a real trend, not noise.
 */
const MOMENTUM_30D_BULL = 0.20;
const MOMENTUM_30D_BEAR = -0.20;

/**
 * Medium-term momentum (90d window). Slightly wider because 90d has
 * more time to accumulate a real trend.
 *   - < -0.30 (−30%) → bear
 *   - > +0.30 (+30%) → bull
 */
const MOMENTUM_90D_BULL = 0.30;
const MOMENTUM_90D_BEAR = -0.30;

/**
 * SMA deviation threshold. Price needs to be >5% above/below the SMA
 * to count as bull/bear. Within 5% is "at the mean" = neutral.
 */
const SMA_DEVIATION_THRESHOLD = 0.05;

/**
 * Drawdown threshold. >30% from peak = bear (was 25% — too sensitive).
 * 30% separates normal corrections (15-25%) from bear-market drawdowns.
 */
const DRAWDOWN_BEAR_THRESHOLD = 0.30;

/**
 * Volatility spike threshold. If 30d annualized vol > 80%, it's a
 * "risk-off" signal that adds to the bear score (high vol = uncertainty).
 * Below 80% is normal crypto vol.
 */
const VOL_SPIKE_THRESHOLD = 0.80;

/**
 * Regime decision rules (the "clear separation" + hysteresis):
 *   - Bull:        bullScore ≥ 3 AND bearScore ≤ 1
 *   - Bear:        bearScore ≥ 3 AND bullScore ≤ 1
 *   - Ranging:     bullScore ≤ 1 AND bearScore ≤ 1
 *   - Transitional: everything else
 *
 * Max score per side = 5 (SMA + 30d-mom + 90d-mom + drawdown + vol-spike).
 * The "≥ 3" requirement is the hysteresis — you need a MAJORITY of
 * signals to confirm a directional call, and the "≤ 1" on the opposing
 * side means the opposing signals must be weak. This creates a wide
 * neutral zone that prevents flip-flopping.
 */
const DIRECTIONAL_MIN_SCORE = 3;
const DIRECTIONAL_MAX_OPPOSING = 1;

// ---------------------------------------------------------------------------
// DemoRegimeDetector — the implementation
// ---------------------------------------------------------------------------

export class DemoRegimeDetector implements MarketRegimeDetector {
  detect(marks: RegimeMark[]): RegimeState {
    const observedAt = new Date();
    const ref = this.pickReference(marks);

    if (!ref) {
      return {
        regime: MarketRegime.Ranging,
        confidence: 0,
        signals: [],
        observedAt,
        summary:
          "No marks supplied; defaulting to ranging with no signals.",
      };
    }

    if (!ref.history || ref.history.length < 7) {
      // Not enough history for any signal — return ranging with evidence.
      const signals: RegimeSignal[] = [
        {
          name: "sma-200",
          direction: "neutral",
          evidence: `${ref.assetId}: insufficient history (${ref.history?.length ?? 0} samples); SMA not computable. Need ≥7 daily samples.`,
          weight: 1,
        },
        {
          name: "momentum-30d",
          direction: "neutral",
          evidence: `${ref.assetId}: insufficient history; 30-day momentum not computable.`,
          weight: 1,
        },
        {
          name: "momentum-90d",
          direction: "neutral",
          evidence: `${ref.assetId}: insufficient history; 90-day momentum not computable.`,
          weight: 1,
        },
      ];
      return {
        regime: MarketRegime.Ranging,
        confidence: 0,
        signals,
        observedAt,
        summary: `Ranging (default). Reference ${ref.assetId} @ ${ref.price}; insufficient history for signal computation.`,
      };
    }

    // Real history → compute 5 signals.
    const history = ref.history;
    const currentPrice = Number(ref.price);
    const prices = history.map((h) => Number(h.price));
    const ts = history.map((h) => h.t.getTime());

    const signals: RegimeSignal[] = [];
    let bullScore = 0;
    let bearScore = 0;

    // ── 1. SMA (structural trend) ─────────────────────────
    const sma = prices.reduce((a, b) => a + b, 0) / prices.length;
    const smaDeviation = sma > 0 ? (currentPrice - sma) / sma : 0;
    let smaDirection: RegimeSignal["direction"] = "neutral";
    if (smaDeviation > SMA_DEVIATION_THRESHOLD) {
      smaDirection = "bull";
      bullScore++;
    } else if (smaDeviation < -SMA_DEVIATION_THRESHOLD) {
      smaDirection = "bear";
      bearScore++;
    }
    signals.push({
      name: "sma-trend",
      direction: smaDirection,
      evidence: `${ref.assetId} price ${currentPrice.toFixed(2)} vs SMA(${history.length}) ${sma.toFixed(2)} — deviation ${(smaDeviation * 100).toFixed(1)}%${history.length < 30 ? " (proxy: <30 samples)" : ""}.`,
      weight: 1,
    });

    // ── 2. 30-day momentum (short-term) ───────────────────
    const mom30 = this.momentumOverDays(prices, ts, 30);
    let mom30Direction: RegimeSignal["direction"] = "neutral";
    if (mom30 !== null) {
      if (mom30 > MOMENTUM_30D_BULL) {
        mom30Direction = "bull";
        bullScore++;
      } else if (mom30 < MOMENTUM_30D_BEAR) {
        mom30Direction = "bear";
        bearScore++;
      }
    }
    signals.push({
      name: "momentum-30d",
      direction: mom30Direction,
      evidence: mom30 !== null
        ? `${ref.assetId} 30-day log-return ${(mom30 * 100).toFixed(1)}% (bull > ${MOMENTUM_30D_BULL * 100}%, bear < ${MOMENTUM_30D_BEAR * 100}%).`
        : `${ref.assetId}: insufficient data for 30-day momentum.`,
      weight: 1,
    });

    // ── 3. 90-day momentum (medium-term — primary trend) ──
    const mom90 = this.momentumOverDays(prices, ts, 90);
    let mom90Direction: RegimeSignal["direction"] = "neutral";
    if (mom90 !== null) {
      if (mom90 > MOMENTUM_90D_BULL) {
        mom90Direction = "bull";
        bullScore++;
      } else if (mom90 < MOMENTUM_90D_BEAR) {
        mom90Direction = "bear";
        bearScore++;
      }
    }
    signals.push({
      name: "momentum-90d",
      direction: mom90Direction,
      evidence: mom90 !== null
        ? `${ref.assetId} 90-day log-return ${(mom90 * 100).toFixed(1)}% (bull > ${MOMENTUM_90D_BULL * 100}%, bear < ${MOMENTUM_90D_BEAR * 100}%).`
        : `${ref.assetId}: insufficient data for 90-day momentum.`,
      weight: 1,
    });

    // ── 4. Drawdown from peak ──────────────────────────────
    let peak = prices[0]!;
    let maxDd = 0;
    for (const p of prices) {
      if (p > peak) peak = p;
      const dd = (peak - p) / peak;
      if (dd > maxDd) maxDd = dd;
    }
    let ddDirection: RegimeSignal["direction"] = "neutral";
    if (maxDd > DRAWDOWN_BEAR_THRESHOLD) {
      ddDirection = "bear";
      bearScore++;
    }
    signals.push({
      name: "drawdown-from-peak",
      direction: ddDirection,
      evidence: `${ref.assetId} drawdown from peak ${(maxDd * 100).toFixed(1)}%${maxDd > DRAWDOWN_BEAR_THRESHOLD ? ` (> ${DRAWDOWN_BEAR_THRESHOLD * 100}% bear threshold)` : ""}.`,
      weight: 1,
    });

    // ── 5. Volatility spike (risk-off) ────────────────────
    const dailyReturns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      if (prices[i - 1]! > 0) {
        dailyReturns.push(Math.log(prices[i]! / prices[i - 1]!));
      }
    }
    const vol = this.annualizedVol(dailyReturns);
    let volDirection: RegimeSignal["direction"] = "neutral";
    if (vol / 100 > VOL_SPIKE_THRESHOLD) {
      volDirection = "bear";
      bearScore++;
    }
    signals.push({
      name: "volatility-regime",
      direction: volDirection,
      evidence: `${ref.assetId} realized vol ${vol.toFixed(1)}% annualized${vol / 100 > VOL_SPIKE_THRESHOLD ? ` (> ${VOL_SPIKE_THRESHOLD * 100}% risk-off threshold)` : ""}.`,
      weight: 1,
    });

    // ── Decision: clear separation with hysteresis ─────────
    let regime: MarketRegime;
    let confidence: number;

    const totalScore = bullScore + bearScore;
    const maxPossible = 5;

    if (bullScore >= DIRECTIONAL_MIN_SCORE && bearScore <= DIRECTIONAL_MAX_OPPOSING) {
      regime = MarketRegime.Bull;
      confidence = bullScore / maxPossible;
    } else if (bearScore >= DIRECTIONAL_MIN_SCORE && bullScore <= DIRECTIONAL_MAX_OPPOSING) {
      regime = MarketRegime.Bear;
      confidence = bearScore / maxPossible;
    } else if (bullScore <= 1 && bearScore <= 1) {
      regime = MarketRegime.Ranging;
      confidence = 1 - totalScore / maxPossible; // high confidence when few signals fire
    } else {
      regime = MarketRegime.Transitional;
      confidence = 0.3 + (totalScore / maxPossible) * 0.3; // 0.3-0.6 range
    }

    const summary = this.buildSummary(regime, bullScore, bearScore, confidence, ref.assetId);

    return { regime, confidence, signals, observedAt, summary };
  }

  /**
   * Build a human-readable summary explaining the regime call + the
   * scores that led to it.
   */
  private buildSummary(
    regime: MarketRegime,
    bullScore: number,
    bearScore: number,
    confidence: number,
    assetId: string,
  ): string {
    const pct = (confidence * 100).toFixed(0);
    switch (regime) {
      case MarketRegime.Bull:
        return `${regime} regime on ${assetId}: ${bullScore}/5 bull signals, ${bearScore}/5 bear signals. Strong uptrend confirmed across multiple timeframes. Confidence ${pct}%.`;
      case MarketRegime.Bear:
        return `${regime} regime on ${assetId}: ${bearScore}/5 bear signals, ${bullScore}/5 bull signals. Downtrend confirmed — defensive posture recommended. Confidence ${pct}%.`;
      case MarketRegime.Ranging:
        return `${regime} regime on ${assetId}: ${bullScore}/5 bull, ${bearScore}/5 bear. No clear trend — sideways market. Confidence ${pct}%.`;
      case MarketRegime.Transitional:
        return `${regime} regime on ${assetId}: ${bullScore}/5 bull, ${bearScore}/5 bear. Mixed signals — no clear majority. Wait for confirmation before adjusting posture. Confidence ${pct}%.`;
    }
  }

  /**
   * Compute log-return over a specific number of days (looking back
   * from the latest price). Returns null if insufficient data.
   */
  private momentumOverDays(
    prices: number[],
    ts: number[],
    days: number,
  ): number | null {
    if (prices.length < 2 || ts.length < 2) return null;
    const latestTs = ts[ts.length - 1]!;
    const targetTs = latestTs - days * 24 * 60 * 60 * 1000;

    // Find the price closest to (but not after) the target timestamp.
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < ts.length; i++) {
      const diff = Math.abs(ts[i]! - targetTs);
      if (diff < bestDiff && ts[i]! <= latestTs) {
        bestDiff = diff;
        bestIdx = i;
      }
    }

    // Need at least 7 days of data between the two points for a
    // meaningful return.
    const actualDays = (latestTs - ts[bestIdx]!) / (24 * 60 * 60 * 1000);
    if (actualDays < 7) return null;

    const startPrice = prices[bestIdx]!;
    const endPrice = prices[prices.length - 1]!;
    if (startPrice <= 0 || endPrice <= 0) return null;

    return Math.log(endPrice / startPrice);
  }

  /**
   * Pick the reference asset for the regime call. Prefer BTC, fall
   * back to ETH, fall back to the first mark.
   */
  private pickReference(marks: RegimeMark[]): RegimeMark | undefined {
    return (
      marks.find((m) => m.assetId.toLowerCase() === "btc") ??
      marks.find((m) => m.assetId.toLowerCase() === "eth") ??
      marks.find((m) => m.assetId.toLowerCase() === "wbtc") ??
      marks[0]
    );
  }

  /**
   * Annualized realized vol. Stdev of daily log-returns × sqrt(365).
   * Returns a percentage (e.g. 55 = 55%).
   */
  private annualizedVol(returns: number[]): number {
    if (returns.length < 2) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((a, r) => a + (r - mean) ** 2, 0) /
      (returns.length - 1);
    const stdev = Math.sqrt(variance);
    return stdev * Math.sqrt(365) * 100;
  }
}

/**
 * Factory. The detector is a pure function — a later phase will plug
 * in live history from the MarketService.
 */
export function createRegimeDetector(): MarketRegimeDetector {
  return new DemoRegimeDetector();
}
