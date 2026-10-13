/**
 * Barrel export for the House page-integration components (Task 15).
 *
 * The page (`/`) consumes these to render the trust-state-aware layout:
 *   - `HouseOverview`       — primary Overview tab (pie + operator panel).
 *   - `AiOperatorPanel`     — the AI "call upon to operate" switch.
 *   - `TrustHeaderStrip`    — the in-page status line (mode + AI role).
 *
 * `TrustSummary` is the client-side trust state shape (mirrors
 * `GET /api/trust`'s `trust` field, with dates as ISO strings). The
 * page owns the state and passes it down.
 *
 * The opinion / snapshot is rådgivning, IKKE en executable intent. The
 * operator switch changes the trust's mode; the policy engine still
 * gates every intent (plan §3). See `src/server/domain/advisory.ts`
 * for the JSDoc on the advisory-only posture.
 */

export { HouseOverview } from "./house-overview";
export type { HouseOverviewProps } from "./house-overview";

export { AiOperatorPanel, AiOperatorPanelSkeleton } from "./ai-operator-panel";
export type { AiOperatorPanelProps } from "./ai-operator-panel";

export { TrustHeaderStrip } from "./trust-header-strip";
export type { TrustHeaderStripProps } from "./trust-header-strip";

export { ManagePositionsPanel } from "./manage-positions-panel";
export type { ManagePositionsPanelProps } from "./manage-positions-panel";

export { ResetTrustDialog } from "./reset-trust-dialog";
export type { ResetTrustDialogProps } from "./reset-trust-dialog";

// Task 38 — new UI views for the expanded 5-tab dashboard.
export { PortfolioView } from "./portfolio-view";
export type { PortfolioViewProps } from "./portfolio-view";

export { PositionsTable } from "./positions-table";

export { MandateEditor } from "./mandate-editor";

export { DecisionLog } from "./decision-log";

export { NavHistoryChart } from "./nav-history-chart";
export type { NavHistoryChartProps } from "./nav-history-chart";

export { HistoryView } from "./history-view";

export { LivePriceBadge } from "./live-price-badge";

export { TrusteeView } from "./trustee-view";
export type { TrusteeViewProps } from "./trustee-view";

export type { TrustSummary, TrustMode, TrustAiRole } from "./types";
export { TRUST_MODE_META, TONE_CHIP_CLASS, DEFAULT_HOUSE_DAYS } from "./types";
