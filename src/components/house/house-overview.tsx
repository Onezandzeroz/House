"use client";

import * as React from "react";
import { AlertCircle, Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

import { PortfolioPieChart } from "@/components/portfolio";

import { ManagePositionsPanel } from "./manage-positions-panel";
import { ResetTrustDialog } from "./reset-trust-dialog";
import type { TrustSummary } from "./types";

/**
 * HouseOverview — the PRIMARY view on the `/` route (Task 15).
 *
 * The owner's words (Task 11):
 *   "It should be visible via the main page pie chart (this must hold as
 *    much of relevant information as possible so it must be large, to
 *    function as the main overview."
 *
 * This is that main overview. It composes:
 *   1. A compact hero card with the trust name + mode chip + AI-role
 *      chip (the at-a-glance state).
 *   2. The `AiOperatorPanel` — the switch that makes the owner's words
 *      "able to operate if called upon to do so" concrete and safe
 *      (policy engine still gates per plan §3).
 *   3. The `PortfolioPieChart` — the dominant visual. ≥360px on
 *      mobile, 480–520px on desktop. The pie is the main anchor; the
 *      operator panel + hero sit above it so the pie can breathe.
 *   4. The "Add funds" button (Task 18) — opens the `ManagePositionsPanel`
 *      drawer so the owner can add/remove real positions via
 *      POST/DELETE /api/trust/positions. The button sits next to a
 *      small "Reset trust" ghost icon button (destruktiv when hovered)
 *      that opens `ResetTrustDialog` (sletter demo-trusten + re-onboard).
 *
 * The portfolio fetch happens here so the pie + summary strip load as
 * one unit. The fetch re-runs when:
 *   - the trust's `id` / `mode` / `killSwitchActive` changes (mode switch),
 *   - `portfolioNonce` increments (after a position mutation in the panel).
 *
 * Layout:
 *   - All sections stacked vertically; each card spans the full
 *     `max-w-6xl` content width so the pie can dominate.
 *   - Mobile (390px): the same vertical stack, pie 360px tall.
 *   - The hero wraps its chips on mobile.
 *
 * Sticky footer is preserved at the page level (`min-h-screen flex
 * flex-col` + `mt-auto` on the footer).
 */
export interface HouseOverviewProps {
  /** The current trust state. */
  trust: TrustSummary;
  /**
   * Called after a successful mode switch (delegated from the operator
   * panel). The page replaces its trust state with `next`, which causes
   * this overview to re-render with the new mode + aiRole + countdown.
   */
  onTrustUpdate: (next: TrustSummary) => void;
  /**
   * Called after a successful trust reset (DELETE /api/trust). The page
   * flips trust-state to `{ kind: "none" }` so onboarding-wizard auto-
   * opens (page.tsx's useEffect listens on trustState.kind === "none").
   */
  onTrustReset: () => void;
}

/** Portfolio fetch state. Mirrors the advisory dashboard pattern. */
type PortfolioState =
  | { kind: "loading" }
  | { kind: "ok"; data: PortfolioSnapshot }
  | { kind: "error"; message: string };

/**
 * Render the primary overview. Owns the portfolio fetch + the drawer/dialog
 * state for manage-positions + reset-trust.
 */
export function HouseOverview({
  trust,
  onTrustUpdate,
  onTrustReset,
}: HouseOverviewProps) {
  const [portfolio, setPortfolio] = React.useState<PortfolioState>({
    kind: "loading",
  });
  const [manageOpen, setManageOpen] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);
  // Portfolio refetch trigger — bumped after each position mutation in
  // the panel so the pie + summary strip re-fetch /api/portfolio.
  const [portfolioNonce, setPortfolioNonce] = React.useState(0);

  // Re-fetch the portfolio snapshot when the trust's identity / mode
  // changes OR when portfolioNonce bumps (post-mutation refetch).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/portfolio", { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | PortfolioSnapshot
          | null;
        if (!res.ok) {
          if (data && typeof data === "object" && "error" in data) {
            if (data.error === "no-trust") {
              if (!cancelled) {
                setPortfolio({
                  kind: "error",
                  message: "The trust no longer exists.",
                });
              }
              return;
            }
          }
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        // Validate that the response is a PortfolioSnapshot (not an
        // error object) by checking for the `sleeves` field.
        if (
          !data ||
          typeof data !== "object" ||
          !("sleeves" in data) ||
          !("nav" in data)
        ) {
          throw new Error("Malformed portfolio response.");
        }
        if (!cancelled) {
          setPortfolio({ kind: "ok", data: data as PortfolioSnapshot });
        }
      } catch (err) {
        if (!cancelled) {
          setPortfolio({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trust.id, trust.mode, trust.killSwitchActive, portfolioNonce]);

  // Refresh the portfolio after a position mutation in the panel.
  const handlePositionsChanged = React.useCallback(() => {
    setPortfolioNonce((n) => n + 1);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {/* ---- Portfolio pie + add-funds trigger -------------------------
          (TrustHeaderStrip + AiOperatorPanel moved to the Trustee tab
           per eier direction Task 51 — pie chart is now the FIRST thing
           the trustee sees when landing on the Portfolio tab.) */}
      <section
        aria-labelledby="portfolio-overview-title"
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex flex-col gap-1">
            <h2
              id="portfolio-overview-title"
              className="font-serif text-xl font-bold tracking-tight text-foreground"
            >
              House Asset Allocation
            </h2>
            <p className="text-xs text-muted-foreground">
              Four sleeves — Stable to Aggressive. Hover a slice for the
              per-asset breakdown.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                toast.info("Reset trust opens a confirmation dialog.", {
                  description:
                    "Deletes the demo trust + all positions. You'll re-onboard fresh.",
                });
                setResetOpen(true);
              }}
              className="text-muted-foreground hover:text-reject-foreground"
            >
              <ShieldAlert className="size-4" aria-hidden />
              Reset trust
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setManageOpen(true)}
            >
              <Plus className="size-4" aria-hidden />
              Add funds
            </Button>
          </div>
        </div>

        {portfolio.kind === "loading" && <PortfolioPieSkeleton />}

        {portfolio.kind === "error" && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" aria-hidden />
            <AlertTitle>Could not load the portfolio</AlertTitle>
            <AlertDescription>
              <p>
                The BFF route <code>/api/portfolio</code> returned an
                error.
              </p>
              <p className="mt-1 font-mono text-xs">{portfolio.message}</p>
            </AlertDescription>
          </Alert>
        )}

        {portfolio.kind === "ok" && (
          <PortfolioPieChart snapshot={portfolio.data} />
        )}
      </section>

      {/* ---- Manage-positions drawer + Reset-trust dialog ------------- */}
      <ManagePositionsPanel
        open={manageOpen}
        onOpenChange={setManageOpen}
        trust={trust}
        onOpenReset={() => setResetOpen(true)}
        onPositionsChanged={handlePositionsChanged}
      />
      <ResetTrustDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        onReset={() => {
          setManageOpen(false);
          onTrustReset();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PortfolioPieSkeleton — matches the pie chart card's shape so the
// loading-to-loaded transition is not a visual jump.
// ---------------------------------------------------------------------------

function PortfolioPieSkeleton() {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="flex flex-col gap-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="h-4 w-3/4" />
        <Separator className="house-hairline" />
        {/* Pie stands alone (Task 29) — no 2-column grid, just the
         * big standalone pie + the cards around it (placeholder
         * squares approximate the layout). */}
        <Skeleton className="house-pie-container w-full rounded-xl" />
        <Separator className="house-hairline my-2" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
