"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * LivePriceBadge (Task 38) — a small badge that signals whether the
 * portfolio's NAV is computed from live CoinGecko prices or from the
 * static reference-price fallback.
 *
 * Fetches `/api/portfolio` once on mount; reads the `priceSource`
 * field (added by Task 36). Two render modes:
 *
 *   - "live"     → pulsing emerald dot + "Live" text. A short tooltip
 *                  explains "Prices refreshed from CoinGecko."
 *   - "fallback" → muted dot + "Fallback prices" text. Tooltip warns
 *                  "CoinGecko unreachable — using reference prices."
 *
 * Used by:
 *   - the Portfolio tab header (next to the trust-name strip).
 *   - the Advisory tab header (above AdvisoryDashboard).
 *
 * The fetch is plain `useEffect + fetch`. No SWR / React Query — the
 * same pattern as `AdvisoryDashboard` and `HouseOverview`. The badge
 * is purely informational — no sign path, no mutation.
 *
 * Loading: a tiny Skeleton pill so the badge does not pop in.
 * Error:   the badge stays in "fallback" mode (safe default — better
 *          to under-claim than to flash "Live" when prices might be
 *          stale).
 */
export function LivePriceBadge() {
  const [state, setState] = React.useState<
    | { kind: "loading" }
    | { kind: "ok"; source: "live" | "fallback" }
    | { kind: "error" }
  >({ kind: "loading" });

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
          | { priceSource?: "live" | "fallback" }
          | null;
        if (!cancelled) {
          // Safe default: if the field is absent, treat as fallback so
          // the badge never over-claims "live" when data is missing.
          setState({
            kind: "ok",
            source: data?.priceSource === "live" ? "live" : "fallback",
          });
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
    return <Skeleton className="h-6 w-20 rounded-full" />;
  }

  if (state.kind === "error" || state.source === "fallback") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Price source: fallback (reference prices)"
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
          >
            <Badge
              variant="outline"
              className="gap-1.5 border-warn/40 bg-warn/15 text-warn-foreground text-[10px] uppercase tracking-widest"
            >
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-warn-foreground"
              />
              Fallback prices
            </Badge>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className="bg-popover text-popover-foreground border border-border max-w-xs"
        >
          <p className="flex items-start gap-1.5 text-xs leading-snug">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>
              CoinGecko unreachable — NAV is computed from reference prices.
              Live prices will resume when the market cache recovers.
            </span>
          </p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Price source: live CoinGecko prices"
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
        >
          <Badge
            variant="outline"
            className="gap-1.5 border-allow/40 bg-allow/15 text-allow-foreground text-[10px] uppercase tracking-widest house-pulse-emerald"
          >
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-allow-foreground"
            />
            Live
          </Badge>
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="bg-popover text-popover-foreground border border-border max-w-xs"
      >
        <p className="text-xs leading-snug">
          Prices refreshed from CoinGecko. NAV reflects the live market.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
