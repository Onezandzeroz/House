"use client";

import * as React from "react";
import {
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  AlertOctagon,
  Sparkles,
  Newspaper,
  type LucideIcon,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import type { AllocationAdvice } from "@/server/domain/advisory";
import type { RiskCategory } from "@/server/domain/bankroll";

/**
 * AdviceCard — a refined, wealth-management-style recommendation card
 * for a single allocation advice item. Reads like a private banker's
 * memo, not a crypto trading signal:
 *
 *   - Serif typography for the asset name + headline recommendation
 *   - Descriptive section labels ("Current Allocation", "Target
 *     Allocation", "Recommended Action")
 *   - The Trustee AI explanation reads like a personal wealth advisor's
 *     note — WHY the recommendation is made, in natural language
 *   - A "Market Context" placeholder (italic, muted) for future news
 *   - Subtle, muted tones — no loud green/red
 *   - Refined left accent matching the action type
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │  Bitcoin                                  ↑ ADD       │
 *   │  BTC · Conservative sleeve                            │
 *   │  ──────────────────────────────────────────────────── │
 *   │  RECOMMENDATION                                      │
 *   │  Increase allocation to Bitcoin by 6.30%              │
 *   │  (+15,802.45 USDC)                                    │
 *   │  ──────────────────────────────────────────────────── │
 *   │  CURRENT ALLOCATION    TARGET ALLOCATION              │
 *   │  28.70%                 35.00%                        │
 *   │  ──────────────────────────────────────────────────── │
 *   │  ✦ TRUSTEE AI — ADVISORY NOTE                        │
 *   │  Bitcoin is the dominant store-of-value asset...     │
 *   │  [full explanation]                                   │
 *   │  ──────────────────────────────────────────────────── │
 *   │  📰 MARKET CONTEXT                                    │
 *   │  Market context will appear here when news is         │
 *   │  connected.                                          │
 *   └──────────────────────────────────────────────────────┘
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
// Action metadata (refined — subtle, muted tones)
// ---------------------------------------------------------------------------

interface ActionMeta {
  label: string;
  verb: string; // "Increase" / "Reduce" / "Maintain" / "Exit"
  icon: LucideIcon;
  accent: string; // left-border accent
  tone: string; // text tone for the action word
}

const ACTION_META: Record<AllocationAdvice["action"], ActionMeta> = {
  add: {
    label: "Add",
    verb: "Increase allocation to",
    icon: ArrowUpRight,
    accent: "before:bg-allow/30",
    tone: "text-allow-foreground/80",
  },
  reduce: {
    label: "Reduce",
    verb: "Reduce allocation to",
    icon: ArrowDownRight,
    accent: "before:bg-warn/30",
    tone: "text-warn-foreground/80",
  },
  hold: {
    label: "Hold",
    verb: "Maintain current allocation to",
    icon: Minus,
    accent: "before:bg-border/30",
    tone: "text-muted-foreground",
  },
  exit: {
    label: "Exit",
    verb: "Divest entirely from",
    icon: AlertOctagon,
    accent: "before:bg-reject/30",
    tone: "text-reject-foreground/80",
  },
};

// ---------------------------------------------------------------------------
// Asset metadata (same as position-card — for the "exclusive" feel)
// ---------------------------------------------------------------------------

const ASSET_NAMES: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  XRP: "XRP",
  XLM: "Stellar Lumens",
  FLR: "Flare",
  USDC: "USD Coin",
  USDT: "Tether",
  RLUSD: "Ripple USD",
  DAI: "DAI",
  FRAX: "FRAX",
  stETH: "Lido Staked ETH",
  rETH: "Rocket Pool ETH",
  cbETH: "Coinbase Wrapped ETH",
  WBTC: "Wrapped Bitcoin",
  ARB: "Arbitrum",
  OP: "Optimism",
  AVAX: "Avalanche",
  UNI: "Uniswap",
  AAVE: "Aave",
  LDO: "Lido DAO",
  DOGE: "Dogecoin",
};

function assetName(assetId: string): string {
  return ASSET_NAMES[assetId.toUpperCase()] ?? assetId;
}

// ---------------------------------------------------------------------------
// Trustee AI advisory note generator
// ---------------------------------------------------------------------------

/**
 * Generate a Trustee AI advisory note — reads like a private banker's
 * memo, not a trading signal. Covers:
 *   1. The recommendation in plain language
 *   2. WHY (the advisory engine's reason, rephrased)
 *   3. HOW it affects the portfolio (weight shift, notional, sleeve)
 *   4. Risk considerations specific to the action
 *
 * PLACEHOLDER — will be replaced with a real LLM call via
 * z-ai-web-dev-sdk in a later phase.
 */
function generateTrusteeAiNote(
  advice: AllocationAdvice,
  bookCurrency: string,
): string {
  const name = assetName(advice.assetId);
  const reason = advice.reason;
  const current = bpsToPercent(advice.currentWeightBps);
  const target = bpsToPercent(advice.targetWeightBps);
  const delta = bpsToPercent(Math.abs(advice.deltaBps));
  const notional = advice.notionalChange;
  const category = advice.riskCategory;

  switch (advice.action) {
    case "add":
      return (
        `${name} currently represents ${current}% of the portfolio, below ` +
        `the target allocation of ${target}% for the ${category} sleeve. ` +
        `${reason} ` +
        `The recommendation is to increase the position by ${delta}% ` +
        `(${notional} ${bookCurrency}), bringing the allocation into ` +
        `alignment with the mandate's target band. This adjustment ` +
        `strengthens the core position without exceeding the single-asset ` +
        `weight cap, and is funded from the stablecoin sleeve to preserve ` +
        `dry powder discipline. The policy engine has verified the trade ` +
        `is compliant with the current mandate and risk budget.`
      );

    case "reduce":
      return (
        `${name} has drifted to ${current}% of the portfolio, above the ` +
        `target of ${target}%. ${reason} ` +
        `The recommendation is to reduce the position by ${delta}% ` +
        `(${notional} ${bookCurrency}), rebalancing back into the ` +
        `${category} sleeve's target band. The proceeds move to the ` +
        `stablecoin sleeve, restoring dry powder toward the 30% floor. ` +
        `This is a routine drift-correction — not a directional call on ` +
        `${name}'s prospects. The policy engine has confirmed the ` +
        `reduction is within the mandate's turnover and concentration limits.`
      );

    case "hold":
      return (
        `${name} is at ${current}%, within the target band for the ` +
        `${category} sleeve. ${reason} ` +
        `No adjustment is recommended at this time. The position is ` +
        `contributing to the portfolio's current posture without ` +
        `breaching concentration, liquidity, or dry-powder limits. ` +
        `The advisory engine will re-evaluate on the next regime change ` +
        `or if drift exceeds the rebalance threshold.`
      );

    case "exit":
      return (
        `${name} is recommended for full divestment. ${reason} ` +
        `The recommendation is to exit the position entirely ` +
        `(${notional} ${bookCurrency}) and move proceeds to the ` +
        `stablecoin sleeve. This may reflect that the asset is outside ` +
        `the mandate's universe, has failed an ethics or compliance ` +
        `screen, or its risk profile has deteriorated beyond the ` +
        `${category} sleeve's tolerance. The policy gate has verified ` +
        `the exit is compliant with the mandate. Proceeds will be held ` +
        `as dry powder pending the next allocation review.`
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
  const name = assetName(advice.assetId);
  const aiNote = React.useMemo(
    () => generateTrusteeAiNote(advice, bookCurrency),
    [advice, bookCurrency],
  );

  const deltaSign = advice.deltaBps > 0 ? "+" : "";

  return (
    <Card
      className={cn(
        "relative overflow-hidden border-border/40 bg-card/30 transition-colors hover:bg-card/50",
        "before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px]",
        meta.accent,
      )}
    >
      <CardContent className="flex flex-col gap-4 p-5 sm:p-6">
        {/* ── Header: asset name + action ───────────────────── */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 className="font-serif text-xl font-bold tracking-tight text-foreground">
              {name}
            </h3>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {advice.assetId} · {advice.riskCategory} sleeve
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <ActionIcon className={cn("size-4", meta.tone)} aria-hidden />
            <span className={cn("text-[11px] font-semibold uppercase tracking-[0.2em]", meta.tone)}>
              {meta.label}
            </span>
          </div>
        </div>

        {/* ── Fading gradient banner under the title ────────── */}
        <div
          aria-hidden
          className={cn(
            "h-[2px] w-full rounded-full",
            "bg-gradient-to-r from-transparent via-primary/40 to-transparent",
            advice.action === "add" && "from-transparent via-allow/40 to-transparent",
            advice.action === "reduce" && "from-transparent via-warn/40 to-transparent",
            advice.action === "exit" && "from-transparent via-reject/40 to-transparent",
          )}
        />

        {/* ── Trustee AI advisory note (right under the title) ─ */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <Sparkles className="size-3 text-primary/60" aria-hidden />
            <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-primary/70">
              Trustee AI — Advisory Note
            </span>
          </div>
          <p className="text-[18px] leading-[1.7] text-foreground/80">
            {aiNote}
          </p>
        </div>

        {/* ── Hairline divider ──────────────────────────────── */}
        <div className="house-hairline" aria-hidden />

        {/* ── Recommendation ────────────────────────────────── */}
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60">
            Recommendation
          </span>
          <p className="text-base leading-relaxed text-foreground/90">
            {meta.verb} {name} by{" "}
            <span className="font-mono font-semibold house-num">
              {bpsToPercent(Math.abs(advice.deltaBps))}%
            </span>
            <span className="text-muted-foreground">
              {" "}
              ({advice.notionalChange} {bookCurrency})
            </span>
          </p>
        </div>

        {/* ── Current + Target allocation ───────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60">
              Current Allocation
            </span>
            <span className="font-serif text-xl font-semibold text-foreground house-num">
              {bpsToPercent(advice.currentWeightBps)}%
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60">
              Target Allocation
            </span>
            <span className="font-serif text-xl font-semibold text-muted-foreground house-num">
              {bpsToPercent(advice.targetWeightBps)}%
            </span>
          </div>
        </div>

        {/* ── Delta indicator ───────────────────────────────── */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60">
            Weight Adjustment
          </span>
          <span
            className={cn(
              "font-mono house-num font-medium",
              advice.deltaBps > 0
                ? "text-allow-foreground/70"
                : advice.deltaBps < 0
                  ? "text-warn-foreground/70"
                  : "text-muted-foreground",
            )}
          >
            {deltaSign}
            {bpsToPercent(advice.deltaBps)}%
          </span>
        </div>

        {/* ── Engine rationale ──────────────────────────────── */}
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60">
            Engine Rationale
          </span>
          <p className="text-[13px] italic leading-relaxed text-muted-foreground/70">
            {advice.reason}
          </p>
        </div>

        {/* ── Market context (placeholder for news) ─────────── */}
        <div className="house-hairline" aria-hidden />
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <Newspaper className="size-3 text-muted-foreground/50" aria-hidden />
            <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60">
              Market Context
            </span>
          </div>
          <p className="text-[13px] italic leading-relaxed text-muted-foreground/50">
            Market context and relevant news for {name} will appear here
            when the news feed is connected.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// AdviceCardGrid — single-column stack (full width, one under another)
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
    <div className="flex flex-col gap-3">
      {advice.map((item, i) => (
        <AdviceCard key={`${item.assetId}-${i}`} advice={item} bookCurrency={bookCurrency} />
      ))}
    </div>
  );
}
