"use client";

import * as React from "react";

import { HouseOverview } from "./house-overview";
import type { HouseOverviewProps } from "./house-overview";
import { PositionsTable } from "./positions-table";
import { LivePriceBadge } from "./live-price-badge";

/**
 * PortfolioView (Task 38) — the primary tab on the new 5-tab `/`
 * route. Composes the existing `HouseOverview` (pie + AI-operator
 * panel + KPI strip) with the new `PositionsTable` below, and a
 * `LivePriceBadge` at the top so the owner can see at a glance
 * whether the NAV is computed from live CoinGecko prices or the
 * reference fallback.
 *
 * The "Add funds" trigger lives inside `HouseOverview` (it owns the
 * `ManagePositionsPanel` drawer + the "Reset trust" dialog). This
 * view does not duplicate the trigger — the table reads the same
 * `/api/portfolio` route, so it reflects add / remove mutations on
 * the next render.
 *
 * Layout: vertical stack; the pie dominates the top, the positions
 * table sits beneath. Mobile (390px): same stack, single column.
 * Desktop (1440px): max-w-6xl; the pie stands alone (per Task 29).
 */
export interface PortfolioViewProps {
  /** The current trust state — forwarded to `HouseOverview`. */
  trust: HouseOverviewProps["trust"];
  /** Forwarded to `HouseOverview` (mode switch handler). */
  onTrustUpdate: HouseOverviewProps["onTrustUpdate"];
  /** Forwarded to `HouseOverview` (reset trust handler). */
  onTrustReset: HouseOverviewProps["onTrustReset"];
}

/**
 * Render the Portfolio tab. The view is a thin wrapper — it does not
 * own any state beyond the layout. The composition is intentional:
 * `HouseOverview` keeps its existing fetch + drawer ownership so the
 * AI-operator panel and the pie chart keep their existing behaviour.
 */
export function PortfolioView({
  trust,
  onTrustUpdate,
  onTrustReset,
}: PortfolioViewProps) {
  // Scroll the pie chart into vertical center when the Portfolio tab
  // becomes active (per eier direction: pie should appear "center
  // screen" because it shows all assets of the trust). Uses a ref +
  // requestAnimationFrame so the layout has settled before scrolling.
  const pieRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = pieRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <LivePriceBadge />
      </div>
      <div ref={pieRef}>
        <HouseOverview
          trust={trust}
          onTrustUpdate={onTrustUpdate}
          onTrustReset={onTrustReset}
        />
      </div>
      <PositionsTable />
    </div>
  );
}
