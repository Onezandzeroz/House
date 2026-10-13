/**
 * Shared types for the Portfolio pie-chart component family (Task 13).
 *
 * The pie-chart is the **main overview** for the trust on the `/` route. It
 * renders the four sleeves (stable / conservative / balanced / aggressive)
 * as donut slices, the NAV in the centre, and the per-asset breakdown in a
 * side legend. A horizontal KPI strip below carries dry powder, NAV,
 * positions count, and the AI's role (advisor vs operator).
 *
 * The chart accepts EITHER a `PortfolioSnapshot` (Task 12's `/api/portfolio`
 * shape — full per-asset value + weight + navContribution per sleeve) OR an
 * `AdvisoryOpinion` (the existing `/api/advisory` payload — sleeves carry
 * asset IDs only; per-asset values are derived from the allocation advice
 * `currentWeightBps` × NAV). The `toPieData` normaliser turns either
 * source into the same `PieDatum[]` so the chart and legend never branch
 * on the source shape.
 *
 * Sleeve colours are HEX, not oklch. Task 10's VLM check found that
 * `oklch(0.86 0.11 80)` clips to near-white in the sRGB gamut — chroma is
 * lost at high L. Recharts also prefers hex because oklch strings do not
 * round-trip cleanly through the SVG `fill` attribute on some renderers.
 *
 * The opinion / snapshot is rådgivning, IKKE en executable intent. The
 * chart is read-only — no sign path exists. (See
 * src/server/domain/advisory.ts JSDoc.)
 */

import type { AdvisoryOpinion } from "@/server/domain/advisory";
import type { RiskCategory } from "@/server/domain/bankroll";

/** The four sleeves — re-declared here to keep this file self-contained. */
export type { RiskCategory };

/**
 * Sleeve hex colours — the four status-hue slices (Task 19 modernization).
 *
 *   - stable       : emerald (--allow-foreground, action / healthy)
 *   - conservative : champagne-gold (--primary, the House's edge)
 *   - balanced     : amber (--warn-foreground, risk builds)
 *   - aggressive   : rose (--reject-foreground, capped in v1)
 *
 * HEX (not oklch) per Task 10 learning. These match the modern tokens
 * landed in `globals.css` by Task 19.
 */
export const SLEEVE_COLORS: Record<RiskCategory, string> = {
  stable: "#10b981",
  conservative: "#c9a227",
  balanced: "#f59e0b",
  aggressive: "#f43f5e",
};

/**
 * Dimmed variants used for the legend dot outline + the slice on
 * non-hover. RGBA (alpha 0.35) per Task 19's modern palette — keeps the
 * slice visible but clearly recedes when a sibling is in focus.
 */
export const SLEEVE_COLORS_DIM: Record<RiskCategory, string> = {
  stable: "rgba(16, 185, 129, 0.35)",
  conservative: "rgba(201, 162, 39, 0.35)",
  balanced: "rgba(245, 158, 11, 0.35)",
  aggressive: "rgba(244, 63, 94, 0.35)",
};

/**
 * Per-sleeve gradient fills (Task 20). Each slice is filled with a
 * `<linearGradient>` from `from` to `to` — modern gradient look instead
 * of flat colour. The `id` is referenced from the chart's `<Cell
 * fill={`url(#${id})`} />`.
 *
 * The gradients are subtle (same hue family, slight lightness lift)
 * so the slice still reads as the sleeve's status colour.
 */
export const SLEEVE_GRADIENTS: Record<
  RiskCategory,
  { from: string; to: string; id: string }
> = {
  stable: { from: "#10b981", to: "#14b8a6", id: "grad-stable" },
  conservative: { from: "#c9a227", to: "#d4af37", id: "grad-conservative" },
  balanced: { from: "#f59e0b", to: "#fbbf24", id: "grad-balanced" },
  aggressive: { from: "#f43f5e", to: "#fb7185", id: "grad-aggressive" },
};

// ---------------------------------------------------------------------------
// ASSET brand-colour palette (Task 26 — full rewrite of the pie).
//
// The owner's words (Task 26): "the colour pallet for the pie chard is only
// two colours (how does this make sense there should be more than two or
// three colours surely to make it give good overview of data represented)".
//
// Each ASSET gets its OWN crypto-brand colour so the MIDDLE ring reads as a
// rich multi-colour band instead of the two-colour sleeve palette. The set
// spans the canonical assetIds the bankroll domain recognises (see
// `categorizeAsset` in src/server/domain/bankroll.ts). It includes some
// blue / teal / purple entries — the owner's explicit colour request
// overrides the house "no blue" rule per Task 26 instructions.
// ---------------------------------------------------------------------------

