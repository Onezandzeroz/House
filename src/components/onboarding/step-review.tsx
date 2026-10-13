"use client";

import * as React from "react";
import { AlertCircle, Snowflake } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { PortfolioPieChart } from "@/components/portfolio/portfolio-pie-chart";

import {
  SLEEVE_META,
  buildPreviewOpinion,
  formatNavShort,
  previewPortfolio,
  type WizardPosition,
} from "./types";

/** The dry-powder floor (30%) — from BankrollPrinciplesSchema defaults. */
const DRY_POWDER_FLOOR_BPS = 3000;

/**
 * StepReview — Step 3 of the onboarding wizard.
 *
 * Renders the four-sleeve pie preview so the trustee can see how the
 * starting portfolio lands across Stable / Conservative / Balanced /
 * Aggressive before the trust is created. The pie uses the same
 * `PortfolioPieChart` component the live dashboard uses (Task 13), fed
 * an `AdvisoryOpinion`-shaped scaffold built from the wizard rows via
 * `buildPreviewOpinion`. The chart's `toPieData` normaliser accepts
 * the opinion shape so the preview matches what the trustee will see
 * after onboarding completes.
 *
 * Below the pie:
 *   - NAV in gold (.text-primary .house-num) — the headline number.
 *   - Dry powder % — current stable-sleeve weight.
 *   - Sleeve breakdown — four small badges (Stable X% / Conservative
 *     Y% / Balanced Z% / Aggressive W%).
 *   - Warning if dry powder < 30% — uses the same component structure as
 *     advisory warnings (left-border rose/amber + remediation block) so
 *     the trustee sees the same warning language they will see in Observe
 *     mode. Plus an "Add stablecoins" button that calls `onAddStablecoins`
 *     to send them back to Step 2.
 *
 * At the bottom: a confirmation checkbox — "I confirm these are my
 * holdings. The trust will start in Observe mode." The parent wizard
 * gates the Next button on this confirmation.
 *
 * Visual language:
 *   - The pie preview is at least 380px tall (mobile) / 420px+ (desktop)
 *     so it reads as a real preview, not a miniature.
 *   - The sleeve badges mirror the per-row badge in Step 2 so the colour
 *     coding stays consistent across the wizard.
 */
export interface StepReviewProps {
  /** The wizard positions — drives the pie + summary. */
  positions: WizardPosition[];
  /** The current confirmation state (controlled). */
  confirmed: boolean;
  /** Setter for the confirmation checkbox. */
  onConfirmedChange: (next: boolean) => void;
  /** Called when the trustee clicks "Add stablecoins" — wizard jumps to Step 2. */
  onAddStablecoins: () => void;
}

/**
 * Render Step 3 — the pie preview + summary + confirmation.
 */
