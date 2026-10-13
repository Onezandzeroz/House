/**
 * price-aggregator.ts — the multi-source price orchestrator.
 *
 * House is non-custody and serves a family trust. Price accuracy matters
 * — a wrong NAV misleads the advisory engine and the trustee. So instead
 * of relying on a single source (CoinGecko-only, as v1 did), this module
 * orchestrates FOUR sources in priority order and surfaces per-asset
 * provenance + confidence so the UI can warn when data quality degrades.
 *
 * The four sources, in authority order per asset:
 *
 *   1. FTSO (on-chain oracle)     — canonical for FLR; cross-check for
 *      BTC/ETH/XRP/XLM/SOL/USDC/USDT. Free, censorship-resistant, no key.
 *   2. CCXT (exchange direct)     — executable bid/ask + quote volume.
 *      Used for the executable-mark path (slippage estimation) + as a
 *      cross-check on the reference price.
 *   3. CoinGecko (aggregator)     — cross-venue reference. The v1 primary;
 *      now one of several sources. Good for assets CCXT doesn't list.
 *   4. Reference prices (hardcoded) — last-resort fallback. Static values
 *      from October 2026. Clearly flagged as low-confidence.
 *
 * Per-asset resolution rule:
 *   - FLR: FTSO primary (canonical). If FTSO down → CoinGecko. If both
 *     down → reference.
 *   - BTC/ETH/XRP/XLM/SOL/USDC/USDT: CoinGecko primary (already working
 *     in v1). FTSO + CCXT run as cross-checks; if CoinGecko is down,
 *     fall to CCXT mid, then to reference.
 *   - RLUSD/stETH/other: CoinGecko primary. If down → reference.
 *   - Unknown custom assets: reference ($1.0 fallback, flagged low).
 *
 * Cross-check divergence detection:
 *   - When 2+ sources return a price for the same asset, the aggregator
 *     computes the max divergence in basis points. If > 200 bps (2%),
 *     a warning is surfaced — the trustee should investigate.
 *
 * Output shape:
 *   - `prices: Record<string, number>`  — backward-compatible with v1
 *     (callers that only need the number map keep working).
 *   - `source: "live" | "fallback"`     — backward-compatible binary flag.
 *   - `details: Record<string, AssetPriceDetail>` — new per-asset rich
 *     metadata (source, confidence, isFallback, divergenceBps, sources[]).
 *   - `summary: { sourcesUsed, fallbackCount, divergenceWarnings }` —
 *     new aggregate for the UI's data-quality badge.
 *
 * Cache: 60s TTL (same as v1). Dedup via pendingPromise. Never throws.
 */

import { REFERENCE_PRICES, referencePrice } from "./reference-prices";
import { fetchLivePrices as fetchCoingeckoPrices } from "./coingecko-client";
import { fetchFtsoPrices, FTSO_COVERED_ASSETS } from "./flare-ftso-client";
import { fetchTickers } from "./ccxt-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The tier that provided an asset's price. */
export type PriceSourceTier =
  | "ftso" // Flare on-chain oracle
  | "ccxt" // Exchange direct (Bybit/OKX/...)
  | "coingecko" // CoinGecko aggregator
  | "reference-fallback" // CoinGecko down, using reference
  | "reference-prices-v0" // Asset not on any live source
  | "reference-prices-v0-fallback"; // Unknown asset, $1.0 fallback

/** Confidence classification for UI display. */
export type PriceConfidence =
  | "high" // Primary live source succeeded
  | "medium" // Cross-check divergence > 50 bps but < 200 bps
  | "low" // Cross-check divergence > 200 bps (warning)
  | "fallback"; // Using hardcoded reference prices

/** Per-asset price detail. */
export interface AssetPriceDetail {
  /** The primary source that provided the price. */
  source: PriceSourceTier;
  /** Confidence level. */
  confidence: PriceConfidence;
  /** True if this asset fell back to hardcoded reference prices. */
  isFallback: boolean;
  /** Max divergence (bps) between available sources. Undefined if only 1 source. */
  divergenceBps: number | null;
  /** All sources that returned a price for this asset (for the UI chip). */
  sources: PriceSourceTier[];
  /** Human-readable label for display. */
  sourceLabel: string;
}

/** Summary of the aggregation — for the data-quality badge. */
export interface PriceAggregationSummary {
  /** Which source tiers were used across all assets. */
  sourcesUsed: PriceSourceTier[];
  /** Count of assets using hardcoded reference fallback. */
  fallbackCount: number;
  /** Count of assets with cross-check divergence > 200 bps. */
  divergenceWarningCount: number;
  /** Total assets evaluated. */
  totalAssets: number;
}

