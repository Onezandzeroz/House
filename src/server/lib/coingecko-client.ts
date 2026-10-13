/**
 * CoinGecko live price client (Task 36 — Live market data integration).
 *
 * House-arkitekturen har inntil nå brukt hardkodete REFERENCE_PRICES for
 * NAV / dry-powder / sleeve-allokering. Denne modulen henter live USD-priser
 * fra CoinGeckos gratis `/simple/price`-endepunkt (ingen API-nøkkel kreves
 * for basisbruk) og faller tilbake på REFERENCE_PRICES hvis CoinGecko er
 * nede eller rate-limiter.
 *
 * Strategi (plan §6; owner direction Task 35):
 *   - Cache: modul-nivå in-memory cache, 60 sekunders TTL. Lever så lenge
 *     Node-isolatet lever — OK for v1 dev. Produksjon bytter til Redis.
 *   - Dedup: samtidige kall deler samme fetch-promise (`pendingPromise`)
 *     slik at en burst av requests bare utløser ÉN HTTP-forespørsel.
 *   - Fallback: hvis fetch feiler (nettverksfeil, 429, 5xx, timeout),
 *     returneres REFERENCE_PRICES med `source: "fallback"`. Caller får
 *     ALLTID et svar — aldri kast til caller.
 *   - Per-asset fallback: assets som ikke er på CoinGecko (f.eks. rlusd)
 *     bruker reference-pris (1.0 for stablecoins).
 *
 * API-detaljer:
 *   - Endpoint: https://api.coingecko.com/api/v3/simple/price
 *   - Query: ?ids=bitcoin,ethereum,...&vs_currencies=usd&include_24hr_change=true
 *   - Rate limit: ~15 calls/min gratis tier. Vår 60s cache → max 1 call/min.
 *   - Ingen API-nøkkel for gratis tier. Hvis CoinGecko senere krever det,
 *     les `COINGECKO_API_KEY` env og bruk header `x-cg-demo-api-key`.
 *
 * Math caveat: v0 bruker JS Number. Produksjon MÅ bruke fixed-point decimal
 * lib. Ikke installer i v0 — dette er den eksplisitte JSDoc-advarselen.
 */

import { REFERENCE_PRICES } from "./reference-prices";

/**
 * CoinGecko ID-mapping for alle assets i House-universet.
 *
 * Nøkkel = lowercase assetId (samme case som REFERENCE_PRICES). Verdi =
 * CoinGecko platform-id brukt i `/simple/price?ids=<...>`-spørringen.
 *
 * Gjeldende CoinGecko-mapping (verify mot https://api.coingecko.com/api/v3/coins/list
 * hvis en id endrer seg — stable, men sjekk ved støre CoinGecko-reorgs).
 *
 * Assets UTEN mapping (rlusd): ikke sendes til CoinGecko; fallback til
 * reference-pris (1.0 for stablecoins) gjelder.
 */
const COINGECKO_IDS: Readonly<Record<string, string>> = Object.freeze({
  btc: "bitcoin",
  wbtc: "wrapped-bitcoin",
  eth: "ethereum",
  usdc: "usd-coin",
  usdt: "tether",
  dai: "dai",
  frax: "frax",
  xrp: "ripple",
  xlm: "stellar",
  flr: "flare-networks",
  sol: "solana",
  arb: "arbitrum",
  avax: "avalanche-2",
  op: "optimism",
  uni: "uniswap",
  aave: "aave",
  ldo: "lido-dao",
  doge: "dogecoin",
  steth: "staked-ether",
  reth: "rocket-pool-eth",
  // cbETH — on CoinGecko the platform id is "coinbase-wrapped-eth"
  // (NOT "coinbase-wrapped-btc"; the latter is cbBTC). v1 demo uses cbETH.
  cbeth: "coinbase-wrapped-eth",
  // rlusd: not yet on CoinGecko — falls back to reference price $1.00.
});

/**
 * Cache-TTL i millisekunder. 60s = 1 call/min, godt under CoinGeckos
 * gratis-tier rate limit (~15/min).
 */
const CACHE_TTL_MS = 60 * 1000;