/**
 * Per-asset brand colours (Task 26). 16+ entries covering the stable,
// conservative, balanced, and aggressive sleeves. Looked up case-
 * insensitively by `assetColor()`.
 */
export const ASSET_COLORS: Record<string, string> = {
  // Stable (5+1) — dry powder
  USDC: "#2775CA", // USDC brand blue
  USDT: "#26A17B", // Tether green
  DAI: "#F5AC37", // MakerDAO gold-yellow
  FRAX: "#E53469", // Frax pink-red
  RLUSD: "#5AC8FA", // Ripple stablecoin light blue (per eier direction)
  // Liquid staking (3) — categorized as stable per categorizeAsset
  stETH: "#00A3FF", // sky blue
  rETH: "#FF7A6A", // salmon
  cbETH: "#A0A0A0", // silver (deliberately distinct from ETH)
  // Conservative (3)
  BTC: "#F7931A", // bitcoin orange
  WBTC: "#F7931A", // same as BTC
  ETH: "#627EEA", // ethereum blue-purple
  // Balanced — established L1/L2 + DeFi blue-chips
  SOL: "#14F195", // solana mint-green
  ARB: "#6495ED", // arbitrum cornflower
  AVAX: "#E84142", // avalanche red
  OP: "#FF0420", // optimism red
  UNI: "#FF007A", // uniswap pink
  AAVE: "#B6509E", // aave purple
  LDO: "#F69988", // lido coral
  // XRP-ecosystem L1s (per eier direction — default portfolio)
  XRP: "#00AAE4", // ripple blue
  XLM: "#14B45E", // stellar green
  FLR: "#F472D0", // flare pink
  // Aggressive (demo)
  DOGE: "#C2A633", // doge tan-gold
};

/** Default colour for assets not in `ASSET_COLORS` (slate, neutral). */
export const DEFAULT_ASSET_COLOR = "#94A3B8";

/** Case-insensitive lookup table built once at module load (O(1) reads). */
const ASSET_COLORS_LOWER: Record<string, string> = Object.fromEntries(
  Object.entries(ASSET_COLORS).map(([k, v]) => [k.toLowerCase(), v]),
);

/** Brand colour for `assetId`. Case-insensitive; falls back to slate. */
export function assetColor(assetId: string): string {
  return ASSET_COLORS_LOWER[assetId.toLowerCase()] ?? DEFAULT_ASSET_COLOR;
}

/**
 * Stable gradient-id for the per-asset MIDDLE-ring gradient. Each unique
 * asset gets its OWN `<linearGradient>` (asset brand-colour → 15% lighter
 * variant via `lightenColor`), referenced from the chart's `<defs>`.
 */
export function assetGradientId(assetId: string): string {
  return `grad-asset-${assetId.toLowerCase()}`;
}

/**
 * Lighten a hex colour toward white by `amount` (0..1). Pure; no I/O.
 * Used to generate the second stop of the per-asset linear gradient.
 *   lightenColor("#10b981", 0.15) → approx #3fcfa0
 */
export function lightenColor(hex: string, amount = 0.15): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const num = parseInt(m[1]!, 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  r = Math.min(255, Math.max(0, mix(r)));
  g = Math.min(255, Math.max(0, mix(g)));
  b = Math.min(255, Math.max(0, mix(b)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b)
    .toString(16)
    .slice(1)}`;
}

/**
 * Darken a hex colour toward black by `amount` (0..1). Pure; no I/O.
 * Used for the OUTER ring's sub-shade of the parent asset colour when
 * the venue slice needs a darker base (e.g. the legend's venue-row
 * left-border). The outer-ring Cell itself uses fillOpacity on the
 * parent asset colour, per Task 26 instructions.
 */
export function darkenColor(hex: string, amount = 0.25): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const num = parseInt(m[1]!, 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  const mix = (c: number) => Math.round(c * (1 - amount));
  r = Math.min(255, Math.max(0, mix(r)));
  g = Math.min(255, Math.max(0, mix(g)));
  b = Math.min(255, Math.max(0, mix(b)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b)
    .toString(16)
    .slice(1)}`;
}

/** Sleeve display labels — title-cased for the legend / tooltip. */
export const SLEEVE_LABELS: Record<RiskCategory, string> = {
  stable: "Stable",
  conservative: "Conservative",
  balanced: "Balanced",
  aggressive: "Aggressive",
};

