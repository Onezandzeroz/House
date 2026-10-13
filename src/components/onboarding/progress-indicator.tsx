"use client";

import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  MULTI_PAGE_STEPS,
  type MultiPageStep,
} from "./types";

/**
 * ProgressIndicator — the 5-step horizontal indicator pinned to the
 * top of the multi-page onboarding (Task 47-49).
 *
 * Renders the five pages as connected markers (small circles joined by
 * a hairline). The current page is gold-filled; completed pages carry
 * an emerald check; future pages are muted. Clicking a completed page
 * jumps back to it.
 *
 * Visual language:
 *   - 5 circles, each ~size-7 (28px), connected by a 1px hairline.
 *   - Current page = gold fill (#c9a227) + gold ring (house-num-accent
 *     glow).
 *   - Completed pages = emerald check on a faint emerald-tinted fill.
 *   - Future pages = muted border, muted text.
 *   - Page numbers (01, 02, 03, 04, 05) in Cormorant serif appear above
 *     the short label so the indicator reads as an exclusive chapter map.
 *
 * Responsive: on mobile (<640px) the short labels hide; the circles +
 * numbers + check stay visible so the user always sees where they are.
 *
 * Accessibility:
 *   - The list is `aria-label="Onboarding pages"` so screen readers
 *     announce it as a list of pages.
 *   - Each marker button carries `aria-current="step"` when active and
 *     `aria-disabled` when forward-jumping is blocked.
 */
export interface ProgressIndicatorProps {
  /** The current page (1..5). */
  current: MultiPageStep;
  /** Called when the user clicks a reachable (completed) page marker. */
  onJump?: (step: MultiPageStep) => void;
  /**
   * The furthest page the user has reached. Forward-jumps are gated
   * behind this so the user can't skip ahead without filling in the
   * previous pages. Defaults to `current`.
   */
  furthestReached?: MultiPageStep;
}

/**
 * Render the 5-step progress indicator. Clicking a completed page
 * calls `onJump`; clicking the current page is a no-op; clicking a
 * future page is disabled.
 */
export function ProgressIndicator({
  current,
  onJump,
  furthestReached = current,
}: ProgressIndicatorProps) {
  return (
    <nav
      aria-label="Onboarding pages"
      className="w-full"
    >
      <ol className="flex items-start justify-between gap-1 sm:gap-2">
        {MULTI_PAGE_STEPS.map((entry, idx) => {
          const isActive = entry.step === current;
          const isComplete = entry.step < current;
          const canJump =
            typeof onJump === "function" && entry.step <= furthestReached;
          const isFuture = entry.step > furthestReached;

          // The connector hairline between this circle and the next.
          // Rendered to the right of every circle EXCEPT the last one.
          const showConnector = idx < MULTI_PAGE_STEPS.length - 1;

          return (
            <li
              key={entry.step}
              className="flex flex-1 list-none items-start"
            >
              <button
                type="button"
                disabled={!canJump}
                onClick={() => canJump && onJump?.(entry.step)}
                aria-current={isActive ? "step" : undefined}
                aria-disabled={!canJump}
                aria-label={`Page ${entry.step}: ${entry.label}${
                  isActive ? " (current)" : isComplete ? " (done)" : ""
                }`}
                className={cn(
                  "group flex flex-1 flex-col items-center gap-1.5 rounded-md py-1 transition-colors",
                  canJump && "cursor-pointer hover:bg-muted/40",
                  !canJump && "cursor-not-allowed",
                )}
              >
                {/* Circle marker */}
                <div className="flex w-full items-center">
                  {/* Left half of the connector (only after the first). */}
                  <span
                    aria-hidden
                    className={cn(
                      "hidden h-px flex-1 transition-colors sm:block",
                      idx === 0
                        ? "bg-transparent"
                        : isComplete || isActive
                          ? "bg-primary/40"
                          : "bg-border/60",
                    )}
                  />
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full border-2 transition-all sm:size-8",
                      isActive &&
                        "border-primary bg-primary text-primary-foreground shadow-[0_0_12px_rgba(201,162,39,0.5)]",
                      !isActive &&
                        isComplete &&
                        "border-allow-foreground/60 bg-allow/10 text-allow-foreground",
                      !isActive &&
                        !isComplete &&
                        !isFuture &&
                        "border-border bg-muted/40 text-muted-foreground",
                      isFuture && "border-border/50 bg-transparent text-muted-foreground/60",
                    )}
                  >
                    {isComplete && !isActive ? (
                      <Check className="size-3.5" aria-hidden />
                    ) : (
                      <span
                        className={cn(
                          "font-serif text-xs font-semibold tabular-nums",
                          isActive && "house-num",
                        )}
                      >
                        {entry.step}
                      </span>
                    )}
                  </span>
                  {/* Right half of the connector (only before the last). */}
                  <span
                    aria-hidden
                    className={cn(
                      "hidden h-px flex-1 transition-colors sm:block",
                      !showConnector
                        ? "bg-transparent"
                        : isComplete
                          ? "bg-primary/40"
                          : isActive
                            ? "bg-primary/30"
                            : "bg-border/60",
                    )}
                  />
                </div>
                {/* Short label under the circle (hidden on mobile). */}
                <span
                  className={cn(
                    "hidden text-[10px] font-medium uppercase tracking-widest sm:block",
                    isActive
                      ? "text-primary"
                      : isComplete
                        ? "text-allow-foreground/80"
                        : "text-muted-foreground",
                  )}
                >
                  {entry.shortLabel}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
