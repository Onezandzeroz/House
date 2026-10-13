"use client";

import { AnimatePresence, motion } from "framer-motion";

import type { AssetDatum } from "./types";
import { bpsToPercent, formatMoneyFull } from "./types";

/**
 * InfoCard (Task 29) — a small thumbnail badge that sits around the pie
 * chart and EXPANDS into a richer card on hover. Replaces the side legend
 * (PortfolioLegend) entirely — the cards ARE the legend now.
 *
 * Owner direction (Task 28):
 *   "The info cards should be minimized (thumbnails) and only when mouse
 *    over become dynamically bigger."
 *
 * Two visual states, both absolutely-positioned at the same (x, y) anchor:
 *
 *   1. Thumbnail (default)  — 110 × 36 px
 *      A single horizontal row: brand-colour dot + assetId (mono, bold) +
 *      weight % of NAV (house-num). Subtle 2 px left-border in the asset's
 *      brand colour so the slice ↔ card relationship is obvious at a
 *      glance.
 *
 *   2. Expand (hover)       — 240 × 180 px
 *      A vertical stack:
 *        - Header: brand dot + assetId (serif, larger) + parent-sleeve
 *          badge.
 *        - Hero numeral: weight % of NAV in gold gradient (house-num +
 *          house-text-gradient-gold).
 *        - Sub-line: value (house-num) + "{ofSleevePct}% of {parentLabel}".
 *        - Venue list (top 4): venue name + share % of asset.
 *
 * Framer-motion animates width + height (spring, stiffness 300, damping
 * 30) so the card grows smoothly. The two content stacks cross-fade
 * inside (AnimatePresence with mode="wait") so the content swap is not
 * jarring during the size tween.
 *
 * Hover is controlled externally (the parent owns the `hoveredMiddle`
 * state) so the pie's middle-ring slice and the card stay in sync — when
 * a card expands, the corresponding slice expands; when the slice is
 * hovered, the card expands. See `PortfolioPieChart` for the wiring.
 *
 * The card is a popover-styled surface (`bg-popover`) — not glass — so
 * it stays legible above the busy pie chart.
 */

/** Thumbnail dimensions (must match the parent's positioning math). */
export const CARD_THUMB_WIDTH = 110;
export const CARD_THUMB_HEIGHT = 36;

/** Expand dimensions (must match the parent's positioning math). */
export const CARD_EXPAND_WIDTH = 240;
export const CARD_EXPAND_HEIGHT = 180;

/** Map a venue-kind to a short chip label. Mirrors the pie tooltip. */
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

export interface InfoCardProps {
  /** The asset this card represents (one entry per middle-ring slice). */
  asset: AssetDatum;
  /** Book currency for the value line. */
  bookCurrency: string;
  /** Whether this card is currently hovered (drives expand vs thumbnail).
   *  Owned by the parent so the pie's middle-ring slice can drive the
   *  same state. */
  isHovered: boolean;
  /** Called when the card's hover state changes. The parent uses this
   *  to keep `hoveredMiddle` in sync with the pie. */
  onHoverChange: (hovered: boolean) => void;
}

/**
 * Render the card. The parent positions the card absolutely and applies
 * the `translate(-50%, -50%)` transform so the card's CENTRE stays at
 * the computed (cardX, cardY) anchor — when the card grows, it grows
 * symmetrically around that point.
 */