export function StepReview({
  positions,
  confirmed,
  onConfirmedChange,
  onAddStablecoins,
}: StepReviewProps) {
  // The opinion is rebuilt on every render — pure input is positions,
  // so this is memoised on positions reference.
  const opinion = React.useMemo(
    () => buildPreviewOpinion(positions),
    [positions],
  );
  const preview = React.useMemo(
    () => previewPortfolio(positions),
    [positions],
  );

  const dryPowderPct = (preview.dryPowderBps / 100).toFixed(1);
  const belowFloor = preview.dryPowderBps < DRY_POWDER_FLOOR_BPS;

  return (
    <section
      aria-labelledby="step-review-title"
      className="flex flex-col gap-6"
    >
      <header className="flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          Onboarding · step 03
        </span>
        <h2
          id="step-review-title"
          className="font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
        >
          Your <span className="text-primary">starting portfolio</span>
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          This is how the trust&apos;s book will land across the four sleeves.
          The pie reads the same data the live dashboard will use once the
          trust is created. Adjust in Step 2 if the dry powder is thin.
        </p>
      </header>

      {/* Pie chart — preview-shaped AdvisoryOpinion, min 380px tall. */}
      <div className="min-h-[380px]">
        <PortfolioPieChart
          opinion={opinion}
          bookCurrency="USDC"
          mode="observe"
          aiRole="advisor"
          killSwitchActive={false}
        />
      </div>

      <Separator className="house-hairline" />

      {/* Summary block — NAV + dry powder + sleeve badges. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* NAV + dry powder. */}
        <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/30 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Net asset value
            </span>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              mark-to-book
            </Badge>
          </div>
          <p className="font-serif text-4xl font-bold tracking-tight house-num text-primary">
            {formatNavShort(preview.nav)}
          </p>
          <p className="text-xs text-muted-foreground">
            Estimated NAV in USDC. Reference prices; not for trade.
          </p>

          <Separator className="house-hairline my-1" />

          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Dry powder
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="What is dry powder?"
                >
                  <AlertCircle className="size-3.5" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-[16rem]">
                <p className="text-xs leading-relaxed">
                  The stable sleeve&apos;s share of NAV. The House always
                  keeps this above the 30% floor — &ldquo;altid parat til en
                  god handel&rdquo;.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
          <p
            className={`font-serif text-4xl font-bold tracking-tight house-num ${
              belowFloor ? "text-warn-foreground" : "text-allow-foreground"
            }`}
          >
            {dryPowderPct}
            <span className="ml-1 text-base text-muted-foreground">%</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {belowFloor
              ? `Below the 30% floor — add stablecoins to be ready for a good trade.`
              : `Above the 30% floor — the book is ready to deploy.`}
          </p>
        </div>

        {/* Sleeve breakdown badges. */}
        <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/30 p-4">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Sleeve breakdown
          </span>
          <ul className="flex flex-col gap-2">
            {preview.sleeves.map((s) => {
              const meta = SLEEVE_META[s.category];
              const pct = (s.weightBps / 100).toFixed(1);
              return (
                <li
                  key={s.category}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={`size-2.5 rounded-full ${meta.dot}`}
                    />
                    <span className="text-sm font-medium text-foreground">
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {s.assetIds.length}{" "}
                      {s.assetIds.length === 1 ? "asset" : "assets"}
                    </span>
                  </div>
                  <span className="house-num text-sm font-semibold text-foreground">
                    {pct}%
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Warning if dry powder < 30% — mirrors advisory warnings-list. */}
      {belowFloor && preview.hasPositions && (
        <DryPowderWarning onAddStablecoins={onAddStablecoins} />
      )}

      {/* Confirmation checkbox — gates the Next button in the wizard. */}
      <div
        className={`flex items-start gap-3 rounded-lg border p-4 transition-colors ${
          confirmed
            ? "border-allow/40 bg-allow/5"
            : "border-border/60 bg-muted/30"
        }`}
      >
        <Checkbox
          id="confirm-holdings"
          checked={confirmed}
          onCheckedChange={(v) => onConfirmedChange(v === true)}
          className="mt-0.5"
        />
        <Label
          htmlFor="confirm-holdings"
          className="text-sm leading-relaxed text-foreground"
        >
          I confirm these are my holdings. The trust will start in{" "}
          <span className="font-semibold text-primary">Observe</span> mode —
          read-only, no execution path. The AI acts as advisor; the policy
          engine gates every proposal.
        </Label>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// DryPowderWarning — mirrors the advisory `WarningsList` warn-severity
// card so the trustee sees the same warning language across onboarding
// and Observe mode.
// ---------------------------------------------------------------------------

interface DryPowderWarningProps {
  /** Called when the trustee clicks "Add stablecoins" — wizard jumps to Step 2. */
  onAddStablecoins: () => void;
}

function DryPowderWarning({ onAddStablecoins }: DryPowderWarningProps) {
  return (
    <article
      className="flex flex-col gap-3 rounded-lg border border-l-2 border-border/60 border-l-warn/60 bg-card p-4"
      aria-labelledby="dry-powder-warn-title"
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Snowflake className="size-4 text-warn-foreground" aria-hidden />
          <h4
            id="dry-powder-warn-title"
            className="font-serif text-base font-semibold tracking-tight"
          >
            Dry powder below the 30% floor
          </h4>
        </div>
        <Badge
          variant="outline"
          className="bg-warn/15 text-warn-foreground border-warn/40 text-[10px]"
        >
          warn
        </Badge>
      </header>
      <p className="text-xs leading-relaxed text-foreground/90">
        Dry powder below the 30% floor — add more stablecoins to be ready
        for a good trade. The House keeps a stable sleeve so a regime change
        or an opportunity can be deployed on without selling down.
      </p>
      <footer className="mt-auto flex items-center justify-between gap-3 rounded-md border border-border/40 bg-muted/40 p-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Remediation
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Go back to Step 2 and add USDC / USDT / DAI / FRAX or staked ETH
            (stETH, rETH, cbETH) until the stable sleeve crosses 30%.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAddStablecoins}
        >
          Add stablecoins
        </Button>
      </footer>
    </article>
  );
}