/** Canonical sleeve order, low to high risk — used by `toPieData`. */
export const SLEEVE_ORDER: RiskCategory[] = [
  "stable",
  "conservative",
  "balanced",
  "aggressive",
];

/**
 * The five-zone dry-powder classification (mirror of the domain enum).
 * Re-declared here so the client types stay self-contained — the domain
 * `DryPowderStatus` is `as const`, but importing it pulls a zod schema
 * transitively. We only need the union type.
 */
export type DryPowderStatus =
  | "above-target"
  | "at-target"
  | "above-floor"
  | "below-floor"
  | "critical";

/** Dry-powder status metadata — label + chip tone + short note. */
export const DRY_POWDER_STATUS_META: Record<
  DryPowderStatus,
  { label: string; tone: "allow" | "warn" | "reject"; note: string }
> = {
  "above-target": {
    label: "Above target",
    tone: "allow",
    note: "Deployable cushion. Ready for a good trade.",
  },
  "at-target": {
    label: "At target",
    tone: "allow",
    note: "Healthy. Cushion at the discipline line.",
  },
  "above-floor": {
    label: "Above floor",
    tone: "allow",
    note: "Below target but above the floor.",
  },
  "below-floor": {
    label: "Below floor",
    tone: "warn",
    note: "Outside principle. Trim toward stables.",
  },
  critical: {
    label: "Critical",
    tone: "reject",
    note: "Force de-risk. Stable sleeve under the critical line.",
  },
};

/**
 * The operating mode of the trust. Mirrors plan §2 (Observe → Advise →
 * Confirm → Rules → House). House mode means the AI is operating (under
 * the same grants as Rules); the other modes are advisory only.
 */
export type TrustMode =
  | "observe"
  | "advise"
  | "confirm"
  | "rules"
  | "house";

/**
 * The AI's role inside the trust. `advisor` = the AI proposes, the
 * owner / policy gate decides. `operator` = the AI is in House mode and
 * emits intents subject to the policy gate. `advisor-off` = AI is muted
 * (observe-only or no AI service wired yet).
 */
export type AiRole = "advisor" | "advisor-off" | "operator";

/**
 * Market regime (mirrors `MarketRegime` from `src/server/domain/regime.ts`,
 * re-declared here to keep the client types self-contained — importing
 * the domain enum would pull zod's runtime into the client bundle).
 *
 * Used to derive the sleeve target weights for the drift arrows when the
 * source is a `PortfolioSnapshot` (snapshots don't carry targets).
 */
export type MarketRegime = "bull" | "bear" | "ranging" | "transitional";

/**
 * Default sleeve posture (target weights) per regime — mirrors
 * `regimeStrategyPosture(regime)` from `src/server/domain/regime.ts`. The
 * values are decimals that sum to 1.00; we multiply by 10000 to get bps.
 *
 * Re-declared here (instead of importing the domain function) for the
 * same self-containment reason as the `MarketRegime` type above.
 */
export function regimeStrategyPostureDefault(
  regime: MarketRegime,
): Record<RiskCategory, number> {
  switch (regime) {
    case "bull":
      return {
        stable: 0.3,
        conservative: 0.4,
        balanced: 0.2,
        aggressive: 0.1,
      };
    case "bear":
      return {
        stable: 0.55,
        conservative: 0.35,
        balanced: 0.08,
        aggressive: 0.02,
      };
    case "transitional":
      return {
        stable: 0.45,
        conservative: 0.35,
        balanced: 0.15,
        aggressive: 0.05,
      };
    case "ranging":
    default:
      return {
        stable: 0.4,
        conservative: 0.3,
        balanced: 0.2,
        aggressive: 0.1,
      };
  }
}

/** Mode display metadata — name + short tagline + whether AI operates. */
export const TRUST_MODE_META: Record<
  TrustMode,
  { name: string; tagline: string; aiOperates: boolean }
> = {
  observe: {
    name: "Observe",
    tagline: "Read-only. No execution path.",
    aiOperates: false,
  },
  advise: {
    name: "Advise",
    tagline: "Policy engine writes proposals.",
    aiOperates: false,
  },
  confirm: {
    name: "Confirm",
    tagline: "Owner approves each batch.",
    aiOperates: false,
  },
  rules: {
    name: "Rules",
    tagline: "Deterministic rebalance inside caps.",
    aiOperates: false,
  },
  house: {
    name: "House",
    tagline: "AI proposes; policy still gates.",
    aiOperates: true,
  },
};

