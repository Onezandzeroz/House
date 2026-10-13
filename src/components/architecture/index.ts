/**
 * Architecture barrel — re-exports every Task 3 foundation component
 * so the new Advisory Dashboard architecture tab (Task 9) can pull
 * them in one import. Also exists so future tabs / pages can compose
 * the foundation cards without repeating the import surface.
 *
 * Components are unchanged from Task 3 except for color-only edits to
 * switch from hardcoded `bg-emerald-500/10` to the new `bg-allow/10
 * text-allow-foreground` token classes landed in Task 8
 * (src/app/globals.css).
 */

export { FoundationStatusBanner } from "./foundation-status";
export { NonCustodyCard } from "./non-custody-card";
export { ModeLadder } from "./mode-ladder";
export { PolicyGate } from "./policy-gate";
export { ServiceMap } from "./service-map";
export { DataModelTable } from "./data-model-table";
export { IntentSchemaCard } from "./intent-schema-card";
export { PhaseProgress } from "./phase-progress";

export type {
  FoundationStatus,
  ModeLadderProps,
  PolicyGateProps,
  ServiceMapProps,
  DataModelTableProps,
  IntentSchemaCardProps,
  NonCustodyCardProps,
  FoundationStatusBannerProps,
  PhaseProgressProps,
} from "./types";
