import {
  MarketRegime,
  type RegimeSignal,
  type RegimeState,
} from "../domain/regime";

/**
 * Market regime detector (owner direction, Task 6; plan §4).
 *
 * Regime-deteksjon er IKKE en black-box LLM. Den er deterministiske
 * signal som ejeren kan revidere — SMA-200 vs current price, 30/90-day
 * momentum, realiseret volatilitet, drawdown from peak.
 *
 * Phase 1 Observe ships live market data into `marks[].history`. Until
 * then, the DemoRegimeDetector returns `ranging` with sample evidence
 * so the advisor has something to chew on. The signal math IS real —
 * when history is supplied, the detector computes SMA, momentum,
 * realized vol, and drawdown and votes the signals into a regime call.
 */

/**
 * One observed mark, with optional history. The detector uses the
 * reference asset (BTC, falling back to ETH) to compute the regime.
 * History is sparse-sampled daily prices; the detector does NOT
 * resample, it just consumes the points the caller supplies.
 */
export interface RegimeMark {
  assetId: string;
  price: string;
  history?: { t: Date; price: string }[];
}

/**
 * The detector interface. One method: given marks for the universe,
 * produce a RegimeState. The detector does NOT call any external
 * service — it is a pure function of the marks the caller supplies.
 *
 * Phase 1 Observe will plug a real MarketService handle in front of
 * this; the interface stays the same.
 */
export interface MarketRegimeDetector {
  detect(marks: RegimeMark[]): RegimeState;
}

// ---------------------------------------------------------------------------
// DemoRegimeDetector — real signal math, demo data.
// ---------------------------------------------------------------------------

/**
 * DemoRegimeDetector — the v0 implementation.
 *
 * Algorithm:
 *   1. Pick the reference asset: BTC if present, else ETH, else the
 *      first mark. The reference is what the regime is measured on.
 *   2. If history is missing (the demo-without-history case), return
 *      `ranging` with three sample signals:
 *         - sma-200        : neutral (no history)
 *         - momentum-30    : neutral (no history)
 *         - realized-vol   : 60d annualized ~ 55% (assumed)
 *      Confidence = 0 (no real signals, so no real confidence).
 *   3. If history is present, compute four real signals:
 *         - sma-200        : price vs the SMA of available history (a
 *                            noisy proxy when N < 200; the evidence
 *                            string says so).
 *         - momentum-30    : log-return over the available window
 *                            (or last 30 days if enough history).
 *         - realized-vol   : stdev of daily log-returns × sqrt(365).
 *                            Reported as a signal; not directly
 *                            regime-determining.
 *         - drawdown-from-peak : max peak-to-now drop. Bear if > 25%.
 *   4. Vote: sum bull weights, sum bear weights. confidence =
 *      (bull - bear) / total. The regime with the higher weight wins;
 *      a near-tie (|confidence| < 0.15) → `transitional`; a tie →
 *      `ranging`.
 */
export class DemoRegimeDetector implements MarketRegimeDetector {
  detect(marks: RegimeMark[]): RegimeState {
    const observedAt = new Date();
    const ref = this.pickReference(marks);

    if (!ref) {
      // Empty marks → ranging with no signals. Should not happen in
      // practice; the demo book always has at least BTC + ETH.
      return {
        regime: MarketRegime.Ranging,
        confidence: 0,
        signals: [],
        observedAt,
        summary:
          "No marks supplied; defaulting to ranging with no signals.",
      };
    }

    if (!ref.history || ref.history.length < 2) {
      // Demo-without-history case — return ranging with sample evidence.
      const signals: RegimeSignal[] = [
        {
          name: "sma-200",
          direction: "neutral",
          evidence: `${ref.assetId}: no history supplied; SMA-200 not computable.`,
          weight: 1,
        },
        {
          name: "momentum-30",
          direction: "neutral",
          evidence: `${ref.assetId}: no history supplied; 30-day momentum not computable.`,
          weight: 1,
        },
        {
          name: "realized-vol",
          direction: "neutral",
          evidence:
            "60d annualized realized vol assumed ~55% (crypto-typical; no live data).",
          weight: 0.5,
        },
      ];
      return {
        regime: MarketRegime.Ranging,
        confidence: 0,
        signals,
        observedAt,
        summary: `Ranging (default). Reference ${ref.assetId} @ ${ref.price}; no live history yet.`,
      };
    }

    // Real history → real signals.
    const history = ref.history;
    const currentPrice = Number(ref.price);
    const prices = history.map((h) => Number(h.price));
    const ts = history.map((h) => h.t.getTime());

    const signals: RegimeSignal[] = [];

    // 1. SMA-200 vs current price.
    const sma = prices.reduce((a, b) => a + b, 0) / prices.length;
    const smaDirection: RegimeSignal["direction"] =
      currentPrice > sma ? "bull" : currentPrice < sma ? "bear" : "neutral";
    signals.push({
      name: "sma-200",
      direction: smaDirection,
      evidence: `${ref.assetId} price ${currentPrice.toFixed(2)} vs SMA(${history.length}) ${sma.toFixed(2)}${
        history.length < 30
          ? " (noisy: <30 samples, treat as proxy for SMA-200)"
          : ""
      }`,
      weight: 1,
    });

    // 2. Momentum — log return over available window.
    const first = prices[0];
    const last = prices[prices.length - 1];
    const logReturn = Math.log(last / first);
    const momentumDirection: RegimeSignal["direction"] =
      logReturn > 0.05 ? "bull" : logReturn < -0.05 ? "bear" : "neutral";
    signals.push({
      name: "momentum-30",
      direction: momentumDirection,
      evidence: `${ref.assetId} log-return ${(logReturn * 100).toFixed(2)}% over ${this.windowDays(ts)}d window.`,
      weight: 1,
    });

    // 3. Realized vol — stdev of daily log-returns, annualized.
    const dailyReturns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      if (prices[i - 1] > 0) {
        dailyReturns.push(Math.log(prices[i] / prices[i - 1]));
      }
    }
    const vol = this.annualizedVol(dailyReturns);
    // Vol is informational; it does not vote the regime directly.
    signals.push({
      name: "realized-vol",
      direction: "neutral",
      evidence: `${ref.assetId} realized vol ${vol.toFixed(1)}% annualized over ${dailyReturns.length + 1} samples.`,
      weight: 0.5,
    });

