/**
 * Reference-priser for v1 Observe (owner direction Task 11; plan §6 —
 * MarketService kommer i Phase 1).
 *
 * Hardkodete reference-priser i USDC (book currency). Byttes ut med
 * MarketService i Phase 1 når live data er koblet. Verdier er
 * realistiske per oktober 2026 — de er IKKE for handel; de er bare
 * rådgivnings-NAV-regning.
 *
 * Konvensjoner:
 *   - Stablecoins (USDC/USDT/DAI/FRAX) = 1.0
 *   - Liquid staking receipts (stETH/rETH/cbETH) = 2500 (paritet med ETH)
 *   - BTC/WBTC = 60000
 *   - ETH = 2500
 *   - SOL = 130
 *   - Andre kjente assets — se tabellen under.
 *   - Default fallback: 1.0 med en warning (caller må markere confidence
 *     lavt). UNKNOWN_ASSET_FLAG returneres fra `referencePrice` så
 *     caller vet at prisen er en fallback.
 *
 * Math caveat: v0 bruker JS Number. Produksjon MÅ bruke fixed-point
 * decimal lib (decimal.js / bignumber.js). Ikke installer i v0 — dette
 * er den eksplisitte JSDoc-advarselen.
 */

/**
 * Map av assetId (lowercase) → reference price i USDC.
 *
 * Case-insensitive lookup via `referencePrice(assetId)`. Verdier er
 * statiske konstanter — aldri endre uten en ny commit og en melding
 * i worklog (rådgivnings-NAV må være deterministisk for replay).
 */
export const REFERENCE_PRICES: Readonly<Record<string, number>> = Object.freeze({
  // stablecoins — exactly 1.0 USDC
  usdc: 1.0,
  usdt: 1.0,
  dai: 1.0,
  frax: 1.0,
  rlusd: 1.0, // Ripple's stablecoin
  // liquid staking receipts — paritet med ETH
  steth: 2500,
  reth: 2500,
  cbeth: 2500,
  // conservative
  btc: 60000,
  wbtc: 60000,
  eth: 2500,
  // balanced
  sol: 130,
  arb: 0.8,
  op: 1.5,
  avax: 25,
  uni: 7.5,
  aave: 100,
  ldo: 2.0,
  // XRP-ecosystem L1s (per eier direction — default portfolio)
  xrp: 2.30,
  xlm: 0.35,
  flr: 0.020,
  // aggressive (demo)
  doge: 0.1,
});

/**
 * Default fallback-pris for ukjente assets. 1.0 USDC — caller må
 * markere confidence lavt (se `referencePrice` returverdi-flagg).
 */
export const UNKNOWN_ASSET_FALLBACK_PRICE = 1.0;

/**
 * Result av reference-price-oppslag. `confidence` er lavt hvis prisen
 * er en fallback (asset ikke i tabellen).
 */
export interface ReferencePriceResult {
  /** Pris i USDC (book currency). */
  price: number;
  /** True hvis asset er i REFERENCE_PRICES; false hvis fallback. */
  known: boolean;
  /** Source-string for audit / display. */
  source: string;
}

/**
 * Slå opp reference-pris for en asset. Case-insensitive. For ukjente
 * assets returneres 1.0 USDC med `known: false` så caller kan markere
 * confidence lavt og logge en warning.
 *
 * Pure function; ingen side-effects eller I/O. Trygg å kalle fra både
 * server og seed-script.
 */
export function referencePrice(assetId: string): ReferencePriceResult {
  const key = assetId.toLowerCase();
  const price = REFERENCE_PRICES[key];
  if (typeof price === "number") {
    return {
      price,
      known: true,
      source: "reference-prices-v0",
    };
  }
  return {
    price: UNKNOWN_ASSET_FALLBACK_PRICE,
    known: false,
    source: "reference-prices-v0-fallback",
  };
}
