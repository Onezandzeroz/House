"use client";

import * as React from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertOctagon,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { AllocationAdvice } from "@/server/domain/advisory";
import type { RiskCategory } from "@/server/domain/bankroll";

/**
 * AdviceCard — a rich card for a single allocation advice item,
 * with a Trustee AI placeholder explanation of WHY the advice is given.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │  BTC                          ADD  ↑         │
 *   │  Conservative · blue-chip                    │
 *   │  ──────────────────────────────────────────  │
 *   │  Current weight    38.42%                   │
 *   │  Target weight     45.00%                   │
 *   │  Delta              +6.58%  ($17,125 USDC)  │
 *   │  ──────────────────────────────────────────  │
 *   │  ✦ Trustee AI                                │
 *   │  BTC is the dominant store-of-value asset    │
 *   │  with the lowest volatility in the book.     │
 *   │  Current allocation is below the target     │
 *   │  for the Conservative sleeve — adding here  │
 *   │  strengthens the core position without      │
 *   │  increasing overall portfolio risk.         │
 *   └──────────────────────────────────────────────┘
 *
 * The Trustee AI explanation is a placeholder generated from the
 * advice's `action` + `reason` + `riskCategory` + `deltaBps`. A later
 * phase will replace this with a real LLM call via z-ai-web-dev-sdk.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2);
}

function formatMoney(s: string | number): string {
  const n = typeof s === "string" ? Number.parseFloat(s) : s;
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ---------------------------------------------------------------------------
// Action + risk metadata (mirrors allocation-advice-table.tsx)
// ---------------------------------------------------------------------------

interface ActionMeta {
  label: string;
  chip: string;
  icon: LucideIcon;
  accent: string;
}

const ACTION_META: Record<AllocationAdvice["action"], ActionMeta> = {
  add: {
    label: "Add",
    chip: "bg-allow/15 text-allow-foreground border-allow/40",
    icon: TrendingUp,
    accent: "border-l-allow/60",
  },
  reduce: {
    label: "Reduce",
    chip: "bg-warn/15 text-warn-foreground border-warn/40",
    icon: TrendingDown,
    accent: "border-l-warn/60",
  },
  hold: {
    label: "Hold",
    chip: "bg-muted text-muted-foreground border-border",
    icon: Minus,
    accent: "border-l-border/60",
  },
  exit: {
    label: "Exit",
    chip: "bg-reject/15 text-reject-foreground border-reject/40",
    icon: AlertOctagon,
    accent: "border-l-reject/60",
  },
};

const RISK_CHIP: Record<RiskCategory, string> = {
  stable: "bg-allow/10 text-allow-foreground border-allow/40",
  conservative: "bg-primary/10 text-primary border-primary/40",
  balanced: "bg-warn/10 text-warn-foreground border-warn/40",
  aggressive: "bg-reject/10 text-reject-foreground border-reject/40",
};

// ---------------------------------------------------------------------------
// Trustee AI placeholder explanation generator
// ---------------------------------------------------------------------------

/**
 * Generate a human-readable Trustee AI explanation for an allocation
 * advice. This is a PLACEHOLDER — it templates from the advice's action,
 * reason, risk category, and delta. A later phase will replace this with
 * a real LLM call via z-ai-web-dev-sdk that produces a richer, context-
 * aware explanation.
 *
 * The explanation always covers:
 *   1. WHY the action is recommended (the reason)
 *   2. WHAT the action means in practice (buy/sell/hold)
 *   3. HOW it affects the portfolio (weight shift + notional)
 */