    // 4. Drawdown from peak.
    let peak = prices[0];
    let maxDd = 0;
    for (const p of prices) {
      if (p > peak) peak = p;
      const dd = (peak - p) / peak;
      if (dd > maxDd) maxDd = dd;
    }
    const ddDirection: RegimeSignal["direction"] =
      maxDd > 0.25 ? "bear" : "neutral";
    signals.push({
      name: "drawdown-from-peak",
      direction: ddDirection,
      evidence: `${ref.assetId} drawdown from peak ${(maxDd * 100).toFixed(2)}%${
        maxDd > 0.25 ? " (> 25% bear threshold)" : ""
      }.`,
      weight: 1,
    });

    // Vote.
    const bullWeight = signals
      .filter((s) => s.direction === "bull")
      .reduce((a, s) => a + s.weight, 0);
    const bearWeight = signals
      .filter((s) => s.direction === "bear")
      .reduce((a, s) => a + s.weight, 0);
    const totalWeight = signals.reduce((a, s) => a + s.weight, 0);
    const confidence =
      totalWeight === 0 ? 0 : Math.abs(bullWeight - bearWeight) / totalWeight;

    let regime: MarketRegime;
    if (Math.abs(bullWeight - bearWeight) < 0.5 || confidence < 0.15) {
      regime = confidence < 0.05 ? MarketRegime.Ranging : MarketRegime.Transitional;
    } else if (bullWeight > bearWeight) {
      regime = MarketRegime.Bull;
    } else {
      regime = MarketRegime.Bear;
    }

    const summary = `${regime} regime detected on ${ref.assetId}: bull-weight ${bullWeight.toFixed(2)}, bear-weight ${bearWeight.toFixed(2)}, confidence ${(confidence * 100).toFixed(0)}%.`;

    return { regime, confidence, signals, observedAt, summary };
  }

  /**
   * Pick the reference asset for the regime call. Prefer BTC, fall
   * back to ETH, fall back to the first mark. The reference is what
   * the regime is measured on — small caps are too noisy to anchor.
   */
  private pickReference(marks: RegimeMark[]): RegimeMark | undefined {
    return (
      marks.find((m) => m.assetId.toLowerCase() === "btc") ??
      marks.find((m) => m.assetId.toLowerCase() === "eth") ??
      marks.find((m) => m.assetId.toLowerCase() === "wbtc") ??
      marks[0]
    );
  }

  /** Number of days spanned by the history. */
  private windowDays(ts: number[]): number {
    if (ts.length < 2) return 0;
    const ms = Math.abs(ts[ts.length - 1] - ts[0]);
    return Math.round(ms / (1000 * 60 * 60 * 24));
  }

  /**
   * Annualized realized vol. Stdev of daily log-returns × sqrt(365)
   * (crypto trades 365 days/year). Returns a percentage (e.g. 55 = 55%).
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
 * Factory. The v0 detector is the DemoRegimeDetector; a later phase
 * will swap in a detector that pulls history from the MarketService.
 * Returning an instance keeps the swap a one-line change.
 */
export function createRegimeDetector(): MarketRegimeDetector {
  return new DemoRegimeDetector();
}