/**
 * One asset inside a sleeve — the per-asset breakdown the legend renders.
 * The `value` is in the book currency (a string for fixed-point safety;
 * display layer formats it). `weightBps` is the asset's weight of the
 * NAV (0..10000).
 */
export interface PieAsset {
  assetId: string;
  value: string;
  weightBps: number;
}

/**
 * One slice of the donut — one sleeve, fully normalised so the chart,
 * legend, and tooltip all read from the same shape regardless of whether
 * the source was a PortfolioSnapshot or an AdvisoryOpinion.
 */
export interface PieDatum {
  category: RiskCategory;
  label: string; // "Stable" | "Conservative" | ...
  weightBps: number; // currentWeightBps of the sleeve
  /** Target weight from the regime posture, used by the legend's drift
   * arrow. If the source was an AdvisoryOpinion, this is
   * `sleeve.targetWeightBps`; for the snapshot path it is derived from
   * the regime posture table (see `regimeStrategyPostureDefault`).
   * Optional — empty when no regime is provided. */
  targetWeightBps?: number;
  navContribution: string; // $ contribution to NAV (book currency)
  assetCount: number;
  assets: PieAsset[];
  color: string; // hex slice fill (SLEEVE_COLORS)
  colorDim: string; // hex dim variant (SLEEVE_COLORS_DIM)
  /** Gradient id for the slice fill — `url(#${id})` form (Task 20). */
  gradientId: string;
}

// ---------------------------------------------------------------------------
// 3-nivå pie-types (Task 26 — full rewrite from scratch).
//
// Each level is its OWN ring in the pie:
//   INNER  (radius 38–58%) : 4 sleeves         — PieDatum[]   (existing)
//   MIDDLE (radius 60–80%) : per-asset slices   — AssetDatum[] (new)
//   OUTER  (radius 82–95%) : per-venue slices    — VenueDatum[] (new)
//
// Each datum carries a back-reference to its parent so the centre label +
// tooltip can show parent context (asset → sleeve, venue → asset).
// ---------------------------------------------------------------------------

/**
 * One VENUE-slice of the OUTER ring — represents WHERE an asset is held
 * (binance / ledger / metamask / ...). One row sums all positions on the
 * same (account.venue, account.kind) for a single asset. If the owner
 * holds 0.5 BTC on binance and 0.7 BTC on ledger, BTC gets two venue
 * slices in the outer ring — each with its own value + weightBps +
 * shareOfAssetBps (what fraction of the asset sits at this venue).
 *
 * The outer-ring Cell uses the parent asset's brand-colour (not its own
 * new colour) at fillOpacity 0.55 so it reads as a sub-band of the
 * parent asset's MIDDLE-ring slice.
 */
export interface VenueDatum {
  /** Venue name (e.g. "binance", "ledger", "metamask"). */
  venue: string;
  /** Venue kind (cex | evm-wallet | solana-wallet | stake-defi). */
  venueKind: string;
  /** Value in book currency at this venue. */
  value: string;
  /** Weight of NAV (bps, 0..10000). */
  weightBps: number;
  /** Weight WITHIN the parent asset (bps, 0..10000). Sum of all venues
   *  for one asset = 10000 (100%). */
  shareOfAssetBps: number;
  /** The parent asset this venue slice belongs to. */
  parentAssetId: string;
  /** The parent sleeve this venue's asset sits in. */
  parentCategory: RiskCategory;
  /** Parent asset brand-colour (for the outer ring's sub-shade fill). */
  parentColor: string;
  /** Parent asset gradient-id (so the tooltip can render a brand dot). */
  parentGradientId: string;
}

/**
 * One ASSET-slice of the MIDDLE ring — represents WHAT the trust holds
 * (BTC / ETH / SOL / ...). Sized by the asset's weight of NAV. Filled
 * with the asset's OWN per-asset linear gradient (brand-colour → 15%
 * lighter variant via `lightenColor`). Carries a list of its venue
 * slices so the legend can render the third level when the asset row
 * is expanded.
 *
 * Back-references the parent sleeve so the centre label + tooltip can
 * show "X% of {parentLabel}" context.
 */
export interface AssetDatum {
  assetId: string;
  /** Total value across all venues (book currency). */
  value: string;
  /** Weight of NAV (bps, 0..10000). */
  weightBps: number;
  /** Brand-colour for this asset (ASSET_COLORS lookup). */
  color: string;
  /** Gradient-id for the per-asset linear gradient. */
  gradientId: string;
  /** The parent sleeve this asset sits in. */
  parentCategory: RiskCategory;
  /** Parent sleeve display label ("Stable" | "Conservative" | ...). */
  parentLabel: string;
  /** Sleeve weight (bps) — for the "of sleeve %" in the centre label. */
  parentWeightBps: number;
  /** Venue breakdown for this asset — empty in the AdvisoryOpinion path. */
  venues: VenueDatum[];
}

