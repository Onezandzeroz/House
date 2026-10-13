"use client";

import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

import type { AdvisoryOpinion } from "@/server/domain/advisory";

import { RegimeBanner } from "./regime-banner";
import { BankrollSnapshot } from "./bankroll-snapshot";
import { DryPowderMeter } from "./dry-powder-meter";
import { SleeveAllocation } from "./sleeve-allocation";
import { AllocationAdviceTable } from "./allocation-advice-table";
import { OpportunitiesList } from "./opportunities-list";
import { WarningsList } from "./warnings-list";
import { AdvisorySummary } from "./advisory-summary";

/**
 * AdvisoryDashboard — the container that fetches `/api/advisory` and
 * renders the eight subcomponents in the order the owner reads them.
 *
 * Fetch is plain `useEffect + fetch` with cleanup — SWR / React Query
 * are overkill for one route. The dashboard is the PRIMARY tab on the
 * new `/` route (Task 9). The Architecture tab lives alongside it.
 *
 * Render order (Task 9 spec):
 *   1. RegimeBanner         — regime + posture
 *   2. BankrollSnapshot     — NAV + house edge + mode
 *   3. DryPowderMeter       — visual dry-powder-discipline meter
 *   4. SleeveAllocation     — four sleeves, current vs target
 *   5. AllocationAdviceTable — per-asset advice
 *   6. OpportunitiesList    — within-principles (conditional)
 *   7. WarningsList         — outside-principles (conditional)
 *   8. AdvisorySummary      — one-sentence bottom line + as-of
 *
 * Loading state: shadcn Skeleton placeholders shaped to match the
 * loaded layout so there is no visual jump.
 *
 * Error state: shadcn Alert with AlertCircle, error message in mono,
 * and the "this is the only route" note.
 *
 * The opinion is rådgivning, IKKE en executable intent. The dashboard
 * is read-only — no sign path exists. (See
 * src/server/domain/advisory.ts JSDoc.)
 */

// The demo book's book currency. Hardcoded because the advisory API
// does not surface it directly today; once /api/advisory returns the
// book currency in the top-level shape, this becomes a property of
// the opinion.
const BOOK_CURRENCY = "USDC";

// Foundation kill-switch state. v0 hardcodes to false (the demo book's
// bookState.killSwitchActive is false). When /api/foundation surfaces
// a kill-switch flag, this is read from there.
const FOUNDATION_KILL_SWITCH = false;

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; data: AdvisoryOpinion }
  | { kind: "error"; message: string };

export function AdvisoryDashboard() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/advisory", { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        const data = (await res.json()) as AdvisoryOpinion;
        if (!cancelled) {
          setState({ kind: "ok", data });
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

  if (state.kind === "loading") {
    return <AdvisoryDashboardSkeleton />;
  }

  if (state.kind === "error") {
    return (
      <Alert variant="destructive">
        <AlertCircle className="size-4" aria-hidden />
        <AlertTitle>Could not load the advisory opinion</AlertTitle>
        <AlertDescription>
          <p>
            The BFF route <code>/api/advisory</code> returned an error.
          </p>
          <p className="mt-1 font-mono text-xs">{state.message}</p>
          <p className="mt-2 text-xs">
            This is the only user-visible route. If the advisory engine is
            broken, the dashboard is broken — fix it before any later phase
            is staffed.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  const opinion = state.data;
  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <RegimeBanner regime={opinion.regime} />

      <BankrollSnapshot
        nav={opinion.nav}
        houseEdgeBps={opinion.houseEdgeBps}
        principles={opinion.principles}
        killSwitchActive={FOUNDATION_KILL_SWITCH}
      />

      <DryPowderMeter
        dryPowderBps={opinion.dryPowderBps}
        dryPowderStatus={opinion.dryPowderStatus}
        principles={opinion.principles}
      />

      <SleeveAllocation sleeves={opinion.sleeves} />

      <AllocationAdviceTable
        advice={opinion.allocationAdvice}
        bookCurrency={BOOK_CURRENCY}
      />

      {/* Conditional — only render when the advisor has something to
          say. No "no opportunities" message; that would be noise. */}
      <OpportunitiesList opportunities={opinion.opportunities} />

      {/* Conditional — same rule. */}
      <WarningsList warnings={opinion.warnings} />

      <AdvisorySummary summary={opinion.summary} asOf={opinion.asOf} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeletons — match the loaded layout shape per shape so the
// transition from loading to loaded is not a visual jump.
// ---------------------------------------------------------------------------

function AdvisoryDashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6 sm:gap-8" aria-busy="true">
      {/* RegimeBanner skeleton. */}
      <div className="relative overflow-hidden rounded-xl border border-border/60 bg-card p-6">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-4 h-16 w-3/4 sm:h-20" />
        <Skeleton className="mt-2 h-4 w-full max-w-xl" />
        <Separator className="house-hairline my-4" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>

      {/* BankrollSnapshot — three cards. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-border/60 bg-card p-5"
          >
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-10 w-3/4" />
            <Skeleton className="mt-1 h-3 w-full" />
          </div>
        ))}
      </div>

      {/* DryPowderMeter skeleton. */}
      <div className="rounded-xl border border-border/60 bg-card p-6">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-4 h-12 w-1/2" />
        <Skeleton className="mt-2 h-3 w-3/4" />
        <Skeleton className="mt-6 h-3 w-full" />
        <Skeleton className="mt-2 h-2 w-full" />
      </div>

      {/* SleeveAllocation — four cards. */}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-2/3" />
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-border/60 bg-card p-5"
            >
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="mt-3 h-8 w-1/2" />
              <Skeleton className="mt-2 h-2 w-full" />
              <Skeleton className="mt-3 h-3 w-1/2" />
            </div>
          ))}
        </div>
      </div>

      {/* AllocationAdviceTable skeleton. */}
      <div className="rounded-xl border border-border/60 bg-card p-6">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-4 h-7 w-1/3" />
        <Skeleton className="mt-2 h-3 w-2/3" />
        <Separator className="house-hairline my-4" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>

      {/* AdvisorySummary skeleton. */}
      <div className="rounded-xl border border-border/60 bg-muted/20 p-5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-2 h-5 w-full max-w-2xl" />
      </div>
    </div>
  );
}
