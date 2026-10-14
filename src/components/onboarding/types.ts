/**
 * Shared types and constants for the onboarding wizard (Task 14).
 *
 * The wizard takes a new trustee through four steps:
 *   1. Name the trust + confirm the trustee / AI roles.
 *   2. Add the starting funds (one row per position).
 *   3. Review the four-sleeve pie preview + dry-powder status.
 *   4. Submit to `POST /api/trust` and confirm.
 *
 * All state lives in `OnboardingWizard` (`useState` only — no global
 * store). Step components receive props (state slices + setters) and emit
 * intents ("next" / "back" / "submit") via callbacks. The wizard owns the
 * state so the steps stay dumb components.
 *
 * Universe list — the assets the trustee can pick in Step 2. Mirrors the
 * categorisation table in `src/server/domain/bankroll.ts` so the
 * sleeve-preview badge matches what the policy engine will compute later.
 *
 * Sleeve preview — pure helper `previewSleeveForAsset(assetId)` calls
 * `categorizeAsset` and returns the sleeve label + chip tone so the
 * per-row badge stays in sync with the policy engine's source of truth.
 *
 * NAV preview — pure helper `previewPortfolio(positions)` walks the rows,
 * looks up `REFERENCE_PRICES`, groups by sleeve, and returns the sleeve
 * breakdown + NAV + dry-powder bps + status. The pie chart in Step 3
 * consumes the `AdvisoryOpinion`-shaped output via `toPieData`.
 */

import {
  DryPowderStatus,
  type AdvisoryOpinion,
} from "@/server/domain/advisory";
import {
  categorizeAsset,
  type RiskCategory,
  BankrollPrinciplesSchema,
  RISK_CATEGORY_ORDER,
} from "@/server/domain/bankroll";
import { REFERENCE_PRICES } from "@/server/lib/reference-prices";

// ---------------------------------------------------------------------------
// Universe list — the assets the trustee can pick in Step 2.
// ---------------------------------------------------------------------------

/**
 * The onboarding universe — the assets the trustee can add as a position
 * in Step 2. Each entry carries the `category` (sleeve) so the
 * sleeve-preview badge can render without round-tripping through the
 * domain categorisation table for known assets. For unknown / custom
 * assets (the "Other…" path), `previewSleeveForAsset` falls through to
 * `categorizeAsset` and (per the domain default) returns `aggressive`.
 *
 * Order: stable first (dry powder), then conservative, balanced,
 * aggressive — same canonical order as `RISK_CATEGORY_ORDER` so the
 * dropdown reads top-to-bottom from low to high risk.
 */
export const ONBOARDING_UNIVERSE = [
  // stable — dry powder (including XRP-ecosystem stablecoins per eier direction)
  { id: "USDC", name: "USDC", category: "stable" as const },
  { id: "USDT", name: "Tether", category: "stable" as const },
  { id: "RLUSD", name: "Ripple USD", category: "stable" as const },
  { id: "DAI", name: "DAI", category: "stable" as const },
  { id: "FRAX", name: "FRAX", category: "stable" as const },
  // conservative — blue-chip
  { id: "BTC", name: "Bitcoin", category: "conservative" as const },
  { id: "WBTC", name: "Wrapped Bitcoin", category: "conservative" as const },
  { id: "ETH", name: "Ethereum", category: "conservative" as const },
  // stable — liquid staking receipts
  { id: "stETH", name: "Lido Staked ETH", category: "stable" as const },
  { id: "rETH", name: "Rocket Pool ETH", category: "stable" as const },
  { id: "cbETH", name: "Coinbase Wrapped ETH", category: "stable" as const },
  // XRP-ecosystem L1s (per eier direction — default portfolio)
  { id: "XRP", name: "XRP", category: "balanced" as const },
  { id: "XLM", name: "Stellar Lumens", category: "balanced" as const },
  { id: "FLR", name: "Flare", category: "balanced" as const },
  // balanced — established L1/L2 + DeFi blue-chips
  { id: "SOL", name: "Solana", category: "balanced" as const },
  { id: "ARB", name: "Arbitrum", category: "balanced" as const },
  { id: "AVAX", name: "Avalanche", category: "balanced" as const },
  { id: "OP", name: "Optimism", category: "balanced" as const },
  { id: "UNI", name: "Uniswap", category: "balanced" as const },
  { id: "AAVE", name: "Aave", category: "balanced" as const },
  { id: "LDO", name: "Lido DAO", category: "balanced" as const },
  // aggressive — smaller cap / meme
  { id: "DOGE", name: "Dogecoin", category: "aggressive" as const },
] as const;

/** A single universe entry — the dropdown rows in Step 2. */
export type UniverseAsset = (typeof ONBOARDING_UNIVERSE)[number];

// ---------------------------------------------------------------------------
// Multi-page onboarding (Task 47-49) — 5 full-screen pages.
// ---------------------------------------------------------------------------

/**
 * DeFi position type — used by the Side 4 "Staking / DeFi" venue path.
 * Mirrors the OnboardingInput positionType enum.
 */
