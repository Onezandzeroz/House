"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Snowflake } from "lucide-react";

import type { DryPowderMeterProps } from "./types";
import type { AdvisoryOpinion } from "@/server/domain/advisory";

/**
 * DryPowderMeter — the visual dry-powder-discipline meter.
 *
 * Dry powder = the stable-sleeve weight. The owner's words (Task 6):
 *   "Tør krudt — altid parat til en god handel."
 *
 * The meter shows:
 *   - the current dry-powder percent (large serif numeral)
 *   - a horizontal Progress bar with markers at the three principle
 *     thresholds: critical (default 20%), floor (default 30%), target
 *     (default 35%)
 *   - a status chip from the advisor's five-zone classification
 *
 * Status chip colors:
 *   above-target / at-target / above-floor → emerald (allow)
 *   below-floor                          → amber   (warn)
 *   critical                             → rose    (reject)
 *
 * Plan coverage:
 *   - owner direction (Task 6): dry-powder principle, kasino-bankroll.
 *   - src/server/domain/bankroll.ts: BankrollPrinciples.
 *   - src/server/domain/advisory.ts: DryPowderStatus.
 */

const STATUS_META: Record<
  AdvisoryOpinion["dryPowderStatus"],
  {
    label: string;
    chip: string;
    bar: string;
    note: string;
  }
> = {
  "above-target": {
    label: "Above target",
    chip: "bg-allow/15 text-allow-foreground border-allow/40",
    bar: "bg-allow/70",
    note: "Deployable cushion. Ready for a good trade.",
  },
  "at-target": {
    label: "At target",
    chip: "bg-allow/15 text-allow-foreground border-allow/40",
    bar: "bg-allow/70",
    note: "Healthy. Cushion at the discipline line.",
  },
  "above-floor": {
    label: "Above floor",
    chip: "bg-allow/15 text-allow-foreground border-allow/40",
    bar: "bg-allow/70",
    note: "Below target but above the 30% floor.",
  },
  "below-floor": {
    label: "Below floor",
    chip: "bg-warn/15 text-warn-foreground border-warn/40",
    bar: "bg-warn/70",
    note: "Outside principle. Trim toward stables.",
  },
  critical: {
    label: "Critical",
    chip: "bg-reject/15 text-reject-foreground border-reject/40",
    bar: "bg-reject/70",
    note: "Force de-risk. Stable sleeve under the critical line.",
  },
};

export function DryPowderMeter({
  dryPowderBps,
  dryPowderStatus,
  principles,
}: DryPowderMeterProps) {
  const meta = STATUS_META[dryPowderStatus];
  const dryPct = dryPowderBps / 100; // 0..100

  // Markers for the three principle thresholds. We anchor them to the
  // 0..50% range on the bar so the meter stays legible — values above
  // 50% are rare (only bear posture targets 55%) and a 0..100 bar
  // would make 30% look small. The bar maxes out at 60% for headroom.
  const barMax = 60;
  const clamp = (v: number) => Math.max(0, Math.min(100, (v / barMax) * 100));
  const valuePct = clamp(dryPct);
  const criticalPct = clamp(principles.dryPowderCriticalBps / 100);
  const floorPct = clamp(principles.dryPowderFloorBps / 100);
  const targetPct = clamp(principles.dryPowderTargetBps / 100);

  return (
    <Card
      id="dry-powder-meter"
      className="scroll-mt-24"
      aria-labelledby="dry-powder-title"
    >
      <CardHeader className="gap-3 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-muted-foreground">
            <Snowflake className="size-3" aria-hidden />
            dry powder
          </Badge>
          <Badge variant="outline" className={`gap-1 ${meta.chip}`}>
            {meta.label}
          </Badge>
        </div>
        <h3
          id="dry-powder-title"
          className="font-serif text-2xl font-bold tracking-tight"
        >
          Tør krudt — always ready for a good trade
        </h3>
        <p className="text-sm text-muted-foreground">
          {meta.note} The stable sleeve is the bankroll&apos;s cushion: it is
          the powder the House deploys when a regime change or an opportunity
          arrives.
        </p>
        <Separator className="house-hairline" />
      </CardHeader>

      <CardContent className="p-6 pt-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Current dry powder
            </span>
            <p className="font-serif text-6xl font-bold tracking-tight house-num text-primary">
              {dryPct.toFixed(2)}
              <span className="ml-1 text-2xl text-muted-foreground">%</span>
            </p>
            <p className="text-xs text-muted-foreground">
              <span className="house-num">{dryPowderBps}</span> bps of NAV in
              the stable sleeve.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>
                critical{" "}
                <span className="house-num text-reject-foreground">
                  {principles.dryPowderCriticalBps / 100}%
                </span>
              </span>
              <span>
                floor{" "}
                <span className="house-num text-warn-foreground">
                  {principles.dryPowderFloorBps / 100}%
                </span>
              </span>
              <span>
                target{" "}
                <span className="house-num text-allow-foreground">
                  {principles.dryPowderTargetBps / 100}%
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* The visual meter. A horizontal bar with three markers; the
            current value slides from the left. */}
        <div className="relative mt-6">
          {/* Track. */}
          <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${meta.bar}`}
              style={{ width: `${valuePct}%` }}
              aria-hidden
            />
            {/* Marker: critical. */}
            <Marker
              pct={criticalPct}
              tone="reject"
              label={`critical ${principles.dryPowderCriticalBps / 100}%`}
            />
            {/* Marker: floor. */}
            <Marker
              pct={floorPct}
              tone="warn"
              label={`floor ${principles.dryPowderFloorBps / 100}%`}
            />
            {/* Marker: target. */}
            <Marker
              pct={targetPct}
              tone="allow"
              label={`target ${principles.dryPowderTargetBps / 100}%`}
            />
          </div>
          {/* Scale labels under the bar. */}
          <div className="mt-1.5 flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>0%</span>
            <span className="house-num">{barMax}%</span>
          </div>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          The bar is clamped to {barMax}% so the three principle markers stay
          legible. Values above {barMax}% collapse to the right edge; the
          numeric readout above is the source of truth.
        </p>
      </CardContent>
    </Card>
  );
}

/** A small vertical tick mark on the meter track. */
function Marker({
  pct,
  tone,
  label,
}: {
  pct: number;
  tone: "allow" | "warn" | "reject";
  label: string;
}) {
  const color =
    tone === "allow"
      ? "bg-allow-foreground"
      : tone === "warn"
        ? "bg-warn-foreground"
        : "bg-reject-foreground";
  return (
    <div
      role="img"
      aria-label={label}
      className="absolute top-1/2 z-10 h-5 w-px -translate-y-1/2"
      style={{ left: `${pct}%` }}
    >
      <div className={`absolute inset-0 ${color}`} aria-hidden />
    </div>
  );
}
