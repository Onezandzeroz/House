/**
 * ccxt-client.ts — CCXT exchange-data client for the House app.
 *
 * Wraps a single CCXT exchange instance (default: Bybit) and exposes two
 * methods:
 *   - `fetchTicker(assetId)`  → spot price + bid/ask + 24h quote volume
 *   - `fetchOhlcv(assetId, timeframe, since, limit)` → historical candles
 *
 * Both are keyless (public endpoints) on Bybit, OKX, Binance, Kraken,
 * Coinbase, KuCoin — the user picks the exchange via `CCXT_EXCHANGE`
 * env (default "bybit"). Bybit covers all 10 House assets (BTC, ETH,
 * SOL, XRP, XLM, FLR, USDC, USDT, RLUSD, stETH) — verified live.
 *
 * Why House uses it (plan §6; user direction "CCXT as primary exchange
 * motor"):
 *   - `getExecutableMark` needs real bid/ask + quote volume (liquidity)
 *     so the policy engine can estimate slippage. v1 returned the
 *     reference price with `liquidity: null` — this fills that gap.
 *   - `getOhlcv` replaces the 7-sample hardcoded BTC/ETH history arrays
 *     in `trust-book.ts` so the regime detector (SMA-200, drawdown,
 *     realised vol) runs on real market history.
 *
 * Architecture:
 *   - One CCXT instance (lazy-init on first use). `enableRateLimit: true`
 *     lets CCXT throttle automatically per exchange's documented limits.
 *   - Caching: tickers 30s, OHLCV 1h (historical data doesn't change
 *     fast — 1h cache is safe and keeps us far from rate limits).
 *   - Retry: 2 attempts with 500ms backoff on network errors.
 *   - Never throws — returns `null` on failure so the caller (price
 *     aggregator or MarketService) can fall through gracefully.
 *   - Stablecoins (USDT, DAI, FRAX, USDC, RLUSD) return a synthetic
 *     $1.00 ticker without an exchange call — they're $1.00 by
 *     definition and USDT/USDT doesn't trade against itself.
 *
 * Math caveat: CCXT returns JS Numbers for ticker fields. Fine for v0.
 * Production should use a fixed-point decimal lib for the executable
 * mark path (slippage estimation).
 */

import ccxt from "ccxt";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Which exchange to use. Default "bybit" (covers all 10 House assets). */
const EXCHANGE_ID = (process.env.CCXT_EXCHANGE ?? "bybit").toLowerCase();

/** Optional API key/secret — only needed if rate limits become a problem. */
const CCXT_API_KEY = process.env.CCXT_API_KEY ?? "";
const CCXT_API_SECRET = process.env.CCXT_API_SECRET ?? "";

/** Ticker cache TTL — 30s. Fresh enough for NAV, gentle on rate limits. */
const TICKER_CACHE_TTL_MS = 30 * 1000;

/** OHLCV cache TTL — 1h. Historical data doesn't change fast. */
const OHLCV_CACHE_TTL_MS = 60 * 60 * 1000;

/** Fetch timeout — 10s. */
const FETCH_TIMEOUT_MS = 10 * 1000;

/** Max retries. 2 = 3 total attempts. */
const MAX_RETRIES = 2;

/** Backoff between retries — 500ms, then 1000ms. */
const RETRY_BACKOFF_MS = 500;

// ---------------------------------------------------------------------------
// Stablecoin set — these return a synthetic $1.00 ticker without a network call.
// ---------------------------------------------------------------------------

const STABLECOIN_ASSETS: ReadonlySet<string> = new Set([
  "usdc",
  "usdt",
  "dai",
  "frax",
  "rlusd",
]);

// ---------------------------------------------------------------------------
// Symbol mapping — assetId → CCXT market symbol.
//
// Most assets map to "ASSET/USDT" (uppercase). A few need special handling:
//   - stETH: Bybit lists it as "STETH/USDT"
//   - Stablecoins: skip the exchange call, return $1.00
//   - WBTC: "WBTC/USDT" may not exist on all exchanges; fall back to BTC
//   - rETH/cbETH: may not be listed; fall back to ETH price
// ---------------------------------------------------------------------------

/**
 * Map an assetId to a CCXT market symbol for the configured exchange.
 * Returns null for stablecoins (no exchange call needed) or for assets
 * that don't have a direct listing (caller should fall back).
 */
