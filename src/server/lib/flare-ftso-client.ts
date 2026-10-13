/**
 * flare-ftso-client.ts — Flare Time Series Oracle v2 price reader.
 *
 * The Flare Time Series Oracle (FTSO) is an on-chain price feed enshrined
 * in Flare's consensus. Validators submit prices every ~1.8s (block
 * latency); the median is published on-chain as a `uint256` value with
 * `int8` decimals per feed. Reading it is a plain `eth_call` — no API
 * key, no rate limit, no ToS, free forever.
 *
 * Why House uses it (plan §6; user direction "look into Flare on-chain
 * oracle"):
 *   - FLR/USD is the canonical price for FLR — it's produced by Flare's
 *     own validators on the same chain where the FLR lives. More
 *     authoritative than a CoinGecko aggregator id.
 *   - Cross-check value: an independent third source (besides CoinGecko
 *     and CCXT/Bybit) for BTC/ETH/XRP/XLM/SOL/USDC/USDT. If CoinGecko and
 *     Bybit diverge, FTSO is the on-chain tie-breaker.
 *
 * What it covers: 8 of 10 House assets (BTC, ETH, XRP, XLM, SOL, FLR,
 * USDC, USDT). It does NOT cover RLUSD (too new — launched Dec 2024) or
 * stETH (no Lido stETH feed on Flare). Those fall through to CoinGecko /
 * reference prices.
 *
 * Architecture:
 *   - One ethers JsonRpcProvider (lazy-init on first use).
 *   - One batched `getFeedsById(bytes21[])` call for all 8 feeds — a
 *     single `eth_call` returns everything.
 *   - Module-level in-memory cache, 60s TTL (matches the portfolio
 *     refresh cadence; FTSO updates every ~1.8s but we don't need that
 *     freshness for a 60s-cache app).
 *   - Dedup via `pendingPromise` — concurrent callers share one fetch.
 *   - Retry: 2 attempts with 500ms backoff on RPC errors.
 *   - Never throws — returns an empty result on failure so the price
 *     aggregator can fall through to the next source.
 *
 * Math caveat: FTSO returns `uint256` values with `int8` decimals. We
 * convert to JS Number (fine for v0 — the values are small enough that
 * float64 precision is not a concern for price display). Production
 * should use a fixed-point decimal lib.
 */

import { ethers } from "ethers";

// ---------------------------------------------------------------------------
// Configuration — env-overridable for flexibility, hardcoded for zero-config.
// ---------------------------------------------------------------------------

/** Flare mainnet C-chain RPC. Free, no key. Override via FLARE_RPC_URL. */
const FLARE_RPC_URL =
  process.env.FLARE_RPC_URL ?? "https://flare-api.flare.network/ext/C/rpc";

/**
 * FtsoV2 contract on Flare mainnet (chain ID 14). Resolved dynamically via
 * the FlareContractRegistry in the future; hardcoded for now since the
 * address is stable and enshrined in consensus.
 */
const FTSO_V2_ADDRESS = ethers.getAddress(
  "0x7bde3df0624114edb3a67dfe6753e62f4e7c1d20",
);

/** Cache TTL — 60s. FTSO updates every ~1.8s but House refreshes every 60s. */
const CACHE_TTL_MS = 60 * 1000;

/** Fetch timeout — 10s. If the RPC is this slow, fall through. */
const FETCH_TIMEOUT_MS = 10 * 1000;

/** Max retries on RPC failure. 2 = 3 total attempts. */
const MAX_RETRIES = 2;

/** Backoff between retries — 500ms, then 1000ms. */
const RETRY_BACKOFF_MS = 500;

// ---------------------------------------------------------------------------
// Feed IDs — bytes21 values for each asset.
//
// Format: 0x01 (category 1 = cryptocurrency) + ASCII hex of "ASSET/USD"
// + zero-padded to 21 bytes. Verified live on Flare mainnet.
// ---------------------------------------------------------------------------

/**
 * Build a bytes21 feed ID for a crypto asset on Flare FTSO v2.
 * Format: 0x01 + ASCII(symbol + "/USD") + zero-padding to 21 bytes.
 */
function buildFeedId(symbol: string): string {
  const ascii = Buffer.from(symbol.toUpperCase() + "/USD", "ascii");
  const bytes = new Uint8Array(21);
  bytes[0] = 0x01; // category 1 = cryptocurrency
  for (let i = 0; i < ascii.length && i + 1 < 21; i++) {
    bytes[i + 1] = ascii[i];
  }
  return "0x" + Buffer.from(bytes).toString("hex");
}

/**
 * The 8 House assets FTSO covers, mapped to their feed IDs.
 * Generated from the symbol — see `buildFeedId`.
 */
const FTSO_FEED_MAP: Readonly<Record<string, string>> = Object.freeze({
  btc: buildFeedId("BTC"),
  eth: buildFeedId("ETH"),
  xrp: buildFeedId("XRP"),
  xlm: buildFeedId("XLM"),
  sol: buildFeedId("SOL"),
  flr: buildFeedId("FLR"),
  usdc: buildFeedId("USDC"),
  usdt: buildFeedId("USDT"),
});

// ---------------------------------------------------------------------------
// ABI — minimal, just the one read method.
// ---------------------------------------------------------------------------

const FTSO_V2_ABI = [
  "function getFeedsById(bytes21[] feedIds) external view returns (uint256[] values, int8[] decimals, uint64 timestamp)",
];

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** One asset's FTSO price reading. */
export interface FtsoPriceEntry {
  /** USD price (value / 10^decimals). */
  price: number;
  /** Raw uint256 value from the contract. */
  rawValue: bigint;
  /** Decimals from the contract (int8). Typically 2-8. */
  decimals: number;
  /** Block timestamp of the reading (seconds since epoch). */
  timestamp: Date;
}

