"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  WIZARD_STEPS,
  type WizardStep,
} from "./types";

/**
 * StepProgress — the horizontal progress indicator pinned to the top of
 * the onboarding modal.
 *
 * Renders the four wizard steps as serif-numbered markers (01, 02, 03,
 * 04) with the current step highlighted in champagne-gold and an
 * underline that matches the gold tone. Completed steps carry a small
 * gold check to mark "this is done — you can go back".
 *
 * Visual language:
 *   - The numbers are 01 / 02 / 03 / 04 (zero-padded) in Cormorant serif
 *     so the marker reads as an exclusive chapter index, not a generic
 *     "Step 1".
 *   - Each marker is a button so the trustee can jump back to a
 *     completed step (forward jumps are disabled until the current step
 *     validates).
 *   - The gold underline on the current step matches the rest of the
 *     dashboard (a 1px gold rule).
 *
 * Responsive: on mobile (<640px) the labels collapse to just the numbers
 * + check; the short label shows on `sm:` and up. The four markers stay
 * inline so the trustee always sees the full chapter map.
 *
 * Accessibility:
 *   - The list is `aria-label="Onboarding steps"` so screen readers
 *     announce it as a list of steps.
 *   - Each marker button carries `aria-current="step"` when active and
 *     `aria-disabled` when forward-jumping is blocked.
 */
export interface StepProgressProps {
  /** The current step (1..4). */
  current: WizardStep;
  /** Called when the trustee clicks a reachable step marker. */
  onJump?: (step: WizardStep) => void;
  /** Max step the trustee has reached — used to gate forward jumps. */
  furthestReached?: WizardStep;
}

/**
 * Render the step progress bar. Clicking a completed step calls
 * `onJump`; clicking the current step is a no-op; clicking a future
 * step is disabled.
 */
export function StepProgress({
  current,
  onJump,
  furthestReached = current,
}: StepProgressProps) {
  return (
    <nav aria-label="Onboarding steps">
      <ol className="flex items-stretch gap-1 sm:gap-2">
        {WIZARD_STEPS.map((entry) => {
          const isActive = entry.step === current;
          const isComplete = entry.step < current;
          const canJump =
            typeof onJump === "function" && entry.step <= furthestReached;
          const isFuture = entry.step > furthestReached;

          return (
            <li key={entry.step} className="flex-1 list-none">
              <button
                type="button"
                disabled={!canJump}
                onClick={() => canJump && onJump?.(entry.step)}
                aria-current={isActive ? "step" : undefined}
                aria-disabled={!canJump}
                aria-label={`Step ${entry.step}: ${entry.label}${
                  isActive ? " (current)" : isComplete ? " (done)" : ""
                }`}
                className={cn(
                  "group flex w-full flex-col items-start gap-1 rounded-md px-2 py-2 text-left transition-colors",
                  canJump && "hover:bg-muted/40",
                  !canJump && "cursor-not-allowed opacity-50",
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "font-serif text-sm font-semibold tabular-nums tracking-tight transition-colors",
                      isActive
                        ? "text-primary"
                        : isComplete
                          ? "text-primary/70"
                          : "text-muted-foreground",
                    )}
                  >
                    {String(entry.step).padStart(2, "0")}
                  </span>
                  {isComplete && !isActive && (
                    <Check className="size-3 text-primary/80" aria-hidden />
                  )}
                </div>
                <span
                  className={cn(
                    "hidden text-[10px] font-medium uppercase tracking-widest sm:block",
                    isActive
                      ? "text-primary"
                      : isComplete
                        ? "text-primary/60"
                        : "text-muted-foreground",
                  )}
                >
                  {entry.shortLabel}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 h-px w-full transition-colors",
                    isActive
                      ? "bg-primary"
                      : isComplete
                        ? "bg-primary/30"
                        : isFuture
                          ? "bg-transparent"
                          : "bg-border",
                  )}
                />
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