function assetToSymbol(assetId: string): string | null {
  const id = assetId.toLowerCase();
  if (STABLECOIN_ASSETS.has(id)) return null; // synthetic $1.00
  // Liquid staking receipts — Bybit lists stETH but not rETH/cbETH.
  // For rETH/cbETH, return null (no direct listing, and using ETH as a
  // proxy would create false divergence warnings in the aggregator).
  // stETH has a direct STETH/USDT pair on Bybit.
  if (id === "steth") return "STETH/USDT";
  if (id === "reth" || id === "cbeth") return null;
  if (id === "wbtc") return "WBTC/USDT";
  // All others: "ASSET/USDT" uppercase.
  return `${assetId.toUpperCase()}/USDT`;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** A ticker reading from the exchange. */
export interface CcxtTicker {
  /** Asset id (lowercase). */
  assetId: string;
  /** Last trade price (USD ≈ USDT). */
  price: number;
  /** Top-of-book bid. */
  bid: number | null;
  /** Top-of-book ask. */
  ask: number | null;
  /** 24h quote volume (USDT) — proxy for liquidity. */
  quoteVolume: number | null;
  /** Exchange timestamp (ms). */
  timestamp: number | null;
  /** Exchange name (e.g. "bybit"). */
  exchange: string;
  /** True if this is a synthetic stablecoin $1.00 (no exchange call). */
  synthetic: boolean;
}

/** An OHLCV candle. */
export interface CcxtCandle {
  /** Open time (ms). */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ---------------------------------------------------------------------------
// Exchange instance — lazy-init.
// ---------------------------------------------------------------------------

let exchange: ccxt.Exchange | null = null;

function getExchange(): ccxt.Exchange {
  if (!exchange) {
    const config: ccxt.Config = {
      enableRateLimit: true,
      timeout: FETCH_TIMEOUT_MS,
      options: { defaultType: "spot" },
    };
    if (CCXT_API_KEY) {
      config.apiKey = CCXT_API_KEY;
      config.secret = CCXT_API_SECRET;
    }
    // CCXT exposes exchanges as lowercase properties on the default export.
    const ExchangeClass = (ccxt as unknown as Record<string, unknown>)[
      EXCHANGE_ID
    ] as unknown as new (config: ccxt.Config) => ccxt.Exchange;
    if (!ExchangeClass || typeof ExchangeClass !== "function") {
      throw new Error(
        `Unknown CCXT exchange "${EXCHANGE_ID}". Check CCXT_EXCHANGE env.`,
      );
    }
    exchange = new ExchangeClass(config);
  }
  return exchange;
}

// ---------------------------------------------------------------------------
// Caches — module-level.
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  expiry: number;
}

const tickerCache = new Map<string, CacheEntry<CcxtTicker | null>>();
const ohlcvCache = new Map<string, CacheEntry<CcxtCandle[] | null>>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch a ticker for one asset. Returns null on failure or for stablecoins
 * (which return a synthetic $1.00 ticker).
 *
 * Cached for 30s per asset. Never throws.
 */
export async function fetchTicker(
  assetId: string,
): Promise<CcxtTicker | null> {
  const id = assetId.toLowerCase();

  // Stablecoin synthetic — no exchange call.
  if (STABLECOIN_ASSETS.has(id)) {
    return {
      assetId: id,
      price: 1.0,
      bid: 1.0,
      ask: 1.0,
      quoteVolume: null,
      timestamp: Date.now(),
      exchange: EXCHANGE_ID,
      synthetic: true,
    };
  }

  // Cache hit.
  const cached = tickerCache.get(id);
  if (cached && Date.now() < cached.expiry) {
    return cached.value;
  }

  // Fetch with retry.
  const result = await fetchTickerWithRetry(id);
  tickerCache.set(id, {
    value: result,
    expiry: Date.now() + TICKER_CACHE_TTL_MS,
  });
  return result;
}

/**
 * Fetch tickers for multiple assets in parallel. Stablecoins return
 * synthetic $1.00. Failed assets return null in their slot.
 */
export async function fetchTickers(
  assetIds: string[],
): Promise<Record<string, CcxtTicker | null>> {
  const entries = await Promise.all(
    assetIds.map(async (id) => [id.toLowerCase(), await fetchTicker(id)] as const),
  );
  return Object.fromEntries(entries);
}

/**
 * Fetch OHLCV candles for an asset. Returns null on failure.
 *
 * Cached for 1h per (asset, timeframe, since, limit) key. Never throws.
 *
 * @param assetId    Asset ticker (e.g. "BTC")
 * @param timeframe  CCXT timeframe: "1m", "5m", "15m", "1h", "4h", "1d", "1w"
 * @param since      Start time (ms). Optional — if omitted, returns `limit` most recent.
 * @param limit      Max candles. Default 500. Exchange max is 1000 for Bybit.
 */
export async function fetchOhlcv(
  assetId: string,
  timeframe: string = "1d",
  since?: number,
  limit: number = 500,
): Promise<CcxtCandle[] | null> {
  const id = assetId.toLowerCase();
  const symbol = assetToSymbol(id);
  if (!symbol) return null; // stablecoin or unknown

  const cacheKey = `${id}:${timeframe}:${since ?? 0}:${limit}`;
  const cached = ohlcvCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return cached.value;
  }

  const result = await fetchOhlcvWithRetry(symbol, timeframe, since, limit);
  ohlcvCache.set(cacheKey, {
    value: result,
    expiry: Date.now() + OHLCV_CACHE_TTL_MS,
  });
  return result;
}

