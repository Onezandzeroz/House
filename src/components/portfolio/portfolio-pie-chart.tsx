"use client";

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  Tooltip,
} from "recharts";
import { Plus } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import type {
  AssetDatum,
  PortfolioPieChartProps,
  PieDatum,
  VenueDatum,
} from "./types";
import {
  toPieData,
  bpsToPercent,
  formatMoneyFull,
  formatMoneyShort,
  lightenColor,
  SLEEVE_GRADIENTS,
} from "./types";
import { useAnimatedCounter } from "./use-animated-counter";
import { InfoCard } from "./info-card";
import { PortfolioSummaryStrip } from "./portfolio-summary-strip";

/**
 * PortfolioPieChart (Task 29 — pie-stands-alone rewrite) — the **main
 * overview** for the trust on the `/` route.
 *
 * Owner direction (Task 28 — verbatim):
 *   "the pie chart is to small and this results in the numbers in the
 *    middle being cut off behind the pie chart. The pie chart must stand
 *    alone (for more space). I also want the pie chart info cards
 *    visible at all times with thin lines (connectors) going to the part
 *    of the chart they relate to. The info cards should be minimized
 *    (thumbnails) and only when mouse over become dynamically bigger."
 *
 * What this rewrite delivers (built on Task 26's 3-ring donut):
 *
 *   - PIE STANDS ALONE — full-width container, no side legend. Height
 *     is 500 px (mobile) → 850 px (desktop), MUCH larger than before.
 *     The summary strip now sits UNDER the pie (was beside it).
 *
 *   - CENTRE LABEL REMOVED — the donut hole carries only a small
 *     "House" wordmark in serif. The owner's complaint about "numbers
 *     being cut off" is addressed at the root: there are no big numbers
 *     in the centre to clip. All info now lives in the surrounding
 *     info-cards.
 *
 *   - 6 INFO-CARDS (one per middle-ring asset) — placed in the slice's
 *     angular direction OUTSIDE the pie. Each card is a thumbnail by
 *     default (~110 × 36 px) and EXPANDS on hover to a richer panel
 *     (~240 × 180 px) with weight % of NAV, value, of-sleeve weight,
 *     and a top-4 venue list. Framer-motion animates the width / height
 *     (spring); the two content stacks cross-fade inside.
 *
 *   - SVG LEAD-LINES — one thin (1.5 px) path per card, drawn from the
 *     middle-ring slice's outer edge to the card's anchor point.
 *     Stroke = the asset's brand colour. Opacity 0.4 default, 0.85 when
 *     the card is hovered, 0.15 when other cards are hovered.
 *
 *   - HOVER SYNC — hovering a card expands the corresponding middle-ring
 *     slice (and dims the other middle slices). Hovering a slice expands
 *     the corresponding card. The state is shared (`hoveredMiddle`).
 *
 * The 3 concentric rings from Task 26 are PRESERVED (just resized so the
 * cards fit around them):
 *   INNER  (radius 26–38 %) : 4 sleeves         (strategisk)
 *   MIDDLE (radius 40–52 %) : per-asset slices    (taktisk)
 *   OUTER  (radius 54–65 %) : per-venue slices    (operasjonelt)
 *
 * Data source: accepts EITHER a `PortfolioSnapshot` (3-level hierarchy
 * from `/api/portfolio`) OR an `AdvisoryOpinion` (advisory sleeves
 * with asset IDs only). The `toPieData` normaliser turns either source
 * into the same `NormalizedPortfolio` (with `pieData` + `assetData` +
 * `venueData`).
 *
 * The chart is read-only — no sign path exists. The opinion / snapshot
 * is rådgivning, IKKE en executable intent.
 */

/** The background hex — used as the slice stroke for the "clipped" look.
 * Matches `--background` (#060708) per Task 19. */
const BACKGROUND_HEX = "#060708";

/** Per-ring radii (Task 29 — shrunk from Task 26's 38-58 / 60-80 / 82-95
 * so the info-cards fit OUTSIDE the pie without overflowing the
 * container). The pie is still big — the OUTER ring's outer edge is
 * 65 % of halfSize, so for an 850 px container that's 276 px radius
 * (552 px diameter, ~65 % of the container's smaller dimension). */
const INNER_INNER_R = "26%";
const INNER_OUTER_R = "38%";
const MIDDLE_INNER_R = "40%";
const MIDDLE_OUTER_R = "52%";
const OUTER_INNER_R = "54%";
const OUTER_OUTER_R = "65%";

/** Per-ring radii as numeric percent (used in the card-position math). */
const OUTER_OUTER_R_PCT = 0.65;
const MIDDLE_OUTER_R_PCT = 0.52;

/** Padding angle between slices within a ring (deg).
 *   - INNER  : 3° — clearly separated sleeves
 *   - MIDDLE : 2° — closer, reads as one continuous band
 *   - OUTER  : 1° — tightest, the outer ring is the densest
 */
const PADDING_INNER = 3;
const PADDING_MIDDLE = 2;
const PADDING_OUTER = 1;

/** Hover-expand amounts (px) per ring. */
const HOVER_EXPAND_INNER = 6;
const HOVER_EXPAND_MIDDLE = 6;
const HOVER_EXPAND_OUTER = 5;

/** Per-ring dim amounts (fillOpacity for the non-focused slices).
 * Hover wins over pin — hover = 0.4, pin only = 0.6. */
const DIM_HOVER = 0.4;
const DIM_PIN = 0.6;

/** Outer-ring fill opacity (sub-shade of parent asset colour). */
const OUTER_OPACITY_NORMAL = 0.55;
const OUTER_OPACITY_FOCUSED = 0.85;
const OUTER_OPACITY_HOVER_DIM = 0.3;
const OUTER_OPACITY_PIN_DIM = 0.45;

// ---------------------------------------------------------------------------
// Radial in-slice labels (per eier direction):
// "I want info text in each section of the pi chart showing what the slice
//  section is. The Info text should be placed inside the slice sections as
//  radial from the center inside the section it describes."
//
// Each ring gets its own label renderer that positions text at the
// mid-radius of each slice, rotated to follow the radius (like a spoke
// from center to edge). Text is flipped 180° on the left half (90°-270°)
// so it's always readable (never upside down). Small slices are skipped
// — the text wouldn't fit.
// ---------------------------------------------------------------------------

const RADIAN = Math.PI / 180;

/** Minimum slice fraction to show a label — per ring. */
const MIN_PCT_INNER = 0.04; // 4%
const MIN_PCT_MIDDLE = 0.025; // 2.5%
const MIN_PCT_OUTER = 0.035; // 3.5%

