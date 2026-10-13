"use client";

import {
  Snowflake,
  Bot,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  Info,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { NormalizedPortfolio, TrustMode } from "./types";
import {
  DRY_POWDER_STATUS_META,
  TRUST_MODE_META,
  bpsToPercent,
  formatMoneyShort,
} from "./types";
import { useAnimatedCounter } from "./use-animated-counter";

/**
 * PortfolioSummaryStrip (Task 20 modernization) — the horizontal KPI
 * strip rendered BELOW the pie chart. Four cells, low-noise: dry powder +
 * NAV + positions count + AI role. Together they summarise the trust
 * state in one glance.
 *
 * Modernized for Task 20:
 *   - Each cell uses `.house-glass` (frosted glass) — modern, not flat.
 *   - Dry powder cell pulses:
 *       * `.house-pulse-emerald` if above-target / at-target (healthy)
 *       * no pulse if below-floor (amber — attention needed, not urgent)
 *       * `.house-pulse-operator` (rose) if critical (force de-risk)
 *   - AI role cell pulses `.house-pulse-operator` (rose) when the AI is
 *     operating (House mode / operator-active) — surfaces "AI live" so
 *     the owner sees at a glance that the AI is in the loop.
 *   - Hero numerals (dry powder %, NAV, positions count) animate via
 *     `useAnimatedCounter` so values "count up/down" smoothly when the
 *     underlying data changes.
 *
 * Plan coverage:
 *   - owner direction (Task 6): dry powder % front-and-centre because the
 *     stable sleeve is the bankroll's cushion ("altid parat til en god
 *     handel").
 *   - plan §2: AI role surfaces whether the AI is advising (Observe /
 *     Advise / Confirm / Rules) or operating (House).
 *
 * The strip is a SUMMARY, not the hero — the pie's centre label carries
 * the NAV as the visual anchor. The NAV cell here is a smaller echo for
 * consistency with the bankroll-snapshot pattern (Task 9).
 */

export interface PortfolioSummaryStripProps {
  /** The normalised trust state — typically the same `NormalizedPortfolio`
   * the pie chart received. */
  data: NormalizedPortfolio;
}

/**
 * Render the four KPI cells. The dry powder cell carries a status chip
 * whose colour matches the five-zone classification (allow/warn/reject).
 */
export function PortfolioSummaryStrip({ data }: PortfolioSummaryStripProps) {
  return (
    <section
      aria-label="Portfolio summary"
      className="grid grid-cols-2 gap-3 lg:grid-cols-4"
    >
      <DryPowderCell
        dryPowderBps={data.dryPowderBps}
        dryPowderStatus={data.dryPowderStatus}
      />
      <NavCell nav={data.nav} currency={data.bookCurrency} />
      <PositionsCell count={data.positionsCount} />
      <AiRoleCell
        mode={data.mode}
        aiRole={data.aiRole}
        killSwitchActive={data.killSwitchActive}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Per-cell sub-components. Kept in this file (not separate files) because
// they are tightly coupled to the strip's layout — splitting them would
// fragment the styling.
// ---------------------------------------------------------------------------

/** The pulse-class for the dry powder cell based on its status. */
function dryPowderPulse(
  status: NormalizedPortfolio["dryPowderStatus"],
): string {
  switch (status) {
    case "above-target":
    case "at-target":
      return "house-pulse-emerald";
    case "critical":
      return "house-pulse-operator";
    case "above-floor":
    case "below-floor":
    default:
      return "";
  }
}

/**
 * Dry powder cell — the hero. Large % numeral in gold + status chip per
 * the advisor's five-zone classification. Pulses emerald when healthy,
 * rose when critical, no pulse when in the in-between amber zones.
 */
function DryPowderCell({
  dryPowderBps,
  dryPowderStatus,
}: {
  dryPowderBps: number;
  dryPowderStatus: NormalizedPortfolio["dryPowderStatus"];
}) {
  const meta = DRY_POWDER_STATUS_META[dryPowderStatus];
  const pct = bpsToPercent(dryPowderBps);
  const targetPct = Number.parseFloat(pct);
  const animatedPct = useAnimatedCounter(targetPct, 800, 2);
  const toneClass =
    meta.tone === "allow"
      ? "bg-allow/15 text-allow-foreground border-allow/40"
      : meta.tone === "warn"
        ? "bg-warn/15 text-warn-foreground border-warn/40"
        : "bg-reject/15 text-reject-foreground border-reject/40";

  return (
    <Card
      aria-labelledby="strip-dry-powder-label"
      className={`relative overflow-hidden border border-border/60 bg-card/60 rounded-xl border-l-2 border-l-allow/60 ${dryPowderPulse(
        dryPowderStatus,
      )}`}
    >
      <CardContent className="flex flex-col gap-1 p-4">
        <div className="flex items-center justify-between">
          <span
            id="strip-dry-powder-label"
            className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
          >
            Dry powder
          </span>
          <Snowflake className="size-3.5 text-muted-foreground" aria-hidden />
        </div>
        <p
          className="font-serif text-3xl font-bold tracking-tight house-num house-text-gradient-gold"
          aria-label={`Dry powder ${pct} percent, ${meta.label}`}
        >
          {animatedPct.toFixed(2)}
          <span className="ml-0.5 text-sm text-muted-foreground">%</span>
        </p>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`text-[10px] ${toneClass}`}>
            {meta.label}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            {dryPowderBps} bps
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground">{meta.note}</p>
      </CardContent>
    </Card>
  );
}

/**
 * NAV cell — an echo of the pie's centre label. Smaller serif numeral so
 * the strip reads as a coherent summary, not a duplicate hero.
 */
function NavCell({ nav, currency }: { nav: string; currency: string }) {
  // The NAV comes in as a string ("264500.00"); the animated counter
  // works in numbers. We tween the underlying number, then format the
  // displayed value with the same `formatMoneyShort` formatter so the
  // numeral style stays consistent with the centre label + the empty
  // state.
  const navNumber = Number.parseFloat(nav) || 0;
  const animatedNav = useAnimatedCounter(navNumber, 800, 2);
  const display = formatMoneyShort(animatedNav.toFixed(2));
  return (
    <Card
      aria-labelledby="strip-nav-label"
      className="relative overflow-hidden border border-border/60 bg-card/60 rounded-xl border-l-2 border-l-primary/60"
    >
      <CardContent className="flex flex-col gap-1 p-4">
        <div className="flex items-center justify-between">
          <span
            id="strip-nav-label"
            className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
          >
            Net asset value
          </span>
          <Wallet className="size-3.5 text-muted-foreground" aria-hidden />
        </div>
        <p
          className="font-serif text-3xl font-bold tracking-tight house-num house-text-gradient-gold"
          aria-label={`Net asset value ${display} ${currency}`}
        >
          {display}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {currency} book currency
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Positions cell — the count of distinct assets held. The number is the
 * "breadth" signal: a thin book (1–3 positions) is concentrated; a wide
 * book (10+) is diversified. Animated counter tweens the count on change.
 */
function PositionsCell({ count }: { count: number }) {
  const animatedCount = useAnimatedCounter(count, 600, 0);
  return (
    <Card
      aria-labelledby="strip-positions-label"
      className="relative overflow-hidden border border-border/60 bg-card/60 rounded-xl border-l-2 border-l-warn/60"
    >
      <CardContent className="flex flex-col gap-1 p-4">
        <div className="flex items-center justify-between">
          <span
            id="strip-positions-label"
            className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
          >
            Positions
          </span>
          <Info className="size-3.5 text-muted-foreground" aria-hidden />
        </div>
        <p
          className="font-serif text-3xl font-bold tracking-tight house-num text-foreground"
          aria-label={`${count} positions`}
        >
          {Math.round(animatedCount)}
        </p>
        <p className="text-[10px] text-muted-foreground">
          Distinct assets held across all sleeves.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * AI role cell — surfaces whether the AI inside the trust is proposing
 * (Advisor) or operating (Operator). The chip colour flips from emerald
 * (advisory) to gold (operating) so the owner can see the AI's posture
 * at a glance. The cell pulses `.house-pulse-operator` (rose) when the
 * AI is operating — the "AI live" indicator. A kill-switch state
 * overrides everything to a rose chip because the kill switch blocks
 * ALL trade paths.
 */
function AiRoleCell({
  mode,
  aiRole,
  killSwitchActive,
}: {
  mode: TrustMode;
  aiRole: NormalizedPortfolio["aiRole"];
  killSwitchActive: boolean;
}) {
  const modeMeta = TRUST_MODE_META[mode];
  const isOperating = modeMeta.aiOperates || aiRole === "operator";
  const aiOff = aiRole === "advisor-off";

  // Kill switch overrides everything — trade permission is revoked.
  if (killSwitchActive) {
    return (
      <Card
        aria-labelledby="strip-ai-role-label"
        className="relative overflow-hidden border border-border/60 bg-card/60 rounded-xl border-l-2 border-l-reject/80 bg-reject/5 house-pulse-operator"
      >
        <CardContent className="flex flex-col gap-1 p-4">
          <div className="flex items-center justify-between">
            <span
              id="strip-ai-role-label"
              className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
            >
              AI role
            </span>
            <ShieldAlert
              className="size-3.5 text-reject-foreground"
              aria-hidden
            />
          </div>
          <p className="font-serif text-3xl font-bold tracking-tight text-reject-foreground">
            Halted
          </p>
          <Badge
            variant="outline"
            className="w-fit bg-reject/15 text-reject-foreground border-reject/40 text-[10px]"
          >
            Kill switch
          </Badge>
          <p className="text-[10px] text-muted-foreground">
            Trade permission revoked. No intent executes.
          </p>
        </CardContent>
      </Card>
    );
  }

  const chipClass = aiOff
    ? "bg-muted text-muted-foreground border-border/60"
    : isOperating
      ? "bg-primary/15 text-primary border-primary/40"
      : "bg-allow/15 text-allow-foreground border-allow/40";

  const roleLabel = aiOff ? "Off" : isOperating ? "Operator" : "Advisor";

  const Icon = isOperating ? Bot : ShieldCheck;
  const iconClass = isOperating ? "text-primary" : "text-allow-foreground";

  return (
    <Card
      aria-labelledby="strip-ai-role-label"
      className={`relative overflow-hidden border border-border/60 bg-card/60 rounded-xl border-l-2 ${
        isOperating
          ? "border-l-primary/80 house-pulse-operator"
          : "border-l-allow/60"
      }`}
    >
      <CardContent className="flex flex-col gap-1 p-4">
        <div className="flex items-center justify-between">
          <span
            id="strip-ai-role-label"
            className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
          >
            AI role
          </span>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="What does the AI role mean?"
                >
                  <Info className="size-3.5" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[16rem]">
                <p className="text-xs leading-relaxed">
                  Advisor: the AI proposes; the owner / policy gate decides.
                  Operator: the AI is in House mode and emits intents subject
                  to the policy gate. The AI never sits on the keys.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center gap-2">
          <Icon className={`size-5 ${iconClass}`} aria-hidden />
          <p
            className={`font-serif text-3xl font-bold tracking-tight ${
              isOperating ? "text-primary" : "text-foreground"
            }`}
          >
            {roleLabel}
          </p>
        </div>
        <Badge variant="outline" className={`w-fit text-[10px] ${chipClass}`}>
          {modeMeta.name} mode
        </Badge>
        <p className="text-[10px] text-muted-foreground">
          {isOperating
            ? "AI proposes intents; policy gates; same grants as Rules."
            : aiOff
              ? "AI muted. Read-only."
              : "AI proposes; owner / policy gate decides."}
        </p>
      </CardContent>
    </Card>
  );
}
