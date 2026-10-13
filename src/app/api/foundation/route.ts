/**
 * /api/foundation — the BFF endpoint that serves the architecture overview
 * page (the only user-visible route in v1, src/app/page.tsx).
 *
 * The route is a thin GET that surfaces the foundation state as a single
 * JSON object. It imports the domain layer (`@/server/domain`) and the
 * service contracts (`@/server/services`) so the response is grounded in
 * the same constants the runtime uses — the mode ladder, the signer
 * routing, the policy check names — instead of a parallel hand-written
 * copy that could drift.
 *
 * No live data is queried. The foundation status is reference content:
 * what is scaffolded, what is stubbed, what is next. Live book / market
 * data lands in Phase 1 Observe and would live under a different route.
 *
 * Auth (Task 42-45): the foundation route calls `getAuthUserId()` (the
 * non-throwing variant of `requireAuth`). If the request is unauthed,
 * the route returns a minimal payload `{ authenticated: false, market }`
 * so the AuthModal can still show a live/fallback price-source badge
 * without leaking the modes / policyGate / services / dataModel
 * internals. If authed, the full payload is returned with
 * `authenticated: true`.
 */

import { NextResponse } from "next/server";

// Domain layer — the runtime contracts. Imported so the response is the
// same shape the engine actually uses at decision time.
import {
  MODE_LADDER,
  type OperatingMode,
  OperatingMode as OperatingModeEnum,
  modeSigner,
} from "@/server/domain";
// Policy check names (stable enum; the order they run is encoded in the
// createPolicyEngine factory and reproduced verbatim below).
import { PolicyCheckName } from "@/server/domain/policy";

// Services barrel — references the stub class names so the foundation
// surface is anchored to the actual implementation surface (every stub
// throws not-implemented; the route does not call them).
import * as Services from "@/server/services";
// Live price source — Task 36. Foundation surfaces `priceSource` so the
// dashboard (Task 38) can render a Live-pulse vs Fallback-badge.
import {
  fetchLivePrices,
  getLivePriceCacheState,
} from "@/server/lib/coingecko-client";
import { getAuthUserId } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Mode ladder table (plan §2). The ladder keys come from the runtime
// constant `MODE_LADDER`; the human labels and "what runs" descriptions
// are the verbatim plan wording so the page matches the docs.
// ---------------------------------------------------------------------------

const MODE_META: Record<
  OperatingMode,
  { name: string; whatRuns: string }
> = {
  observe: {
    name: "Observe",
    whatRuns: "Balances, prices, PnL, drift vs target",
  },
  advise: {
    name: "Advise",
    whatRuns: "Policy engine writes a proposed book and a reason",
  },
  confirm: {
    name: "Confirm",
    whatRuns: "Same proposals, packaged as a batch",
  },
  rules: {
    name: "Rules",
    whatRuns: "Deterministic rebalance when drift or a schedule fires",
  },
  house: {
    name: "House",
    whatRuns:
      "AI proposes; policy still gates; execution uses the same grants",
  },
};

const DEFAULT_MODE: OperatingMode = OperatingModeEnum.Confirm;

const modes = MODE_LADDER.map((key) => ({
  key,
  name: MODE_META[key].name,
  whatRuns: MODE_META[key].whatRuns,
  whoSigns: modeSigner(key),
  defaultFor: key === DEFAULT_MODE ? "confirm" : null,
}));

// ---------------------------------------------------------------------------
// Policy gate — the 8 checks in the canonical run order. The order is
// encoded in createPolicyEngine (services/policy-engine.ts); this array
// reproduces it verbatim so the page shows the same sequence the engine
// runs. Behaviour text paraphrases the JSDoc per check.
// ---------------------------------------------------------------------------

