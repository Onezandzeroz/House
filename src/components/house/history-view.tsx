"use client";

import * as React from "react";
import { Camera, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { NavHistoryChart } from "./nav-history-chart";
import { DecisionLog } from "./decision-log";

/**
 * HistoryView (Task 38) — the fourth tab on the new 5-tab `/` route.
 *
 * Composes:
 *   - `NavHistoryChart` at the top (NAV-historikk area chart).
 *   - `DecisionLog` below (audit-trail table of accepted / rejected
 *      intents, expandable rows, CSV export).
 *   - A "Take snapshot" button in the top-right that POSTs to
 *      `/api/trust/snapshots` and bumps a `refreshKey` state passed
 *      to the chart so it refetches + shows the new point.
 *
 * The view owns the `refreshKey` so a single snapshot trigger
 * refreshes the chart without forcing the table to re-render. The
 * decision log keeps its own fetch.
 *
 * Loading + error + empty states are delegated to the children
 * (NavHistoryChart handles all three; DecisionLog handles all
 * three). This view stays a thin layout wrapper.
 */
export function HistoryView() {
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [taking, setTaking] = React.useState(false);

  const handleTakeSnapshot = React.useCallback(async () => {
    setTaking(true);
    try {
      const res = await fetch("/api/trust/snapshots", {
        method: "POST",
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; message?: string; snapshot?: { nav: string } }
        | null;
      if (!res.ok) {
        const msg =
          data && typeof data === "object" && typeof data.message === "string"
            ? data.message
            : `HTTP ${res.status} ${res.statusText}`;
        toast.error("Could not take snapshot", { description: msg });
        return;
      }
      const nav =
        data && typeof data === "object" && "snapshot" in data
          ? data.snapshot?.nav
          : undefined;
      const navStr = nav ? formatMoney(nav) : "—";
      toast.success("Snapshot taken", {
        description: `NAV recorded at ${navStr}.`,
      });
      // Bump the chart's refreshKey so it refetches.
      setRefreshKey((k) => k + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Could not take snapshot", { description: msg });
    } finally {
      setTaking(false);
    }
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-2xl font-bold tracking-tight text-primary house-num-accent">
            History
          </h1>
          <p className="text-xs text-muted-foreground">
            NAV snapshots over time + the audit trail of every accepted or
            rejected intent.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleTakeSnapshot()}
          disabled={taking}
        >
          {taking ? (
            <RefreshCw className="size-4 animate-spin" aria-hidden />
          ) : (
            <Camera className="size-4" aria-hidden />
          )}
          Take snapshot
        </Button>
      </header>
      <NavHistoryChart refreshKey={refreshKey} />
      <DecisionLog />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(s: string): string {
  const trimmed = String(s ?? "").trim();
  const withoutDollar = trimmed.startsWith("$") ? trimmed.slice(1) : trimmed;
  const n = Number(withoutDollar);
  if (!Number.isFinite(n)) return withoutDollar || "0.00";
  return n
    .toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    .replace(/,/g, " ");
}
