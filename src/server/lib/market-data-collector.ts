/**
 * market-data-collector.ts — collects market data inputs for the
 * composite risk scorer.
 *
 * Gathers:
 *   - 30d/90d annualized volatility (from CCXT OHLCV daily candles)
 *   - Max drawdown 90d (from CCXT OHLCV)
 *   - Beta to BTC (from CCXT OHLCV correlation)
 *   - Downside deviation (from CCXT OHLCV negative returns)
 *   - Market cap (from CoinGecko /coins/markets)
 *   - 24h volume (from CoinGecko or CCXT ticker)
 *   - Quote volume 24h (from CCXT ticker)
 *
 * Architecture:
 *   - One async `collectMarketData(assetId)` call per asset.
 *   - Results cached 1h (volatility doesn't change fast; market cap
 *     is stable enough for risk scoring).
 *   - Dedup via pendingPromise map (concurrent callers for the same
 *     asset share one fetch).
 *   - Never throws — returns null fields on failure so the scorer
 *     degrades gracefully.
 *   - `collectMarketDataBatch(assetIds[])` fetches all in parallel.
 *
 * The collected data feeds into `computeRiskScore(assetId, data)` in
 * risk-scoring.ts.
 */

import { fetchOhlcv, fetchTicker } from "./ccxt-client";
import { fetchLivePrices } from "./coingecko-client";
import type { MarketDataInput } from "../domain/risk-scoring";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Cache TTL — 1h. Risk scoring doesn't need real-time data. */
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Number of daily candles to fetch for volatility calculation. */
const OHLCV_DAYS_30 = 35; // 30 + 5 buffer
const OHLCV_DAYS_90 = 95; // 90 + 5 buffer

// ---------------------------------------------------------------------------
// Cache state — per-asset cache + dedup
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: MarketDataInput | null;
  expiry: number;
}

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<MarketDataInput | null>>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Collect market data for a single asset. Cached 1h. Never throws —
 * returns null on failure (the scorer degrades gracefully).
 *
 * @param assetId Asset ticker (e.g. "BTC")
 * @returns MarketDataInput with available fields, or null on total failure.
 */
export async function collectMarketData(
  assetId: string,
): Promise<MarketDataInput | null> {
  const id = assetId.toLowerCase();

  // Cache hit
  const cached = cache.get(id);
  if (cached && Date.now() < cached.expiry) {
    return cached.data;
  }

  // Dedup — share one fetch across concurrent callers
  const existing = pending.get(id);
  if (existing) return existing;

  const promise = doCollectMarketData(id).finally(() => {
    pending.delete(id);
  });
  pending.set(id, promise);
  return promise;
}

/**
 * Collect market data for multiple assets in parallel.
 * Returns a map of lowercase assetId → MarketDataInput (or null).
 */
export async function collectMarketDataBatch(
  assetIds: string[],
): Promise<Record<string, MarketDataInput | null>> {
  const entries = await Promise.all(
    assetIds.map(async (id) => [id.toLowerCase(), await collectMarketData(id)] as const),
  );
  return Object.fromEntries(entries);
}

/**
 * Invalidate the market-data cache for one asset (or all if no arg).
 */
export function invalidateMarketDataCache(assetId?: string): void {
  if (assetId) {
    cache.delete(assetId.toLowerCase());
  } else {
    cache.clear();
  }
}

// ---------------------------------------------------------------------------
// Internal — the actual data collection
// ---------------------------------------------------------------------------