export type DeFiPositionType = "staking" | "lending" | "lp" | "vault";

/**
 * Reporting level for beneficiaries (Side 3). Mirrors the
 * OnboardingInput beneficiaries[].reportingLevel enum.
 */
export type ReportingLevel = "full" | "summary";

/**
 * Trust type — picked on Side 1. Mirrors the OnboardingInput trustType
 * enum. The values are kebab-cased to match the Prisma column.
 */
export type TrustType =
  | "family-fund"
  | "personal"
  | "investment-club";

/** Book currency — picked on Side 1. Default USDC. */
export type BookCurrency = "USDC" | "USDT" | "DAI";

/**
 * One editable beneficiary row in Side 3. `id` is a client-side stable
 * key (crypto.randomUUID) so the row keeps identity across edits.
 *
 *   - name + email are required when the row is non-empty.
 *   - relationship is free-text ("Son", "Spouse", etc.).
 *   - reportingLevel: "full" (default) | "summary".
 */
export interface Beneficiary {
  /** Client-side stable id. */
  id: string;
  /** Beneficiary full name. Required when the row is non-empty. */
  name: string;
  /** Email where reports are delivered. Required when the row is non-empty. */
  email: string;
  /** Free-text relationship to the trustee ("Son", "Spouse", etc.). */
  relationship: string;
  /** "full" (default) | "summary" — reporting level. */
  reportingLevel: ReportingLevel;
}

/**
 * One editable position row in Side 4 — extended with DeFi metadata
 * (Task 47-49). The legacy `WizardPosition` shape is preserved (id,
 * assetId, quantity, venueKind, venue, isCustomAsset) so the preview
 * helpers (previewPortfolio, buildPreviewOpinion) continue to work
 * unchanged. The DeFi fields below are only relevant when
 * venueKind === "stake-defi".
 *
 *   - protocol        : "Aave", "Lido", "XMagnetic" — only for stake-defi.
 *   - positionType    : "staking" | "lending" | "lp" | "vault" — only for stake-defi.
 *   - contractAddress : optional verification address — only for stake-defi.
 *   - apyBps          : APY in basis points (500 = 5%). UI shows %; converted
 *                       to bps on submit. Only for stake-defi.
 *   - lockEnd         : ISO date string when a locked position unlocks.
 *                       Only for stake-defi.
 */
export interface WizardPositionV2 extends WizardPosition {
  /** Protocol name (e.g. "Aave", "Lido", "XMagnetic"). stake-defi only. */
  protocol: string;
  /** Position type — stake-defi only. */
  positionType: DeFiPositionType | "";
  /** Optional contract address for verification — stake-defi only. */
  contractAddress: string;
  /**
   * APY in PERCENT (e.g. "5.2"). UI-input. The wizard converts to bps on
   * submit (5.2 → 520). Empty string = not set. stake-defi only.
   */
  apyPercent: string;
  /** ISO date string (yyyy-mm-dd) when the locked position unlocks. stake-defi only. */
  lockEnd: string;
}

/**
 * WizardForm — the full collected state across all 5 pages. The
 * multi-page wizard owns this state; each page component receives a
 * slice + setters and emits intents via callbacks.
 *
 *   Side 1 — trust details: name, trustType, bookCurrency, description.
 *   Side 2 — trustee info: trusteeName, trusteePhone, trusteeAddress.
 *              Email is read-only from the session and not stored here.
 *   Side 3 — beneficiaries: beneficiaries[].
 *   Side 4 — portfolio: positions[] (WizardPositionV2 with DeFi fields).
 *   Side 5 — review: confirmed (boolean), derived from the user checking
 *              the confirmation checkbox on the review page.
 */
export interface WizardForm {
  // Side 1 — Trust details
  name: string;
  trustType: TrustType;
  bookCurrency: BookCurrency;
  description: string;

  // Side 2 — Trustee info (email comes from session, not stored here)
  trusteeName: string;
  trusteePhone: string;
  trusteeAddress: string;

  // Side 3 — Beneficiaries
  beneficiaries: Beneficiary[];

  // Side 4 — Positions (extended with DeFi fields)
  positions: WizardPositionV2[];

  // Side 5 — Confirmation
  confirmed: boolean;
}

/** The five multi-page wizard pages, in order. */
export type MultiPageStep = 1 | 2 | 3 | 4 | 5;

/** Multi-page step metadata — the labels shown in the progress bar. */
export const MULTI_PAGE_STEPS: ReadonlyArray<{
  step: MultiPageStep;
  label: string;
  shortLabel: string;
}> = [
  { step: 1, label: "Trust details", shortLabel: "Trust" },
  { step: 2, label: "Trustee information", shortLabel: "Trustee" },
  { step: 3, label: "Beneficiaries", shortLabel: "Beneficiaries" },
  { step: 4, label: "Assets & positions", shortLabel: "Assets" },
  { step: 5, label: "Review & confirm", shortLabel: "Review" },
];

