"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ArrowUp, ArrowDown, Minus, ChevronDown } from "lucide-react";

import type { RegimeBannerProps } from "./types";
import type { MarketRegime, RegimeSignal } from "@/server/domain/regime";

/**
 * RegimeBanner — the hero card at the top of the Advisory Dashboard.
 *
 * Shows the detected market regime (Bull / Bear / Ranging /
 * Transitional) in large serif type, a status chip with the
 * corresponding posture color, the confidence percent, the strategy
 * posture sentence (hardcoded from the owner direction, Task 6), and
 * an Accordion with the regime signal evidence trail so the owner can
 * audit WHICH signals pointed which way.
 *
 * Plan coverage:
 *   - owner direction (Task 6): regime-bevisst rådgivning.
 *   - src/server/domain/regime.ts: regimeStrategyPosture posture.
 *   - src/server/domain/advisory.ts: AdvisoryOpinion.regime.
 */

// Hardcoded posture sentences per regime — verbatim from the owner
// direction in Task 6 (paraphrased to English for the technical UI).
const POSTURE_BY_REGIME: Record<MarketRegime, string> = {
  bull: "Tilt toward balanced / aggressive; reduce dry powder toward the 30% floor.",
  bear: "Protective. Raise dry powder above the floor; keep conservative blue-chips only.",
  ranging: "Harvest yield; hold neutral posture and let the stable sleeve carry.",
  transitional: "Turning point. Hold cushion; do not commit until signals agree.",
};

// Regime chip color — emerald for bull, rose for bear, amber for
// ranging, muted for transitional. Uses the new --allow/--warn/--reject
// tokens so the chip palette is consistent with the rest of the
// dashboard.
const REGIME_CHIP: Record<
  MarketRegime,
  { label: string; chip: string; ring: string }
> = {
  bull: {
    label: "Bull",
    chip: "bg-allow/15 text-allow-foreground border-allow/40",
    ring: "from-allow/20",
  },
  bear: {
    label: "Bear",
    chip: "bg-reject/15 text-reject-foreground border-reject/40",
    ring: "from-reject/20",
  },
  ranging: {
    label: "Ranging",
    chip: "bg-warn/15 text-warn-foreground border-warn/40",
    ring: "from-warn/20",
  },
  transitional: {
    label: "Transitional",
    chip: "bg-muted text-muted-foreground border-border",
    ring: "from-muted/20",
  },
};

// Signal direction chip + icon.
function DirectionChip({ direction }: { direction: RegimeSignal["direction"] }) {
  if (direction === "bull") {
    return (
      <Badge
        variant="outline"
        className="gap-1 bg-allow/10 text-allow-foreground border-allow/40"
      >
        <ArrowUp className="size-3" aria-hidden />
        bull
      </Badge>
    );
  }
  if (direction === "bear") {
    return (
      <Badge
        variant="outline"
        className="gap-1 bg-reject/10 text-reject-foreground border-reject/40"
      >
        <ArrowDown className="size-3" aria-hidden />
        bear
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 bg-muted text-muted-foreground border-border"
    >
      <Minus className="size-3" aria-hidden />
      neutral
    </Badge>
  );
}

export function RegimeBanner({ regime }: RegimeBannerProps) {
  const chip = REGIME_CHIP[regime.regime];
  const posture = POSTURE_BY_REGIME[regime.regime];
  const confidencePct = (regime.confidence * 100).toFixed(0);
  const observedAt =
    regime.observedAt instanceof Date
      ? regime.observedAt.toISOString()
      : String(regime.observedAt);

  return (
    <Card
      id="regime-banner"
      className="relative overflow-hidden scroll-mt-24"
      aria-labelledby="regime-banner-title"
    >
      {/* Radial glow at the top — the House always has the edge. */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b ${chip.ring} to-transparent`}
      />
      <CardHeader className="relative gap-4 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-muted-foreground">
            regime · observed
          </Badge>
          <Badge variant="outline" className="text-muted-foreground">
            <code className="font-mono text-[10px]">
              {observedAt.slice(0, 19).replace("T", " ")} UTC
            </code>
          </Badge>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-2">
            <h2
              id="regime-banner-title"
              className="font-serif text-5xl font-bold tracking-tight text-primary sm:text-6xl"
            >
              {chip.label}
              <span className="text-muted-foreground"> regime</span>
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              {posture}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={`${chip.chip} px-3 py-1 text-xs`}
            >
              {chip.label}
            </Badge>
            <Badge
              variant="outline"
              className="px-3 py-1 text-xs border-border bg-muted text-muted-foreground"
            >
              confidence{" "}
              <span className="house-num text-foreground">
                {confidencePct}%
              </span>
            </Badge>
          </div>
        </div>

        <Separator className="house-hairline" />
      </CardHeader>

      <CardContent className="relative p-6 pt-0">
        <p className="text-sm text-muted-foreground">{regime.summary}</p>

        {regime.signals.length > 0 && (
          <Accordion
            type="single"
            collapsible
            className="mt-4 w-full"
            defaultValue={undefined}
          >
            <AccordionItem
              value="signals"
              className="border-border/60"
            >
              <AccordionTrigger className="text-sm font-medium hover:no-underline">
                <span className="flex items-center gap-2">
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                  Signal evidence ({regime.signals.length})
                </span>
              </AccordionTrigger>
              <AccordionContent className="pt-2">
                <ul className="flex flex-col gap-3">
                  {regime.signals.map((signal) => (
                    <li
                      key={signal.name}
                      className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/30 p-3 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-xs font-semibold text-foreground">
                            {signal.name}
                          </code>
                          <DirectionChip direction={signal.direction} />
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {signal.evidence}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 sm:flex-col sm:items-end sm:gap-1">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          weight
                        </span>
                        <span className="house-num text-sm text-foreground">
                          {signal.weight.toFixed(2)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}