/**
 * One venue (custody location) where an asset is held. Task 25 — the
 * third level of the portfolio hierarchy: sleeves → assets → venues.
 *
 * Owner direction (Task 25): "3 meningsfulle dimensjoner: strategisk →
 * taktisk → operasjonelt". This is the OPERASJONELT (operational)
 * dimension — custody distribution: where is each holding actually
 * forvaltet (binance / ledger / metamask / ...).
 *
 * One venue row sums all positions on the same (account.venue,
 * account.kind) for a single asset. If the owner holds 0.5 BTC on
 * binance and 0.7 BTC on ledger, BTC gets two venue rows — each with
 * its own quantity / value / weightBps, plus a `shareOfAssetBps`
 * indicating what fraction of the asset's total value sits at this
 * venue (sum of `shareOfAssetBps` across venues for one asset = 10000).
 *
 * Mirrors `PortfolioSnapshotVenue` in src/server/services/trust-service.ts
 * — re-declared here so the client bundle stays self-contained and does
 * not pull zod's runtime into the client (same pattern as
 * `DryPowderStatus`, `TrustMode`, `AiRole`, `MarketRegime` above).
 */
export interface PortfolioSnapshotVenue {
  /** Venue name (e.g. "binance", "ledger", "metamask"). */
  venue: string;
  /** Venue kind (cex | evm-wallet | solana-wallet | stake-defi). */
  venueKind: string;
  /** Quantity of this asset at this venue (string for fixed-point). */
  quantity: string;
  /** Value in book currency at this venue. */
  value: string;
  /** Weight of NAV (bps, 0..10000). */
  weightBps: number;
  /** Weight WITHIN this asset (bps, 0..10000). Sum of all venues for
   *  one asset = 10000 (100%). */
  shareOfAssetBps: number;
}

/**
 * PortfolioSnapshot — Task 12's `/api/portfolio` payload. Each sleeve
 * carries full per-asset data (value + weight), so the legend can show
 * exact asset contributions. The snapshot also surfaces mode, AI role,
 * and kill-switch state — used by the summary strip.
 *
 * v0 fallback: when `/api/portfolio` is not wired (Task 12 not landed),
 * the chart consumes an `AdvisoryOpinion` via the `toPieData` adapter
 * instead. The adapter derives per-asset values from the allocation
 * advice `currentWeightBps × NAV`.
 *
 * Task 25: each asset now carries a `venues[]` list — the third level
 * of the hierarchy (sleeves → assets → venues). The list is empty in
 * the AdvisoryOpinion-path (advisor sleeves carry asset IDs only, no
 * custody breakdown); it is populated when the source is a real
 * PortfolioSnapshot from /api/portfolio.
 */
export interface PortfolioSnapshotAsset {
  assetId: string;
  quantity: string;
  price: string;
  value: string;
  weightBps: number;
  /** Entry price per unit in book currency (null for stablecoins or
   *  assets where the trustee didn't provide a price). Used for P&L. */
  entryPrice?: string | null;
  /** Task 25 — third level of the hierarchy: custody breakdown per
   *  asset. One entry per unique (account.venue, account.kind). Empty
   *  in the AdvisoryOpinion-path (only the snapshot path populates it). */
  venues: PortfolioSnapshotVenue[];
}

export interface PortfolioSnapshotSleeve {
  category: RiskCategory;
  assets: PortfolioSnapshotAsset[];
  currentWeightBps: number;
  navContribution: string;
}

export interface PortfolioSnapshot {
  trustId: string;
  trustName: string;
  mode: TrustMode;
  aiRole: AiRole;
  killSwitchActive: boolean;
  nav: string;
  bookCurrency: string;
  dryPowderBps: number;
  dryPowderStatus: DryPowderStatus;
  sleeves: PortfolioSnapshotSleeve[];
  positionsCount: number;
  /** Task 36 — "live" hvis NAV er beregnet med live CoinGecko-priser;
   *  "fallback" hvis CoinGecko var nede / ratelimited. UI-en (Task 38)
   *  viser en Live-pulse eller Fallback-badge basert på dette feltet. */
  priceSource?: "live" | "fallback";
  asOf: Date | string;
}

/**
 * The shape `toPieData` returns — the chart, legend, and summary strip
 * all consume this. Carries the per-sleeve pie data plus the trust-level
 * fields the KPI strip needs (NAV, dry powder, positions, AI role, mode,
 * kill-switch).
 */