/** Trust-type options for the Side 1 select. */
export const TRUST_TYPE_OPTIONS: ReadonlyArray<{
  value: TrustType;
  label: string;
  hint: string;
}> = [
  {
    value: "family-fund",
    label: "Family Fund",
    hint: "Multi-generational fond — the default House posture.",
  },
  {
    value: "personal",
    label: "Personal",
    hint: "Single-owner trust — you alone are the trustee and beneficiary.",
  },
  {
    value: "investment-club",
    label: "Investment Club",
    hint: "Small group with shared mandate — operator-style governance.",
  },
];

/** Book-currency options for the Side 1 select. */
export const BOOK_CURRENCY_OPTIONS: ReadonlyArray<{
  value: BookCurrency;
  label: string;
  hint: string;
}> = [
  { value: "USDC", label: "USDC", hint: "Circle USD Coin — the default." },
  { value: "USDT", label: "USDT", hint: "Tether — largest market cap stable." },
  { value: "DAI", label: "DAI", hint: "MakerDAO — decentralized stable." },
];

/** Reporting-level options for the Side 3 select. */
export const REPORTING_LEVEL_OPTIONS: ReadonlyArray<{
  value: ReportingLevel;
  label: string;
  hint: string;
}> = [
  {
    value: "full",
    label: "Full view",
    hint: "Per-asset positions + NAV + decision log.",
  },
  {
    value: "summary",
    label: "Summary only",
    hint: "NAV + sleeve weights only — no individual positions.",
  },
];

/** DeFi position-type options for the Side 4 select. */
export const DEFI_POSITION_TYPE_OPTIONS: ReadonlyArray<{
  value: DeFiPositionType;
  label: string;
  hint: string;
}> = [
  {
    value: "staking",
    label: "Staking",
    hint: "Native or liquid staking (e.g. Lido, Rocket Pool).",
  },
  {
    value: "lending",
    label: "Lending",
    hint: "Money-market deposit (e.g. Aave, Compound).",
  },
  {
    value: "lp",
    label: "LP",
    hint: "Liquidity-provider receipt token (e.g. Uniswap v3).",
  },
  {
    value: "vault",
    label: "Vault",
    hint: "Yield-vault share (e.g. Yearn, Beefy).",
  },
];

// ---------------------------------------------------------------------------
// Venue kinds — the four AccountKind values (mirror of domain/book.ts).
// ---------------------------------------------------------------------------

/** The six venue kinds, mirror of `AccountKind` in domain/book.ts. */
export type VenueKind =
  | "cex"
  | "evm-wallet"
  | "solana-wallet"
  | "stake-defi"
  | "xrp-wallet"
  | "dex";

/** Display metadata for each venue kind — label + hint shown in Step 2. */
export const VENUE_KIND_META: Record<
  VenueKind,
  { label: string; hint: string }
> = {
  cex: {
    label: "Exchange",
    hint: "CEX balance (e.g. binance, coinbase).",
  },
  "evm-wallet": {
    label: "EVM wallet",
    hint: "Ethereum / L2 self-custody (e.g. ledger, metamask).",
  },
  "solana-wallet": {
    label: "Solana wallet",
    hint: "Solana self-custody (e.g. phantom, solflare).",
  },
  "stake-defi": {
    label: "Staking / DeFi",
    hint: "Staked or LP'd position (e.g. lido, aave).",
  },
  "xrp-wallet": {
    label: "XRP wallet",
    hint: "XRPL self-custody (e.g. cold storage, xumm).",
  },
  dex: {
    label: "DEX",
    hint: "On-chain DEX position (e.g. xmagnetic.org, uniswap).",
  },
};

// ---------------------------------------------------------------------------
// Wizard state — owned by `OnboardingWizard`.
// ---------------------------------------------------------------------------

/**
 * One editable position row in Step 2. `id` is a client-side stable key
 * so the row keeps its identity across edits even if the user swaps the
 * assetId. `assetId` is empty until the user picks an asset (or enters a
 * custom one via the "Other…" path).
 *
 * `quantity` is a string so the user can type freely (e.g. "0.5",
 * "100", "1.5") before we parse it for NAV preview / submit.
 */
export interface WizardPosition {
  /** Client-side stable id (crypto.randomUUID() on row creation). */
  id: string;
  /** Asset id (e.g. "BTC"). Empty string = not chosen yet. */
  assetId: string;
  /** Quantity as typed by the user. Parsed on submit / preview. */
  quantity: string;
  /** Venue kind. Defaults to "cex". */
  venueKind: VenueKind;
  /** Venue label (e.g. "binance", "ledger"). Required on submit. */
  venue: string;
  /**
   * Entry price per unit in book currency (USDC). Only for non-stablecoin
   * assets — collected during onboarding per eier direction: "I need to
   * know entry prices of the assets (not stable coins)." Empty string =
   * not provided (falls back to reference price for cost basis).
   */
  entryPrice: string;
  /**
   * True when the user picked the "Other…" asset path. The asset id is
   * then free-text and the sleeve preview falls through to
   * `categorizeAsset` (which defaults unknowns to `aggressive`).
   */
  isCustomAsset: boolean;
}

/** The four wizard steps, in order. */
export type WizardStep = 1 | 2 | 3 | 4;

