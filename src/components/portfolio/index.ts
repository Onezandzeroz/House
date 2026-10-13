/**
 * Barrel export for the portfolio pie-chart component family (Task 13 +
 * 20 + 26 + 29). The pie-chart is the main overview for the `/` route.
 *
 * Task 29 (pie-stands-alone rewrite):
 *   - Pi står alene i en 500–850 px container (ingen side-legend).
 *   - 6 info-kort rundt pi'en (én per middle-ring asset) med thumbnail-
 *     default + hover-expand (framer-motion).
 *   - Tynne SVG lead-lines fra hvert kort til dens middle-ring slice.
 *   - Sentre-label FJERNET (kun et lite "HOUSE" wordmark i donut-hullet).
 *   - KPI-stripe (PortfolioSummaryStrip) flyttet UNDER pi'en.
 *   - PortfolioLegend FJERNET (kortene erstatter legend).
 */

export { PortfolioPieChart } from "./portfolio-pie-chart";
export { PortfolioSummaryStrip } from "./portfolio-summary-strip";
export type { PortfolioSummaryStripProps } from "./portfolio-summary-strip";
export { InfoCard } from "./info-card";
export type { InfoCardProps } from "./info-card";
export { useAnimatedCounter } from "./use-animated-counter";

export type {
  PortfolioPieChartProps,
  PieDatum,
  PieAsset,
  AssetDatum,
  VenueDatum,
  NormalizedPortfolio,
  PortfolioSnapshot,
  PortfolioSnapshotSleeve,
  PortfolioSnapshotAsset,
  PortfolioSnapshotVenue,
  RiskCategory,
  DryPowderStatus,
  TrustMode,
  AiRole,
  MarketRegime,
} from "./types";

export {
  toPieData,
  SLEEVE_COLORS,
  SLEEVE_COLORS_DIM,
  SLEEVE_GRADIENTS,
  SLEEVE_LABELS,
  SLEEVE_ORDER,
  ASSET_COLORS,
  DEFAULT_ASSET_COLOR,
  assetColor,
  assetGradientId,
  lightenColor,
  darkenColor,
  DRY_POWDER_STATUS_META,
  TRUST_MODE_META,
  formatMoneyShort,
  formatMoneyFull,
  bpsToPercent,
  regimeStrategyPostureDefault,
} from "./types";