export interface NormalizedPortfolio {
  pieData: PieDatum[];
  /** Middle-ring data — per-asset slices, flattened across all sleeves.
   *  Empty in the AdvisoryOpinion path (opinions carry asset IDs only,
   *  no venue breakdown) — the chart renders just the inner + middle
   *  rings in that case. */
  assetData: AssetDatum[];
  /** Outer-ring data — per-venue slices, flattened across all assets.
   *  Empty in the AdvisoryOpinion path (no venue data without snapshot). */
  venueData: VenueDatum[];
  /** Total sleeve weight (sum of currentWeightBps). If 0 → empty state. */
  totalWeightBps: number;
  nav: string;
  navDisplay: string; // "$264 500" formatted with spaces
  bookCurrency: string;
  dryPowderBps: number;
  dryPowderStatus: DryPowderStatus;
  positionsCount: number;
  mode: TrustMode;
  aiRole: AiRole;
  killSwitchActive: boolean;
  hasPositions: boolean;
  trustName?: string;
  asOf?: Date | string;
}

/**
 * Props for `PortfolioPieChart`. The chart accepts EITHER a snapshot OR
 * an opinion (the snapshot wins if both are present). `bookCurrency`,
 * `mode`, `aiRole`, and `killSwitchActive` are optional overrides used
 * when the source is an `AdvisoryOpinion` (which does not surface these
 * fields directly).
 */
export interface PortfolioPieChartProps {
  snapshot?: PortfolioSnapshot;
  opinion?: AdvisoryOpinion;
  /** Book currency for the centre label + tooltip. Defaults to "USDC". */
  bookCurrency?: string;
  /** Trust operating mode. Defaults to "observe" for the AdvisoryOpinion path. */
  mode?: TrustMode;
  /** AI role. Defaults to "advisor". */
  aiRole?: AiRole;
  /** Kill-switch active flag. Defaults to false. */
  killSwitchActive?: boolean;
  /**
   * Current market regime — drives the sleeve target weights used by
   * the legend's drift arrows when the source is a `PortfolioSnapshot`
   * (snapshots don't carry targets). If the source is an
   * `AdvisoryOpinion`, the opinion's per-sleeve `targetWeightBps` wins.
   * Defaults to `"ranging"` (the DemoRegimeDetector's default).
   */
  regime?: MarketRegime;
  /**
   * If true, the pie simulates a "live" NAV tick every 5 seconds —
   * small ±0.05% perturbations that animate the centre counter so the
   * owner sees the chart breathe. Demo effect only; production would
   * receive ticks from MarketService. Defaults to false.
   */
  simulateLive?: boolean;
}

// ---------------------------------------------------------------------------
// Money / bps formatting helpers — pure, no React, no I/O. Used by the
// chart, legend, tooltip, and summary strip so the numerals stay
// consistent across the family.
// ---------------------------------------------------------------------------

/** Format a money string as a short "$264 500" (whole-number, space sep.). */
export function formatMoneyShort(value: string): string {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return value;
  const rounded = Math.round(n);
  return `$${rounded.toLocaleString("en-US").replace(/,/g, " ")}`;
}

/** Format a money string with two decimals and space-separated thousands. */
export function formatMoneyFull(value: string): string {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return value;
  return `$${n
    .toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    .replace(/,/g, " ")}`;
}

/** Convert bps to a percent string with two decimals (e.g. 2836 → "28.36"). */
export function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2);
}

/**
 * Derive an asset's NAV contribution from its weight and the trust NAV.
 * `weightBps × NAV / 10000`, returned as a fixed-precision string. Used
 * by the AdvisoryOpinion adapter — the snapshot path carries the value
 * verbatim.
 *
 * Math caveat: this is JS Number math, fine for the demo. Production
 * code MUST use a fixed-point decimal lib (see src/server/domain/advisory.ts
 * JSDoc warning).
 */
function navContributionFromBps(weightBps: number, nav: string): string {
  const navNum = Number.parseFloat(nav);
  if (!Number.isFinite(navNum)) return "0.00";
  const v = (weightBps / 10000) * navNum;
  return v.toFixed(2);
}

// ---------------------------------------------------------------------------
// toPieData — the normaliser. Pure; memoisable.
// ---------------------------------------------------------------------------

