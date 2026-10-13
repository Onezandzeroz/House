"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import {
  AnimatePresence,
  motion,
} from "framer-motion";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

import { OnboardingInputSchema } from "@/server/domain/trust";

import { ProgressIndicator } from "./progress-indicator";
import { PageTrustDetails } from "./page-trust-details";
import { PageTrusteeInfo } from "./page-trustee-info";
import { PageBeneficiaries } from "./page-beneficiaries";
import { PageAssets } from "./page-assets";
import { PageReview } from "./page-review";
import { SuccessOverlay } from "./success-overlay";
import {
  beneficiariesToInput,
  filterCompleteBeneficiaries,
  filterCompletePositionsV2,
  isBeneficiariesValid,
  isPositionsValidV2,
  isValidTrustName,
  makeInitialWizardForm,
  positionsV2ToInput,
  type MultiPageStep,
  type WizardForm,
} from "./types";

/**
 * MultiPageWizard — the full-screen state-driven 5-page onboarding
 * experience (Task 47-49). Replaces the legacy 4-step Sheet modal
 * `OnboardingWizard`.
 *
 * Pages:
 *   1. Trust details    — name, type, book currency, description.
 *   2. Trustee info     — name (pre-filled from session), email (ro), phone, address.
 *   3. Beneficiaries    — dynamic list with name + email + relationship + reportingLevel.
 *   4. Assets & positions — table with asset + quantity + venueKind + venue +
 *      DeFi metadata (protocol, positionType, APY, lockEnd, contractAddress).
 *   5. Review & confirm — pie preview + 4 summary sections + confirmation checkbox.
 *
 * State (all `useState` — no global store):
 *   - `currentPage`     : 1..5 — the active page.
 *   - `form`            : WizardForm — all collected data across all 5 pages.
 *   - `furthestReached` : the max page the user has reached (gates forward jumps).
 *   - `submitState`     : "idle" | "saving" | "success" | "error".
 *   - `errorMessage`    : surfaced on Side 5 error state.
 *   - `successTrustName`: surfaced on the success overlay.
 *
 * Validation gates (forward-nav):
 *   - 1 → 2 : `isValidTrustName(form.name)`.
 *   - 2 → 3 : `form.trusteeName.trim().length >= 1`.
 *   - 3 → 4 : `isBeneficiariesValid(form.beneficiaries)`.
 *   - 4 → 5 : `isPositionsValidV2(form.positions)`.
 *   - 5 → submit : `form.confirmed === true`.
 *
 * Submit (Side 5 footer "Create trust"):
 *   - Build the OnboardingInput from form (filter complete rows, convert
 *     apyPercent → apyBps, DeFi fields only when venueKind === "stake-defi").
 *   - `OnboardingInputSchema.parse(input)` — surface zod errors via the
 *     Side 5 error alert.
 *   - `fetch('/api/trust', { method: 'POST', body: JSON.stringify(input) })`.
 *   - On 201: setSubmitState("success") + successTrustName; the
 *     SuccessOverlay mounts; after 3 seconds it auto-dismisses and
 *     `onComplete({ id, name })` fires.
 *   - On error: setSubmitState("error") + errorMessage; the Side 5
 *     error alert shows; the user can edit and retry.
 *
 * Visual language:
 *   - Full-screen: `min-h-screen` root wrapper. No header/footer from
 *     the dashboard — the wizard owns the whole viewport.
 *   - Header: House wordmark (serif gold) + "Family Reserve" + the
 *     5-step ProgressIndicator.
 *   - Body: centered glassmorphism card (house-glass-strong) max-w-2xl
 *     p-8 with framer-motion page transitions (fade + slide).
 *   - Footer: "Back" (ghost, left) + "Next" / "Create trust" (gold
 *     primary, right). Disabled state shows an inline hint.
 *
 * The wizard mounts when the parent (page.tsx) sees
 * `trustState.kind === "none"`. The parent owns the trust fetch so
 * when the success overlay's onComplete fires, the parent can refetch
 * and the dashboard mounts in place of the wizard.
 */
export interface MultiPageWizardProps {
  /**
   * Called once after the success-overlay auto-dismisses (or once when
   * the user dismisses manually if we add that path later). The parent
   * uses this to refresh trust state and mount the dashboard.
   */
  onComplete?: (trust: { id: string; name: string }) => void;
}

/** The wizard's submit-state machine. */
type SubmitState = "idle" | "saving" | "success" | "error";

/**
 * Render the multi-page onboarding wizard. The parent (page.tsx) mounts
 * this when the user has no trust yet; this component owns the wizard
 * state and submits to /api/trust on Side 5.
 */
