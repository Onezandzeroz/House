"use client";

import * as React from "react";
import { useSession, signOut } from "next-auth/react";
import {
  AlertCircle,
  GitBranch,
  History,
  Lock,
  LogOut,
  PieChart,
  Scale,
  ShieldCheck,
} from "lucide-react";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { AdvisoryDashboard } from "@/components/advisory";
import { MultiPageWizard } from "@/components/onboarding";
import { AuthModal } from "@/components/auth/auth-modal";
import {
  LivePriceBadge,
  PortfolioView,
  TrusteeView,
  MandateEditor,
  HistoryView,
} from "@/components/house";
import type { TrustSummary } from "@/components/house";

import type { FoundationStatus } from "@/app/api/foundation/route";

// ---------------------------------------------------------------------------
// House — Family Reserve · Page integration (Task 15 + Task 38 + Task 47-49)
//
// The `/` route. The owner sees one of three layouts depending on
// whether a trust has been created yet:
//
//   1. Loading         — skeletons while /api/trust resolves.
//   2. No trust        — Task 47-49: `<MultiPageWizard />` is mounted as the
//                         ENTIRE page (full-screen state-driven 5-page
//                         onboarding experience, NOT a modal). The wizard
//                         owns its own state and submits to /api/trust on
//                         Side 5; the SuccessOverlay auto-dismisses after
//                         3 seconds and lands on the Portfolio tab.
//   3. Trust exists    — a Tabs container with FOUR tabs:
//                         - Portfolio  (PRIMARY)   — PortfolioView
//                                                    (pie + operator +
//                                                    KPI strip +
//                                                    PositionsTable).
//                         - Advisory   (secondary) — AdvisoryDashboard
//                                                    with a LivePriceBadge.
//                         - Mandate    (new)       — MandateEditor
//                                                    (risk budget + universe
//                                                    + ethics + history).
//                         - History    (new)       — HistoryView (NAV chart
//                                                    + DecisionLog).
//
// The page owns the trust state. The PortfolioView's HouseOverview
// calls /api/trust/mode and propagates the updated trust back up so
// the pie chart, header strip, and operator panel all re-render with
// the new mode + aiRole + houseExpiry.
//
// Sticky footer pattern: the root div is `min-h-screen flex flex-col`
// and the footer carries `mt-auto`, so the footer pins to the bottom
// on short content and gets pushed down naturally when content
// overflows (no floating, no overlap). Mobile safe-area is respected
// via the standard footer padding.
//
// TASK 47-49: when `trustState.kind === "none"`, we render
// `<MultiPageWizard onComplete={...} />` INSTEAD of the dashboard
// header/footer. The wizard is a full-screen experience — it owns
// the whole viewport, the dashboard header/footer (House wordmark +
// Sign out + footer) are NOT rendered. Once the wizard completes
// (success overlay's onComplete fires), `refetchTrust()` re-fetches
// /api/trust and the dashboard mounts in place of the wizard.
// ---------------------------------------------------------------------------

type TrustState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "ok"; trust: TrustSummary }
  | { kind: "error"; message: string };

type FoundationState =
  | { kind: "loading" }
  | { kind: "ok"; data: FoundationStatus }
  | { kind: "error"; message: string };

export default function HomePage() {
  // ---- Auth gate (Task 42-45). -----------------------------------------
  // House is multi-tenant — every visitor must authenticate before they
  // see a trust. `useSession()` is sourced from the JWT cookie set by
  // NextAuth; the SessionProvider in layout.tsx is what makes this hook
  // available client-side.
  //
  // The auth gate is the ONLY logic in this outer component — all trust
  // /foundation/wizard hooks live in <Dashboard /> below so React's
  // rules-of-hooks (hooks must run in the same order every render) hold
  // for both the modal branch and the dashboard branch.
  const { data: session, status } = useSession();

  // Loading session → small centered spinner so the modal doesn't flash
  // and the dashboard doesn't mount with no userId.
  if (status === "loading") return <SessionLoadingScreen />;

  // Unauthenticated → mount the AuthModal as the entire page (not as
  // a layer on top of the dashboard). The modal handles both sign-in
  // and create-account flows and reloads on success.
  if (!session) return <AuthModal />;

  // Authenticated → render the dashboard. `session.user.email` powers
  // the user-badge / sign-out button in the header.
  return <Dashboard email={session.user.email ?? undefined} />;
}

