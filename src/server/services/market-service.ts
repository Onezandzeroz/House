import type { Mark } from "../domain/book";
import { MarkKind } from "../domain/book";
import { HouseError } from "../domain/errors";
import { fetchLivePrices } from "../lib/coingecko-client";
import { referencePrice } from "../lib/reference-prices";
import type { AsyncResult, ServiceInfo } from "./types";
import { ServiceHealth } from "./types";

/**
 * Market service (plan §6): prices, liquidity, and venue status.
 * CoinGecko or equivalent for reference prices; venue mids for execution.
 *
 * The two mark kinds (plan §7) MUST NOT be collapsed: `getReferenceMark`
 * returns a `reference` mark used for NAV / drift / drawdown;
 * `getExecutableMark` returns an `executable` mark used by the policy
 * engine's slippage check and by the executor for fill reconciliation.
 *
 * `venueHealth` is the policy engine's `venue-health` check input. A
 * degraded venue (e.g. withdrawals halted) is reported here, not in the
 * book state.
 *
 * `health` is for introspection by the foundation route / ops dashboard.
 * v1 CoingeckoMarketService is "healthy" by construction (live fetch with
 * reference fallback — caller får ALLTID en pris).
 */
export interface MarketService {
  /**
   * Reference mark for an asset in the book currency. CoinGecko-shaped:
   * a single mid, no liquidity context beyond 24h volume.
   */
  getReferenceMark(
    assetId: string,
    bookCurrency: string,
  ): AsyncResult<Mark>;

  /**
   * Executable mark for an asset on a specific venue, in the book
   * currency. Venue mids; the liquidity context carries top-of-book
   * depth so the policy engine can estimate slippage for a given
   * notional.
   */
  getExecutableMark(
    assetId: string,
    venue: string,
    bookCurrency: string,
  ): AsyncResult<Mark>;

  /**
   * Venue health. `healthy=false` triggers the policy engine's
   * `venue-health` reject. `notes` carries the human-readable reason
   * (e.g. "withdrawals halted", "API 5xx rate exceeded").
   */
  venueHealth(
    venue: string,
  ): AsyncResult<{ venue: string; healthy: boolean; notes?: string }>;

  /**
   * Service health for introspection. v1: CoinGecko-service is healthy by
   * construction (live fetch with reference fallback).
   */
  health(): AsyncResult<ServiceInfo>;
}

// ---------------------------------------------------------------------------
// CoingeckoMarketService — v1 live implementation (Task 36).
// ---------------------------------------------------------------------------

/**
 * v1 CoinGecko-backed MarketService.
 *
 * Implementation notes (Task 36):
 *   - Reference marks: live CoinGecko `/simple/price` with 60s cache + dedup
 *     (se coingecko-client.ts). Fallback to REFERENCE_PRICES on failure —
 *     caller får ALLTID en pris.
 *   - Executable marks: v1 = reference (single mid). Produksjon bytter til
 *     venue-mid med top-of-book depth fra CEX-adapter.
 *   - Venue health: v1 antar alle venues "healthy". Produksjon sjekker
 *     faktisk API-status per venue.
 *   - `source`-feltet på Mark indikerer "coingecko" (live), "reference-
 *     fallback" (CoinGecko nede), eller "reference-prices-v0[-fallback]"
 *     (asset ikke på CoinGecko).
 *
 * Math caveat: v0 bruker JS Number. Produksjon MÅ bruke fixed-point decimal
 * lib. Prisene formateres med 8 desimaler (høy presisjon — små assets som
 * FLR kan være $0.02; ARB $0.80) så fixed-point-konvertering senere ikke
 * mister informasjon.
 */
