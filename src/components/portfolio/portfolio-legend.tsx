"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { Line, LineChart, ResponsiveContainer } from "recharts";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import type {
  AssetDatum,
  PieDatum,
  RiskCategory,
  VenueDatum,
} from "./types";
import { bpsToPercent, darkenColor, formatMoneyFull } from "./types";

/**
 * PortfolioLegend (Task 26 rebuild) — the side panel that shows the
 * three-level hierarchy (sleeves → assets → venues) as three nested
 * collapsible layers.
 *
 * Owner direction (Task 26): the pie chart must surface the 3-level
 * structure (strategisk → taktisk → operasjonelt). The legend is the
 * companion — same hierarchy, in row form:
 *
 *   - Top-level    : 4 sleeves (one AccordionItem each). Same as Task 20.
 *   - Mid-level    : one AssetRow per asset inside the expanded sleeve.
 *     Each asset row is itself a `Collapsible` — expand it to reveal
 *     its venues. Brand-coloured dot + 2px left-border in the asset's
 *     brand colour so the visual identity matches the pie's MIDDLE ring.
 *   - Bottom-level: one VenueRow per venue where the asset is custodied.
 *     Each venue row has a small square (sub-shade of the asset's brand
 *     colour via `darkenColor`) + venue-name + venueKind chip + value +
 *     weight % of asset.
 *
 * Sleeve rows carry the sparkline + drift arrow (kept from Task 20) so
 * the regime-posture drift story still surfaces at the strategic level.
 * Asset rows carry only the brand-dot + weights + venue-count badge —
 * simpler, because the per-asset detail is the per-venue breakdown.
 *
 * The active row (hovered or pinned on the pie) gets an emerald
 * left-border + ring-inset so the legend ↔ pie relationship is obvious.
 */

export interface PortfolioLegendProps {
  /** The four-slice pie data — one row per sleeve. */
  data: PieDatum[];
  /** Middle-ring asset data — flattened across sleeves. Each AssetDatum
   *  carries its parentCategory so the legend can group assets by sleeve. */
  assetData: AssetDatum[];
  /** The currently hovered slice's category (from the pie's onMouseEnter
   *  on the INNER ring). Highlights the sleeve row. */
  activeCategory?: RiskCategory | null;
  /** The currently pinned slice's category (drives the emerald left-border). */
  pinnedCategory?: RiskCategory | null;
  /** The currently hovered asset's id (from the pie's onMouseEnter on the
   *  MIDDLE ring). Highlights the asset row. */
  activeAssetId?: string | null;
  /** The currently pinned asset's id (drives the emerald left-border on
   *  the asset row). */
  pinnedAssetId?: string | null;
  /** Controlled expanded sleeve. If omitted, the accordion is uncontrolled. */
  expandedValue?: string;
  /** Default expanded sleeve on first render (uncontrolled). */
  defaultExpandedValue?: string;
}

/**
 * Render the legend. Outer layer is a shadcn Accordion (single-collapsible)
 * — one AccordionItem per sleeve. Inside each AccordionContent, the
 * per-asset breakdown is a vertical stack of `AssetCollapsible` rows,
 * each of which expands to show its venue list.
 */