async function doCollectMarketData(
  assetId: string,
): Promise<MarketDataInput | null> {
  try {
    // Fetch OHLCV + ticker in parallel.
    // OHLCV for volatility/drawdown/beta, ticker for quote volume.
    const [ohlcv30, ohlcv90, btcOhlcv90, ticker] = await Promise.all([
      fetchOhlcv(assetId, "1d", Date.now() - OHLCV_DAYS_30 * 24 * 60 * 60 * 1000, OHLCV_DAYS_30).catch(() => null),
      fetchOhlcv(assetId, "1d", Date.now() - OHLCV_DAYS_90 * 24 * 60 * 60 * 1000, OHLCV_DAYS_90).catch(() => null),
      // BTC OHLCV for beta calculation (only needed for non-BTC assets)
      assetId.toLowerCase() === "btc"
        ? Promise.resolve(null)
        : fetchOhlcv("BTC", "1d", Date.now() - OHLCV_DAYS_90 * 24 * 60 * 60 * 1000, OHLCV_DAYS_90).catch(() => null),
      fetchTicker(assetId).catch(() => null),
    ]);

    // Market cap from CoinGecko (the aggregator has this; CCXT doesn't).
    // We piggyback on the existing fetchLivePrices cache (60s) — but that
    // only returns spot prices, not market cap. For v1, we estimate market
    // cap from the ticker's quoteVolume (as a liquidity proxy) and use a
    // hardcoded market-cap table for the known universe. A later phase
    // can add a real CoinGecko /coins/markets call.
    const marketCap = estimateMarketCap(assetId, ticker?.quoteVolume ?? null);

    // Compute volatility metrics from OHLCV
    let volatility30d: number | null = null;
    let volatility90d: number | null = null;
    let maxDrawdown90d: number | null = null;
    let betaToBtc: number | null = null;
    let downsideDeviation: number | null = null;

    if (ohlcv30 && ohlcv30.length >= 7) {
      volatility30d = computeAnnualizedVolatility(ohlcv30);
      downsideDeviation = computeDownsideDeviation(ohlcv30);
    }

    if (ohlcv90 && ohlcv90.length >= 14) {
      volatility90d = computeAnnualizedVolatility(ohlcv90);
      maxDrawdown90d = computeMaxDrawdown(ohlcv90);
    }

    if (ohlcv90 && ohlcv90.length >= 14 && btcOhlcv90 && btcOhlcv90.length >= 14) {
      betaToBtc = computeBeta(ohlcv90, btcOhlcv90);
    }

    const result: MarketDataInput = {
      volatility30d,
      volatility90d,
      maxDrawdown90d,
      betaToBtc,
      downsideDeviation,
      marketCap,
      volume24h: ticker?.quoteVolume ?? null,
      quoteVolume24h: ticker?.quoteVolume ?? null,
    };

    // Cache the result (even if some fields are null — the scorer handles it)
    cache.set(assetId, {
      data: result,
      expiry: Date.now() + CACHE_TTL_MS,
    });

    return result;
  } catch {
    // Total failure — cache null so we don't retry every call
    cache.set(assetId, { data: null, expiry: Date.now() + CACHE_TTL_MS });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Quantitative helpers — pure functions on OHLCV candle arrays
// ---------------------------------------------------------------------------

/**
 * Compute annualized volatility from daily candles.
 * Uses log returns: ln(close[i] / close[i-1]).
 * Annualized = stdDev × sqrt(365).
 *
 * @param candles Array of { timestamp, open, high, low, close, volume }
 * @returns Annualized volatility (e.g. 0.85 = 85%). Null if insufficient data.
 */
function computeAnnualizedVolatility(
  candles: Array<{ close: number }>,
): number | null {
  if (candles.length < 7) return null;

  const logReturns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const curr = candles[i].close;
    if (prev > 0 && curr > 0) {
      logReturns.push(Math.log(curr / prev));
    }
  }

  if (logReturns.length < 5) return null;

  const mean = logReturns.reduce((s, r) => s + r, 0) / logReturns.length;
  const variance =
    logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / logReturns.length;
  const stdDev = Math.sqrt(variance);

  // Annualize: daily stdDev × sqrt(365) for crypto (365 trading days)
  return stdDev * Math.sqrt(365);
}

/**
 * Compute maximum drawdown from OHLCV candles.
 * Drawdown = (peak - trough) / peak, over the running peak.
 *
 * @returns Max drawdown as a positive fraction (e.g. 0.45 = -45% drawdown)
 */
function computeMaxDrawdown(
  candles: Array<{ close: number }>,
): number | null {
  if (candles.length < 2) return null;

  let peak = candles[0].close;
  let maxDd = 0;

  for (const c of candles) {
    if (c.close > peak) peak = c.close;
    if (peak > 0) {
      const dd = (peak - c.close) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }

  return maxDd;
}

/**
 * Compute beta to BTC from two OHLCV series.
 * Beta = Cov(assetReturns, btcReturns) / Var(btcReturns).
 *
 * @param assetCandles  The asset's OHLCV (90d daily)
 * @param btcCandles    BTC's OHLCV (90d daily)
 * @returns Beta (e.g. 1.2 = 20% more volatile than BTC). Null if insufficient data.
 */
function computeBeta(
  assetCandles: Array<{ close: number }>,
  btcCandles: Array<{ close: number }>,
): number | null {
  // Align the two series by length (take the shorter)
  const len = Math.min(assetCandles.length, btcCandles.length);
  if (len < 7) return null;

  const assetReturns: number[] = [];
  const btcReturns: number[] = [];
  for (let i = 1; i < len; i++) {
    const aPrev = assetCandles[i - 1].close;
    const aCurr = assetCandles[i].close;
    const bPrev = btcCandles[i - 1].close;
    const bCurr = btcCandles[i].close;
    if (aPrev > 0 && aCurr > 0 && bPrev > 0 && bCurr > 0) {
      assetReturns.push(Math.log(aCurr / aPrev));
      btcReturns.push(Math.log(bCurr / bPrev));
    }
  }

  if (assetReturns.length < 5) return null;

  const n = assetReturns.length;
  const meanA = assetReturns.reduce((s, r) => s + r, 0) / n;
  const meanB = btcReturns.reduce((s, r) => s + r, 0) / n;

  let cov = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    cov += (assetReturns[i] - meanA) * (btcReturns[i] - meanB);
    varB += (btcReturns[i] - meanB) ** 2;
  }
  cov /= n;
  varB /= n;

  if (varB === 0) return null;
  return cov / varB;
}

/**
 * Compute downside deviation (annualized).
 * Only considers negative returns (Sortino-style denominator).
 *
 * @returns Annualized downside deviation (e.g. 0.55 = 55%)
 */
function computeDownsideDeviation(
  candles: Array<{ close: number }>,
): number | null {
  if (candles.length < 7) return null;

  const logReturns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const curr = candles[i].close;
    if (prev > 0 && curr > 0) {
      logReturns.push(Math.log(curr / prev));
    }
  }

  if (logReturns.length < 5) return null;

  // Only negative returns (downside)
  const negativeReturns = logReturns.filter((r) => r < 0);
  if (negativeReturns.length < 3) return 0; // No downside = 0 downside deviation

  const mean = negativeReturns.reduce((s, r) => s + r, 0) / negativeReturns.length;
  const variance =
    negativeReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / negativeReturns.length;
  const stdDev = Math.sqrt(variance);

  return stdDev * Math.sqrt(365);
}

