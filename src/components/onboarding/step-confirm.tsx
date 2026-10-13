"use client";

import * as React from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Loader2,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

/**
 * StepConfirm — Step 4 of the onboarding wizard.
 *
 * Three visual states, all in the same step slot:
 *
 *   1. **saving**    — spinner + "Creating trust…" muted. The POST
 *                       `/api/trust` is in flight.
 *   2. **success**   — a large gold check + the trust name in serif +
 *                       "Observe / Advisor" badges + an "Enter House"
 *                       button that calls `onEnterHouse`.
 *   3. **error**    — an Alert (destructive variant) + the error message
 *                       + a "Back" button so the trustee can fix the
 *                       inputs and try again.
 *
 * Visual language:
 *   - The success state is centred: large gold check, serif trust name,
 *     two badges (mode + AI role) so the trustee sees their starting
 *     posture immediately. The "Enter House" button is the gold primary
 *     CTA — it closes the wizard and triggers `onEnterHouse`, which the
 *     parent (Task 15) listens to so the page can refresh.
 *   - The error state uses the same Alert pattern as the rest of the
 *     dashboard so the trustee sees a familiar shape.
 */
export interface StepConfirmProps {
  /** The trust name (used in the success state + as a fallback label). */
  trustName: string;
  /** Current submit state — driven by the parent wizard. */
  state: "idle" | "saving" | "success" | "error";
  /** Error message — shown in the Alert when state==="error". */
  errorMessage?: string;
  /** The created trust's id (passed through from the POST response). */
  trustId?: string | null;
  /** Called when the trustee clicks "Enter House" in the success state. */
  onEnterHouse: () => void;
  /** Called when the trustee clicks "Back" in the error state. */
  onBack: () => void;
}

/**
 * Render Step 4 — loading / success / error. The parent wizard owns the
 * submit lifecycle; this component is purely presentational.
 */
export function StepConfirm({
  trustName,
  state,
  errorMessage,
  trustId,
  onEnterHouse,
  onBack,
}: StepConfirmProps) {
  return (
    <section
      aria-labelledby="step-confirm-title"
      className="flex flex-col gap-6"
    >
      <header className="flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          Onboarding · step 04
        </span>
        <h2
          id="step-confirm-title"
          className="font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
        >
          {state === "success" ? (
            <>
              Trust <span className="text-primary">created</span>
            </>
          ) : state === "error" ? (
            <>
              Could not <span className="text-reject-foreground">create</span>{" "}
              the trust
            </>
          ) : (
            <>
              Confirm and <span className="text-primary">create</span>
            </>
          )}
        </h2>
      </header>

      {/* SAVING — centred spinner + muted text. */}
      {state === "saving" && (
        <div className="flex flex-col items-center justify-center gap-4 py-16">
          <Loader2
            className="size-10 animate-spin text-primary"
            aria-hidden
          />
          <p className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Creating trust…
          </p>
          <p className="text-sm text-muted-foreground">
            Writing the trust, the book, and your starting positions to the
            ledger. This usually takes a second.
          </p>
        </div>
      )}

      {/* SUCCESS — large gold check + trust name + badges + CTA. */}
      {state === "success" && (
        <div className="flex flex-col items-center justify-center gap-5 py-12 text-center">
          <div
            aria-hidden
            className="relative flex size-20 items-center justify-center"
          >
            {/* Soft radial gold glow around the check. */}
            <div
              aria-hidden
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  "radial-gradient(circle at 50% 50%, rgba(201,162,39,0.18), transparent 70%)",
              }}
            />
            <div className="relative flex size-16 items-center justify-center rounded-full border border-primary/40 bg-primary/10">
              <Check className="size-8 text-primary" aria-hidden />
            </div>
          </div>

          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Trust created
            </span>
            <p className="font-serif text-3xl font-bold tracking-tight text-primary">
              {trustName || "Your trust"}
            </p>
            {trustId && (
              <p className="font-mono text-[10px] text-muted-foreground">
                id: {trustId}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <Badge
              variant="outline"
              className="bg-allow/15 text-allow-foreground border-allow/40"
            >
              <ShieldCheck className="size-3" aria-hidden />
              Mode: Observe
            </Badge>
            <Badge
              variant="outline"
              className="bg-primary/15 text-primary border-primary/40"
            >
              AI role: Advisor
            </Badge>
          </div>

          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            The trust is in <strong className="text-foreground">Observe</strong>{" "}
            mode — read-only, no execution path. The AI acts as advisor. Add
            or remove positions later; switch modes when you are ready.
          </p>

          <Button
            type="button"
            size="lg"
            onClick={onEnterHouse}
            className="mt-2"
          >
            Enter House
          </Button>
        </div>
      )}

      {/* ERROR — destructive Alert + Back button. */}
      {state === "error" && (
        <div className="flex flex-col gap-4">
          <Alert variant="destructive">
            <AlertCircle className="size-4" aria-hidden />
            <AlertTitle>Trust creation failed</AlertTitle>
            <AlertDescription>
              <p>
                The trust could not be created. The BFF route returned an
                error — fix the inputs below and try again.
              </p>
              {errorMessage && (
                <p className="mt-2 font-mono text-xs">{errorMessage}</p>
              )}
            </AlertDescription>
          </Alert>
          <div className="flex justify-start">
            <Button type="button" variant="outline" onClick={onBack}>
              <ArrowLeft className="size-4" aria-hidden />
              Back to review
            </Button>
          </div>
        </div>
      )}

      {/* IDLE — pre-submit. The wizard shows this only briefly between
          the trustee clicking Next on Step 3 and the submit firing. */}
      {state === "idle" && (
        <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
          <Check className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Ready to create
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            Click <strong className="text-primary">Create trust</strong> in
            the footer to write the trust and its starting positions to the
            ledger.
          </p>
        </div>
      )}
    </section>
  );
}
