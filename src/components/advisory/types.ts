/**
 * Shared types for the Advisory Dashboard components (Task 9).
 *
 * Re-exports the AdvisoryOpinion type from the domain layer so the
 * client components and the BFF route can never drift apart. The
 * re-export is type-only — `import type` is erased at build time so
 * the client bundle stays free of any server-only imports.
 *
 * The AdvisoryOpinion is rådgivning, IKKE en executable intent. The
 * advisory dashboard renders it for the owner to read; it never
 * signs anything. (See src/server/domain/advisory.ts JSDoc.)
 */

import type { AdvisoryOpinion } from "@/server/domain/advisory";

export type { AdvisoryOpinion };

// Per-component prop shapes — every advisory subcomponent takes the
// slice of the opinion it renders. The container (`AdvisoryDashboard`)
// owns the fetch and hands the slice down.

export type RegimeBannerProps = {
  regime: AdvisoryOpinion["regime"];
};

export type BankrollSnapshotProps = {
  nav: AdvisoryOpinion["nav"];
  houseEdgeBps: AdvisoryOpinion["houseEdgeBps"];
  principles: AdvisoryOpinion["principles"];
  killSwitchActive: boolean;
};

export type DryPowderMeterProps = {
  dryPowderBps: AdvisoryOpinion["dryPowderBps"];
  dryPowderStatus: AdvisoryOpinion["dryPowderStatus"];
  principles: AdvisoryOpinion["principles"];
};

export type SleeveAllocationProps = {
  sleeves: AdvisoryOpinion["sleeves"];
};

export type AllocationAdviceTableProps = {
  advice: AdvisoryOpinion["allocationAdvice"];
  bookCurrency: string;
};

export type OpportunitiesListProps = {
  opportunities: AdvisoryOpinion["opportunities"];
};

export type WarningsListProps = {
  warnings: AdvisoryOpinion["warnings"];
};

export type AdvisorySummaryProps = {
  summary: AdvisoryOpinion["summary"];
  asOf: AdvisoryOpinion["asOf"];
};

// Architecture overview props — the secondary tab. Wraps the Task 3
// foundation components in a single container so the page can mount
// either tab without conditional logic.

export type ArchitectureOverviewProps = {
  foundation: import("@/app/api/foundation/route").FoundationStatus;
};

// Helpers used across components — small, pure, no React.

/** Convert basis points to a percent string with two decimals. */
export function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2);
}

/** Convert basis points to a percent number (0..100). */
export function bpsToPercentNum(bps: number): number {
  return bps / 100;
}

/** Format a money string with a currency prefix. */
export function formatMoney(value: string, currency: string): string {
  return `${value} ${currency}`;
}

/** Format an ISO date string as a human-readable timestamp. */
export function formatAsOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // ISO with a Z; show in UTC for determinism (the demo book uses UTC).
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} UTC`;
}