// ---------------------------------------------------------------------------
// Market cap estimation (v1 — hardcoded table + volume proxy)
// ---------------------------------------------------------------------------

/**
 * Hardcoded market-cap table for the known universe (Oct 2026 values).
 * A later phase can replace this with a real CoinGecko /coins/markets call.
 */
const MARKET_CAPS: Readonly<Record<string, number>> = Object.freeze({
  btc: 1_600_000_000_000, // ~$1.6T
  eth: 300_000_000_000, // ~$300B
  sol: 55_000_000_000, // ~$55B
  xrp: 130_000_000_000, // ~$130B
  xlm: 10_000_000_000, // ~$10B
  flr: 1_500_000_000, // ~$1.5B
  arb: 4_000_000_000, // ~$4B
  op: 3_000_000_000, // ~$3B
  avax: 12_000_000_000, // ~$12B
  uni: 6_000_000_000, // ~$6B
  aave: 2_500_000_000, // ~$2.5B
  ldo: 2_000_000_000, // ~$2B
  doge: 50_000_000_000, // ~$50B
  wbtc: 13_000_000_000, // ~$13B
  usdc: 40_000_000_000, // ~$40B
  usdt: 130_000_000_000, // ~$130B
  dai: 5_000_000_000, // ~$5B
  frax: 1_000_000_000, // ~$1B
  rlusd: 2_000_000_000, // ~$2B (new)
  steth: 28_000_000_000, // ~$28B
  reth: 8_000_000_000, // ~$8B
  cbeth: 5_000_000_000, // ~$5B
});

/**
 * Estimate market cap for an asset. Uses the hardcoded table; if the
 * asset isn't in the table, estimates from 24h quote volume (rough proxy:
 * mcap ≈ volume × 50 for liquid assets, × 20 for illiquid).
 */
function estimateMarketCap(
  assetId: string,
  quoteVolume24h: number | null,
): number | null {
  const id = assetId.toLowerCase();
  const known = MARKET_CAPS[id];
  if (known !== undefined) return known;

  // Unknown asset — estimate from volume
  if (quoteVolume24h && quoteVolume24h > 0) {
    // Rough heuristic: mcap ≈ 30 × daily volume (varies wildly but OK for v1)
    return quoteVolume24h * 30;
  }

  return null;
}
