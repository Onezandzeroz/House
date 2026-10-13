"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, AlertCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * LivePriceBadge (Task 38 + market-data upgrade) — a badge that signals
 * the data quality of the portfolio's price sources.
 *
 * Fetches `/api/portfolio` once on mount and reads three fields:
 *   - `priceSource`         : "live" | "fallback" (root-level binary)
 *   - `priceSummary`         : { fallbackCount, divergenceWarningCount,
 *                               sourcesUsed, totalAssets }
 *   - (per-asset detail is available via `priceDetails` but the badge
 *      only needs the aggregate summary.)
 *
 * Four render modes:
 *
 *   1. "live" (all primary)   → pulsing emerald dot + "Live" + source
 *      count. Tooltip lists which sources are active (FTSO, CCXT,
 *      CoinGecko).
 *
 *   2. "partial-fallback"     → amber dot + "Partial fallback" + count.
 *      Tooltip warns that N asset(s) are using hardcoded reference
 *      prices because all live sources failed for them. This is the
 *      key uncertainty indicator — the trustee knows NAV for those
 *      assets is stale/estimated.
 *
 *   3. "divergence-warning"   → amber AlertCircle + "Price divergence".
 *      Tooltip warns that N asset(s) have >2% divergence between
 *      sources — the trustee should investigate before acting on NAV.
 *
 *   4. "fallback" (all down)  → muted dot + "Fallback prices". Tooltip
 *      warns that ALL live sources are down and the entire NAV is
 *      computed from hardcoded reference prices.
 *
 * Used by:
 *   - the Portfolio tab header (next to the trust-name strip).
 *   - the Advisory tab header.
 *   - the PositionsTable header.
 *
 * The fetch is plain `useEffect + fetch`. Loading: a Skeleton pill.
 * Error: the badge stays in "fallback" mode (safe default — better to
 * under-claim than to flash "Live" when prices might be stale).
 */

/** Shape of the price summary from /api/portfolio. */
interface PriceSummary {
  sourcesUsed: string[];
  fallbackCount: number;
  divergenceWarningCount: number;
  totalAssets: number;
}

/** Shape of the portfolio response fields the badge reads. */
interface PortfolioPriceInfo {
  priceSource?: "live" | "fallback";
  priceSummary?: PriceSummary;
}

type BadgeState =
  | { kind: "loading" }
  | { kind: "live"; sources: string[] }
  | { kind: "partial-fallback"; fallbackCount: number; sources: string[] }
  | { kind: "divergence-warning"; count: number; sources: string[] }
  | { kind: "fallback" }
  | { kind: "error" };

/** Human-readable labels for each source tier. */
const SOURCE_LABELS: Record<string, string> = {
  ftso: "Flare FTSO (on-chain)",
  ccxt: "Exchange (CCXT)",
  coingecko: "CoinGecko",
  "reference-fallback": "Reference (live down)",
  "reference-prices-v0": "Reference price",
  "reference-prices-v0-fallback": "Reference $1.00",
};

