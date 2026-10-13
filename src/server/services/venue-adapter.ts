import type { KeyScope, PositionState } from "../domain/book";
import type { AsyncResult } from "./types";

/**
 * A single balance reported by a venue adapter. CEX spot balances
 * typically come back as `state: "free"`; earn / staked balances on a
 * CEX come back as `state: "staked"` or `state: "locked"` depending on
 * the venue's API shape.
 */
export interface VenueBalance {
  assetId: string;
  quantity: string;
  state: PositionState;
}

/**
 * Venue adapter (plan §6): CCXT for CEX balances and, later, orders.
 * One adapter interface so a DEX router can sit beside it.
 *
 * In v1 / Phase 1 Observe this is READ-ONLY. Trade methods
 * (createOrder, cancelOrder, fetchOrder, etc.) are NOT on this
 * interface in v1. They are added in Phase 3 Confirm mode, behind a
 * separate `TradeVenueAdapter` type that extends this one. Read-only
 * until then — `keyScope()` MUST return `"read"` for any adapter used
 * in Observe.
 *
 * Trade keys without withdrawal (Confirm / Rules) and session keys
 * (House) are introduced later; the `keyScope()` method is the
 * invariant the policy engine and the signer rely on.
 */
export interface VenueAdapter {
  /** Stable venue id (e.g. "binance", "kraken", "uniswap-v3-router"). */
  venueId(): string;

  /**
   * Key scope currently configured on this adapter. Must be `"read"`
   * in v1 / Phase 1. The policy engine and signer both check this
   * before any trade path is invoked.
   */
  keyScope(): KeyScope;

  /**
   * Fetch all balances held at the venue. Returns an entry per asset
   * the venue reports, with the position state the venue assigns
   * (free / locked / staked / etc.).
   */
  fetchBalance(): AsyncResult<VenueBalance[]>;
}

/**
 * CCXT-shaped stub. Real impl lands in Phase 1 Observe against one
 * major CEX. The constructor takes a venue id and a key scope so a
 * future Confirm-mode adapter can be wired with the right scope
 * without changing this class.
 */
export class CcxtVenueAdapter implements VenueAdapter {
  private readonly _venueId: string;
  private readonly _keyScope: KeyScope;

  constructor(
    venueId = "ccxt-stub",
    keyScope: KeyScope = "read",
  ) {
    this._venueId = venueId;
    this._keyScope = keyScope;
  }

  venueId(): string {
    return this._venueId;
  }

  keyScope(): KeyScope {
    return this._keyScope;
  }

  async fetchBalance(): AsyncResult<VenueBalance[]> {
    throw new Error(
      "not-implemented: CcxtVenueAdapter.fetchBalance (Phase 1 Observe)",
    );
  }
}