/** Wizard step metadata — the number shown in the progress bar. */
export const WIZARD_STEPS: ReadonlyArray<{
  step: WizardStep;
  label: string;
  shortLabel: string;
}> = [
  { step: 1, label: "Name the trust", shortLabel: "Name" },
  { step: 2, label: "Add starting funds", shortLabel: "Funds" },
  { step: 3, label: "Review portfolio", shortLabel: "Review" },
  { step: 4, label: "Confirm & create", shortLabel: "Confirm" },
];

// ---------------------------------------------------------------------------
// Sleeve preview — pure helpers used by Step 2 + Step 3.
// ---------------------------------------------------------------------------

/** Sleeve display metadata — label + chip tone classes (matches the advisory palette). */
export const SLEEVE_META: Record<
  RiskCategory,
  { label: string; chip: string; dot: string }
> = {
  stable: {
    label: "Stable",
    chip: "bg-allow/15 text-allow-foreground border-allow/40",
    dot: "bg-allow-foreground",
  },
  conservative: {
    label: "Conservative",
    chip: "bg-primary/15 text-primary border-primary/40",
    dot: "bg-primary",
  },
  balanced: {
    label: "Balanced",
    chip: "bg-warn/15 text-warn-foreground border-warn/40",
    dot: "bg-warn-foreground",
  },
  aggressive: {
    label: "Aggressive",
    chip: "bg-reject/15 text-reject-foreground border-reject/40",
    dot: "bg-reject-foreground",
  },
};

/**
 * Preview the sleeve for an asset id. Uses `categorizeAsset` so the badge
 * matches the policy engine's source of truth exactly. For unknown /
 * custom assets the domain returns `aggressive` — the trustee must opt
 * them down deliberately (per the JSDoc on `categorizeAsset`).
 */
export function previewSleeveForAsset(assetId: string): RiskCategory {
  if (!assetId) return "aggressive";
  return categorizeAsset(assetId);
}

// ---------------------------------------------------------------------------
// NAV preview — pure helpers used by Step 2 + Step 3.
// ---------------------------------------------------------------------------

/**
 * One asset's preview contribution — value (in book currency) and
 * sleeve category. The portfolio preview below groups these by sleeve.
 */
export interface PreviewAssetContribution {
  assetId: string;
  quantity: number;
  price: number;
  value: number;
  category: RiskCategory;
}

/** Per-sleeve preview aggregate — used by the Step 3 sleeve badges. */
export interface PreviewSleeveAggregate {
  category: RiskCategory;
  value: number;
  weightBps: number;
  assetIds: string[];
}

/** The full portfolio preview returned by `previewPortfolio`. */
export interface PortfolioPreview {
  /** Total NAV in book currency (USDC). 0 if no positions. */
  nav: number;
  /** Per-sleeve aggregates, in canonical order. */
  sleeves: PreviewSleeveAggregate[];
  /** Stable sleeve weight, in bps. The dry-powder fraction. */
  dryPowderBps: number;
  /** Five-zone dry-powder status. */
  dryPowderStatus: (typeof DryPowderStatus)[keyof typeof DryPowderStatus];
  /** Number of valid positions (asset chosen + quantity > 0). */
  positionsCount: number;
  /** True if at least one position has a non-zero value. */
  hasPositions: boolean;
}