const policyGate = [
  {
    order: 1,
    name: PolicyCheckName.KillSwitch,
    behavior:
      "If active, immediately reject with kill-switched. Stop. The decision is still logged.",
  },
  {
    order: 2,
    name: PolicyCheckName.Universe,
    behavior:
      "assetId must be in the mandate universe list. Reject if absent. Lists, not prompts.",
  },
  {
    order: 3,
    name: PolicyCheckName.Ethics,
    behavior:
      "Hard excludes — sanctioned addresses, known mixers, unverified contracts, user-blocked assets. The AI may NOT override a hard exclude.",
  },
  {
    order: 4,
    name: PolicyCheckName.Leverage,
    behavior:
      "Total exposure after the intent must not exceed riskBudget.leverageCap. Default 1.0; above 1.0 stays off in v1. Reject on breach (no resize).",
  },
  {
    order: 5,
    name: PolicyCheckName.Concentration,
    behavior:
      "Single-asset weight <= maxSingleAssetWeightBps (breach resizes); venue weight <= maxVenueConcentrationBps (breach rejects — venue choice is part of the intent identity).",
  },
  {
    order: 6,
    name: PolicyCheckName.Drawdown,
    behavior:
      "If portfolio drawdown from peak > maxPortfolioDrawdownBps, only transfer-to-stables intents are allowed. Any other side is rejected.",
  },
  {
    order: 7,
    name: PolicyCheckName.DailyTurnover,
    behavior:
      "Running turnover + this notional <= daily cap. A breach resizes the notional to fit under the remaining daily cap.",
  },
  {
    order: 8,
    name: PolicyCheckName.VenueHealth,
    behavior:
      "Venue must be healthy. Price dislocation, failed oracle, or signer error halts the book and pages the owner.",
  },
];

// ---------------------------------------------------------------------------
// Services — every service the foundation has scaffolded. Each is a stub
// throwing not-implemented per Task 2-b. The role / never-does text is
// paraphrased from docs/architecture.md so the page is the same source
// of truth.
// ---------------------------------------------------------------------------

const services = [
  {
    name: "BookService",
    phase: "Phase 1 — Observe",
    role: "Positions, cost basis, lots, and target weights. Owns the unit of strategy, permission, and reporting.",
    neverDoes:
      "Stores seeds. Stores trade key secrets in clear text. Calls the signer.",
    status: "stub" as const,
    implRef: Services.BookServiceImpl.name,
  },
  {
    name: "MarketService",
    phase: "Phase 1 — Observe",
    role: "Prices, liquidity, and venue status. Reference marks from CoinGecko or equivalent; executable marks from venue mids.",
    neverDoes:
      "Collapses reference and executable into one number. Both are stored as separate marks.",
    status: "stub" as const,
    implRef: Services.MarketServiceImpl.name,
  },
  {
    name: "ChainReader (Alchemy)",
    phase: "Phase 1 — Observe",
    role: "EVM balances and logs via Alchemy or QuickNode. Reads public addresses only.",
    neverDoes:
      "Holds private keys. Reads anything other than public on-chain state.",
    status: "stub" as const,
    implRef: Services.AlchemyChainReader.name,
  },
  {
    name: "ChainReader (Helius)",
    phase: "Phase 1 — Observe",
    role: "Solana balances via Helius. Provider is per-chain to avoid key sprawl (plan §12).",
    neverDoes:
      "Holds private keys. Used for EVM chains — those route to Alchemy instead.",
    status: "stub" as const,
    implRef: Services.HeliusChainReader.name,
  },
  {
    name: "VenueAdapter (CCXT)",
    phase: "Phase 1 read-only; Phase 3 trade-no-withdraw",
    role: "CCXT for CEX balances (read in Phase 1) and orders (trade in Phase 3). One adapter interface so a DEX router can sit beside it.",
    neverDoes:
      "Withdraws. Withdrawal is not in any scope the adapter is granted.",
    status: "stub" as const,
    implRef: Services.CcxtVenueAdapter.name,
  },
  {
    name: "PolicyEngine",
    phase: "Phase 2 — Paper book",
    role: "Pure function from book state plus mandate to allow, resize, or reject. Runs the 8-check gate in canonical order.",
    neverDoes:
      "Emits intents. Calls the signer. Calls the AI. Holds keys. Holds any DB handle.",
    status: "stub" as const,
    implRef: "createPolicyEngine",
  },
  {
    name: "Signer",
    phase: "Phase 3 Confirm / Phase 4 Rules",
    role: "Exchange trade keys in KMS; wallet session keys or a user wallet via WalletConnect. Signs accepted intents only. Isolated service account.",
    neverDoes:
      "Accepts text from the AI. Accepts intents that bypassed the policy engine. Runs in the same process as the AI.",
    status: "stub" as const,
    implRef: Services.KmsSigner.name,
  },
  {
    name: "AIHouse",
    phase: "Phase 5 — AI house service",
    role: "Reads book, mandate, and market features. Returns intents in the fixed schema and a short rationale. Swap models without touching execution.",
    neverDoes:
      "Holds keys. Has a network path to the signer. Emits anything outside the intent schema. Adds assets, venues, or leverage.",
    status: "stub" as const,
    implRef: Services.ToolCalledAIHouse.name,
  },
];