/**
 * Fetch-timeout i millisekunder. 5s — hvis CoinGecko ikke svarer innen
 * da, bruk fallback. Vi vil aldri at BFF-en skal henge på en treg
 * upstream.
 */
const FETCH_TIMEOUT_MS = 5 * 1000;

/**
 * Resultat av `fetchLivePrices`. Inneholder en pris-map (lowercase assetId
 * → USD pris), source-flagg (live / fallback), og timestamp for når
 * dataene ble hentet (cache-tid, ikke nåtid, så caller vet hvor fersk
 * prisen er).
 */
export interface LivePriceResult {
  /** Pris-map: lowercase assetId → USD pris. Inkluderer ALLE assets fra
   * REFERENCE_PRICES, med live-pris der CoinGecko har data, reference-pris
   * ellers. */
  prices: Record<string, number>;
  /** "live" hvis CoinGecko-kallet lyktes; "fallback" hvis vi falt tilbake til
   * REFERENCE_PRICES. UI-en (Task 38) bruker dette til å vise en Live-pulse
   * badge vs en Fallback-badge. */
  source: "live" | "fallback";
  /** Tidspunktet prisen ble hentet (cache-tid, ikke nåtid). For UI-display. */
  fetchedAt: Date;
}

/**
 * Cache-state — modul-nivå, lever så lenge Node-isolatet lever.
 *
 *   - `cachedResult`     : sist vellykkede resultat (live ELLER fallback).
 *   - `cacheExpiry`      : timestamp for når cachedResult går ut på tid.
 *   - `pendingPromise`   : pågående fetch (for dedup). Null når ingen
 *                          pågående fetch.
 */
let cachedResult: LivePriceResult | null = null;
let cacheExpiry: number = 0;
let pendingPromise: Promise<LivePriceResult> | null = null;

/**
 * Bygg URL for CoinGecko `/simple/price`-kall. Samler alle CoinGecko-IDs
 * fra `COINGECKO_IDS` i én komma-separert query-string.
 *
 * Pure function — ingen side-effects. Eksportert kun for testbarhet.
 */
export function buildCoingeckoUrl(): string {
  const ids = Object.values(COINGECKO_IDS).join(",");
  const params = new URLSearchParams({
    ids,
    vs_currencies: "usd",
    include_24hr_change: "true",
  });
  return `https://api.coingecko.com/api/v3/simple/price?${params.toString()}`;
}

/**
 * Hent live USD-priser fra CoinGecko for alle assets i House-universet.
 *
 * Cache-strategi:
 *   - Hvis cache er gyldig (ikke utløpt), returneres cached resultat
 *     umiddelbart — ingen nettverks-IO.
 *   - Hvis cache er utløpt ELLER ikke eksisterer: start en ny fetch (lagret
 *     i `pendingPromise`). Samtidige kall får samme promise (dedup).
 *
 * Fallback-strategi:
 *   - Hvis fetch feiler (nettverksfeil, 429, 5xx, timeout): returner
 *     REFERENCE_PRICES med `source: "fallback"`. Caller får ALLTID et svar.
 *   - For assets ikke på CoinGecko (rlusd): bruk reference-pris.
 *
 * Aldri kast til caller. Hvis noe går galt, returneres fallback-data.
 *
 * @returns LivePriceResult med pris-map + source + fetchedAt.
 */
export async function fetchLivePrices(): Promise<LivePriceResult> {
  // 1. Cache hit — return umiddelbart.
  const now = Date.now();
  if (cachedResult && now < cacheExpiry) {
    return cachedResult;
  }

  // 2. Dedup — hvis en fetch allerede pågår, vent på den.
  if (pendingPromise) {
    return pendingPromise;
  }

  // 3. Start ny fetch. Lagre promise for dedup.
  pendingPromise = doFetchLivePrices().finally(() => {
    pendingPromise = null;
  });
  return pendingPromise;
}

/**
 * Intern fetch-implementasjon. Gjør selve HTTP-kallet, bygger LivePriceResult,
 * håndterer fallback ved feil.
 *
 * Cache-oppdatering: VELLYKKET fetch oppdaterer `cachedResult` + `cacheExpiry`.
 * FEILET fetch oppdaterer IKKE cache (slik at neste kall prøver på nytt
 * umiddelbart — ikke vent 60s på nytt forsøk).
 */
