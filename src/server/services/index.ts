/**
 * Services barrel — re-exports every service interface and stub.
 * Imported as `@/server/services` (or `@/server` for the full server
 * surface via the parent barrel).
 *
 * Stubs throw `not-implemented` so callers fail loudly. Real impls
 * land per the plan's phase schedule:
 *
 *   Phase 1 Observe  : BookService, MarketService, ChainReader,
 *                      VenueAdapter (read-only).
 *   Phase 2 Paper    : PolicyEngine arithmetic (checkUniverse etc.).
 *   Phase 3 Confirm  : TradeVenueAdapter (extends VenueAdapter), Signer
 *                      for WalletConnect.
 *   Phase 4 Rules    : KmsSigner session keys; kill switch drill.
 *   Phase 5 House    : ToolCalledAIHouse.
 */

export * from "./types";
export * from "./book-service";
export * from "./market-service";
export * from "./chain-reader";
export * from "./venue-adapter";
export * from "./policy-engine";
export * from "./signer";
export * from "./ai-house";