/** Parse a string quantity into a finite, non-negative number. */
function parseQuantity(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

/**
 * Preview the portfolio from the wizard's editable rows. For each row with
 * a chosen asset + quantity > 0, compute the value (quantity × reference
 * price) and group by sleeve via `categorizeAsset`.
 *
 * Returns a zeroed `PortfolioPreview` (hasPositions=false) if no rows
 * contribute. The pie chart in Step 3 renders the empty-state in that
 * case.
 *
 * Math caveat: v0 uses JS Number — fine for the onboarding preview where
 * values are small. Production code MUST use a fixed-point decimal lib
 * (see `src/server/domain/advisory.ts` JSDoc warning).
 */
export function previewPortfolio(
  positions: ReadonlyArray<WizardPosition>,
): PortfolioPreview {
  const contributions: PreviewAssetContribution[] = [];
  for (const p of positions) {
    const assetId = p.assetId.trim();
    if (!assetId) continue;
    const qty = parseQuantity(p.quantity);
    if (qty <= 0) continue;
    const key = assetId.toLowerCase();
    const price = REFERENCE_PRICES[key] ?? 1.0; // unknown → fallback
    contributions.push({
      assetId,
      quantity: qty,
      price,
      value: qty * price,
      category: categorizeAsset(assetId),
    });
  }

  const nav = contributions.reduce((s, c) => s + c.value, 0);
  if (nav <= 0) {
    return {
      nav: 0,
      sleeves: RISK_CATEGORY_ORDER.map((category) => ({
        category,
        value: 0,
        weightBps: 0,
        assetIds: [],
      })),
      dryPowderBps: 0,
      dryPowderStatus: DryPowderStatus.AboveFloor,
      positionsCount: 0,
      hasPositions: false,
    };
  }

  const sleeves: PreviewSleeveAggregate[] = RISK_CATEGORY_ORDER.map(
    (category) => {
      const inSleeve = contributions.filter((c) => c.category === category);
      const value = inSleeve.reduce((s, c) => s + c.value, 0);
      return {
        category,
        value,
        weightBps: Math.round((value / nav) * 10000),
        assetIds: inSleeve.map((c) => c.assetId),
      };
    },
  );

  const dryPowderBps = sleeves.find((s) => s.category === "stable")
    ?.weightBps ?? 0;

  return {
    nav,
    sleeves,
    dryPowderBps,
    dryPowderStatus: dryPowderStatusFromBps(dryPowderBps),
    positionsCount: contributions.length,
    hasPositions: true,
  };
}

/** The five-zone dry-powder classification (mirrors the advisor's logic). */
function dryPowderStatusFromBps(
  bps: number,
): (typeof DryPowderStatus)[keyof typeof DryPowderStatus] {
  // Defaults from BankrollPrinciplesSchema: floor=3000, critical=2000,
  // target=3500. ±50 bps around target = "at-target".
  if (bps < 2000) return DryPowderStatus.Critical;
  if (bps < 3000) return DryPowderStatus.BelowFloor;
  if (bps < 3450) return DryPowderStatus.AboveFloor;
  if (bps <= 3550) return DryPowderStatus.AtTarget;
  return DryPowderStatus.AboveTarget;
}

/**
 * Helper — sum the values of one asset across the wizard rows. Used by
 * `buildPreviewOpinion` to compute per-asset weights.
 */
function assetValue(
  positions: ReadonlyArray<WizardPosition>,
  assetId: string,
): number {
  const key = assetId.toLowerCase();
  const price = REFERENCE_PRICES[key] ?? 1.0;
  return positions
    .filter((p) => p.assetId === assetId)
    .reduce((s, p) => s + parseQuantity(p.quantity) * price, 0);
}

/**
 * Build an `AdvisoryOpinion`-shaped payload from the wizard positions so
 * the Step 3 pie chart can render via the same `toPieData` normaliser the
 * live dashboard uses. The opinion is NOT the advisor's real output — it
 * is a preview scaffold with:
 *   - regime = transitional (no live signals yet)
 *   - principles = the bankroll defaults (BankrollPrinciplesSchema.parse({}))
 *   - sleeves / allocationAdvice = derived from the wizard rows
 *   - opportunities / warnings = empty (the advisory engine emits those)
 *
 * The pie chart only reads `sleeves`, `allocationAdvice`, `nav`,
 * `dryPowderBps`, `dryPowderStatus`, and `asOf` — the rest is structural
 * filler to satisfy the `AdvisoryOpinion` type.
 */
export function buildPreviewOpinion(
  positions: ReadonlyArray<WizardPosition>,
): AdvisoryOpinion {
  const preview = previewPortfolio(positions);
  const principles = BankrollPrinciplesSchema.parse({});

  // Build the sleeve list with assets (string[]) so `toPieData`'s opinion
  // adapter can walk them. `currentWeightBps` carries the live weight.
  const sleeves = preview.sleeves.map((s) => ({
    category: s.category,
    assets: s.assetIds,
    targetWeightBps: s.weightBps, // target = current for preview (no advice yet)
    currentWeightBps: s.weightBps,
  }));

  // Per-asset allocation advice — `hold` for everything (no advisory run).
  const allocationAdvice = preview.sleeves.flatMap((s) =>
    s.assetIds.map((assetId) => {
      const w = Math.round(
        (assetValue(positions, assetId) / Math.max(preview.nav, 1)) * 10000,
      );
      return {
        assetId,
        riskCategory: s.category,
        action: "hold" as const,
        currentWeightBps: w,
        targetWeightBps: w,
        deltaBps: 0,
        notionalChange: "0.00",
        reason: "Onboarding preview — no advisory run yet.",
      };
    }),
  );

  return {
    bookId: "preview",
    asOf: new Date(),
    regime: {
      regime: "transitional",
      confidence: 0.5,
      signals: [],
      observedAt: new Date(),
      summary:
        "Onboarding preview — regime detection runs once the trust is created.",
    },
    principles,
    nav: preview.nav.toFixed(2),
    sleeves,
    dryPowderBps: preview.dryPowderBps,
    dryPowderStatus: preview.dryPowderStatus,
    houseEdgeBps: 0,
    allocationAdvice,
    opportunities: [],
    warnings: [],
    summary: "Onboarding preview — review the starting portfolio.",
  };
}

// ---------------------------------------------------------------------------
// Validation — pure helpers used by the wizard before Next / submit.
// ---------------------------------------------------------------------------

/** True if the trust name is valid (1..120 chars after trim). */
export function isValidTrustName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 120;
}

/** True if a position row is complete enough to submit. */
export function isPositionComplete(p: WizardPosition): boolean {
  return (
    p.assetId.trim().length >= 1 &&
    p.venue.trim().length >= 1 &&
    parseQuantity(p.quantity) > 0
  );
}