export class CoingeckoMarketService implements MarketService {
  /**
   * Reference mark for en asset i book currency. Henter live CoinGecko-
   * pris (60s cache); fallback til reference-pris hvis CoinGecko er nede
   * ELLER asset ikke er på CoinGecko.
   *
   * `Mark.source` settes til:
   *   - "coingecko"               — live CoinGecko-pris.
   *   - "reference-fallback"      — CoinGecko ute, bruker reference-pris.
   *   - "reference-prices-v0"      — asset ikke på CoinGecko (kunne ikke
   *                                 hentes live), bruker reference-pris.
   *   - "reference-prices-v0-fallback" — asset ukjent, fallback 1.0.
   */
  async getReferenceMark(
    assetId: string,
    _bookCurrency: string,
  ): AsyncResult<Mark> {
    try {
      const { prices, source } = await fetchLivePrices();
      const key = assetId.toLowerCase();
      const livePrice = prices[key];

      let price: number;
      let markSource: string;

      if (typeof livePrice === "number" && Number.isFinite(livePrice)) {
        // Live CoinGecko-pris tilgjengelig.
        price = livePrice;
        markSource = source === "live" ? "coingecko" : "reference-fallback";
      } else {
        // Asset ikke i live-pris-data — bruk reference-pris.
        const ref = referencePrice(assetId);
        price = ref.price;
        markSource = ref.source;
      }

      const now = new Date();
      const mark: Mark = {
        id: `mark-ref-${key}-${now.getTime()}`,
        bookId: "", // Mark er book-agnostisk i v1 — caller binder til Book.
        assetId,
        kind: MarkKind.Reference,
        price: price.toFixed(8),
        liquidity: null,
        source: markSource,
        observedAt: now,
        createdAt: now,
      };
      return { ok: true, value: mark };
    } catch (err) {
      // Ukjent feil — wrap til HouseError. Skal ikke skje siden fetchLivePrices
      // aldri kaster, men vi er defensive.
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: new HouseError("market-service-error", message),
      };
    }
  }

  /**
   * Executable mark for en asset på en spesifikk venue. v1: executable =
   * reference (single mid). Produksjon bytter til venue-mid med top-of-
   * book depth (`liquidity`-feltet) slik at policy-engine kan estimere
   * slippage for et gitt notional.
   *
   * NB: `bookCurrency` ignoreres i v1 (antatt USDC); venue-valuta-konvertering
   * er en Phase 3-utvidelse.
   */
  async getExecutableMark(
    assetId: string,
    venue: string,
    bookCurrency: string,
  ): AsyncResult<Mark> {
    // v1: executable = reference. Produksjon henter venue-mid fra
    // CEX-adapter (CCXT ticker) og inkluderer top-of-book depth i
    // `liquidity`-feltet.
    const refResult = await this.getReferenceMark(assetId, bookCurrency);
    if (!refResult.ok) return refResult;

    // Override `kind` og `source` for å markere at dette er executable.
    // Pris + liquidity er samme som reference i v1.
    const now = new Date();
    const executable: Mark = {
      ...refResult.value,
      id: `mark-exec-${assetId.toLowerCase()}-${venue.toLowerCase()}-${now.getTime()}`,
      kind: MarkKind.Executable,
      // Liquidity fremdeles null i v1; venue-depth kommer i Phase 3.
      liquidity: null,
      source: `${refResult.value.source}+venue:${venue}`,
    };
    return { ok: true, value: executable };
  }

  /**
   * Venue health. v1 antar alle venues "healthy" — den faktiske API-status-
   * sjekken kommer i Phase 3 sammen med CEX-adapteret. `notes` markerer
   * at dette er en v1-antakelse så UI-en kan vise det.
   */
  async venueHealth(
    venue: string,
  ): AsyncResult<{ venue: string; healthy: boolean; notes?: string }> {
    return {
      ok: true,
      value: {
        venue,
        healthy: true,
        notes: "v1: assumed healthy (Phase 3 will check API status)",
      },
    };
  }

  /**
   * Service health for foundation-route introspection. v1: alltid "healthy"
   * fordi CoingeckoMarketService har fallback — selv om CoinGecko er nede,
   * returnerer vi pris (fra REFERENCE_PRICES).
   */
  async health(): AsyncResult<ServiceInfo> {
    return {
      ok: true,
      value: {
        name: "CoingeckoMarketService",
        health: ServiceHealth.Healthy,
        version: "0.1.0-live",
        notes: "Live CoinGecko prices with 60s cache; fallback to reference prices.",
      },
    };
  }
}

// ---------------------------------------------------------------------------
// MarketServiceImpl — kept as a stub for the foundation route's service
// introspection table (foundation/route.ts references Services.MarketServiceImpl.name).
// The stub returns a not-implemented Result so callers fail loudly if used
// directly. Real callers use `createMarketService()` which returns the
// live `CoingeckoMarketService`.
// ---------------------------------------------------------------------------

/**
 * Stub implementation retained for backwards compatibility with the
 * foundation route's service table (Services.MarketServiceImpl.name). Real
 * callers use `createMarketService()` which returns the live
 * `CoingeckoMarketService`. Do NOT use this stub directly for price lookups.
 *
 * @deprecated Use `createMarketService()` instead.
 */
export class MarketServiceImpl implements MarketService {
  async getReferenceMark(
    _assetId: string,
    _bookCurrency: string,
  ): AsyncResult<Mark> {
    return {
      ok: false,
      error: new HouseError(
        "not-implemented",
        "MarketServiceImpl is a stub; use createMarketService() for live prices.",
      ),
    };
  }

  async getExecutableMark(
    _assetId: string,
    _venue: string,
    _bookCurrency: string,
  ): AsyncResult<Mark> {
    return {
      ok: false,
      error: new HouseError(
        "not-implemented",
        "MarketServiceImpl is a stub; use createMarketService() for live prices.",
      ),
    };
  }

  async venueHealth(
    _venue: string,
  ): AsyncResult<{ venue: string; healthy: boolean; notes?: string }> {
    return {
      ok: false,
      error: new HouseError(
        "not-implemented",
        "MarketServiceImpl is a stub; use createMarketService() for live prices.",
      ),
    };
  }

  async health(): AsyncResult<ServiceInfo> {
    return {
      ok: false,
      error: new HouseError(
        "not-implemented",
        "MarketServiceImpl is a stub; use createMarketService() for live prices.",
      ),
    };
  }
}

/**
 * Factory. Returnerer en `CoingeckoMarketService` instans med live
 * CoinGecko-priser (60s cache) og fallback til REFERENCE_PRICES.
 *
 * En senere fase kan bytte implementasjon (f.eks. en CachingMarketService
 * som caches getReferenceMark i 5 sekunder) ved å bytte kroppen her.
 */
export function createMarketService(): MarketService {
  return new CoingeckoMarketService();
}