function generateTrusteeAiExplanation(
  advice: AllocationAdvice,
  bookCurrency: string,
): string {
  const action = advice.action;
  const reason = advice.reason;
  const category = advice.riskCategory;
  const deltaPct = bpsToPercent(Math.abs(advice.deltaBps));
  const direction = advice.deltaBps > 0 ? "increase" : "decrease";
  const notional = advice.notionalChange;

  switch (action) {
    case "add":
      return (
        `${advice.assetId} is categorized as ${category} risk and currently ` +
        `sits at ${bpsToPercent(advice.currentWeightBps)}% of the portfolio, ` +
        `below the target of ${bpsToPercent(advice.targetWeightBps)}%. ` +
        `${reason} Adding here would ${direction} the position by ${deltaPct}% ` +
        `(${notional} ${bookCurrency}), strengthening the ${category} sleeve ` +
        `without breaching the single-asset weight cap. This is consistent with ` +
        `the current regime posture and the bankroll principle of keeping dry ` +
        `powder ready — the add is funded from the stable sleeve, not from ` +
        `de-risking other productive positions.`
      );

    case "reduce":
      return (
        `${advice.assetId} has drifted to ${bpsToPercent(advice.currentWeightBps)}% ` +
        `of the portfolio, above the target of ${bpsToPercent(advice.targetWeightBps)}%. ` +
        `${reason} Reducing by ${deltaPct}% (${notional} ${bookCurrency}) brings ` +
        `the position back within the ${category} sleeve's target band and ` +
        `rebalances dry powder toward the stable floor. This is a routine ` +
        `drift-correction, not a directional call — the policy gate has verified ` +
        `the trade is within the mandate's risk budget.`
      );

    case "hold":
      return (
        `${advice.assetId} is at ${bpsToPercent(advice.currentWeightBps)}% — ` +
        `within the target band for the ${category} sleeve. ${reason} ` +
        `No action is needed. The position is contributing to the portfolio's ` +
        `current posture without breaching concentration or dry-powder limits. ` +
        `The policy engine will re-evaluate on the next regime change or if ` +
        `drift exceeds the rebalance threshold.`
      );

    case "exit":
      return (
        `${advice.assetId} is flagged for exit. ${reason} The recommendation ` +
        `is to fully divest (${notional} ${bookCurrency}) and move the proceeds ` +
        `to the stable sleeve. This may be because the asset is outside the ` +
        `mandate's universe, has failed an ethics screen, or its risk profile ` +
        `has deteriorated beyond the ${category} sleeve's tolerance. The policy ` +
        `gate has verified the exit is compliant with the mandate.`
      );

    default:
      return reason;
  }
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export interface AdviceCardProps {
  advice: AllocationAdvice;
  bookCurrency: string;
}

export function AdviceCard({ advice, bookCurrency }: AdviceCardProps) {
  const meta = ACTION_META[advice.action];
  const ActionIcon = meta.icon;
  const aiExplanation = React.useMemo(
    () => generateTrusteeAiExplanation(advice, bookCurrency),
    [advice, bookCurrency],
  );

  const deltaSign = advice.deltaBps > 0 ? "+" : "";
  const deltaColor =
    advice.deltaBps > 0
      ? "text-allow-foreground"
      : advice.deltaBps < 0
        ? "text-warn-foreground"
        : "text-muted-foreground";

  return (
    <Card
      className={cn(
        "relative overflow-hidden border-l-4 transition-colors hover:bg-muted/20",
        meta.accent,
      )}
    >
      <CardContent className="flex flex-col gap-3 p-4">
        {/* Header: asset id + action badge */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-lg font-bold text-foreground">
              {advice.assetId}
            </span>
            <div className="flex items-center gap-1.5">
              <Badge
                variant="outline"
                className={cn("text-[9px]", RISK_CHIP[advice.riskCategory])}
              >
                {advice.riskCategory}
              </Badge>
            </div>
          </div>
          <Badge
            variant="outline"
            className={cn("gap-1 text-[10px]", meta.chip)}
          >
            <ActionIcon className="size-3" aria-hidden />
            {meta.label}
          </Badge>
        </div>

        {/* Weight metrics */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
              Current
            </span>
            <span className="font-mono house-num text-foreground">
              {bpsToPercent(advice.currentWeightBps)}%
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
              Target
            </span>
            <span className="font-mono house-num text-muted-foreground">
              {bpsToPercent(advice.targetWeightBps)}%
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
              Delta
            </span>
            <span className={cn("font-mono house-num font-semibold", deltaColor)}>
              {deltaSign}
              {bpsToPercent(advice.deltaBps)}%
            </span>
          </div>
        </div>

        {/* Notional */}
        <div className="flex items-baseline justify-between border-t border-border/40 pt-2 text-xs">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
            Notional change
          </span>
          <span className="font-mono house-num text-foreground">
            {advice.notionalChange}{" "}
            <span className="text-[10px] text-muted-foreground">{bookCurrency}</span>
          </span>
        </div>

        {/* Trustee AI explanation */}
        <div className="rounded-md border border-primary/20 bg-primary/[0.03] p-3">
          <div className="mb-1.5 flex items-center gap-1.5">
            <Sparkles className="size-3 text-primary" aria-hidden />
            <span className="text-[9px] font-semibold uppercase tracking-widest text-primary">
              Trustee AI
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-foreground/80">
            {aiExplanation}
          </p>
        </div>

        {/* Original reason (from the advisory engine) */}
        <div className="border-t border-border/40 pt-2">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
            Engine reason
          </span>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {advice.reason}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// AdviceCardGrid — renders a responsive grid of AdviceCards
// ---------------------------------------------------------------------------

export function AdviceCardGrid({
  advice,
  bookCurrency,
}: {
  advice: AllocationAdvice[];
  bookCurrency: string;
}) {
  if (advice.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
        No allocation advice available.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {advice.map((item, i) => (
        <AdviceCard key={`${item.assetId}-${i}`} advice={item} bookCurrency={bookCurrency} />
      ))}
    </div>
  );
}