/**
 * Dashboard — the authenticated branch of `HomePage`. Owns the trust
 * state, foundation state, onboarding-wizard open state, and the 4-tab
 * container. All hooks run unconditionally here because the parent
 * already short-circuited unauthenticated requests to <AuthModal />.
 */
function Dashboard({ email }: { email?: string }) {
  const [trustState, setTrustState] = React.useState<TrustState>({
    kind: "loading",
  });
  const [foundation, setFoundation] = React.useState<FoundationState>({
    kind: "loading",
  });

  // ---- Trust fetch (own callback so we can re-run it after the
  // wizard completes a new trust). --------------------------------------
  const refetchTrust = React.useCallback(async () => {
    try {
      const res = await fetch("/api/trust", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as { trust: TrustSummary | null };
      if (data.trust === null) {
        setTrustState({ kind: "none" });
      } else {
        setTrustState({ kind: "ok", trust: data.trust });
      }
    } catch (err) {
      setTrustState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  React.useEffect(() => {
    void refetchTrust();
  }, [refetchTrust]);

  // ---- Foundation fetch (architecture tab + footer reference). -----
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/foundation", { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        const data = (await res.json()) as FoundationStatus;
        if (!cancelled) setFoundation({ kind: "ok", data });
      } catch (err) {
        if (!cancelled) {
          setFoundation({
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

  // ---- Wizard's onComplete → refetch the trust. The SuccessOverlay
  //      auto-dismisses after 3 seconds and fires onComplete(trust);
  //      we refetch /api/trust so the trust state moves to
  //      `{ kind: "ok", trust }` and the dashboard mounts in place
  //      of the wizard.
  const handleWizardComplete = React.useCallback(
    (_trust: { id: string; name: string }) => {
      void refetchTrust();
    },
    [refetchTrust],
  );

  // ---- TASK 47-49 — full-screen MultiPageWizard when no trust. -----
  // We render this BEFORE the dashboard layout (header / footer) so
  // the wizard owns the entire viewport. Once the SuccessOverlay's
  // onComplete fires, `handleWizardComplete` calls `refetchTrust()`
  // and the trust state moves to `{ kind: "ok", trust }` — this
  // component re-renders and falls through to the dashboard layout.
  if (trustState.kind === "none") {
    return <MultiPageWizard onComplete={handleWizardComplete} />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="sticky top-0 z-20 house-glow border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-baseline gap-3">
            <span className="font-serif text-2xl font-bold tracking-tight text-primary">
              House
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Family Reserve
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FoundationBadge foundation={foundation} />
            <UserBadge email={email} />
          </div>
        </div>
        <div className="house-hairline" aria-hidden />
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {trustState.kind === "loading" && <PageLoadingSkeleton />}

        {trustState.kind === "error" && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" aria-hidden />
            <AlertTitle>Could not load the trust</AlertTitle>
            <AlertDescription>
              <p>
                The BFF route <code>/api/trust</code> returned an error.
              </p>
              <p className="mt-1 font-mono text-xs">{trustState.message}</p>
              <p className="mt-2 text-xs">
                The trust endpoint is required for the Portfolio tab. The
                advisory + architecture routes are independent — try the
                other tabs or refresh.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {trustState.kind === "ok" && (
          <Tabs
            defaultValue="portfolio"
            className="flex flex-col gap-6"
          >
            <TabsList
              aria-label="House views"
              className="self-start sm:self-auto"
            >
              <TabsTrigger value="portfolio" className="gap-1.5">
                <PieChart className="size-3.5" aria-hidden />
                Portfolio
              </TabsTrigger>
              <TabsTrigger value="trustee" className="gap-1.5">
                <ShieldCheck className="size-3.5" aria-hidden />
                Trustee
              </TabsTrigger>
              <TabsTrigger value="advisory" className="gap-1.5">
                <GitBranch className="size-3.5" aria-hidden />
                Advisory
              </TabsTrigger>
              <TabsTrigger value="mandate" className="gap-1.5">
                <Scale className="size-3.5" aria-hidden />
                Mandate
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-1.5">
                <History className="size-3.5" aria-hidden />
                History
              </TabsTrigger>
            </TabsList>

            {/* PRIMARY — Portfolio: pie chart (FIRST thing the trustee
                sees after onboarding) + KPI strip + PositionsTable.
                AI controls moved to the Trustee tab per eier direction. */}
            <TabsContent value="portfolio" className="mt-0">
              <PortfolioView
                trust={trustState.trust}
                onTrustUpdate={(next) =>
                  setTrustState({ kind: "ok", trust: next })
                }
                onTrustReset={() => setTrustState({ kind: "none" })}
              />
            </TabsContent>

            {/* SECONDARY — Trustee: AI operator panel + safety protocol.
                This is the "control room" — mode switch, AI role,
                kill switch, policy gate reference. */}
            <TabsContent value="trustee" className="mt-0">
              <TrusteeView
                trust={trustState.trust}
                onTrustUpdate={(next) =>
                  setTrustState({ kind: "ok", trust: next })
                }
              />
            </TabsContent>

            {/* SECONDARY — Advisory dashboard (Task 9). Live-price
                badge sits in the top-right above AdvisoryDashboard so
                the owner sees whether the NAV is live CoinGecko or
                the reference fallback. */}
            <TabsContent value="advisory" className="mt-0">
              <div className="mb-4 flex justify-end">
                <LivePriceBadge />
              </div>
              <AdvisoryDashboard />
            </TabsContent>

            {/* NEW (Task 38) — Mandate editor: risk budget + universe +
                ethics + version history. */}
            <TabsContent value="mandate" className="mt-0">
              <MandateEditor />
            </TabsContent>

            {/* NEW (Task 38) — History: NAV chart + DecisionLog audit
                trail. */}
            <TabsContent value="history" className="mt-0">
              <HistoryView />
            </TabsContent>

          </Tabs>
        )}
      </main>

      <footer className="mt-auto border-t border-border/60 bg-muted/30">
        <div className="house-hairline" aria-hidden />
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 sm:px-6 sm:py-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-base font-bold text-primary">
                House
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Foundation build · Non-custody · Trade keys not yet connected
              </span>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Private family-fond build. The advisory opinion is
            rådgivning — not an executable intent. No trade key is
            connected. The next step (plan §13) is to stand up Observe
            against one exchange and one wallet; paper decision log
            review for a week comes first.
          </p>
        </div>
      </footer>

    </div>
  );
}

// ---------------------------------------------------------------------------
// PageLoadingSkeleton — shown while /api/trust resolves. Mirrors the
// shape of the Overview tab (hero + operator panel + pie) so the
// loading-to-loaded transition is not a visual jump.
// ---------------------------------------------------------------------------

function PageLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-44 w-full rounded-xl" />
      <Skeleton className="h-[480px] w-full rounded-xl" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// FoundationBadge — the small chip in the header showing the build
// phase. Kept here (not in components/) because it is page-specific.
// ---------------------------------------------------------------------------

function FoundationBadge({ foundation }: { foundation: FoundationState }) {
  if (foundation.kind === "loading") {
    return <Skeleton className="h-5 w-24 rounded-full" />;
  }
  if (foundation.kind === "error") {
    // Don't surface foundation errors in the header — the architecture
    // tab handles them. The header chip just stays muted.
    return null;
  }
  return (
    <Badge
      variant="outline"
      className="bg-primary/10 text-primary border-primary/40"
    >
      <Lock className="size-3" aria-hidden />
      Foundation
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// UserBadge — the signed-in trustee's email + a sign-out button (Task 42-45).
// The badge is the only surface in the app where the owner can sign out —
// there is no separate /account route. Clicking the button clears the JWT
// cookie via `signOut()` from next-auth/react and reloads so the AuthModal
// remounts.
// ---------------------------------------------------------------------------

function UserBadge({ email }: { email?: string }) {
  return (
    <div className="flex items-center gap-2">
      {email && (
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground sm:inline">
          {email}
        </span>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs"
        onClick={() => signOut({ callbackUrl: "/" })}
      >
        <LogOut className="size-3" aria-hidden />
        Sign out
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionLoadingScreen — shown while `useSession()` reports "loading".
// A minimal centered spinner so the AuthModal does not flash and the
// dashboard does not mount with no userId (which would 401 the BFF calls).
// ---------------------------------------------------------------------------

function SessionLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <span className="font-serif text-3xl font-bold tracking-tight text-primary house-num-accent">
          House
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          Family Reserve · loading session
        </span>
      </div>
    </div>
  );
}
