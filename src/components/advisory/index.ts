/**
 * Advisory barrel — re-exports every advisory dashboard component so
 * the new `/` route (Task 9) can pull them in one import.
 *
 * The advisory dashboard is the PRIMARY tab on the new `/` route. The
 * architecture overview is the SECONDARY tab; it lives in
 * `architecture-overview.tsx` and wraps the Task 3 foundation cards.
 */

export { AdvisoryDashboard } from "./advisory-dashboard";
export { RegimeBanner } from "./regime-banner";
export { BankrollSnapshot } from "./bankroll-snapshot";
export { DryPowderMeter } from "./dry-powder-meter";
export { SleeveAllocation } from "./sleeve-allocation";
export { AllocationAdviceTable } from "./allocation-advice-table";
export { OpportunitiesList } from "./opportunities-list";
export { WarningsList } from "./warnings-list";
export { AdvisorySummary } from "./advisory-summary";
export { ArchitectureOverview } from "./architecture-overview";

export type {
  AdvisoryOpinion,
  RegimeBannerProps,
  BankrollSnapshotProps,
  DryPowderMeterProps,
  SleeveAllocationProps,
  AllocationAdviceTableProps,
  OpportunitiesListProps,
  WarningsListProps,
  AdvisorySummaryProps,
  ArchitectureOverviewProps,
} from "./types";

export {
  bpsToPercent,
  bpsToPercentNum,
  formatMoney,
  formatAsOf,
} from "./types";
