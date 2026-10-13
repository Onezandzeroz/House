"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import { OnboardingInputSchema } from "@/server/domain/trust";

import { StepProgress } from "./step-progress";
import { StepWelcome } from "./step-welcome";
import { StepAddFunds } from "./step-add-funds";
import { StepReview } from "./step-review";
import { StepConfirm } from "./step-confirm";
import {
  isPositionComplete,
  isValidTrustName,
  type WizardPosition,
  type WizardStep,
} from "./types";

/**
 * OnboardingWizard — the four-step modal that turns a new user into the
 * trustee of a new trust (fond) tenant.
 *
 * Owner direction (Task 14):
 *   "I want this app to onboard any new user as being the trustee of a new
 *    trust (fond) tenant. and the AI inside the trust will have the role as
 *    advisor but also able to operate if called upon to do so. The onboarding
 *    flow should take the new trustee through adding the information about
 *    which funds and how many (amount) funds is in the starting asset
 *    portfolio."
 *
 * The wizard is a shadcn `Dialog` rendered as an overlay on `/`-route. Per
 * the system-requirement, the user can only see `/`; the wizard is a modal
 * there, not a separate route.
 *
 * State (all `useState` — no global store):
 *   - `open`           : controlled by the parent (Task 15 will render
 *                         `<OnboardingWizard open={…} onOpenChange={…} />`).
 *   - `step`           : 1..4 — the current chapter.
 *   - `name`           : trust-name text.
 *   - `positions`      : the editable rows.
 *   - `confirmed`      : Step 3 confirmation checkbox.
 *   - `submitState`    : "idle" | "saving" | "success" | "error".
 *   - `errorMessage`   : surfaced by Step 4 on error.
 *   - `createdTrustId` : surfaced by Step 4 on success.
 *
 * Validation gates (forward-nav):
 *   - Step 1 → 2  : `isValidTrustName(name)`.
 *   - Step 2 → 3  : at least one complete row.
 *   - Step 3 → 4  : `confirmed === true`.
 *
 * Submit:
 *   - Build `{ name, positions }` from the wizard state.
 *   - `OnboardingInputSchema.parse(input)` — if it throws, surface the
 *      message via Step 4's error state and abort.
 *   - `fetch('/api/trust', { method: 'POST', body: JSON.stringify(input) })`.
 *   - On 201: success state — the trustee sees the trust id + the gold
 *      "Enter House" CTA. `onComplete(trustId, trustName)` is fired.
 *   - On anything else: error state with the response message.
 *
 * Visual language:
 *   - Modal: `max-w-4xl` so Step 3's pie preview and Step 2's grid both
 *      have room. Mobile collapses the grid; the modal is full-width with
 *      1rem side margins (shadcn default).
 *   - Header: serif title + muted description, separated from the body by
 *      a `house-hairline`.
 *   - Footer: Back (ghost) on the left, Next (gold primary) on the right.
 *      Step 4 hides the footer in the success state (the CTA is in the body).
 */
export interface OnboardingWizardProps {
  /** Controlled open state. */
  open: boolean;
  /** Called when the trustee requests the modal to close. */
  onOpenChange: (open: boolean) => void;
  /**
   * Called once when the trust is created successfully. Task 15 listens
   * to this to refresh the page state (hide the wizard, show the trust).
   */
  onComplete?: (trust: { id: string; name: string }) => void;
}

/** The wizard's submit-state machine. */
type SubmitState = "idle" | "saving" | "success" | "error";

/**
 * Render the onboarding wizard modal. The parent owns the `open` state so
 * Task 15 can mount the wizard on `/` and trigger it from a button.
 */