export function MultiPageWizard({
  onComplete,
}: MultiPageWizardProps) {
  const { data: session } = useSession();
  const email = session?.user?.email ?? "—";
  const sessionName = session?.user?.name ?? "";

  // ---- State ----------------------------------------------------------
  const [currentPage, setCurrentPage] = React.useState<MultiPageStep>(1);
  const [form, setForm] = React.useState<WizardForm>(makeInitialWizardForm);
  const [furthestReached, setFurthestReached] =
    React.useState<MultiPageStep>(1);
  const [submitState, setSubmitState] = React.useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = React.useState<string | undefined>(
    undefined,
  );
  const [successTrustName, setSuccessTrustName] = React.useState<
    string | null
  >(null);

  // Pre-fill trusteeName from session.user.name on mount. If the user
  // registered via AuthModal, they typed a trustName there; AuthModal
  // stores it as the User.name. We surface it as the default
  // trusteeName so they don't have to re-type their own name.
  React.useEffect(() => {
    if (sessionName && sessionName.trim().length > 0) {
      setForm((prev) =>
        prev.trusteeName.trim().length === 0
          ? { ...prev, trusteeName: sessionName }
          : prev,
      );
    }
  }, [sessionName]);

  // ---- Validation gates ---------------------------------------------
  const page1Valid = isValidTrustName(form.name);
  const page2Valid = form.trusteeName.trim().length >= 1;
  const page3Valid = isBeneficiariesValid(form.beneficiaries);
  const page4Valid = isPositionsValidV2(form.positions);
  const page5Valid = form.confirmed;

  const canAdvance: Record<MultiPageStep, boolean> = {
    1: page1Valid,
    2: page2Valid,
    3: page3Valid,
    4: page4Valid,
    5: page5Valid,
  };

  // ---- Navigation ---------------------------------------------------
  const next = () => {
    if (!canAdvance[currentPage]) return;
    const nextStep = Math.min(5, currentPage + 1) as MultiPageStep;
    setCurrentPage(nextStep);
    if (nextStep > furthestReached) setFurthestReached(nextStep);
  };

  const back = () => {
    if (currentPage === 1) return;
    setCurrentPage(Math.max(1, currentPage - 1) as MultiPageStep);
  };

  const jump = (target: MultiPageStep) => {
    if (target > furthestReached) return;
    setCurrentPage(target);
  };

  // ---- Form mutation helper -----------------------------------------
  const updateForm = React.useCallback(
    (patch: Partial<WizardForm>) => {
      setForm((prev) => ({ ...prev, ...patch }));
    },
    [],
  );

  // Ref to the last-created trust so the SuccessOverlay's onComplete
  // can fire `onComplete(trust)` without re-rendering on every submit
  // attempt. Declared before `submit` so the closure captures the
  // initialized ref, not a TDZ reference.
  const lastCreatedTrustRef = React.useRef<{
    id: string;
    name: string;
  } | null>(null);

  // ---- Submit -------------------------------------------------------
  const submit = async () => {
    setSubmitState("saving");
    setErrorMessage(undefined);

    // Build the input. Use only complete rows so partial trailing rows
    // are silently skipped. apyPercent is converted to apyBps; DeFi
    // metadata is included only for venueKind === "stake-defi".
    const completePositions = filterCompletePositionsV2(form.positions);
    const completeBeneficiaries = filterCompleteBeneficiaries(
      form.beneficiaries,
    );

    const input = {
      name: form.name.trim(),
      trustType: form.trustType,
      bookCurrency: form.bookCurrency,
      description: form.description.trim() || undefined,
      trusteeName: form.trusteeName.trim(),
      trusteePhone: form.trusteePhone.trim() || undefined,
      trusteeAddress: form.trusteeAddress.trim() || undefined,
      beneficiaries: beneficiariesToInput(completeBeneficiaries),
      positions: positionsV2ToInput(completePositions),
    };

    // Defensive re-validation with zod before the network call.
    let parsed: ReturnType<typeof OnboardingInputSchema.parse>;
    try {
      parsed = OnboardingInputSchema.parse(input);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Validation failed — check the rows and try again.";
      setErrorMessage(message);
      setSubmitState("error");
      return;
    }

    try {
      const res = await fetch("/api/trust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
        cache: "no-store",
      });
      const data: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const message =
          typeof data === "object" &&
          data !== null &&
          "message" in data &&
          typeof (data as { message: unknown }).message === "string"
            ? (data as { message: string }).message
            : `HTTP ${res.status} ${res.statusText}`;
        setErrorMessage(message);
        setSubmitState("error");
        return;
      }

      // Shape from /api/trust: { trust: { id, name, mode, aiRole, ... } }
      const trust = (data as { trust?: { id: string; name: string } })
        .trust;
      if (!trust || !trust.id) {
        setErrorMessage("Trust created but the response was malformed.");
        setSubmitState("error");
        return;
      }
      setSuccessTrustName(trust.name);
      setSubmitState("success");
      // Stash the trust so the overlay's onComplete callback can read it.
      lastCreatedTrustRef.current = trust;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Network error — try again.";
      setErrorMessage(message);
      setSubmitState("error");
    }
  };

  const handleOverlayComplete = React.useCallback(() => {
    const trust = lastCreatedTrustRef.current;
    if (trust) {
      onComplete?.(trust);
    } else {
      // Defensive fallback — fire without the trust id if the ref was
      // somehow cleared. The parent will refetch /api/trust anyway.
      onComplete?.({ id: "", name: form.name });
    }
  }, [onComplete, form.name]);

  // ---- Render ------------------------------------------------------
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Page-level background radial glow — emerald + gold accents
          (scoped to the wizard so the dashboard's body glow doesn't
          leak through under the overlay). */}
      <div className="house-bg-glow" aria-hidden />

      {/* Header — House wordmark + Family Reserve + 5-step progress. */}
      <header className="border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <span className="font-serif text-2xl font-bold tracking-tight text-primary house-num-accent">
                House
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Family Reserve
              </span>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Page {currentPage} of 5
            </span>
          </div>
          <ProgressIndicator
            current={currentPage}
            onJump={jump}
            furthestReached={furthestReached}
          />
        </div>
        <div className="house-hairline" aria-hidden />
      </header>

      {/* Body — centered glassmorphism card max-w-5xl. Wide enough
          for the 5-column asset grid (Asset + Quantity + Venue Kind +
          Venue + Remove) per eier direction Task 56. */}
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8">
        <div className="house-glass-strong rounded-2xl p-6 sm:p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentPage}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              {currentPage === 1 && (
                <PageTrustDetails
                  form={form}
                  onFormChange={updateForm}
                />
              )}
              {currentPage === 2 && (
                <PageTrusteeInfo
                  form={form}
                  onFormChange={updateForm}
                  email={email}
                />
              )}
              {currentPage === 3 && (
                <PageBeneficiaries
                  form={form}
                  onFormChange={updateForm}
                />
              )}
              {currentPage === 4 && (
                <PageAssets
                  form={form}
                  onFormChange={updateForm}
                />
              )}
              {currentPage === 5 && (
                <PageReview
                  form={form}
                  email={email}
                  onConfirmedChange={(v) =>
                    updateForm({ confirmed: v })
                  }
                  onBackToAssets={() => setCurrentPage(4)}
                />
              )}
            </motion.div>
          </AnimatePresence>

          {/* Saving state — centered spinner. */}
          {submitState === "saving" && (
            <div
              className="mt-6 flex flex-col items-center gap-3 rounded-lg border border-border/60 bg-muted/40 p-6 text-center"
              role="status"
              aria-live="polite"
            >
              <div
                className="size-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary"
                aria-hidden
              />
              <p className="font-serif text-sm font-semibold tracking-tight text-foreground">
                Creating trust…
              </p>
              <p className="text-xs text-muted-foreground">
                Writing the trust, beneficiaries, and positions to the ledger.
              </p>
            </div>
          )}

          {/* Error state — destructive alert above the footer actions. */}
          {submitState === "error" && errorMessage && (
            <Alert variant="destructive" className="mt-6">
              <AlertCircle className="size-4" aria-hidden />
              <AlertTitle>Trust creation failed</AlertTitle>
              <AlertDescription>
                <p>{errorMessage}</p>
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Inline reason when Next is disabled. */}
        {currentPage < 5 && !canAdvance[currentPage] && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            {currentPage === 1 && !page1Valid && "Enter a trust name to continue."}
            {currentPage === 2 && !page2Valid && "Enter your full name to continue."}
            {currentPage === 3 && !page3Valid && "Complete or remove incomplete beneficiary rows."}
            {currentPage === 4 && !page4Valid && "Add at least one complete asset row."}
          </p>
        )}
      </main>

      {/* Footer — Back (ghost, left) + Next / Create trust (gold, right). */}
      <footer className="sticky bottom-0 border-t border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={back}
            disabled={currentPage === 1 || submitState === "saving"}
            className={currentPage === 1 ? "invisible" : ""}
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back
          </Button>

          <div className="flex items-center gap-3">
            {currentPage < 5 ? (
              <Button
                type="button"
                size="sm"
                onClick={next}
                disabled={!canAdvance[currentPage]}
              >
                Next
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={submit}
                disabled={
                  !page5Valid ||
                  submitState === "saving" ||
                  submitState === "success"
                }
              >
                {submitState === "saving" ? "Creating…" : "Create trust"}
              </Button>
            )}
          </div>
        </div>
      </footer>

      {/* Success overlay — mounts when submitState === "success". */}
      {submitState === "success" && successTrustName && (
        <SuccessOverlay
          trustName={successTrustName}
          onComplete={handleOverlayComplete}
        />
      )}
    </div>
  );
}