// ---------------------------------------------------------------------------
// Data model — every Prisma model with a one-line purpose and the
// immutability flag. The three immutable rows (MandateVersion,
// EthicsListVersion, DecisionLogEntry) are the audit spine (§7, §10).
// ---------------------------------------------------------------------------

const dataModel = [
  {
    model: "User",
    purpose: "One owner in v1. Later: beneficiary and operator roles.",
    immutable: false,
  },
  {
    model: "Session",
    purpose: "NextAuth session token.",
    immutable: false,
  },
  {
    model: "Book",
    purpose:
      "The unit of strategy, permission, and reporting. Holds the current mode and kill state.",
    immutable: false,
  },
  {
    model: "MandateVersion",
    purpose:
      "Immutable mandate snapshot. A change never overwrites history (§7).",
    immutable: true,
  },
  {
    model: "EthicsListVersion",
    purpose:
      "Immutable ethics list snapshot. Replayed against later decisions (§4).",
    immutable: true,
  },
  {
    model: "Account",
    purpose:
      "Exchange connection metadata, wallet addresses, chain ids. Holds a KMS reference, never a secret.",
    immutable: false,
  },
  {
    model: "Position",
    purpose:
      "Free, locked, staked, claimable. Stores source and confidence — no false precision.",
    immutable: false,
  },
  {
    model: "Lot",
    purpose:
      "Quantity, cost in book currency, venue, timestamp. The PnL ledger.",
    immutable: false,
  },
  {
    model: "Mark",
    purpose:
      "Reference price AND executable price, both stored. Never collapsed.",
    immutable: false,
  },
  {
    model: "Intent",
    purpose:
      "The only executable shape. asset, side, venue, notional, max slippage, expiry, reason.",
    immutable: false,
  },
  {
    model: "DecisionLogEntry",
    purpose:
      "Append-only. Proposal, policy result, signature id or user rejection, fill.",
    immutable: true,
  },
  {
    model: "DecisionApproval",
    purpose: "Owner approve/reject of an intent at Confirm mode.",
    immutable: false,
  },
  {
    model: "BookSnapshot",
    purpose: "Daily mark-to-book-currency for the drift view.",
    immutable: false,
  },
];

// ---------------------------------------------------------------------------
// Intent shape — the only executable contract (plan §3). Fields the
// proposer chooses, plus origin / status set by the engine and signer.
// ---------------------------------------------------------------------------

const intentShape = [
  {
    field: "assetId",
    type: "string",
    meaning: "Must be in the mandate universe. Lists, not prompts.",
  },
  {
    field: "side",
    type: "enum",
    meaning:
      "buy | sell | stake | unstake | transfer-to-stables. transfer-to-stables is the de-risk side.",
  },
  {
    field: "venue",
    type: "string",
    meaning: "CEX id or DEX router name. Must be an allowed venue.",
  },
  {
    field: "notional",
    type: "string",
    meaning:
      "In the book currency (e.g. USDC). String for fixed-point precision.",
  },
  {
    field: "maxSlippageBps",
    type: "int",
    meaning: "Cap on realized slippage. Breach rejects the fill.",
  },
  {
    field: "expiresAt",
    type: "datetime",
    meaning: "Stale intents are rejected by the policy engine on sight.",
  },
  {
    field: "reasonCode",
    type: "enum",
    meaning:
      "drift-rebalance | drawdown-de-risk | scheduled-rebalance | ai-proposal | user-approve.",
  },
  {
    field: "clientId",
    type: "string",
    meaning: "Idempotency id; retries cannot double-fill (§10).",
  },
  {
    field: "origin",
    type: "enum",
    meaning:
      "rules | ai | user. Set by the proposer path, not by the intent. The policy engine treats them the same.",
  },
  {
    field: "status",
    type: "enum",
    meaning:
      "pending | policy-rejected | user-rejected | kill-switched | signed | filled | expired. Set by the policy engine and signer.",
  },
  {
    field: "id",
    type: "string",
    meaning:
      "Generated at intent-creation time. Stays the same across a resize — the resized intent keeps the id.",
  },
  {
    field: "bookId",
    type: "string",
    meaning: "Scope of the intent. One book = one strategy, one permission grant.",
  },
];