export function OnboardingWizard({
  open,
  onOpenChange,
  onComplete,
}: OnboardingWizardProps) {
  const [step, setStep] = React.useState<WizardStep>(1);
  const [name, setName] = React.useState("");
  const [positions, setPositions] = React.useState<WizardPosition[]>([
    {
      id: makeRowId(),
      assetId: "",
      quantity: "",
      venueKind: "cex",
      venue: "",
      isCustomAsset: false,
    },
  ]);
  const [confirmed, setConfirmed] = React.useState(false);
  const [submitState, setSubmitState] = React.useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = React.useState<string | undefined>(
    undefined,
  );
  const [createdTrustId, setCreatedTrustId] = React.useState<string | null>(
    null,
  );
  const [furthestReached, setFurthestReached] =
    React.useState<WizardStep>(1);

  // Reset internal state when the wizard is (re-)opened. Lets a returning
  // trustee re-run the flow without stale rows from a previous attempt.
  React.useEffect(() => {
    if (open) {
      setStep(1);
      setName("");
      setPositions([
        {
          id: makeRowId(),
          assetId: "",
          quantity: "",
          venueKind: "cex",
          venue: "",
          isCustomAsset: false,
        },
      ]);
      setConfirmed(false);
      setSubmitState("idle");
      setErrorMessage(undefined);
      setCreatedTrustId(null);
      setFurthestReached(1);
    }
  }, [open]);

  // ---- Validation gates --------------------------------------------------
  const step1Valid = isValidTrustName(name);
  const completePositions = positions.filter(isPositionComplete);
  const step2Valid = completePositions.length >= 1;
  const step3Valid = confirmed;

  const canAdvance: Record<WizardStep, boolean> = {
    1: step1Valid,
    2: step2Valid,
    3: step3Valid,
    4: true,
  };

  // ---- Navigation -------------------------------------------------------
  const next = () => {
    if (!canAdvance[step]) return;
    const nextStep = Math.min(4, step + 1) as WizardStep;
    setStep(nextStep);
    if (nextStep > furthestReached) setFurthestReached(nextStep);
  };

  const back = () => {
    if (step === 1) return;
    setStep(Math.max(1, step - 1) as WizardStep);
  };

  const jump = (target: WizardStep) => {
    if (target > furthestReached) return;
    setStep(target);
  };

  // ---- Submit -----------------------------------------------------------
  const submit = async () => {
    setSubmitState("saving");
    setErrorMessage(undefined);

    // Build the input. Use only complete positions; the parent gates Next
    // on `step2Valid`, but we re-validate with zod to be defensive.
    const input = {
      name: name.trim(),
      positions: completePositions.map((p) => ({
        assetId: p.assetId.trim(),
        quantity: p.quantity.trim(),
        venue: p.venue.trim(),
        venueKind: p.venueKind,
      })),
    };

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
      setCreatedTrustId(trust.id);
      setSubmitState("success");
      onComplete?.({ id: trust.id, name: trust.name });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Network error — try again.";
      setErrorMessage(message);
      setSubmitState("error");
    }
  };

  // The footer is hidden in the success state — the CTA is in the body.
  const showFooter = submitState !== "success";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl gap-0 p-0 sm:max-w-4xl"
        showCloseButton={submitState !== "saving"}
      >
        {/* Modal header — serif title + muted description + hairline. */}
        <DialogHeader className="gap-2 p-6 pb-0">
          <DialogTitle className="font-serif text-2xl font-bold tracking-tight">
            Onboard a new <span className="text-primary">trust</span>
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            You are the trustee. The trust starts in Observe mode with the AI
            as advisor. Four short steps.
          </DialogDescription>
          <div className="pt-4">
            <StepProgress
              current={step}
              onJump={jump}
              furthestReached={furthestReached}
            />
          </div>
        </DialogHeader>

        <Separator className="house-hairline" />

        {/* Modal body — scrollable so Step 3 pie + summary fit on mobile. */}
        <div className="max-h-[70vh] overflow-y-auto px-6 py-6">
          {step === 1 && (
            <StepWelcome name={name} onNameChange={setName} />
          )}
          {step === 2 && (
            <StepAddFunds
              positions={positions}
              onPositionsChange={setPositions}
            />
          )}
          {step === 3 && (
            <StepReview
              positions={positions}
              confirmed={confirmed}
              onConfirmedChange={setConfirmed}
              onAddStablecoins={() => setStep(2)}
            />
          )}
          {step === 4 && (
            <StepConfirm
              trustName={name}
              state={submitState}
              errorMessage={errorMessage}
              trustId={createdTrustId}
              onEnterHouse={() => onOpenChange(false)}
              onBack={() => setStep(3)}
            />
          )}
        </div>

        {showFooter && (
          <footer className="flex items-center justify-between gap-2 border-t border-border/60 p-4">
            {/* Back button — hidden on step 1; in error-state on step 4
                 the in-body Back button is the one the user clicks. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={back}
              disabled={step === 1 || submitState === "saving"}
              className={step === 1 ? "invisible" : ""}
            >
              <ArrowLeft className="size-4" aria-hidden />
              Back
            </Button>

            <div className="flex items-center gap-3">
              {/* Inline reason when Next is disabled — keeps the trustee
                  oriented without a tooltip-only flow. */}
              {step === 1 && !step1Valid && (
                <StepHint>Enter a trust name to continue.</StepHint>
              )}
              {step === 2 && !step2Valid && (
                <StepHint>Add at least one complete row.</StepHint>
              )}
              {step === 3 && !step3Valid && (
                <StepHint>Confirm your holdings to continue.</StepHint>
              )}

              {step < 4 ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={next}
                  disabled={!canAdvance[step]}
                >
                  Next
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
              ) : submitState === "error" ? (
                // In the error state the in-body "Back to review" button is
                // the primary CTA — hide the footer Create button so the
                // trustee doesn't accidentally retry with bad inputs.
                <span className="text-xs text-muted-foreground">
                  Fix the inputs and try again.
                </span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={submit}
                  disabled={
                    submitState === "saving" || submitState === "success"
                  }
                >
                  Create trust
                </Button>
              )}
            </div>
          </footer>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// StepHint — a small muted inline hint shown next to a disabled Next button
// so the trustee knows what's missing without reading tooltips.
// ---------------------------------------------------------------------------

function StepHint({ children }: { children: React.ReactNode }) {
  return (
    <span className="hidden text-xs text-muted-foreground sm:inline">
      {children}
    </span>
  );
}

/** Stable id for the initial position row. (Re-exported for the wizard only.) */
function makeRowId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