/** Full result — backward-compatible with v1 LivePriceResult + new fields. */
export interface AggregatedPriceResult {
  /** Lowercase assetId → USD price. Backward-compatible with v1. */
  prices: Record<string, number>;
  /** "live" if any primary source succeeded; "fallback" if all down. */
  source: "live" | "fallback";
  /** When the aggregation happened (cache time). */
  fetchedAt: Date;
  /** NEW: per-asset rich metadata. */
  details: Record<string, AssetPriceDetail>;
  /** NEW: aggregate summary for the data-quality badge. */
  summary: PriceAggregationSummary;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Cache TTL — 60s, same as v1. */
const CACHE_TTL_MS = 60 * 1000;

/** Divergence threshold (bps) for "low" confidence + UI warning. */
const DIVERGENCE_WARN_BPS = 200; // 2%

/** Divergence threshold (bps) for "medium" confidence. */
const DIVERGENCE_MEDIUM_BPS = 50; // 0.5%

// ---------------------------------------------------------------------------
// Source labels — human-readable for the UI.
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<PriceSourceTier, string> = {
  ftso: "Flare FTSO",
  ccxt: "Exchange live",
  coingecko: "CoinGecko",
  "reference-fallback": "Reference (live down)",
  "reference-prices-v0": "Reference price",
  "reference-prices-v0-fallback": "Reference $1.00",
};

// ---------------------------------------------------------------------------
// Cache + dedup state
// ---------------------------------------------------------------------------

let cachedResult: AggregatedPriceResult | null = null;
let cacheExpiry = 0;
let pendingPromise: Promise<AggregatedPriceResult> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch aggregated prices from all available sources.
 *
 * Cache strategy: 60s TTL. Concurrent callers share one fetch via
 * `pendingPromise`. Never throws — on total failure, returns reference
 * prices with `source: "fallback"`.
 *
 * @returns AggregatedPriceResult with the price map + per-asset details + summary.
 */
export async function fetchAggregatedPrices(): Promise<AggregatedPriceResult> {
  const now = Date.now();
  if (cachedResult && now < cacheExpiry) {
    return cachedResult;
  }
  if (pendingPromise) {
    return pendingPromise;
  }
  pendingPromise = doAggregate().finally(() => {
    pendingPromise = null;
  });
  return pendingPromise;
}

/**
 * Internal aggregation implementation.
 *
 * Fetches FTSO + CoinGecko + CCXT in parallel. For each asset in the
 * reference-price universe, picks the primary source, records cross-checks,
 * computes divergence, and builds the result.
 */
async function doAggregate(): Promise<AggregatedPriceResult> {
  const fetchedAt = new Date();

  // Fetch all three sources in parallel. Each is independently cached +
  // never-throws, so one failing doesn't block the others.
  const [ftsoResult, coingeckoResult, ccxtTickers] = await Promise.all([
    fetchFtsoPrices().catch(() => null),
    fetchCoingeckoPrices().catch(() => null),
    fetchTickers(Object.keys(REFERENCE_PRICES)).catch(() => ({})),
  ]);

  // Build the per-asset result.
  const prices: Record<string, number> = {};
  const details: Record<string, AssetPriceDetail> = {};
  const sourcesUsedSet = new Set<PriceSourceTier>();
  let fallbackCount = 0;
  let divergenceWarningCount = 0;
  const totalAssets = Object.keys(REFERENCE_PRICES).length;

  for (const assetId of Object.keys(REFERENCE_PRICES)) {
    const ref = referencePrice(assetId);
    const ftsoEntry = ftsoResult?.ok ? ftsoResult.prices[assetId] : null;
    const coingeckoPrice = coingeckoResult?.prices[assetId];
    const ccxtTicker = ccxtTickers?.[assetId] ?? null;

    // Collect all available prices for this asset (for cross-check).
    const available: Array<{ source: PriceSourceTier; price: number }> = [];
    if (ftsoEntry && ftsoEntry.price > 0) {
      available.push({ source: "ftso", price: ftsoEntry.price });
    }
    if (
      ccxtTicker &&
      !ccxtTicker.synthetic &&
      typeof ccxtTicker.price === "number" &&
      ccxtTicker.price > 0
    ) {
      available.push({ source: "ccxt", price: ccxtTicker.price });
    }
    if (
      typeof coingeckoPrice === "number" &&
      Number.isFinite(coingeckoPrice) &&
      coingeckoPrice > 0
    ) {
      available.push({ source: "coingecko", price: coingeckoPrice });
    }

    // Pick the primary source.
    let primaryPrice: number;
    let primarySource: PriceSourceTier;

    if (assetId === "flr" && ftsoEntry) {
      // FLR: FTSO is canonical.
      primaryPrice = ftsoEntry.price;
      primarySource = "ftso";
    } else if (available.length > 0) {
      // Other assets: prefer CoinGecko (cross-venue aggregate), then CCXT,
      // then FTSO (for non-FLR assets where CoinGecko is down).
      const coingeckoAvail = available.find((a) => a.source === "coingecko");
      const ccxtAvail = available.find((a) => a.source === "ccxt");
      const ftsoAvail = available.find((a) => a.source === "ftso");
      const chosen = coingeckoAvail ?? ccxtAvail ?? ftsoAvail!;
      primaryPrice = chosen.price;
      primarySource = chosen.source;
    } else {
      // No live source — use reference price.
      primaryPrice = ref.price;
      primarySource = ref.source as PriceSourceTier;
    }

    // Compute divergence (max bps between any two available sources).
    let divergenceBps: number | null = null;
    if (available.length >= 2) {
      const sortedPrices = available.map((a) => a.price).sort((a, b) => a - b);
      const min = sortedPrices[0];
      const max = sortedPrices[sortedPrices.length - 1];
      if (min > 0) {
        divergenceBps = Math.round(((max - min) / min) * 10000);
      }
    }

    // Classify confidence.
    let confidence: PriceConfidence;
    let isFallback: boolean;
    if (
      primarySource === "reference-prices-v0" ||
      primarySource === "reference-prices-v0-fallback" ||
      primarySource === "reference-fallback"
    ) {
      confidence = "fallback";
      isFallback = true;
      fallbackCount++;
    } else if (divergenceBps !== null && divergenceBps >= DIVERGENCE_WARN_BPS) {
      confidence = "low";
      isFallback = false;
      divergenceWarningCount++;
    } else if (divergenceBps !== null && divergenceBps >= DIVERGENCE_MEDIUM_BPS) {
      confidence = "medium";
      isFallback = false;
    } else {
      confidence = "high";
      isFallback = false;
    }

    prices[assetId] = primaryPrice;
    sourcesUsedSet.add(primarySource);
    details[assetId] = {
      source: primarySource,
      confidence,
      isFallback,
      divergenceBps,
      sources: available.map((a) => a.source),
      sourceLabel: SOURCE_LABELS[primarySource],
    };
  }

  // Root-level "live" vs "fallback": "fallback" only if ALL assets are on
  // reference prices (total failure). Even one live source = "live".
  const anyLive = Array.from(sourcesUsedSet).some(
    (s) => s === "ftso" || s === "ccxt" || s === "coingecko",
  );

  const result: AggregatedPriceResult = {
    prices,
    source: anyLive ? "live" : "fallback",
    fetchedAt,
    details,
    summary: {
      sourcesUsed: Array.from(sourcesUsedSet),
      fallbackCount,
      divergenceWarningCount,
      totalAssets,
    },
  };

  cachedResult = result;
  cacheExpiry = Date.now() + CACHE_TTL_MS;
  return result;
}

// ---------------------------------------------------------------------------
// Diagnostics + cache invalidation
// ---------------------------------------------------------------------------

/** Invalidate the aggregator cache. Forces a fresh fetch on next call. */
export function invalidateAggregatedCache(): void {
  cachedResult = null;
  cacheExpiry = 0;
}

/**
 * Get the current cache state for diagnostics. Returns null if no cache.
 */
export function getAggregatedCacheState(): {
  source: "live" | "fallback";
  fetchedAt: Date;
  expiresAt: Date;
  isExpired: boolean;
  fallbackCount: number;
  divergenceWarningCount: number;
} | null {
  if (!cachedResult) return null;
  return {
    source: cachedResult.source,
    fetchedAt: cachedResult.fetchedAt,
    expiresAt: new Date(cacheExpiry),
    isExpired: Date.now() >= cacheExpiry,
    fallbackCount: cachedResult.summary.fallbackCount,
    divergenceWarningCount: cachedResult.summary.divergenceWarningCount,
  };
}

/**
 * Get the detail for a specific asset. Returns null if no cache or asset
 * not in the detail map.
 *
 * Used by the UI to render per-asset source chips.
 */
export function getAssetPriceDetail(
  assetId: string,
): AssetPriceDetail | null {
  if (!cachedResult) return null;
  return cachedResult.details[assetId.toLowerCase()] ?? null;
}