/**
 * Format a USDC NAV number as a "$XXX XXX" short string. Whole-number,
 * space-separated thousands, no decimals — matches the dashboard's
 * `formatMoneyShort` convention so the onboarding preview reads the same
 * as the live page.
 */
export function formatNavShort(nav: number): string {
  if (!Number.isFinite(nav) || nav <= 0) return "$0";
  const rounded = Math.round(nav);
  return `$${rounded.toLocaleString("en-US").replace(/,/g, " ")}`;
}

// ---------------------------------------------------------------------------
// Multi-page onboarding helpers (Task 47-49).
// ---------------------------------------------------------------------------

/**
 * Generate a stable row id. Uses `crypto.randomUUID` when available;
 * falls back to a Date.now + Math.random string for environments where
 * the crypto API isn't present. Used for both beneficiary rows and
 * position rows so they keep identity across edits.
 */
export function makeRowId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Build the initial empty beneficiary row. Used by the Side 3 "Add
 * another beneficiary" button + as the initial row when the wizard
 * mounts. All fields are blank; reportingLevel defaults to "full".
 */
export function makeEmptyBeneficiary(): Beneficiary {
  return {
    id: makeRowId(),
    name: "",
    email: "",
    relationship: "",
    reportingLevel: "full",
  };
}

/**
 * Build the initial empty position row (Side 4). Venue kind defaults to
 * "cex" (the most common — onboarding's first row is usually a CEX
 * balance). All DeFi metadata fields are blank so non-DeFi rows carry
 * no DeFi data on submit.
 */
export function makeEmptyPositionV2(): WizardPositionV2 {
  return {
    id: makeRowId(),
    assetId: "",
    quantity: "",
    venueKind: "cex",
    venue: "",
    entryPrice: "",
    isCustomAsset: false,
    protocol: "",
    positionType: "",
    contractAddress: "",
    apyPercent: "",
    lockEnd: "",
  };
}

/**
 * Build the initial WizardForm for the multi-page wizard. Side 1 is
 * filled with sane defaults (USDC + family-fund); the other pages
 * start with one empty row each (one beneficiary + one position).
 *
 * The wizard may pre-fill `trusteeName` from the NextAuth session and
 * `name` from the registration form's "trust name" field if the user
 * registered via AuthModal. The pre-fill happens in
 * `multi-page-wizard.tsx` after construction.
 */
export function makeInitialWizardForm(): WizardForm {
  return {
    name: "",
    trustType: "family-fund",
    bookCurrency: "USDC",
    description: "",
    trusteeName: "",
    trusteePhone: "",
    trusteeAddress: "",
    beneficiaries: [makeEmptyBeneficiary()],
    positions: [makeEmptyPositionV2()],
    confirmed: false,
  };
}

/**
 * Build a WizardForm pre-filled with the "Smith Family Reserve" demo
 * data — the same portfolio the seed script writes for the demo user
 * (trustee@house.local). Used by the "Load demo data" button in the
 * onboarding wizard so a new user can see a complete, realistic trust
 * filled in across all 5 pages without typing anything.
 *
 * The portfolio (per eier direction):
 *   - CEX (binance):        BTC + USDC   — blue-chip + dry powder
 *   - DEX (xmagnetic.org):  FLR + XRP    — XRPL ecosystem L1s
 *   - XRP-wallet (cold storage): XLM + RLUSD + USDT + SOL
 *
 * entryPrice is set for non-stablecoin assets; stablecoins (USDC,
 * RLUSD, USDT) omit it (they are $1.00 by definition). Beneficiaries
 * include a spouse (full reporting) + a son (summary reporting) so the
 * beneficiary page shows two realistic rows.
 *
 * `confirmed` is left false — the user still reviews and checks the
 * confirmation box on Side 5 before submitting.
 */
