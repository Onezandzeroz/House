"use client";

import * as React from "react";
import { AlertCircle } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import type {
  PortfolioSnapshot,
  PortfolioSnapshotAsset,
  PortfolioSnapshotSleeve,
  PortfolioSnapshotVenue,
} from "@/components/portfolio/types";
import { SLEEVE_META } from "@/components/onboarding/types";
import { categorizeAsset, type RiskCategory } from "@/server/domain/bankroll";
import { LivePriceBadge } from "./live-price-badge";
import { PositionCardGrid, type PositionCardData } from "./position-card";

/**
 * PositionsCardView — fetches /api/portfolio (same as PositionsTable)
 * but renders each position as a rich PositionCard in a responsive grid
 * instead of a flat table. Each card shows the asset, sleeve, quantity,
 * entry price, current price (+ source), market value, P&L, weight, and
 * venue — all at a glance.
 */

type State =
  | { kind: "loading" }
  | { kind: "ok"; data: PortfolioSnapshot }
  | { kind: "error"; message: string };

/** Flatten the 3-level sleeves → assets → venues into card rows. */
function flattenToCards(snapshot: PortfolioSnapshot): PositionCardData[] {
  const source = snapshot.priceSource === "live" ? "live" : "fallback";
  const out: PositionCardData[] = [];
  for (const sleeve of snapshot.sleeves as PortfolioSnapshotSleeve[]) {
    for (const asset of sleeve.assets as PortfolioSnapshotAsset[]) {
      const isStable = categorizeAsset(asset.assetId) === "stable";
      const assetEntry = isStable ? null : (asset.entryPrice ?? null);
      for (const venue of asset.venues as PortfolioSnapshotVenue[]) {
        out.push({
          assetId: asset.assetId,
          sleeve: sleeve.category,
          venue: venue.venue,
          venueKind: venue.venueKind,
          quantity: venue.quantity,
          price: asset.price,
          value: venue.value,
          weightBps: venue.weightBps,
          source,
          priceSource: asset.priceSource,
          priceConfidence: asset.priceConfidence,
          priceIsFallback: asset.priceIsFallback,
          entryPrice: assetEntry,
        });
      }
    }
  }
  // Sort by value descending (largest position first)
  return out.sort((a, b) => Number(b.value) - Number(a.value));
}

export function PositionsCardView() {
  const [state, setState] = React.useState<State>({ kind: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/portfolio", { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | PortfolioSnapshot
          | null;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (
          !data ||
          typeof data !== "object" ||
          !("sleeves" in data) ||
          !("nav" in data)
        ) {
          throw new Error("Malformed portfolio response.");
        }
        if (!cancelled) {
          setState({ kind: "ok", data: data as PortfolioSnapshot });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = React.useMemo(() => {
    if (state.kind !== "ok") return [];
    return flattenToCards(state.data);
  }, [state]);

  if (state.kind === "loading") {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-48 rounded-xl" />
        ))}
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <Alert variant="destructive">
        <AlertCircle className="size-4" aria-hidden />
        <AlertTitle>Could not load positions</AlertTitle>
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }

  return <PositionCardGrid rows={rows} />;
}