export function PortfolioLegend({
  data,
  assetData,
  activeCategory = null,
  pinnedCategory = null,
  activeAssetId = null,
  pinnedAssetId = null,
  expandedValue,
  defaultExpandedValue,
}: PortfolioLegendProps) {
  // Track which assets are expanded — a Set of assetIds. Independent
  // per asset so the user can open multiple assets at once. Set state
  // helpers (add / remove / toggle) are memoised.
  const [expandedAssets, setExpandedAssets] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleAsset = React.useCallback((assetId: string) => {
    setExpandedAssets((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }, []);

  return (
    <Accordion
      type="single"
      collapsible
      value={expandedValue}
      defaultValue={defaultExpandedValue}
      className="flex max-h-[700px] flex-col gap-2 overflow-y-auto pr-1"
      aria-label="Portfolio legend — sleeves, assets, venues"
    >
      {data.map((datum) => {
        const assetsInSleeve = assetData.filter(
          (a) => a.parentCategory === datum.category,
        );
        return (
          <LegendSleeveRow
            key={datum.category}
            datum={datum}
            assetsInSleeve={assetsInSleeve}
            active={activeCategory === datum.category}
            pinned={pinnedCategory === datum.category}
            activeAssetId={activeAssetId}
            pinnedAssetId={pinnedAssetId}
            expandedAssets={expandedAssets}
            onToggleAsset={toggleAsset}
          />
        );
      })}
    </Accordion>
  );
}

// ---------------------------------------------------------------------------
// Sleeve-level row — top-level AccordionItem. Carries the sleeve label
// + asset count + weight% (gold gradient) + NAV contribution + sparkline
// + drift arrow. 2px left-border in the sleeve colour (emerald when pinned).
// ---------------------------------------------------------------------------

function LegendSleeveRow({
  datum,
  assetsInSleeve,
  active,
  pinned,
  activeAssetId,
  pinnedAssetId,
  expandedAssets,
  onToggleAsset,
}: {
  datum: PieDatum;
  assetsInSleeve: AssetDatum[];
  active: boolean;
  pinned: boolean;
  activeAssetId: string | null;
  pinnedAssetId: string | null;
  expandedAssets: Set<string>;
  onToggleAsset: (assetId: string) => void;
}) {
  const isPrimary = datum.category === "conservative";
  const weightPct = bpsToPercent(datum.weightBps);

  return (
    <AccordionItem
      value={datum.category}
      className={`group relative overflow-hidden rounded-md border border-border/60 bg-card/60 px-3 py-2.5 transition-colors hover:bg-white/[0.05] ${
        active ? "ring-1 ring-inset ring-allow/40" : ""
      } ${pinned ? "ring-1 ring-inset ring-allow/60" : ""}`}
      style={{
        // 2px left-border in the sleeve colour — emerald when pinned so
        // the pin is obvious from the legend side.
        borderLeft: pinned
          ? `2px solid #10b981`
          : `2px solid ${datum.color}`,
      }}
    >
      <div className="flex items-center gap-3">
        {/* Sleeve colour dot — mirrors the slice's gradient fill. */}
        <span
          aria-hidden
          className="size-3 shrink-0 rounded-full ring-2 ring-background/40"
          style={{
            background: `linear-gradient(135deg, ${datum.color}, ${datum.colorDim})`,
          }}
        />
        <AccordionTrigger
          className="hover:no-underline"
          aria-label={`${datum.label} sleeve, ${weightPct} percent, expand asset list`}
        >
          <div className="flex flex-1 flex-wrap items-center justify-between gap-3 pr-2 text-left">
            <div className="flex flex-col gap-0.5">
              <span
                className={`font-serif text-base leading-none ${
                  isPrimary ? "text-primary" : "text-foreground"
                }`}
              >
                {datum.label}
              </span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {datum.assetCount}{" "}
                {datum.assetCount === 1 ? "asset" : "assets"}
              </span>
            </div>

            <div className="flex items-center gap-3">
              {/* Sparkline + drift arrow row — kept from Task 20. */}
              <SleeveSparkline datum={datum} />
              <DriftArrow datum={datum} />

              <div className="flex flex-col items-end gap-0.5">
                <span className="font-serif text-xl font-bold leading-none house-num house-text-gradient-gold">
                  {weightPct}
                  <span className="ml-0.5 text-xs text-muted-foreground">
                    %
                  </span>
                </span>
                <span className="font-mono text-[11px] text-muted-foreground house-num">
                  {formatMoneyFull(datum.navContribution)}
                </span>
              </div>
            </div>
          </div>
        </AccordionTrigger>
      </div>

      <AccordionContent className="pt-2">
        {/* Per-asset breakdown — vertical stack of AssetCollapsible rows.
         * Each is independently collapsible so the user can open multiple
         * assets at once (compare two assets' venue breakdowns side by side). */}
        {assetsInSleeve.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            No positions in this sleeve yet.
          </p>
        ) : (
          <div className="flex flex-col gap-1 pl-2">
            <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-border/40 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
              <span>asset</span>
              <span className="text-right">value</span>
              <span className="text-right">of nav</span>
              <span className="text-right">of sleeve</span>
            </div>
            {assetsInSleeve.map((asset) => (
              <AssetCollapsible
                key={`${datum.category}-${asset.assetId}`}
                asset={asset}
                active={activeAssetId === asset.assetId}
                pinned={pinnedAssetId === asset.assetId}
                expanded={expandedAssets.has(asset.assetId)}
                onToggle={() => onToggleAsset(asset.assetId)}
              />
            ))}
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

// ---------------------------------------------------------------------------
// Asset-level row — `Collapsible` per asset. Brand-coloured dot + assetId
// + value + weight% of NAV + weight% of sleeve + venue-count badge. 2px
// left-border in the asset's brand colour (emerald when pinned).
// ---------------------------------------------------------------------------

function AssetCollapsible({
  asset,
  active,
  pinned,
  expanded,
  onToggle,
}: {
  asset: AssetDatum;
  active: boolean;
  pinned: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const weightOfNavPct = bpsToPercent(asset.weightBps);
  const weightOfSleevePct =
    asset.parentWeightBps > 0
      ? ((asset.weightBps / asset.parentWeightBps) * 100).toFixed(1)
      : "0.0";

  return (
    <Collapsible open={expanded} onOpenChange={onToggle}>
      <div
        className={`group/asset relative overflow-hidden rounded-md border border-border/40 bg-background/40 px-2 py-1.5 transition-colors hover:bg-white/[0.05] ${
          active ? "ring-1 ring-inset ring-allow/40" : ""
        } ${pinned ? "ring-1 ring-inset ring-allow/60" : ""}`}
        style={{
          // 2px left-border in the asset's brand colour — emerald when pinned.
          borderLeft: pinned
            ? `2px solid #10b981`
            : `2px solid ${asset.color}`,
        }}
      >
        <CollapsibleTrigger
          className="flex w-full items-center gap-2 text-left hover:no-underline"
          aria-label={`${asset.assetId}, ${weightOfNavPct} percent of NAV, expand venue list`}
        >
          {/* Brand-coloured dot — mirrors the middle-ring slice. */}
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full ring-2 ring-background/40"
            style={{ backgroundColor: asset.color }}
          />
          <span className="font-mono text-xs text-foreground">
            {asset.assetId}
          </span>
          <ChevronRight
            aria-hidden
            className={`size-3 shrink-0 text-muted-foreground transition-transform duration-200 ${
              expanded ? "rotate-90" : ""
            }`}
          />

          <div className="ml-auto flex items-center gap-3 text-right">
            <span className="font-mono text-[11px] text-foreground house-num">
              {formatMoneyFull(asset.value)}
            </span>
            <span className="w-12 text-right font-mono text-[11px] text-muted-foreground house-num">
              {weightOfNavPct}%
            </span>
            <span className="w-12 text-right font-mono text-[11px] text-muted-foreground house-num">
              {weightOfSleevePct}%
            </span>
          </div>
        </CollapsibleTrigger>

        {/* Venue-count badge — sits below the trigger row, tiny. */}
        {asset.venues.length > 0 && (
          <span className="mt-0.5 inline-block pl-4 text-[10px] uppercase tracking-widest text-muted-foreground">
            {asset.venues.length}{" "}
            {asset.venues.length === 1 ? "venue" : "venues"}
          </span>
        )}
      </div>

      <CollapsibleContent className="pt-1">
        <VenueList asset={asset} />
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Venue-level list — rendered when an asset is expanded. Header row +
// one VenueRow per venue. Each VenueRow has a small square (sub-shade of
// the asset's brand colour via `darkenColor`) + venue-name + venueKind
// chip + value + weight % of asset. 2px left-border in the sub-shade.
// ---------------------------------------------------------------------------

function VenueList({ asset }: { asset: AssetDatum }) {
  if (asset.venues.length === 0) {
    return (
      <p className="px-2 py-1.5 text-[10px] text-muted-foreground">
        No venue breakdown available for this asset.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-0.5 pl-4">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-border/30 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>venue</span>
        <span className="text-right">value</span>
        <span className="text-right">of asset</span>
      </div>
      {asset.venues.map((venue, i) => (
        <VenueRow
          key={`${venue.venueKind}-${venue.venue}-${i}`}
          venue={venue}
          assetColor={asset.color}
        />
      ))}
    </div>
  );
}

function VenueRow({
  venue,
  assetColor,
}: {
  venue: VenueDatum;
  assetColor: string;
}) {
  const shareOfAssetPct =
    venue.shareOfAssetBps > 0
      ? (venue.shareOfAssetBps / 100).toFixed(1)
      : "0.0";
  const subShade = darkenColor(assetColor, 0.2);
  return (
    <div
      className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-sm py-0.5"
      style={{
        borderLeft: `2px solid ${subShade}`,
        paddingLeft: "0.5rem",
      }}
    >
      <div className="flex items-center gap-2">
        {/* Small square in the sub-shade of the asset's brand colour. */}
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-[2px]"
          style={{ backgroundColor: assetColor, opacity: 0.6 }}
        />
        <span className="font-mono text-[11px] text-foreground">
          {venue.venue}
        </span>
        <span className="rounded-sm border border-border/60 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-muted-foreground">
          {venueKindLabel(venue.venueKind)}
        </span>
      </div>
      <span className="text-right font-mono text-[11px] text-foreground house-num">
        {formatMoneyFull(venue.value)}
      </span>
      <span className="text-right font-mono text-[11px] text-muted-foreground house-num">
        {shareOfAssetPct}%
      </span>
    </div>
  );
}

/** Map a venue-kind to a human label for the venue-row chip. */
function venueKindLabel(kind: string): string {
  switch (kind) {
    case "cex":
      return "CEX";
    case "evm-wallet":
      return "EVM";
    case "solana-wallet":
      return "SOL";
    case "stake-defi":
      return "DeFi";
    default:
      return kind;
  }
}

// ---------------------------------------------------------------------------
// SleeveSparkline — a 40×16 mini trend chart per sleeve. Kept from Task
// 20 (mock data; swap for real history when MarketService ships). The
// sparkline lives ONLY at the sleeve level — assets + venues carry the
// per-slice weights only.
// ---------------------------------------------------------------------------

/** Number of mock points. */
const SPARKLINE_POINTS = 8;
/** Mock volatility band (±200 bps). */
const SPARKLINE_VOL_BPS = 200;

/** Generate the mock sparkline series for a sleeve. Deterministic per
 * category + current weight — same `datum` always produces the same
 * series so the sparkline is stable across renders. */
function mockSparklineData(
  category: RiskCategory,
  currentWeightBps: number,
): Array<{ i: number; w: number }> {
  // Seed: hash the category string to a number so each sleeve has a
  // distinct but stable noise pattern.
  let seed = 0;
  for (let i = 0; i < category.length; i++) {
    seed = (seed * 31 + category.charCodeAt(i)) & 0xffffffff;
  }
  // Simple seeded PRNG (xorshift-ish).
  let rng = Math.abs(seed) || 1;
  const next = () => {
    rng ^= rng << 13;
    rng ^= rng >>> 17;
    rng ^= rng << 5;
    return Math.abs(rng) / 0xffffffff;
  };

  const points: Array<{ i: number; w: number }> = [];
  for (let i = 0; i < SPARKLINE_POINTS; i++) {
    const t = i / (SPARKLINE_POINTS - 1);
    // Smooth sine wave — varies ±SPARKLINE_VOL_BPS around the current.
    const wave = Math.sin(t * Math.PI * 2 + seed * 0.05) * SPARKLINE_VOL_BPS;
    // Seeded noise — ±50bps of jitter.
    const noise = (next() - 0.5) * 100;
    // Earlier points deviate more; the last point = current weight.
    const fade = 1 - t;
    const w = Math.max(
      0,
      Math.round(currentWeightBps - wave * fade - noise * fade),
    );
    points.push({ i, w });
  }
  // Pin the last point to the current weight — the sparkline's "now"
  // matches the displayed number exactly.
  points[points.length - 1] = {
    i: SPARKLINE_POINTS - 1,
    w: currentWeightBps,
  };
  return points;
}

function SleeveSparkline({ datum }: { datum: PieDatum }) {
  const series = useMemo(
    () => mockSparklineData(datum.category, datum.weightBps),
    [datum.category, datum.weightBps],
  );
  return (
    <div
      aria-hidden
      className="h-4 w-10 shrink-0"
      role="img"
      aria-label={`Sparkline of ${datum.label} sleeve weight over time — last point ${bpsToPercent(
        datum.weightBps,
      )} percent`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={series}
          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
        >
          <Line
            type="monotone"
            dataKey="w"
            stroke={datum.color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DriftArrow — the per-sleeve drift indicator (▲ ▼ ►). Compares the
// current weight to the target weight (regime posture derived by
// `toPieData`). Kept from Task 20 — only the sleeve level carries drift;
// assets + venues don't have regime-posture targets.
// ---------------------------------------------------------------------------

const DRIFT_THRESHOLD_BPS = 500;
const DRIFT_SIGNIFICANT_BPS = 1000;

type DriftDirection = "up" | "down" | "flat";

function computeDrift(datum: PieDatum): {
  direction: DriftDirection;
  deltaBps: number;
  significant: boolean;
  label: string;
  toneClass: string;
} {
  const target = datum.targetWeightBps;
  if (target === undefined) {
    return {
      direction: "flat",
      deltaBps: 0,
      significant: false,
      label: "no target",
      toneClass: "text-muted-foreground",
    };
  }
  const delta = datum.weightBps - target;
  const absDelta = Math.abs(delta);
  let direction: DriftDirection = "flat";
  if (delta > DRIFT_THRESHOLD_BPS) direction = "up";
  else if (delta < -DRIFT_THRESHOLD_BPS) direction = "down";

  // Significant drift (>1000 bps) — triggers the bounce animation.
  const significant = absDelta > DRIFT_SIGNIFICANT_BPS;

  const label =
    direction === "up"
      ? `Over target by ${absDelta} bps`
      : direction === "down"
        ? `Under target by ${absDelta} bps`
        : `At target (±${absDelta} bps)`;

  // Tone: rose for over, amber for under, emerald for at-target.
  const toneClass =
    direction === "up"
      ? "text-reject-foreground"
      : direction === "down"
        ? "text-warn-foreground"
        : "text-allow-foreground";

  return {
    direction,
    deltaBps: delta,
    significant,
    label,
    toneClass,
  };
}

function DriftArrow({ datum }: { datum: PieDatum }) {
  const drift = computeDrift(datum);
  const arrow =
    drift.direction === "up" ? "▲" : drift.direction === "down" ? "▼" : "►";

  // Bounce animation when significant — small Y oscillation, 0.9s loop.
  const bounce = drift.significant
    ? {
        animate: { y: [0, drift.direction === "up" ? -3 : 3, 0] },
        transition: {
          duration: 0.9,
          repeat: Infinity,
          ease: "easeInOut" as const,
        },
      }
    : {};

  return (
    <motion.span
      className={`font-mono text-xs ${drift.toneClass}`}
      title={drift.label}
      aria-label={drift.label}
      {...bounce}
    >
      {arrow}
    </motion.span>
  );
}

/** Re-export so callers can pass per-sleeve accent data if needed. */
export type { AssetDatum, PieDatum, RiskCategory, VenueDatum };