export function makeDemoWizardForm(): WizardForm {
  const demoPositions: WizardPositionV2[] = [
    // CEX (binance) — blue-chip + USDC for trading
    {
      id: makeRowId(),
      assetId: "BTC",
      quantity: "1.2",
      venueKind: "cex",
      venue: "binance",
      entryPrice: "60000",
      isCustomAsset: false,
      protocol: "",
      positionType: "",
      contractAddress: "",
      apyPercent: "",
      lockEnd: "",
    },
    {
      id: makeRowId(),
      assetId: "USDC",
      quantity: "75000",
      venueKind: "cex",
      venue: "binance",
      entryPrice: "",
      isCustomAsset: false,
      protocol: "",
      positionType: "",
      contractAddress: "",
      apyPercent: "",
      lockEnd: "",
    },
    // DEX (xmagnetic.org) — XRPL ecosystem L1s
    {
      id: makeRowId(),
      assetId: "FLR",
      quantity: "50000",
      venueKind: "dex",
      venue: "xmagnetic.org",
      entryPrice: "0.020",
      isCustomAsset: false,
      protocol: "",
      positionType: "",
      contractAddress: "",
      apyPercent: "",
      lockEnd: "",
    },
    {
      id: makeRowId(),
      assetId: "XRP",
      quantity: "10000",
      venueKind: "dex",
      venue: "xmagnetic.org",
      entryPrice: "2.30",
      isCustomAsset: false,
      protocol: "",
      positionType: "",
      contractAddress: "",
      apyPercent: "",
      lockEnd: "",
    },
    // XRP-wallet (cold storage) — self-custody
    {
      id: makeRowId(),
      assetId: "XLM",
      quantity: "50000",
      venueKind: "xrp-wallet",
      venue: "cold storage",
      entryPrice: "0.35",
      isCustomAsset: false,
      protocol: "",
      positionType: "",
      contractAddress: "",
      apyPercent: "",
      lockEnd: "",
    },
    {
      id: makeRowId(),
      assetId: "RLUSD",
      quantity: "25000",
      venueKind: "xrp-wallet",
      venue: "cold storage",
      entryPrice: "",
      isCustomAsset: false,
      protocol: "",
      positionType: "",
      contractAddress: "",
      apyPercent: "",
      lockEnd: "",
    },
    {
      id: makeRowId(),
      assetId: "USDT",
      quantity: "25000",
      venueKind: "xrp-wallet",
      venue: "cold storage",
      entryPrice: "",
      isCustomAsset: false,
      protocol: "",
      positionType: "",
      contractAddress: "",
      apyPercent: "",
      lockEnd: "",
    },
    {
      id: makeRowId(),
      assetId: "SOL",
      quantity: "100",
      venueKind: "xrp-wallet",
      venue: "cold storage",
      entryPrice: "130",
      isCustomAsset: false,
      protocol: "",
      positionType: "",
      contractAddress: "",
      apyPercent: "",
      lockEnd: "",
    },
  ];

  return {
    // Side 1 — Trust details
    name: "Smith Family Reserve",
    trustType: "family-fund",
    bookCurrency: "USDC",
    description:
      "Family reserve — blue-chip BTC + XRPL ecosystem + stablecoin dry powder across Binance, XMagnetic DEX, and cold storage.",
    // Side 2 — Trustee info
    trusteeName: "Demo Trustee",
    trusteePhone: "+1 (555) 123-4567",
    trusteeAddress: "1 Reserve Court, Geneva, Switzerland",
    // Side 3 — Beneficiaries
    beneficiaries: [
      {
        id: makeRowId(),
        name: "Eleanor Smith",
        email: "eleanor.smith@example.com",
        relationship: "Spouse",
        reportingLevel: "full",
      },
      {
        id: makeRowId(),
        name: "James Smith",
        email: "james.smith@example.com",
        relationship: "Son",
        reportingLevel: "summary",
      },
    ],
    // Side 4 — Positions
    positions: demoPositions,
    // Side 5 — Confirmation (user still checks the box)
    confirmed: false,
  };
}

/**
 * True if a beneficiary row is "empty" — i.e. the user has not typed
 * anything into name OR email. Empty rows are skipped on submit so
 * the user can leave the last partial row blank without an error.
 *
 * A row that has SOMETHING in name OR email is "started" and must be
 * fully complete (see `isBeneficiaryComplete`).
 */
export function isBeneficiaryEmpty(b: Beneficiary): boolean {
  return b.name.trim() === "" && b.email.trim() === "";
}

/**
 * True if a beneficiary row is complete enough to submit. A row is
 * complete when:
 *   - name is at least 1 char (after trim), AND
 *   - email is a valid email format.
 *
 * Used by the wizard to gate the Next button (Side 3 → Side 4):
 *   - If the user has ANY non-empty beneficiary row, EVERY started row
 *     must be complete before Next is enabled.
 *   - Empty rows are allowed and skipped on submit.
 */
export function isBeneficiaryComplete(b: Beneficiary): boolean {
  if (isBeneficiaryEmpty(b)) return true; // empty is "complete" (skipped)
  return (
    b.name.trim().length >= 1 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim())
  );
}

/**
 * True if Side 3 is valid: either no beneficiaries at all, OR every
 * started row is complete. The wizard uses this to gate Next.
 *
 * "Started" means name OR email has content. If both are blank, the
 * row is treated as a placeholder and skipped on submit.
 */
export function isBeneficiariesValid(
  beneficiaries: ReadonlyArray<Beneficiary>,
): boolean {
  // Empty list is valid — the trust can start without beneficiaries.
  if (beneficiaries.length === 0) return true;
  // Every non-empty row must be complete.
  return beneficiaries.every((b) => isBeneficiaryComplete(b));
}

/**
 * Filter beneficiaries to only the complete, non-empty rows. Used by
 * the wizard on submit so the user can leave a partial last row blank
 * without an error.
 */
export function filterCompleteBeneficiaries(
  beneficiaries: ReadonlyArray<Beneficiary>,
): Beneficiary[] {
  return beneficiaries.filter((b) => !isBeneficiaryEmpty(b));
}

/**
 * True if a Side 4 position row (V2) is complete enough to submit. A
 * row is complete when:
 *   - assetId is at least 1 char,
 *   - venue is at least 1 char,
 *   - quantity parses to a positive number.
 *
 * For DeFi positions (venueKind === "stake-defi") the protocol + position
 * fields are recommended but NOT required for v1 — we accept partial
 * DeFi metadata because the user may not know the contract address yet.
 *
 * The wizard uses this to gate Next (Side 4 → Side 5): at least one row
 * must be complete.
 */