export function InfoCard({
  asset,
  bookCurrency,
  isHovered,
  onHoverChange,
}: InfoCardProps) {
  const weightPct = bpsToPercent(asset.weightBps);
  const ofSleevePct =
    asset.parentWeightBps > 0
      ? ((asset.weightBps / asset.parentWeightBps) * 100).toFixed(1)
      : "0.0";
  const topVenues = asset.venues.slice(0, 4);

  return (
    <motion.div
      layout
      initial={false}
      animate={{
        width: isHovered ? CARD_EXPAND_WIDTH : CARD_THUMB_WIDTH,
        height: isHovered ? CARD_EXPAND_HEIGHT : CARD_THUMB_HEIGHT,
      }}
      transition={{ type: "spring", stiffness: 320, damping: 30, mass: 0.6 }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onFocus={() => onHoverChange(true)}
      onBlur={() => onHoverChange(false)}
      tabIndex={0}
      role="button"
      aria-label={`${asset.assetId} slice — ${weightPct} percent of NAV`}
      className="relative z-20 cursor-pointer overflow-hidden rounded-md border border-border/80 bg-popover shadow-lg shadow-black/50 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
      style={{
        borderLeftColor: asset.color,
        borderLeftWidth: 2,
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {isHovered ? (
          <motion.div
            key={`expand-${asset.assetId}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14, delay: 0.04 }}
            className="flex flex-col gap-2 p-3"
            style={{ width: CARD_EXPAND_WIDTH, height: CARD_EXPAND_HEIGHT }}
          >
            {/* Header — brand dot + assetId + parent sleeve badge. */}
            <div className="flex items-center gap-1.5 border-b border-border/40 pb-1.5">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full ring-2 ring-background/40"
                style={{ backgroundColor: asset.color }}
              />
              <span className="font-serif text-sm font-bold tracking-tight text-foreground">
                {asset.assetId}
              </span>
              <span className="ml-auto rounded-sm border border-border/60 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-muted-foreground">
                {asset.parentLabel}
              </span>
            </div>

            {/* Hero numeral — weight % of NAV in gold gradient. */}
            <div className="flex items-baseline justify-between">
              <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                of nav
              </span>
              <span className="font-serif text-xl font-bold leading-none house-num house-text-gradient-gold">
                {weightPct}
                <span className="ml-0.5 text-[10px] text-muted-foreground">
                  %
                </span>
              </span>
            </div>

            {/* Sub-line — value + of-sleeve weight. */}
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[11px] house-num text-foreground">
                {formatMoneyFull(asset.value)}
              </span>
              <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
                {ofSleevePct}% of {asset.parentLabel}
              </span>
            </div>

            {/* Venue list — top 4 custody locations. */}
            {topVenues.length > 0 && (
              <div className="mt-auto border-t border-border/40 pt-1.5">
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 pb-0.5 text-[9px] uppercase tracking-widest text-muted-foreground">
                  <span>venue</span>
                  <span className="text-right">value</span>
                  <span className="text-right">share</span>
                </div>
                <div className="max-h-[60px] overflow-y-auto pr-0.5">
                  {topVenues.map((v) => (
                    <div
                      key={`${v.venueKind}-${v.venue}`}
                      className="grid grid-cols-[1fr_auto_auto] items-center gap-2 py-0.5"
                    >
                      <span className="flex items-center gap-1 truncate font-mono text-[10px] text-foreground">
                        <span
                          aria-hidden
                          className="size-1.5 shrink-0 rounded-sm"
                          style={{
                            backgroundColor: asset.color,
                            opacity: 0.6,
                          }}
                        />
                        <span className="truncate">{v.venue}</span>
                      </span>
                      <span className="text-right font-mono text-[10px] text-foreground house-num">
                        {formatMoneyFull(v.value)}
                      </span>
                      <span className="text-right font-mono text-[10px] text-muted-foreground house-num">
                        {(v.shareOfAssetBps / 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
                {asset.venues.length > 4 && (
                  <p className="pt-0.5 text-[9px] text-muted-foreground">
                    +{asset.venues.length - 4} more ·{" "}
                    {venueKindLabel(topVenues[0]!.venueKind)}
                  </p>
                )}
              </div>
            )}

            {topVenues.length === 0 && (
              <p className="mt-auto border-t border-border/40 pt-1.5 text-[9px] uppercase tracking-widest text-muted-foreground">
                {bookCurrency} · advisory only
              </p>
            )}
          </motion.div>
        ) : (
          <motion.div
            key={`thumb-${asset.assetId}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="flex items-center gap-1.5 px-2.5 py-1.5"
            style={{ width: CARD_THUMB_WIDTH, height: CARD_THUMB_HEIGHT }}
          >
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: asset.color }}
            />
            <span className="font-mono text-[11px] font-bold tracking-tight text-foreground">
              {asset.assetId}
            </span>
            <span className="ml-auto font-mono text-[11px] house-num text-primary">
              {weightPct}%
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
