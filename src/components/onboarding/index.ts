/**
 * Barrel exports for the onboarding wizard (Task 14 + Task 47-49).
 *
 * PRIMARY export — `MultiPageWizard` (Task 47-49) is the full-screen
 * state-driven 5-page onboarding experience that replaces the legacy
 * 4-step Sheet modal. Consumed by `src/app/page.tsx` when the user has
 * no trust yet (`trustState.kind === "none"`).
 *
 * LEGACY exports — `OnboardingWizard` (the old 4-step modal) + the
 * step-* components + the old `WizardStep` type are kept for backward
 * compatibility. Existing code that still mounts the modal (e.g.
 * portfolio panel "Add funds" CTA may temporarily fall back) can keep
 * working; new code should prefer `MultiPageWizard`.
 *
 * SHARED exports — `AssetSelect` + `VenueKindSelect` from
 * `step-add-funds.tsx` are re-exported because the Side 4 page-assets
 * component re-uses them (no need to duplicate the universe list or
 * venue-kind metadata).
 */

// PRIMARY (Task 47-49) — full-screen multi-page onboarding.
export { MultiPageWizard } from "./multi-page-wizard";
export type { MultiPageWizardProps } from "./multi-page-wizard";

export { SuccessOverlay } from "./success-overlay";
export type { SuccessOverlayProps } from "./success-overlay";

export { ProgressIndicator } from "./progress-indicator";
export type { ProgressIndicatorProps } from "./progress-indicator";

export { PageTrustDetails } from "./page-trust-details";
export type { PageTrustDetailsProps } from "./page-trust-details";

export { PageTrusteeInfo } from "./page-trustee-info";
export type { PageTrusteeInfoProps } from "./page-trustee-info";

export { PageBeneficiaries } from "./page-beneficiaries";
export type { PageBeneficiariesProps } from "./page-beneficiaries";

export { PageAssets } from "./page-assets";
export type { PageAssetsProps } from "./page-assets";

export { PageReview } from "./page-review";
export type { PageReviewProps } from "./page-review";

// SHARED — `AssetSelect` + `VenueKindSelect` from step-add-funds.
// Re-exported so page-assets (Side 4) can reuse them without
// duplicating the universe list + venue-kind metadata.
export { AssetSelect } from "./step-add-funds";
export type { AssetSelectProps } from "./step-add-funds";
export { VenueKindSelect } from "./step-add-funds";
export type { VenueKindSelectProps } from "./step-add-funds";

// LEGACY — the 4-step modal. Retained for backward compatibility;
// new callers should use `MultiPageWizard`.
export { OnboardingWizard } from "./onboarding-wizard";
export type { OnboardingWizardProps } from "./onboarding-wizard";

export { StepProgress } from "./step-progress";
export type { StepProgressProps } from "./step-progress";

export { StepWelcome } from "./step-welcome";
export type { StepWelcomeProps } from "./step-welcome";

export { StepAddFunds } from "./step-add-funds";
export type { StepAddFundsProps } from "./step-add-funds";

export { StepReview } from "./step-review";
export type { StepReviewProps } from "./step-review";

export { StepConfirm } from "./step-confirm";
export type { StepConfirmProps } from "./step-confirm";

// Shared types + helpers — exported so callers can pre-fill the
// wizard (Task 47-49 pre-fills trusteeName from session.user.name).
export {
  ONBOARDING_UNIVERSE,
  VENUE_KIND_META,
  SLEEVE_META,
  WIZARD_STEPS,
  MULTI_PAGE_STEPS,
  TRUST_TYPE_OPTIONS,
  BOOK_CURRENCY_OPTIONS,
  REPORTING_LEVEL_OPTIONS,
  DEFI_POSITION_TYPE_OPTIONS,
  previewSleeveForAsset,
  previewPortfolio,
  buildPreviewOpinion,
  isValidTrustName,
  isPositionComplete,
  formatNavShort,
  makeRowId,
  makeEmptyBeneficiary,
  makeEmptyPositionV2,
  makeInitialWizardForm,
  isBeneficiaryEmpty,
  isBeneficiaryComplete,
  isBeneficiariesValid,
  filterCompleteBeneficiaries,
  isPositionV2Complete,
  isPositionsValidV2,
  filterCompletePositionsV2,
  positionsV2ToInput,
  beneficiariesToInput,
} from "./types";
export type {
  UniverseAsset,
  VenueKind,
  WizardPosition,
  WizardStep,
  MultiPageStep,
  TrustType,
  BookCurrency,
  DeFiPositionType,
  ReportingLevel,
  Beneficiary,
  WizardPositionV2,
  WizardForm,
  PreviewAssetContribution,
  PreviewSleeveAggregate,
  PortfolioPreview,
} from "./types";