export function isPositionV2Complete(p: WizardPositionV2): boolean {
  return (
    p.assetId.trim().length >= 1 &&
    p.venue.trim().length >= 1 &&
    parseQuantity(p.quantity) > 0
  );
}

/**
 * Filter Side 4 positions to only the complete, non-empty rows. Used
 * by the wizard on submit so partial trailing rows are skipped.
 */
export function filterCompletePositionsV2(
  positions: ReadonlyArray<WizardPositionV2>,
): WizardPositionV2[] {
  return positions.filter(isPositionV2Complete);
}

/**
 * True if Side 4 is valid: at least one complete position row.
 */
export function isPositionsValidV2(
  positions: ReadonlyArray<WizardPositionV2>,
): boolean {
  return positions.some(isPositionV2Complete);
}

/**
 * Convert the wizard's positions (V2 with apyPercent string) to the
 * OnboardingInput shape (with apyBps number). Used by the multi-page
 * wizard on submit.
 *
 *   - apyPercent "5.2" → apyBps 520 (Math.round(percent * 100)).
 *   - lockEnd "2026-12-31" → ISO string (kept as-is; service converts to Date).
 *   - DeFi metadata (protocol, positionType, contractAddress, apyBps,
 *     lockEnd) is set ONLY when venueKind === "stake-defi".
 *   - entryPrice is set ONLY for non-stablecoin assets (Task 57 per
 *     eier direction). Stablecoins are $1.00 by definition; the UI
 *     hides the entry-price field for them so the trustee never types
 *     a redundant value. The trust-service uses entryPrice to seed a
 *     Lot row for cost-basis tracking; if the field is omitted, the
 *     service falls back to the reference price (see trust-service.ts
 *     onboarding-create around line 611).
 */
export function positionsV2ToInput(
  positions: ReadonlyArray<WizardPositionV2>,
): Array<{
  assetId: string;
  quantity: string;
  venue: string;
  venueKind: WizardPositionV2["venueKind"];
  protocol?: string;
  positionType?: "staking" | "lending" | "lp" | "vault";
  contractAddress?: string;
  apyBps?: number;
  lockEnd?: string;
  entryPrice?: string;
}> {
  return positions.map((p) => {
    const isDefi = p.venueKind === "stake-defi";
    const trimmedAssetId = p.assetId.trim();
    // Stablecoins are $1.00 by definition — skip entryPrice entirely
    // so the trustee doesn't fill a redundant value (per eier direction
    // Task 57). For non-stables an empty entryPrice falls back to the
    // reference price on the server.
    const isStable =
      trimmedAssetId.length > 0 &&
      categorizeAsset(trimmedAssetId) === "stable";
    const trimmedEntryPrice = p.entryPrice.trim();
    const base = {
      assetId: trimmedAssetId,
      quantity: p.quantity.trim(),
      venue: p.venue.trim(),
      venueKind: p.venueKind,
      // Only attach entryPrice for non-stablecoin rows with a non-empty
      // value. Empty string → undefined so the wire shape stays clean.
      ...(isStable || trimmedEntryPrice.length === 0
        ? {}
        : { entryPrice: trimmedEntryPrice }),
    };
    if (!isDefi) return base;
    // DeFi metadata — only include fields that are non-empty.
    const out: typeof base & {
      protocol?: string;
      positionType?: "staking" | "lending" | "lp" | "vault";
      contractAddress?: string;
      apyBps?: number;
      lockEnd?: string;
      entryPrice?: string;
    } = { ...base };
    if (p.protocol.trim().length > 0) {
      out.protocol = p.protocol.trim();
    }
    if (p.positionType !== "") {
      out.positionType = p.positionType;
    }
    if (p.contractAddress.trim().length > 0) {
      out.contractAddress = p.contractAddress.trim();
    }
    const apyNum = Number.parseFloat(p.apyPercent);
    if (Number.isFinite(apyNum) && apyNum > 0) {
      out.apyBps = Math.round(apyNum * 100);
    }
    if (p.lockEnd.trim().length > 0) {
      out.lockEnd = p.lockEnd.trim();
    }
    return out;
  });
}

/**
 * Convert the wizard's beneficiaries to the OnboardingInput shape
 * (name + email + optional relationship + reportingLevel).
 */
export function beneficiariesToInput(
  beneficiaries: ReadonlyArray<Beneficiary>,
): Array<{
  name: string;
  email: string;
  relationship?: string;
  reportingLevel: "full" | "summary";
}> {
  return beneficiaries.map((b) => {
    const out: {
      name: string;
      email: string;
      relationship?: string;
      reportingLevel: "full" | "summary";
    } = {
      name: b.name.trim(),
      email: b.email.trim(),
      reportingLevel: b.reportingLevel,
    };
    if (b.relationship.trim().length > 0) {
      out.relationship = b.relationship.trim();
    }
    return out;
  });
}