export function LivePriceBadge() {
  const [state, setState] = React.useState<BadgeState>({ kind: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/portfolio", { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setState({ kind: "error" });
          return;
        }
        const data = (await res.json().catch(() => null)) as
          | PortfolioPriceInfo
          | null;
        if (!cancelled) {
          setState(classify(data));
        }
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") {
    return <Skeleton className="h-6 w-24 rounded-full" />;
  }

  // Fallback (all sources down) OR error — same safe-default render.
  if (state.kind === "error" || state.kind === "fallback") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Price source: all sources down — using reference prices"
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
          >
            <Badge
              variant="outline"
              className="gap-1.5 border-reject/40 bg-reject/10 text-reject-foreground text-[10px] uppercase tracking-widest"
            >
              <AlertTriangle className="size-3" aria-hidden />
              Fallback prices
            </Badge>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className="bg-popover text-popover-foreground border border-border max-w-xs"
        >
          <p className="flex items-start gap-1.5 text-xs leading-snug">
            <AlertTriangle className="mt-0.5 size-3 shrink-0 text-reject-foreground" aria-hidden />
            <span>
              <strong>All live price sources are down.</strong> NAV is
              computed from hardcoded reference prices (Oct 2026 values).
              Prices may be significantly stale — verify before acting.
            </span>
          </p>
        </TooltipContent>
      </Tooltip>
    );
  }

  // Partial fallback — some assets on reference, others live.
  if (state.kind === "partial-fallback") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Price source: partial fallback — ${state.fallbackCount} asset(s) on reference prices`}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
          >
            <Badge
              variant="outline"
              className="gap-1.5 border-warn/40 bg-warn/15 text-warn-foreground text-[10px] uppercase tracking-widest"
            >
              <AlertCircle className="size-3" aria-hidden />
              Partial fallback
              <span className="house-num">·{state.fallbackCount}</span>
            </Badge>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className="bg-popover text-popover-foreground border border-border max-w-xs"
        >
          <p className="flex items-start gap-1.5 text-xs leading-snug">
            <AlertCircle className="mt-0.5 size-3 shrink-0 text-warn-foreground" aria-hidden />
            <span>
              <strong>{state.fallbackCount} asset(s) using reference prices.</strong>{" "}
              All live sources failed for those assets — NAV for them is
              computed from hardcoded Oct 2026 values. Other assets are
              live. Sources active: {state.sources.map(s => SOURCE_LABELS[s] ?? s).join(", ")}.
            </span>
          </p>
        </TooltipContent>
      </Tooltip>
    );
  }

  // Divergence warning — sources disagree by >2% on some assets.
  if (state.kind === "divergence-warning") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Price divergence warning — ${state.count} asset(s) with >2% source disagreement`}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
          >
            <Badge
              variant="outline"
              className="gap-1.5 border-warn/40 bg-warn/15 text-warn-foreground text-[10px] uppercase tracking-widest"
            >
              <AlertCircle className="size-3" aria-hidden />
              Price divergence
            </Badge>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className="bg-popover text-popover-foreground border border-border max-w-xs"
        >
          <p className="flex items-start gap-1.5 text-xs leading-snug">
            <AlertCircle className="mt-0.5 size-3 shrink-0 text-warn-foreground" aria-hidden />
            <span>
              <strong>{state.count} asset(s) with &gt;2% price divergence</strong>{" "}
              between FTSO, CCXT, and CoinGecko. The primary source was
              used for NAV, but the disagreement suggests market
              dislocation or a feed issue. Investigate before acting.
            </span>
          </p>
        </TooltipContent>
      </Tooltip>
    );
  }

  // All live — green pulse.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Price source: live — ${state.sources.length} source(s) active`}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
        >
          <Badge
            variant="outline"
            className="gap-1.5 border-allow/40 bg-allow/15 text-allow-foreground text-[10px] uppercase tracking-widest house-pulse-emerald"
          >
            <CheckCircle2 className="size-3" aria-hidden />
            Live
            <span className="house-num">·{state.sources.length}</span>
          </Badge>
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="bg-popover text-popover-foreground border border-border max-w-xs"
      >
        <p className="text-xs leading-snug">
          <strong>All prices live.</strong> Sources active:{" "}
          {state.sources.map(s => SOURCE_LABELS[s] ?? s).join(", ")}.
          NAV reflects the live market.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Classify the portfolio response into a badge state.
 *
 * Priority: fallback (all down) > partial-fallback (some down) >
 * divergence-warning (sources disagree) > live (all good).
 */
function classify(data: PortfolioPriceInfo | null): BadgeState {
  // No data → safe default (fallback).
  if (!data || !data.priceSource) {
    return { kind: "fallback" };
  }

  const summary = data.priceSummary;
  const sources = summary?.sourcesUsed ?? [];
  const fallbackCount = summary?.fallbackCount ?? 0;
  const divergenceCount = summary?.divergenceWarningCount ?? 0;
  const total = summary?.totalAssets ?? 0;

  // All sources down.
  if (data.priceSource === "fallback") {
    return { kind: "fallback" };
  }

  // Some assets on reference prices.
  if (fallbackCount > 0) {
    return { kind: "partial-fallback", fallbackCount, sources };
  }

  // Divergence between sources.
  if (divergenceCount > 0) {
    return { kind: "divergence-warning", count: divergenceCount, sources };
  }

  // All live, no issues.
  return { kind: "live", sources };
}