/**
 * Fetch OHLCV history for regime detection — convenience wrapper that
 * fetches daily candles for the last N days and returns them in the
 * `{ t: Date, price: string }` shape the regime detector expects.
 *
 * Returns null on failure (caller falls back to hardcoded history).
 *
 * @param assetId   Asset ticker
 * @param days      Number of daily candles to fetch. Default 200 (for SMA-200).
 */
export async function fetchOhlcvHistory(
  assetId: string,
  days: number = 200,
): Promise<{ t: Date; price: string }[] | null> {
  const candles = await fetchOhlcv(
    assetId,
    "1d",
    Date.now() - days * 24 * 60 * 60 * 1000,
    days,
  );
  if (!candles || candles.length === 0) return null;
  return candles.map((c) => ({
    t: new Date(c.timestamp),
    price: String(c.close),
  }));
}

// ---------------------------------------------------------------------------
// Retry wrappers
// ---------------------------------------------------------------------------

async function fetchTickerWithRetry(
  assetId: string,
): Promise<CcxtTicker | null> {
  const symbol = assetToSymbol(assetId);
  if (!symbol) return null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const ex = getExchange();
      const ticker = await ex.fetchTicker(symbol);
      if (!ticker || typeof ticker.last !== "number") {
        // Exchange returned a ticker without a last price — skip.
        return null;
      }
      return {
        assetId,
        price: ticker.last,
        bid: ticker.bid ?? null,
        ask: ticker.ask ?? null,
        quoteVolume: ticker.quoteVolume ?? null,
        timestamp: ticker.timestamp ?? null,
        exchange: EXCHANGE_ID,
        synthetic: false,
      };
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[ccxt] fetchTicker ${symbol} failed after ${MAX_RETRIES + 1} attempts: ${msg.slice(0, 100)}`,
        );
        return null;
      }
      await sleep(RETRY_BACKOFF_MS * (attempt + 1));
    }
  }
  return null;
}

async function fetchOhlcvWithRetry(
  symbol: string,
  timeframe: string,
  since: number | undefined,
  limit: number,
): Promise<CcxtCandle[] | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const ex = getExchange();
      const raw = await ex.fetchOHLCV(symbol, timeframe, since, limit);
      if (!raw || raw.length === 0) return null;
      return raw.map((c) => ({
        timestamp: c[0] as number,
        open: c[1] as number,
        high: c[2] as number,
        low: c[3] as number,
        close: c[4] as number,
        volume: c[5] as number,
      }));
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[ccxt] fetchOHLCV ${symbol} ${timeframe} failed after ${MAX_RETRIES + 1} attempts: ${msg.slice(0, 100)}`,
        );
        return null;
      }
      await sleep(RETRY_BACKOFF_MS * (attempt + 1));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers + diagnostics
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Invalidate all ticker + OHLCV caches. */
export function invalidateCcxtCache(): void {
  tickerCache.clear();
  ohlcvCache.clear();
}

/** Get the configured exchange id (for diagnostics / display). */
export function getExchangeId(): string {
  return EXCHANGE_ID;
}