async function doFetchLivePrices(): Promise<LivePriceResult> {
  const fetchedAt = new Date();

  try {
    const url = buildCoingeckoUrl();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...coingeckoAuthHeaders(),
        },
        // next: { revalidate: 0 } — vi har egen cache, ikke bruk Next.js
        // fetch-cache for prisdata (force-dynamic route uansett).
        cache: "no-store",
      });
    } finally {
      clearTimeout(timeout);
    }

    // 429 = rate-limited; 5xx = CoinGecko-serverfeil; begge → fallback.
    if (!response.ok) {
      return fallbackResult(fetchedAt);
    }

    const json = (await response.json()) as Record<
      string,
      { usd?: number; usd_24h_change?: number }
    >;

    // 4. Bygg pris-map: start med ALLE reference-priser, overskriv med live
    // der CoinGecko har data. assets uten CoinGecko-mapping (rlusd) får
    // reference-pris ($1.00 for stablecoins).
    const prices: Record<string, number> = { ...REFERENCE_PRICES };

    for (const [assetId, coingeckoId] of Object.entries(COINGECKO_IDS)) {
      const entry = json[coingeckoId];
      if (entry && typeof entry.usd === "number" && Number.isFinite(entry.usd)) {
        prices[assetId] = entry.usd;
      }
      // Hvis CoinGecko mangler prisen for denne id-en, behold reference.
    }

    const result: LivePriceResult = {
      prices,
      source: "live",
      fetchedAt,
    };

    // Cache kun vellykkede resultater.
    cachedResult = result;
    cacheExpiry = Date.now() + CACHE_TTL_MS;

    return result;
  } catch {
    // Fetch feilet (nettverksfeil, timeout via AbortController, JSON-parse,
    // etc.). Returner fallback — aldri kast til caller.
    return fallbackResult(fetchedAt);
  }
}

/**
 * Bygg fallback-resultat fra REFERENCE_PRICES. Brukes når CoinGecko er
 * uopprettelig. Cache IKKE — neste kall prøver CoinGecko på nytt.
 */
function fallbackResult(fetchedAt: Date): LivePriceResult {
  return {
    prices: { ...REFERENCE_PRICES },
    source: "fallback",
    fetchedAt,
  };
}

/**
 * Hvis `COINGECKO_API_KEY` env er satt, returner headers for demo-API-key.
 * Gratis tier krever ikke nøkkel, men CoinGecko kan innføre det senere.
 */
function coingeckoAuthHeaders(): Record<string, string> {
  const key = process.env.COINGECKO_API_KEY;
  if (!key) return {};
  return { "x-cg-demo-api-key": key };
}

/**
 * Tving cache til å utløpe ved neste kall. Eksportert for testbarhet og
 * for fremtidig "refresh prices"-knapp i UI-en (Task 38+).
 *
 * Side-effect: nuller `cachedResult` og setter `cacheExpiry` til 0. Hvis en
 * pågående fetch er i gang, lar vi den fullføre (den vil enten oppdatere
 * cache eller la være ved feil).
 */
export function invalidateLivePriceCache(): void {
  cachedResult = null;
  cacheExpiry = 0;
}

/**
 * Hent cache-state for diagnostikk (UI kan vise "last updated X sek siden").
 * Eksportert for Task 38+ UI-bruk. Returnerer null hvis cache er tom.
 */
export function getLivePriceCacheState(): {
  source: "live" | "fallback";
  fetchedAt: Date;
  expiresAt: Date;
  isExpired: boolean;
} | null {
  if (!cachedResult) return null;
  return {
    source: cachedResult.source,
    fetchedAt: cachedResult.fetchedAt,
    expiresAt: new Date(cacheExpiry),
    isExpired: Date.now() >= cacheExpiry,
  };
}

/**
 * Exporter COINGECKO_IDS for testbarhet og for at UI-en (Task 38) kan vise
 * "N assets tracked live" (antall mappet til CoinGecko).
 */
export const COINGECKO_ID_MAPPING: Readonly<Record<string, string>> =
  COINGECKO_IDS;
