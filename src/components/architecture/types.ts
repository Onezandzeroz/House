/**
 * Shared types for the architecture overview components. Re-exports the
 * FoundationStatus type from the BFF route so the components and the
 * route can never drift apart.
 *
 * This is a type-only module — `import type` is erased at build time so
 * the client bundle stays free of any server-only imports.
 */

import type { FoundationStatus } from "@/app/api/foundation/route";

export type { FoundationStatus };

export type ModeLadderProps = {
  modes: FoundationStatus["modes"];
};

export type PolicyGateProps = {
  checks: FoundationStatus["policyGate"];
};

export type ServiceMapProps = {
  services: FoundationStatus["services"];
};

export type DataModelTableProps = {
  models: FoundationStatus["dataModel"];
};

export type IntentSchemaCardProps = {
  fields: FoundationStatus["intentShape"];
};

export type NonCustodyCardProps = {
  nonCustody: FoundationStatus["nonCustody"];
};

export type FoundationStatusBannerProps = {
  product: FoundationStatus["product"];
  phase: FoundationStatus["phase"];
};

export type PhaseProgressProps = {
  current: FoundationStatus["phase"]["current"];
};