/** Result of an FTSO batched read. Keyed by lowercase assetId. */
export interface FtsoPriceResult {
  /** Map of lowercase assetId → price entry. Only includes assets FTSO covers. */
  prices: Record<string, FtsoPriceEntry>;
  /** When the read happened (cache time, not now). */
  fetchedAt: Date;
  /** True if the read succeeded; false if it fell through (empty map). */
  ok: boolean;
}

// ---------------------------------------------------------------------------
// Cache state — module-level, lives for the Node process lifetime.
// ---------------------------------------------------------------------------

let cachedResult: FtsoPriceResult | null = null;
let cacheExpiry = 0;
let pendingPromise: Promise<FtsoPriceResult> | null = null;

// ---------------------------------------------------------------------------
// Provider — lazy-init so the module doesn't open a connection on import.
// ---------------------------------------------------------------------------

let provider: ethers.JsonRpcProvider | null = null;
let ftsoContract: ethers.Contract | null = null;

function getFtsoContract(): ethers.Contract {
  if (!ftsoContract) {
    provider = new ethers.JsonRpcProvider(FLARE_RPC_URL, {
      chainId: 14,
      name: "flare",
    });
    ftsoContract = new ethers.Contract(FTSO_V2_ADDRESS, FTSO_V2_ABI, provider);
  }
  return ftsoContract;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch FTSO prices for all 8 covered assets in a single batched `eth_call`.
 *
 * Cache strategy: 60s TTL. Concurrent callers share one fetch via
 * `pendingPromise`. Never throws — returns `{ ok: false, prices: {} }` on
 * any failure so the aggregator can fall through.
 *
 * @returns FtsoPriceResult with a price map + ok flag + fetchedAt.
 */
export async function fetchFtsoPrices(): Promise<FtsoPriceResult> {
  const now = Date.now();
  if (cachedResult && now < cacheExpiry) {
    return cachedResult;
  }
  if (pendingPromise) {
    return pendingPromise;
  }
  pendingPromise = doFetchFtsoPrices().finally(() => {
    pendingPromise = null;
  });
  return pendingPromise;
}

/**
 * Internal fetch implementation with retry + timeout.
 *
 * On success: updates cache. On failure: returns empty result (no cache
 * update so the next call retries immediately).
 */
async function doFetchFtsoPrices(): Promise<FtsoPriceResult> {
  const fetchedAt = new Date();
  const entries = Object.entries(FTSO_FEED_MAP);
  const feedIds = entries.map(([, hex]) => hex as unknown as ethers.BytesLike);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const contract = getFtsoContract();
      const result = await withTimeout(
        contract.getFeedsById(feedIds),
        FETCH_TIMEOUT_MS,
      );
      const [values, decimals, timestamp] = result as [
        bigint[],
        number[],
        bigint,
      ];

      const prices: Record<string, FtsoPriceEntry> = {};
      const ts = new Date(Number(timestamp) * 1000);

      for (let i = 0; i < entries.length; i++) {
        const [assetId] = entries[i];
        const rawValue = values[i];
        const dec = decimals[i];
        // int8 can be negative in theory (though FTSO uses positive). Guard.
        const decimalsNum = Number(dec);
        if (decimalsNum < 0 || decimalsNum > 18) continue;
        const price = Number(rawValue) / Math.pow(10, decimalsNum);
        if (!Number.isFinite(price) || price <= 0) continue;
        prices[assetId] = {
          price,
          rawValue,
          decimals: decimalsNum,
          timestamp: ts,
        };
      }

      const result_ok: FtsoPriceResult = {
        prices,
        fetchedAt,
        ok: true,
      };
      cachedResult = result_ok;
      cacheExpiry = Date.now() + CACHE_TTL_MS;
      return result_ok;
    } catch (err) {
      // Last attempt failed — return empty result.
      if (attempt === MAX_RETRIES) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[flare-ftso] all ${MAX_RETRIES + 1} attempts failed: ${msg.slice(0, 120)}`,
        );
        return { prices: {}, fetchedAt, ok: false };
      }
      // Backoff before retry.
      await sleep(RETRY_BACKOFF_MS * (attempt + 1));
    }
  }

  // Unreachable — the loop returns on the last attempt.
  return { prices: {}, fetchedAt, ok: false };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Promise wrapper with a timeout — rejects after `ms` if not settled. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`FTSO read timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Sleep helper for retry backoff. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Invalidate the FTSO cache. Call this to force a fresh read on the next
 * `fetchFtsoPrices` call. Used by the price aggregator's refresh + the
 * diagnostic cross-check.
 */
export function invalidateFtsoCache(): void {
  cachedResult = null;
  cacheExpiry = 0;
}

/**
 * Get the current cache state for diagnostics. Returns null if no cache.
 */
export function getFtsoCacheState(): {
  ok: boolean;
  fetchedAt: Date;
  expiresAt: Date;
  isExpired: boolean;
  assetCount: number;
} | null {
  if (!cachedResult) return null;
  return {
    ok: cachedResult.ok,
    fetchedAt: cachedResult.fetchedAt,
    expiresAt: new Date(cacheExpiry),
    isExpired: Date.now() >= cacheExpiry,
    assetCount: Object.keys(cachedResult.prices).length,
  };
}

/**
 * The list of asset IDs FTSO covers. Used by the aggregator to know which
 * assets can use FTSO as a source.
 */
export const FTSO_COVERED_ASSETS: ReadonlySet<string> = new Set(
  Object.keys(FTSO_FEED_MAP),
);

/**
 * Build the feed ID for a given asset symbol. Exported for testing +
 * for the aggregator to verify a feed exists before trying to read it.
 */
export { buildFeedId };