/**
 * Normalise a `PortfolioPieChartProps` payload into the
 * `NormalizedPortfolio` the chart, legend, and summary strip consume.
 *
 * The function:
 *   1. Picks the snapshot if present; otherwise falls back to the opinion.
 *   2. Walks the four sleeves (in canonical order) and builds a `PieDatum`
 *      per sleeve — with full per-asset breakdown.
 *   3. For the snapshot path, asset value + weight are verbatim. For the
 *      opinion path, per-asset values are derived from the
 *      `allocationAdvice[].currentWeightBps × NAV` (the opinion's sleeves
 *      carry asset IDs only).
 *   4. Computes the total sleeve weight so the chart can show an empty
 *      state when the book has no positions.
 *   5. Surfaces the trust-level fields (mode, AI role, dry powder,
 *      positions count, kill switch) for the KPI strip.
 *
 * Returns an empty-state `NormalizedPortfolio` (hasPositions=false,
 * pieData=[]) if neither source is present or if both have zero
 * positions. The chart renders a centred "No positions yet" message in
 * that case.
 */
export function toPieData(props: PortfolioPieChartProps): NormalizedPortfolio {
  const {
    snapshot,
    opinion,
    bookCurrency = "USDC",
    mode = "observe",
    aiRole = "advisor",
    killSwitchActive = false,
    regime = "ranging",
  } = props;

  // Sleeve target weights — used by the legend's drift arrows. If the
  // source is an AdvisoryOpinion, each sleeve carries its own
  // `targetWeightBps` (derived from the regime posture inside the
  // advisor). If the source is a PortfolioSnapshot (which does not carry
  // targets), derive them here from the regime posture table.
  const postureTargets = regimeStrategyPostureDefault(regime);

  // Snapshot path — preferred. Per-asset value + weight + navContribution
  // are exact (Task 12's `/api/portfolio` returns them directly). Task 26
  // also flattens the 3-level hierarchy into `assetData` (middle ring) +
  // `venueData` (outer ring) so the chart can render three concentric
  // rings from one normalised shape.
  if (snapshot) {
    const pieData: PieDatum[] = SLEEVE_ORDER.map((category) => {
      const sleeve = snapshot.sleeves.find((s) => s.category === category);
      const assets: PieAsset[] = (sleeve?.assets ?? []).map((a) => ({
        assetId: a.assetId,
        value: a.value,
        weightBps: a.weightBps,
      }));
      return {
        category,
        label: SLEEVE_LABELS[category],
        weightBps: sleeve?.currentWeightBps ?? 0,
        targetWeightBps: Math.round(postureTargets[category] * 10000),
        navContribution: sleeve?.navContribution ?? "0.00",
        assetCount: assets.length,
        assets,
        color: SLEEVE_COLORS[category],
        colorDim: SLEEVE_COLORS_DIM[category],
        gradientId: SLEEVE_GRADIENTS[category].id,
      };
    });

    // Flatten sleeves → assets → venues into the MIDDLE-ring assetData +
    // OUTER-ring venueData. Each AssetDatum carries its brand-colour +
    // per-asset gradient-id + a back-reference to the parent sleeve. Each
    // VenueDatum carries a back-reference to the parent asset.
    const assetData: AssetDatum[] = [];
    const venueData: VenueDatum[] = [];
    for (const category of SLEEVE_ORDER) {
      const sleeve = snapshot.sleeves.find((s) => s.category === category);
      if (!sleeve) continue;
      const parentLabel = SLEEVE_LABELS[category];
      const parentWeightBps = sleeve.currentWeightBps;
      for (const asset of sleeve.assets) {
        if (asset.weightBps <= 0) continue;
        const color = assetColor(asset.assetId);
        const gradientId = assetGradientId(asset.assetId);
        const venues: VenueDatum[] = asset.venues.map((v) => ({
          venue: v.venue,
          venueKind: v.venueKind,
          value: v.value,
          weightBps: v.weightBps,
          shareOfAssetBps: v.shareOfAssetBps,
          parentAssetId: asset.assetId,
          parentCategory: category,
          parentColor: color,
          parentGradientId: gradientId,
        }));
        assetData.push({
          assetId: asset.assetId,
          value: asset.value,
          weightBps: asset.weightBps,
          color,
          gradientId,
          parentCategory: category,
          parentLabel,
          parentWeightBps,
          venues,
        });
        venueData.push(...venues);
      }
    }

    const totalWeightBps = pieData.reduce((s, d) => s + d.weightBps, 0);
    return {
      pieData,
      assetData,
      venueData,
      totalWeightBps,
      nav: snapshot.nav,
      navDisplay: formatMoneyShort(snapshot.nav),
      bookCurrency: snapshot.bookCurrency,
      dryPowderBps: snapshot.dryPowderBps,
      dryPowderStatus: snapshot.dryPowderStatus,
      positionsCount: snapshot.positionsCount,
      mode: snapshot.mode,
      aiRole: snapshot.aiRole,
      killSwitchActive: snapshot.killSwitchActive,
      hasPositions: totalWeightBps > 0,
      trustName: snapshot.trustName,
      asOf: snapshot.asOf,
    };
  }

  // Opinion fallback — derive per-asset values from allocation advice.
  if (opinion) {
    // Index advice by assetId so the sleeve builder can look up the
    // per-asset weight without scanning the advice array each time.
    const adviceByAsset = new Map<
      string,
      AdvisoryOpinion["allocationAdvice"][number]
    >();
    for (const a of opinion.allocationAdvice) {
      adviceByAsset.set(a.assetId, a);
    }

    const pieData: PieDatum[] = SLEEVE_ORDER.map((category) => {
      const sleeve = opinion.sleeves.find((s) => s.category === category);
      // The opinion's sleeve.assets is string[] (asset IDs only). Walk
      // the list and pull the currentWeightBps from the matching advice
      // row. If the asset is not in the advice (shouldn't happen for the
      // demo book, but be defensive), weight = 0.
      const assets: PieAsset[] = (sleeve?.assets ?? []).map((assetId) => {
        const advice = adviceByAsset.get(assetId);
        const weightBps = advice?.currentWeightBps ?? 0;
        return {
          assetId,
          weightBps,
          value: navContributionFromBps(weightBps, opinion.nav),
        };
      });

      const weightBps = sleeve?.currentWeightBps ?? 0;
      return {
        category,
        label: SLEEVE_LABELS[category],
        weightBps,
        targetWeightBps: sleeve?.targetWeightBps,
        navContribution: navContributionFromBps(weightBps, opinion.nav),
        assetCount: assets.length,
        assets,
        color: SLEEVE_COLORS[category],
        colorDim: SLEEVE_COLORS_DIM[category],
        gradientId: SLEEVE_GRADIENTS[category].id,
      };
    });

    // Opinion-path: assets have no venue breakdown (advisory sleeves
    // carry asset IDs only). We still populate assetData so the MIDDLE
    // ring renders with brand colours; venueData stays empty (the OUTER
    // ring is omitted in the chart when empty).
    const assetData: AssetDatum[] = [];
    for (const category of SLEEVE_ORDER) {
      const sleeve = opinion.sleeves.find((s) => s.category === category);
      if (!sleeve) continue;
      const parentLabel = SLEEVE_LABELS[category];
      const parentWeightBps = sleeve.currentWeightBps ?? 0;
      for (const asset of sleeve.assets) {
        const advice = adviceByAsset.get(asset);
        const assetWeightBps = advice?.currentWeightBps ?? 0;
        if (assetWeightBps <= 0) continue;
        assetData.push({
          assetId: asset,
          value: navContributionFromBps(assetWeightBps, opinion.nav),
          weightBps: assetWeightBps,
          color: assetColor(asset),
          gradientId: assetGradientId(asset),
          parentCategory: category,
          parentLabel,
          parentWeightBps,
          venues: [],
        });
      }
    }

    const totalWeightBps = pieData.reduce((s, d) => s + d.weightBps, 0);
    const positionsCount = opinion.sleeves.reduce(
      (s, sl) => s + sl.assets.length,
      0,
    );
    // The opinion's dry-powder field pair is the source of truth; the
    // stable sleeve's currentWeightBps should equal dryPowderBps, but the
    // status enum is the more useful piece for the KPI strip.
    return {
      pieData,
      assetData,
      venueData: [],
      totalWeightBps,
      nav: opinion.nav,
      navDisplay: formatMoneyShort(opinion.nav),
      bookCurrency,
      dryPowderBps: opinion.dryPowderBps,
      dryPowderStatus: opinion.dryPowderStatus,
      positionsCount,
      mode,
      aiRole,
      killSwitchActive,
      hasPositions: totalWeightBps > 0,
      asOf: opinion.asOf,
    };
  }

  // Neither source — empty state.
  return {
    pieData: [],
    assetData: [],
    venueData: [],
    totalWeightBps: 0,
    nav: "0.00",
    navDisplay: "$0",
    bookCurrency,
    dryPowderBps: 0,
    dryPowderStatus: "above-floor",
    positionsCount: 0,
    mode,
    aiRole,
    killSwitchActive,
    hasPositions: false,
  };
}