// ---------------------------------------------------------------------------
// Response assembly.
// ---------------------------------------------------------------------------

const foundation = {
  product: {
    name: "House",
    tagline:
      "Bankroll OS for one crypto owner. Semi-automatic. AI is a later service — it never sits on the keys.",
    version: "0.0.1-foundation",
  },
  // Auth flag (Task 42-45) — set per-request in GET().
  authenticated: false as boolean,
  phase: {
    current: "Phase 0 — Mandate & legal posture",
    next: "Phase 1 — Observe",
  },
  nonCustody: {
    holdsSeeds: false,
    holdsWithdrawalKeys: false,
    tradeKeysScoped: true,
    aiPathToSigner: false,
  },
  // Advisory engine surfaced in Task 7. The foundation route advertises
  // the advisory endpoint so the page-builder (Task 9) can wire the
  // advisory dashboard without hardcoding the path.
  hasAdvisory: true,
  advisoryEndpoint: "/api/advisory",
  // Trust / tenant-container surfaced in Task 12. The foundation route
  // advertises the trust endpoint so page-builders (Task 14 onboarding
  // wizard, Task 15 page integration) can discover it without
  // hardcoding the path. Portfolio (pie-chart-data) is at
  // /api/portfolio; position CRUD at /api/trust/positions.
  hasTrust: true,
  trustEndpoint: "/api/trust",
  portfolioEndpoint: "/api/portfolio",
  // Mandate / ethics / decisions / snapshots endpoints surfaced in
  // Task 37 (mandate editor + decision log + NAV chart backend). The
  // page-builder (Task 38) reads `hasMandate` to know whether to
  // render the Mandate tab and `mandateEndpoint` for the GET/PUT URL.
  // Same pattern for ethics / decisions / snapshots.
  hasMandate: true,
  mandateEndpoint: "/api/trust/mandate",
  ethicsEndpoint: "/api/trust/ethics",
  decisionsEndpoint: "/api/trust/decisions",
  snapshotsEndpoint: "/api/trust/snapshots",
  // Live market data — Task 36. Surfaces `priceSource` so the dashboard
  // (Task 38) can render a Live-pulse vs Fallback-badge. Filled in by
  // the GET handler after the static parts are assembled.
  market: {
    priceSource: "fallback" as "live" | "fallback",
    fetchedAt: null as Date | null,
    cacheExpiresAt: null as Date | null,
  },
  modes,
  policyGate,
  services,
  dataModel,
  intentShape,
};

export type FoundationStatus = typeof foundation;

/** Minimal payload returned to unauthenticated callers. Includes only
 * the `market` field so the AuthModal can still show a live/fallback
 * badge — full architecture internals are not leaked to anonymous
 * requests. */
async function minimalFoundation() {
  const live = await fetchLivePrices();
  const cacheState = getLivePriceCacheState();
  const market = {
    priceSource: live.source,
    fetchedAt: live.fetchedAt,
    cacheExpiresAt: cacheState?.expiresAt ?? null,
  };
  return { authenticated: false as boolean, market };
}

export async function GET() {
  // Auth check (Task 42-45). Unauthenticated callers get the minimal
  // payload; authenticated callers get the full foundation + market.
  const userId = await getAuthUserId();
  if (!userId) {
    const minimal = await minimalFoundation();
    return NextResponse.json(minimal, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  }

  // Live price source — Task 36. fetchLivePrices is cached (60s TTL +
  // dedup) so this is cheap to call on every foundation fetch. If
  // CoinGecko is down, source="fallback" — the dashboard still renders,
  // it just shows a Fallback badge instead of a Live-pulse.
  const live = await fetchLivePrices();
  const cacheState = getLivePriceCacheState();
  const market = {
    priceSource: live.source,
    fetchedAt: live.fetchedAt,
    cacheExpiresAt: cacheState?.expiresAt ?? null,
  };
  const payload = { ...foundation, authenticated: true, market };
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