/**
 * Compute the SVG position + rotation for a radial label inside a slice.
 * Returns {x, y, rotation} or null if the slice is too small.
 *
 * - midAngle is in recharts' convention (0°=right, 90°=top, going
 *   counterclockwise in math coords; but startAngle=90 endAngle=-270
 *   makes slices go CLOCKWISE from top).
 * - Position: mid-radius along the mid-angle direction.
 * - Rotation: text top points AWAY from centre, bottom TOWARD centre
 *   (per eier direction: "the text top should be pointing away from
 *   the centre and the bottom of the text towards the centre").
 *   SVG rotation = 90 - midAngle (converts recharts' Y-up CCW to SVG's
 *   Y-down CW, with text oriented along the outward radius).
 *   - 12 o'clock (midAngle 90)  → rotation 0°   (text upright, top↑)
 *   - 3 o'clock  (midAngle 0)   → rotation 90°  (top→ right)
 *   - 6 o'clock  (midAngle -90) → rotation 180° (top↓ down)
 *   - 9 o'clock  (midAngle 180) → rotation -90° (top← left)
 */
function radialLabelTransform(
  cx: number,
  cy: number,
  midAngle: number,
  innerRadius: number,
  outerRadius: number,
  percent: number,
  minPct: number,
): { x: number; y: number; rotation: number } | null {
  if (percent < minPct) return null;
  const radius = (innerRadius + outerRadius) / 2;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  // Text top points away from centre, bottom toward centre.
  // SVG rotation = 90 - midAngle.
  const rotation = 90 - midAngle;
  return { x, y, rotation };
}

/**
 * INNER ring label — shows the sleeve name (Stable / Conservative /
 * Balanced / Aggressive). 12px bold white text.
 */
function renderInnerRadialLabel(props: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  innerRadius?: number;
  outerRadius?: number;
  percent?: number;
  payload?: PieDatum;
  name?: string;
}) {
  const cx = props.cx ?? 0;
  const cy = props.cy ?? 0;
  const midAngle = props.midAngle ?? 0;
  const innerRadius = props.innerRadius ?? 0;
  const outerRadius = props.outerRadius ?? 0;
  const percent = props.percent ?? 0;
  const text = props.payload?.label ?? props.name ?? "";
  const t = radialLabelTransform(
    cx, cy, midAngle, innerRadius, outerRadius, percent, MIN_PCT_INNER,
  );
  if (!t) return null;
  return (
    <text
      x={t.x}
      y={t.y}
      fill="#ffffff"
      fillOpacity={0.95}
      textAnchor="middle"
      dominantBaseline="central"
      transform={`rotate(${t.rotation} ${t.x} ${t.y})`}
      fontSize={12}
      fontWeight={700}
      style={{ pointerEvents: "none" }}
    >
      {text}
    </text>
  );
}

/**
 * MIDDLE ring label — shows the asset ID (BTC, USDC, etc.). 11px bold
 * white text. Skips very small slices (<2.5%).
 */
function renderMiddleRadialLabel(props: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  innerRadius?: number;
  outerRadius?: number;
  percent?: number;
  payload?: AssetDatum;
  name?: string;
}) {
  const cx = props.cx ?? 0;
  const cy = props.cy ?? 0;
  const midAngle = props.midAngle ?? 0;
  const innerRadius = props.innerRadius ?? 0;
  const outerRadius = props.outerRadius ?? 0;
  const percent = props.percent ?? 0;
  const text = props.payload?.assetId ?? props.name ?? "";
  const t = radialLabelTransform(
    cx, cy, midAngle, innerRadius, outerRadius, percent, MIN_PCT_MIDDLE,
  );
  if (!t) return null;
  return (
    <text
      x={t.x}
      y={t.y}
      fill="#ffffff"
      fillOpacity={0.95}
      textAnchor="middle"
      dominantBaseline="central"
      transform={`rotate(${t.rotation} ${t.x} ${t.y})`}
      fontSize={11}
      fontWeight={700}
      style={{ pointerEvents: "none" }}
    >
      {text}
    </text>
  );
}

/**
 * OUTER ring label — shows the venue name (binance, xmagnetic.org, etc.).
 * 9px white text. Skips small slices (<3.5%).
 */
function renderOuterRadialLabel(props: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  innerRadius?: number;
  outerRadius?: number;
  percent?: number;
  payload?: VenueDatum;
  name?: string;
}) {
  const cx = props.cx ?? 0;
  const cy = props.cy ?? 0;
  const midAngle = props.midAngle ?? 0;
  const innerRadius = props.innerRadius ?? 0;
  const outerRadius = props.outerRadius ?? 0;
  const percent = props.percent ?? 0;
  const text = props.payload?.venue ?? props.name ?? "";
  const t = radialLabelTransform(
    cx, cy, midAngle, innerRadius, outerRadius, percent, MIN_PCT_OUTER,
  );
  if (!t) return null;
  return (
    <text
      x={t.x}
      y={t.y}
      fill="#ffffff"
      fillOpacity={0.90}
      textAnchor="middle"
      dominantBaseline="central"
      transform={`rotate(${t.rotation} ${t.x} ${t.y})`}
      fontSize={9}
      fontWeight={600}
      style={{ pointerEvents: "none" }}
    >
      {text}
    </text>
  );
}

/** Pie start/end angles so slice 0 starts at 12 o'clock and the chart
 * progresses CLOCKWISE. Recharts default is startAngle=0 (3 o'clock)
 * going counter-clockwise; this flips it so the top slice is first.
 *
 * With `startAngle={90} endAngle={-270}`:
 *   - slice 0 START is at 90° in recharts' polar-convention, which is
 *     12 o'clock (top) in SVG coords.
 *   - the angle DECREASES from 90 to -270 (sweep of -360°), so the
 *     chart goes clockwise.
 *
 * For the card-position math, the matching "math angle" (degrees, 0 =
 * right, 90 = bottom, going clockwise visually because of SVG y-flip)
 * is `mathAngle = -90 + 360 * midFraction`. At fraction 0 this is -90
 * → (cx + 0, cy - r) = top ✓. At fraction 0.25 this is 0 → (cx + r,
 * cy) = right ✓.
 */
const PIE_START_ANGLE = 90;
const PIE_END_ANGLE = -270;

/** Offset (px) from the outer ring's outer edge to the card's CENTRE.
 * 20 px keeps the card visually adjacent to the pie without overlapping
 * the outer ring. */
const CARD_OFFSET = 20;

/** Small dot radius for the lead-line's slice-side anchor (visual nicety
 * — a coloured dot at the slice's outer edge makes the connection point
 * obvious). */
const LEAD_ANCHOR_R = 2;

/**
 * Render the portfolio pie chart card. Accepts EITHER `snapshot` OR
 * `opinion` (snapshot wins if both are present).
 */
export function PortfolioPieChart(props: PortfolioPieChartProps) {
  const {
    snapshot,
    opinion,
    bookCurrency,
    mode,
    aiRole,
    killSwitchActive,
    regime,
    simulateLive = false,
  } = props;

  const data = useMemo(
    () =>
      toPieData({
        snapshot,
        opinion,
        bookCurrency,
        mode,
        aiRole,
        killSwitchActive,
        regime,
      }),
    [
      snapshot,
      opinion,
      bookCurrency,
      mode,
      aiRole,
      killSwitchActive,
      regime,
    ],
  );

  // Three independent hover/pin slot pairs — one per ring. Each ring is
  // visually independent (hovering one ring does NOT dim another ring),
  // but the pinned ring-glow + the centre wordmark follow any pin.
  const [hoveredInner, setHoveredInner] = useState<number | null>(null);
  const [pinnedInner, setPinnedInner] = useState<number | null>(null);
  const [hoveredMiddle, setHoveredMiddle] = useState<number | null>(null);
  const [pinnedMiddle, setPinnedMiddle] = useState<number | null>(null);
  const [hoveredOuter, setHoveredOuter] = useState<number | null>(null);
  const [pinnedOuter, setPinnedOuter] = useState<number | null>(null);

  // Optional "live tick" simulation — same as Task 20.
  const baseNav = useMemo(() => {
    if (data.hasPositions) return Number.parseFloat(data.nav);
    return 0;
  }, [data.hasPositions, data.nav]);
  const [liveNav, setLiveNav] = useState<number>(baseNav);
  useEffect(() => {
    setLiveNav(baseNav);
  }, [baseNav]);
  useEffect(() => {
    if (!simulateLive || !data.hasPositions) return;
    const id = window.setInterval(() => {
      setLiveNav((prev) => prev * (1 + (Math.random() - 0.5) * 0.001));
    }, 5000);
    return () => window.clearInterval(id);
  }, [simulateLive, data.hasPositions]);

  const navTarget = simulateLive && data.hasPositions ? liveNav : baseNav;
  const animatedNav = useAnimatedCounter(navTarget, 800, 2);
  const animatedNavDisplay = formatMoneyShort(
    animatedNav.toFixed(2).toString(),
  );

  // Container size tracking — used to compute card positions in pixels.
  // The pie's ResponsiveContainer fills the container; recharts' cx/cy
  // are at 50 % / 50 % of the container's width / height. We track the
  // actual rendered size via ResizeObserver so the cards land at the
  // correct (x, y) even on resize / responsive breakpoints.
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setContainerSize({
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Middle ring data — already flattened by `toPieData`. May be empty in
  // the opinion-path-with-no-weights case; the chart conditionally
  // renders the middle + outer `<Pie>` layers when non-empty.
  const middleData = data.assetData;
  const outerData = data.venueData;

  // Compute card positions for each middle-ring asset. MUST run before
  // the early return on `!data.hasPositions` so the React hook order
  // stays consistent across renders (rules-of-hooks). When there are no
  // positions (or container not yet measured), `cardLayout` is just `[]`.
  //
  // Card positioning (per eier direction):
  //   - Cards placed CLOSE TO their slice's true angle (NOT evenly
  //     distributed around the circumference).
  //   - Cards stack in TWO COLUMNS (left + right of the pie) based on
  //     which half the slice is in. Card Y = slice's Y (so the card is
  //     visually beside its slice), with overlap-avoidance nudging
  //     cards apart when small clustered slices would collide.
  //   - Lead-lines BEND (elbow / L-shape): from slice outer edge,
  //     outward a bit, then horizontally to the card's pie-facing edge.
  const cardLayout = useMemo(() => {
    if (
      !containerSize.width ||
      !containerSize.height ||
      middleData.length === 0
    ) {
      return [] as Array<{
        asset: AssetDatum;
        index: number;
        sliceMidAngle: number;
        sliceMidX: number;
        sliceMidY: number;
        cardX: number;
        cardY: number;
        cardEdgeX: number; // pie-facing edge of the card — where lead-line ends
        side: "left" | "right";
      }>;
    }
    const cx = containerSize.width / 2;
    const cy = containerSize.height / 2;
    const halfSize = Math.min(containerSize.width, containerSize.height) / 2;
    const middleRingOuterPx = MIDDLE_OUTER_R_PCT * halfSize;
    const totalWeight = middleData.reduce(
      (sum, a) => sum + a.weightBps,
      0,
    );
    if (totalWeight === 0) return [];

    // Compute each slice's TRUE mid-angle (cumulative-weight based).
    const slicesWithAngles = middleData.map((asset, index) => {
      let cumulativeBefore = 0;
      for (let j = 0; j < index; j++) {
        cumulativeBefore += middleData[j]!.weightBps;
      }
      const midFraction =
        (cumulativeBefore + asset.weightBps / 2) / totalWeight;
      // mathAngle: 0° = top (12 o'clock), going clockwise.
      // -90 + 360 * fraction: fraction 0 → -90 (top), 0.25 → 0 (right), etc.
      const mathAngle = -90 + 360 * midFraction;
      return { asset, index, sliceMidAngle: mathAngle };
    });

    // Sort by slice mid-angle so cards appear in clockwise order matching
    // their slices — important for the overlap-avoidance pass below.
    const sorted = [...slicesWithAngles].sort(
      (a, b) => a.sliceMidAngle - b.sliceMidAngle,
    );

    // Card dimensions (thumbnail default — matches InfoCard's thumbnail size).
    const CARD_W = 110;
    const CARD_H = 36;
    // Cards sit RIGHT BESIDE their slice's outer edge in the slice's
    // angular direction (per eier direction: "close to the part of the
    // pie chart they represent"). NOT in side-columns at container edge.
    // Initial offset is small (~30px); overlap-avoidance below may push
    // cards further outward when small clustered slices would collide.
    const BASE_OFFSET = 30;
    const CARD_RADIUS = Math.max(CARD_W, CARD_H) / 2; // ~55 — for overlap calc
    const MIN_CARD_DIST = CARD_W + 12; // min center-to-center distance

    // Initial layout: each card placed in its slice's angular direction,
    // BASE_OFFSET outward from the middle ring's outer edge. Card center
    // is at (cardX, cardY); card has no fixed column — it sits where its
    // slice points.
    const layout = sorted.map((entry) => {
      const sliceAngleRad = (entry.sliceMidAngle * Math.PI) / 180;
      const sliceMidX = cx + middleRingOuterPx * Math.cos(sliceAngleRad);
      const sliceMidY = cy + middleRingOuterPx * Math.sin(sliceAngleRad);

      // Side: right half = angle in (-90, 90); left half = angle in (90, 270).
      const isRight =
        entry.sliceMidAngle > -90 && entry.sliceMidAngle < 90;
      const side: "left" | "right" = isRight ? "right" : "left";

      // Card placed in slice's angular direction, BASE_OFFSET beyond slice edge.
      // offset is mutable — overlap-avoidance below may push it further out.
      const cardDist = middleRingOuterPx + BASE_OFFSET;
      const cardX = cx + cardDist * Math.cos(sliceAngleRad);
      const cardY = cy + cardDist * Math.sin(sliceAngleRad);

      // Card's pie-facing edge — where the lead-line ends.
      // The pie-facing edge is on the side of the card nearest the pie,
      // i.e. the edge pointing toward (cx, cy).
      const angleToCenter = Math.atan2(cy - cardY, cx - cardX);
      const cardEdgeX = cardX + (CARD_W / 2) * Math.cos(angleToCenter);
      // (We don't use cardEdgeY because the bent path ends at the card's
      // pie-facing edge but at the card's Y — see path computation below.
      // cardEdgeX is enough for the horizontal segment.)

      return {
        asset: entry.asset,
        index: entry.index,
        sliceMidAngle: entry.sliceMidAngle,
        sliceAngleRad,
        sliceMidX,
        sliceMidY,
        cardX,
        cardY,
        cardEdgeX,
        side,
        offset: BASE_OFFSET,
      };
    });

    // Overlap avoidance: walk cards in angular order. If a card would
    // overlap the previous card (center-to-center distance <
    // MIN_CARD_DIST), push THIS card further outward (increase its
    // offset) until it clears. This is what lets small clustered slices
    // (DOGE / ARB / SOL in the demo) keep their cards close to their
    // slices WITHOUT overlapping — cards just fan slightly outward.
    // Two passes (forward + backward) catch both top-down and
    // bottom-up collision cascades.
    const recompute = (item: (typeof layout)[number]) => {
      const cardDist = middleRingOuterPx + item.offset;
      item.cardX = cx + cardDist * Math.cos(item.sliceAngleRad);
      item.cardY = cy + cardDist * Math.sin(item.sliceAngleRad);
      const angleToCenter = Math.atan2(cy - item.cardY, cx - item.cardX);
      item.cardEdgeX = item.cardX + (CARD_W / 2) * Math.cos(angleToCenter);
    };

    const pushApart = (a: (typeof layout)[number], b: (typeof layout)[number]) => {
      const dx = b.cardX - a.cardX;
      const dy = b.cardY - a.cardY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MIN_CARD_DIST && dist > 0.001) {
        // Push b outward until it clears a. Each px of offset moves b
        // ~1px outward along its angle (which is approximately the
        // direction away from a for clustered slices). Conservative.
        const needed = (MIN_CARD_DIST - dist);
        b.offset += needed + 8;
        recompute(b);
      }
    };

    // Forward pass.
    for (let i = 1; i < layout.length; i++) {
      pushApart(layout[i - 1]!, layout[i]!);
    }
    // Backward pass (catch wrap-around / bottom-up collisions).
    for (let i = layout.length - 2; i >= 0; i--) {
      pushApart(layout[i + 1]!, layout[i]!);
    }
    // Wrap-around: first and last card may also collide (the angular
    // ring closes). Only check if there are >= 3 cards.
    if (layout.length >= 3) {
      pushApart(layout[layout.length - 1]!, layout[0]!);
    }

    // Clamp cards within container (so they don't get pushed off-screen).
    const maxX = containerSize.width - CARD_W / 2 - 4;
    const minX = CARD_W / 2 + 4;
    const maxY = containerSize.height - CARD_H / 2 - 4;
    const minY = CARD_H / 2 + 4;
    for (const item of layout) {
      if (item.cardX > maxX) {
        item.cardX = maxX;
        item.cardEdgeX = item.cardX - CARD_W / 2;
      }
      if (item.cardX < minX) {
        item.cardX = minX;
        item.cardEdgeX = item.cardX + CARD_W / 2;
      }
      if (item.cardY > maxY) item.cardY = maxY;
      if (item.cardY < minY) item.cardY = minY;
    }

    return layout;
  }, [middleData, containerSize]);

  if (!data.hasPositions) {
    return <EmptyState trustName={data.trustName} />;
  }

  // Pinned-ring-glow overlay — shown when ANY pin is set (inner, middle,
  // or outer). Uniform emerald per the spec.
  const anyPinned =
    pinnedInner !== null || pinnedMiddle !== null || pinnedOuter !== null;

  const togglePinInner = (i: number) =>
    setPinnedInner((prev) => (prev === i ? null : i));
  const togglePinMiddle = (i: number) =>
    setPinnedMiddle((prev) => (prev === i ? null : i));
  const togglePinOuter = (i: number) =>
    setPinnedOuter((prev) => (prev === i ? null : i));

  const clearAllPins = () => {
    setPinnedInner(null);
    setPinnedMiddle(null);
    setPinnedOuter(null);
  };

  return (
    <Card
      aria-labelledby="portfolio-pie-chart-title"
      className="relative overflow-visible border border-border/60 bg-card"
    >
      <CardHeader className="gap-2 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle
            id="portfolio-pie-chart-title"
            className="font-serif text-2xl font-bold tracking-tight"
          >
            House Asset Allocation
          </CardTitle>
          <div className="flex items-center gap-2">
            {simulateLive ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-allow/40 bg-allow/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-allow-foreground">
                <span aria-hidden className="relative flex size-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-allow-foreground opacity-75" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-allow-foreground" />
                </span>
                Live
              </span>
            ) : null}
            {data.trustName ? (
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                {data.trustName}
              </span>
            ) : null}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Three concentric rings — inner is the four sleeves (Stable to
          Aggressive), middle is each asset held, outer is where each
          asset is custodied. Hover an info-card around the pie to
          expand the detail; hover a slice to surface its tooltip.
        </p>
        <Separator className="house-hairline" />
      </CardHeader>

      <CardContent className="flex flex-col gap-6 p-6 pt-0">
        {/* The standalone pie + lead-lines + info-cards. Container is
         * MUCH larger than Task 26 (was 380–700 px; now 500–850 px) so
         * the pie can breathe and the cards have room around it. Height
         * is `min(82vw, Xpx)` so on narrow viewports the chart stays
         * roughly square (no weird tall-and-thin donut). The custom
         * `house-pie-container` utility (in globals.css) handles the
         * responsive height + the `overflow-visible` so cards can extend
         * beyond the chart wrapper without being clipped. */}
        <div
          ref={containerRef}
          className="house-pie-container relative w-full overflow-visible rounded-xl border border-border/60 bg-card/40"
          style={{
            height: "calc(100vh - 240px)",
            minHeight: "360px",
            maxHeight: "760px",
          }}
        >
          {/* Subtle radial glow behind the donut — depth, not noise. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, rgba(16,185,129,0.06), transparent 60%)",
            }}
          />

          {/* Minimal centre wordmark — NO big numbers (per owner: "the
           * numbers in the middle being cut off"). Just a small "House"
           * serif label so the donut hole is not empty. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-center"
          >
            <span className="font-serif text-base font-semibold tracking-[0.25em] text-muted-foreground/60">
              HOUSE
            </span>
            <span className="text-[9px] uppercase tracking-[0.4em] text-muted-foreground/40">
              bankroll
            </span>
          </div>

          {/* The 3-ring donut itself. */}
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <defs>
                {/* INNER-ring gradients — one per sleeve. */}
                {data.pieData.map((d) => {
                  const g = SLEEVE_GRADIENTS[d.category];
                  return (
                    <linearGradient
                      key={g.id}
                      id={g.id}
                      x1="0"
                      y1="0"
                      x2="1"
                      y2="1"
                    >
                      <stop offset="0%" stopColor={g.from} />
                      <stop offset="100%" stopColor={g.to} />
                    </linearGradient>
                  );
                })}

                {/* MIDDLE-ring gradients — ONE PER UNIQUE ASSET.
                 * Brand-colour → 15 % lighter via `lightenColor`. */}
                {middleData.map((a) => (
                  <linearGradient
                    key={a.gradientId}
                    id={a.gradientId}
                    x1="0"
                    y1="0"
                    x2="1"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={a.color} />
                    <stop
                      offset="100%"
                      stopColor={lightenColor(a.color, 0.15)}
                    />
                  </linearGradient>
                ))}
              </defs>

              {/* INNER RING — 4 sleeves. */}
              <Pie
                data={data.pieData}
                dataKey="weightBps"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={INNER_INNER_R}
                outerRadius={INNER_OUTER_R}
                paddingAngle={PADDING_INNER}
                startAngle={PIE_START_ANGLE}
                endAngle={PIE_END_ANGLE}
                stroke={BACKGROUND_HEX}
                strokeWidth={3}
                label={renderInnerRadialLabel}
                labelLine={false}
                isAnimationActive
                animationDuration={800}
                animationType="spring"
                activeIndex={
                  hoveredInner !== null ? hoveredInner : undefined
                }
                activeShape={(props: React.ComponentProps<typeof Sector>) => {
                  const outerRadius =
                    (props.outerRadius as number | undefined) ?? 0;
                  return (
                    <Sector
                      {...props}
                      outerRadius={outerRadius + HOVER_EXPAND_INNER}
                      stroke={BACKGROUND_HEX}
                      strokeWidth={3}
                      style={{
                        filter:
                          "drop-shadow(0 0 10px rgba(16,185,129,0.45))",
                      }}
                    />
                  );
                }}
                onMouseEnter={(_data, index) => {
                  setHoveredInner(index);
                }}
                onMouseLeave={() => setHoveredInner(null)}
                onClick={(_data, index) => {
                  togglePinInner(index);
                }}
              >
                {data.pieData.map((datum, i) => {
                  const isHovered = hoveredInner === i;
                  const isPinned = pinnedInner === i;
                  const anythingFocused =
                    hoveredInner !== null || pinnedInner !== null;
                  const dim = anythingFocused && !isHovered && !isPinned;
                  const dimAmount =
                    hoveredInner !== null ? DIM_HOVER : DIM_PIN;
                  return (
                    <Cell
                      key={datum.category}
                      fill={`url(#${datum.gradientId})`}
                      fillOpacity={dim ? dimAmount : 1}
                      stroke={BACKGROUND_HEX}
                      strokeWidth={3}
                    />
                  );
                })}
              </Pie>

              {/* MIDDLE RING — per-asset slices. Each Cell uses the
               * asset's OWN per-asset linear gradient (brand colour). */}
              {middleData.length > 0 && (
                <Pie
                  data={middleData}
                  dataKey="weightBps"
                  nameKey="assetId"
                  cx="50%"
                  cy="50%"
                  innerRadius={MIDDLE_INNER_R}
                  outerRadius={MIDDLE_OUTER_R}
                  paddingAngle={PADDING_MIDDLE}
                  startAngle={PIE_START_ANGLE}
                  endAngle={PIE_END_ANGLE}
                  stroke={BACKGROUND_HEX}
                  strokeWidth={2}
                  label={renderMiddleRadialLabel}
                  labelLine={false}
                  isAnimationActive
                  animationDuration={700}
                  animationType="spring"
                  activeIndex={
                    hoveredMiddle !== null ? hoveredMiddle : undefined
                  }
                  activeShape={(
                    props: React.ComponentProps<typeof Sector>,
                  ) => {
                    const outerRadius =
                      (props.outerRadius as number | undefined) ?? 0;
                    return (
                      <Sector
                        {...props}
                        outerRadius={outerRadius + HOVER_EXPAND_MIDDLE}
                        stroke={BACKGROUND_HEX}
                        strokeWidth={2}
                        style={{
                          filter:
                            "drop-shadow(0 0 10px rgba(16,185,129,0.45))",
                        }}
                      />
                    );
                  }}
                  onMouseEnter={(_data, index) => {
                    setHoveredMiddle(index);
                  }}
                  onMouseLeave={() => setHoveredMiddle(null)}
                  onClick={(_data, index) => {
                    togglePinMiddle(index);
                  }}
                >
                  {middleData.map((datum, i) => {
                    const isHovered = hoveredMiddle === i;
                    const isPinned = pinnedMiddle === i;
                    const anythingFocused =
                      hoveredMiddle !== null || pinnedMiddle !== null;
                    const dim = anythingFocused && !isHovered && !isPinned;
                    const dimAmount =
                      hoveredMiddle !== null ? DIM_HOVER : DIM_PIN;
                    return (
                      <Cell
                        key={`${datum.parentCategory}-${datum.assetId}`}
                        fill={`url(#${datum.gradientId})`}
                        fillOpacity={dim ? dimAmount : 1}
                        stroke={BACKGROUND_HEX}
                        strokeWidth={2}
                      />
                    );
                  })}
                </Pie>
              )}

              {/* OUTER RING — per-venue slices. Each Cell uses the
               * parent asset's brand-colour at fillOpacity 0.55 (or
               * 0.85 focused / 0.3 dim-hover / 0.45 dim-pin). */}
              {outerData.length > 0 && (
                <Pie
                  data={outerData}
                  dataKey="weightBps"
                  nameKey="venue"
                  cx="50%"
                  cy="50%"
                  innerRadius={OUTER_INNER_R}
                  outerRadius={OUTER_OUTER_R}
                  paddingAngle={PADDING_OUTER}
                  startAngle={PIE_START_ANGLE}
                  endAngle={PIE_END_ANGLE}
                  stroke={BACKGROUND_HEX}
                  strokeWidth={1.5}
                  label={renderOuterRadialLabel}
                  labelLine={false}
                  isAnimationActive
                  animationDuration={600}
                  animationType="spring"
                  activeIndex={
                    hoveredOuter !== null ? hoveredOuter : undefined
                  }
                  activeShape={(
                    props: React.ComponentProps<typeof Sector>,
                  ) => {
                    const outerRadius =
                      (props.outerRadius as number | undefined) ?? 0;
                    return (
                      <Sector
                        {...props}
                        outerRadius={outerRadius + HOVER_EXPAND_OUTER}
                        stroke={BACKGROUND_HEX}
                        strokeWidth={1.5}
                        style={{
                          filter:
                            "drop-shadow(0 0 8px rgba(16,185,129,0.4))",
                        }}
                      />
                    );
                  }}
                  onMouseEnter={(_data, index) => {
                    setHoveredOuter(index);
                  }}
                  onMouseLeave={() => setHoveredOuter(null)}
                  onClick={(_data, index) => {
                    togglePinOuter(index);
                  }}
                >
                  {outerData.map((datum, i) => {
                    const isHovered = hoveredOuter === i;
                    const isPinned = pinnedOuter === i;
                    const anythingFocused =
                      hoveredOuter !== null || pinnedOuter !== null;
                    const dim = anythingFocused && !isHovered && !isPinned;
                    const opacity = isHovered || isPinned
                      ? OUTER_OPACITY_FOCUSED
                      : dim
                        ? (hoveredOuter !== null
                            ? OUTER_OPACITY_HOVER_DIM
                            : OUTER_OPACITY_PIN_DIM)
                        : OUTER_OPACITY_NORMAL;
                    return (
                      <Cell
                        key={`${datum.parentAssetId}-${datum.venueKind}-${datum.venue}-${i}`}
                        fill={datum.parentColor}
                        fillOpacity={opacity}
                        stroke={BACKGROUND_HEX}
                        strokeWidth={1.5}
                      />
                    );
                  })}
                </Pie>
              )}

              <Tooltip
                content={
                  <PieTooltipContent bookCurrency={data.bookCurrency} />
                }
                cursor={false}
                offset={16}
                wrapperStyle={{ zIndex: 30 }}
                isAnimationActive={false}
              />
            </PieChart>
          </ResponsiveContainer>

          {/* Pinned-ring-glow overlay — HTML/CSS ring over the donut.
           * Uniform emerald glow around the entire donut whenever ANY
           * ring has a pinned slice. Sized to the pie's outer ring. */}
          {anyPinned && (
            <div
              aria-hidden
              className="house-pulse-emerald pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <div
                className="rounded-full border-2 border-allow/50"
                style={{
                  width: "68%",
                  height: "68%",
                  boxShadow:
                    "0 0 24px rgba(16,185,129,0.35), inset 0 0 24px rgba(16,185,129,0.18)",
                }}
              />
            </div>
          )}

          {/* SVG overlay — thin lead-lines from each middle-ring slice
           * to its info-card anchor. `pointer-events-none` so the SVG
           * does not block pie hover/click. */}
          {containerSize.width > 0 && (
            <svg
              aria-hidden
              className="pointer-events-none absolute inset-0"
              width={containerSize.width}
              height={containerSize.height}
            >
              {cardLayout.map(({ asset, index, sliceMidX, sliceMidY, cardX, cardY, cardEdgeX, sliceMidAngle }) => {
                const isHovered = hoveredMiddle === index;
                const isOtherHovered =
                  hoveredMiddle !== null && hoveredMiddle !== index;
                const opacity = isHovered
                  ? 0.85
                  : isOtherHovered
                    ? 0.15
                    : 0.4;
                // Bent lead-line path (Z-shape / staircase with two
                // visible elbows):
                //   1. Start at slice's outer-edge midpoint.
                //   2. Go OUTWARD in the slice's radial direction (40px)
                //      — leaves the pie cleanly, gives the first elbow
                //      room to be visible.
                //   3. Go HORIZONTALLY to the card's pie-facing x
                //      (cardEdgeX), holding the waypoint's y — first
                //      visible elbow.
                //   4. Go VERTICALLY to the card's y (cardY) — second
                //      visible elbow.
                // The two elbows make the bend visually unmistakable
                // (per eier direction: "the connector lines to be strait
                // lines only they may bend to reach their connection
                // points").
                const sliceAngleRad = (sliceMidAngle * Math.PI) / 180;
                const OUTWARD = 40; // px outward from slice before bending
                const waypointX =
                  sliceMidX + OUTWARD * Math.cos(sliceAngleRad);
                const waypointY =
                  sliceMidY + OUTWARD * Math.sin(sliceAngleRad);
                const pathD = `M ${sliceMidX} ${sliceMidY} L ${waypointX} ${waypointY} L ${cardEdgeX} ${waypointY} L ${cardEdgeX} ${cardY}`;
                return (
                  <g key={`lead-${asset.assetId}`}>
                    <path
                      d={pathD}
                      stroke={asset.color}
                      strokeWidth={isHovered ? 2 : 1.5}
                      fill="none"
                      opacity={opacity}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {/* Anchor dot at the slice's outer edge — makes the
                     * connection point obvious. */}
                    <circle
                      cx={sliceMidX}
                      cy={sliceMidY}
                      r={LEAD_ANCHOR_R}
                      fill={asset.color}
                      opacity={opacity}
                    />
                  </g>
                );
              })}
            </svg>
          )}

          {/* Info-cards — absolutely positioned around the pie at each
           * middle-ring slice's angular direction. */}
          {cardLayout.map(({ asset, index, cardX, cardY }) => (
            <div
              key={`card-${asset.assetId}`}
              className="absolute"
              style={{
                left: `${cardX}px`,
                top: `${cardY}px`,
                transform: "translate(-50%, -50%)",
              }}
            >
              <InfoCard
                asset={asset}
                bookCurrency={data.bookCurrency}
                isHovered={hoveredMiddle === index}
                onHoverChange={(h) => {
                  if (h) setHoveredMiddle(index);
                  else if (hoveredMiddle === index) setHoveredMiddle(null);
                }}
              />
            </div>
          ))}

          {/* "Clear pin" affordance — visible only when any slice is
           * pinned. Clears ALL three pins. */}
          {anyPinned && (
            <button
              type="button"
              onClick={clearAllPins}
              className="absolute right-2 top-2 z-30 rounded-md border border-border/60 bg-background/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
              aria-label="Clear pinned slice"
            >
              Clear pin
            </button>
          )}

          {/* Mini NAV badge — bottom-left, just a small echo of the
           * book-value. NOT in the donut hole (where it clipped before)
           * — pinned to the chart container's bottom-left corner. */}
          <div
            aria-label={`Net asset value ${animatedNavDisplay} ${data.bookCurrency}`}
            className="pointer-events-none absolute bottom-2 left-2 z-10 flex flex-col gap-0.5"
          >
            <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
              NAV
            </span>
            <span className="font-serif text-base font-bold leading-none house-num house-text-gradient-gold">
              {animatedNavDisplay}
            </span>
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
              {data.bookCurrency}
            </span>
          </div>
        </div>

        <Separator className="house-hairline" />

        {/* KPI strip — dry powder + NAV + positions + AI role. Now sits
         * UNDER the pie (no side legend to its right). */}
        <PortfolioSummaryStrip data={data} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Custom Tooltip content — 3 variants. Recharts' default is stylistically
// wrong for dark mode; this component renders the full tooltip so the gold
// / muted palette stays consistent with the rest of the dashboard.
//
// Per eier direction (revert, Task 24 round): the tooltip is a plain dark
// card — `bg-popover border` — no glassmorphism, no framer-motion fade.
//
// The tooltip handles THREE payload shapes:
//   - PieDatum    (inner ring)  — has `category` + `assets` (array)
//   - AssetDatum  (middle ring) — has `assetId` + `venues` (array)
//   - VenueDatum  (outer ring)  — has `venue` + `venueKind`
// It sniffs the payload shape to choose which layout to render.
// ---------------------------------------------------------------------------

interface PieTooltipContentProps {
  active?: boolean;
  payload?: ReadonlyArray<{
    payload: PieDatum | AssetDatum | VenueDatum;
    color: string;
    name?: string;
    value?: number;
  }>;
  bookCurrency: string;
}

function isVenuePayload(
  p: PieDatum | AssetDatum | VenueDatum,
): p is VenueDatum {
  return (
    (p as VenueDatum).venue !== undefined &&
    (p as VenueDatum).venueKind !== undefined &&
    (p as VenueDatum).parentAssetId !== undefined
  );
}

function isAssetPayload(
  p: PieDatum | AssetDatum | VenueDatum,
): p is AssetDatum {
  return (
    (p as AssetDatum).assetId !== undefined &&
    Array.isArray((p as AssetDatum).venues) &&
    (p as AssetDatum).parentCategory !== undefined
  );
}

function PieTooltipContent({
  active,
  payload,
  bookCurrency,
}: PieTooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];
  const datum = entry.payload;

  // OUTER (venue) tooltip — venue name + kind + value + weight of NAV +
  // weight of parent asset + parent asset + parent sleeve.
  if (isVenuePayload(datum)) {
    const weightPct = bpsToPercent(datum.weightBps);
    const ofAssetPct =
      datum.shareOfAssetBps > 0
        ? (datum.shareOfAssetBps / 100).toFixed(1)
        : "0.0";
    return (
      <div className="max-w-[16rem] rounded-md border border-border bg-popover p-3 shadow-xl shadow-black/50">
        <div className="flex items-center gap-2 border-b border-border/40 pb-2">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-sm"
            style={{
              backgroundColor: datum.parentColor,
              opacity: 0.7,
            }}
          />
          <span className="font-serif text-sm font-semibold tracking-tight">
            {datum.venue}
          </span>
          <span className="ml-auto rounded-sm border border-border/60 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
            {venueKindLabel(datum.venueKind)}
          </span>
        </div>
        <div className="flex items-end justify-between gap-3 py-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              of nav
            </span>
            <span className="font-serif text-xl font-bold leading-none house-num text-primary">
              {weightPct}
              <span className="ml-0.5 text-[10px] text-muted-foreground">%</span>
            </span>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              value
            </span>
            <span className="font-mono text-xs house-num">
              {formatMoneyFull(datum.value)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {bookCurrency} · {ofAssetPct}% of {datum.parentAssetId}
            </span>
          </div>
        </div>
        <div className="border-t border-border/40 pt-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          parent: {datum.parentAssetId} · {datum.parentCategory} sleeve
        </div>
      </div>
    );
  }

  // MIDDLE (asset) tooltip — assetId + brand dot + weight of NAV + value
  // + weight of parent sleeve + venue list (top 4).
  if (isAssetPayload(datum)) {
    const weightPct = bpsToPercent(datum.weightBps);
    const ofSleevePct =
      datum.parentWeightBps > 0
        ? ((datum.weightBps / datum.parentWeightBps) * 100).toFixed(1)
        : "0.0";
    const topVenues = datum.venues.slice(0, 4);
    return (
      <div className="max-w-[18rem] rounded-md border border-border bg-popover p-3 shadow-xl shadow-black/50">
        <div className="flex items-center gap-2 border-b border-border/40 pb-2">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full ring-2 ring-background/40"
            style={{ backgroundColor: datum.color }}
          />
          <span className="font-serif text-sm font-semibold tracking-tight">
            {datum.assetId}
          </span>
          <span className="ml-auto text-[10px] uppercase tracking-widest text-muted-foreground">
            {datum.parentLabel} sleeve
          </span>
        </div>
        <div className="flex items-end justify-between gap-3 py-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              of nav
            </span>
            <span className="font-serif text-xl font-bold leading-none house-num text-primary">
              {weightPct}
              <span className="ml-0.5 text-[10px] text-muted-foreground">%</span>
            </span>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              value
            </span>
            <span className="font-mono text-xs house-num">
              {formatMoneyFull(datum.value)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {bookCurrency} · {ofSleevePct}% of {datum.parentLabel}
            </span>
          </div>
        </div>
        {topVenues.length > 0 && (
          <div className="border-t border-border/40 pt-2">
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
              <span>venue</span>
              <span className="text-right">value</span>
              <span className="text-right">share</span>
            </div>
            {topVenues.map((v) => (
              <div
                key={`${v.venueKind}-${v.venue}`}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-0.5"
              >
                <span className="font-mono text-xs text-foreground">
                  {v.venue}
                </span>
                <span className="text-right font-mono text-xs text-foreground house-num">
                  {formatMoneyFull(v.value)}
                </span>
                <span className="text-right font-mono text-xs text-muted-foreground house-num">
                  {(v.shareOfAssetBps / 100).toFixed(1)}%
                </span>
              </div>
            ))}
            {datum.venues.length > 4 && (
              <p className="pt-1 text-[10px] text-muted-foreground">
                +{datum.venues.length - 4} more — see info-card.
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // INNER (sleeve) tooltip — sleeve name + sleeve colour dot + weight% +
  // NAV contribution + asset list (top 6).
  const weightPct = bpsToPercent(datum.weightBps);
  const gradientId = datum.gradientId;

  return (
    <div className="max-w-[18rem] rounded-md border border-border bg-popover p-3 shadow-xl shadow-black/50">
      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
        <svg
          viewBox="0 0 12 12"
          aria-hidden
          className="size-3 shrink-0 rounded-full ring-2 ring-background/40"
        >
          <defs>
            <linearGradient
              id={`tt-${gradientId}`}
              x1="0"
              y1="0"
              x2="1"
              y2="1"
            >
              <stop
                offset="0%"
                stopColor={SLEEVE_GRADIENTS[datum.category].from}
              />
              <stop
                offset="100%"
                stopColor={SLEEVE_GRADIENTS[datum.category].to}
              />
            </linearGradient>
          </defs>
          <circle cx="6" cy="6" r="6" fill={`url(#tt-${gradientId})`} />
        </svg>
        <span className="font-serif text-sm font-semibold tracking-tight">
          {datum.label}
        </span>
        <span className="ml-auto text-[10px] uppercase tracking-widest text-muted-foreground">
          {datum.assetCount} {datum.assetCount === 1 ? "asset" : "assets"}
        </span>
      </div>
      <div className="flex items-end justify-between gap-3 py-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            weight
          </span>
          <span className="font-serif text-xl font-bold leading-none house-num text-primary">
            {weightPct}
            <span className="ml-0.5 text-[10px] text-muted-foreground">%</span>
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            nav contribution
          </span>
          <span className="font-mono text-xs house-num">
            {formatMoneyFull(datum.navContribution)}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {bookCurrency}
          </span>
        </div>
      </div>
      {datum.assets.length > 0 && (
        <div className="border-t border-border/40 pt-2">
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>asset</span>
            <span className="text-right">value</span>
            <span className="text-right">weight</span>
          </div>
          {datum.assets.slice(0, 6).map((asset) => (
            <div
              key={asset.assetId}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-0.5"
            >
              <span className="font-mono text-xs text-foreground">
                {asset.assetId}
              </span>
              <span className="text-right font-mono text-xs text-foreground house-num">
                {formatMoneyFull(asset.value)}
              </span>
              <span className="text-right font-mono text-xs text-muted-foreground house-num">
                {bpsToPercent(asset.weightBps)}%
              </span>
            </div>
          ))}
          {datum.assets.length > 6 && (
            <p className="pt-1 text-[10px] text-muted-foreground">
              +{datum.assets.length - 6} more — see info-cards.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Map a venue-kind to a human label for the venue tooltip chip. */
function venueKindLabel(kind: string): string {
  switch (kind) {
    case "cex":
      return "CEX";
    case "evm-wallet":
      return "EVM wallet";
    case "solana-wallet":
      return "Solana wallet";
    case "stake-defi":
      return "Stake / DeFi";
    default:
      return kind;
  }
}

// ---------------------------------------------------------------------------
// Empty state — when the trust has no positions yet. Shown in place of
// the pie + cards so the card never renders a degenerate single-slice
// donut.
// ---------------------------------------------------------------------------

function EmptyState({ trustName }: { trustName?: string }) {
  return (
    <Card
      aria-labelledby="portfolio-pie-chart-title"
      className="relative overflow-hidden border border-border/60 bg-card"
    >
      <CardHeader className="gap-2 p-6">
        <CardTitle
          id="portfolio-pie-chart-title"
          className="font-serif text-2xl font-bold tracking-tight"
        >
          House Asset Allocation
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          The three-ring donut — sleeves, assets, venues — will appear here
          once positions are added. Each asset will get its own info-card
          around the pie.
        </p>
        <Separator className="house-hairline" />
      </CardHeader>
      <CardContent className="p-6 pt-0">
        <div
          className="relative flex w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-xl p-6 text-center"
          style={{ height: "min(82vw, 500px)" }}
        >
          {/* Subtle house-shimmer background sweep. */}
          <div
            aria-hidden
            className="house-shimmer pointer-events-none absolute inset-0 opacity-60"
          />

          {/* Empty-donut shape — a ring with the shimmer sweep. */}
          <div
            aria-hidden
            className="relative size-40 rounded-full sm:size-48"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, transparent 56%, rgba(255,255,255,0.04) 56%, rgba(255,255,255,0.04) 100%)",
              boxShadow:
                "inset 0 0 0 1px rgba(255,255,255,0.08), 0 0 40px rgba(16,185,129,0.05)",
            }}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <Plus className="size-6 text-muted-foreground" aria-hidden />
            </div>
          </div>

          <p className="font-serif text-2xl font-semibold tracking-tight text-foreground">
            No positions yet
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {trustName ? `The trust “${trustName}” has ` : "The trust has "}
            no holdings. Once positions are added — through onboarding or
            live position sync — the three-ring pie chart will render here
            as the main overview: inner sleeves, middle assets, outer
            venues. Each asset in the middle ring will get its own
            info-card around the pie.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
