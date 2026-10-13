"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Snowflake,
  ShieldCheck,
  Scale,
  Flame,
} from "lucide-react";

import type { SleeveAllocationProps } from "./types";
import type { RiskCategory, Sleeve } from "@/server/domain/bankroll";

/**
 * SleeveAllocation — the four sleeve cards (Stable / Conservative /
 * Balanced / Aggressive), each showing current vs target weight with
 * a horizontal progress bar, floor/cap markers, and the asset list.
 *
 * Plan coverage:
 *   - owner direction (Task 6): "hvor mange, hvor store og i hvilke
 *     risiko kategori" — the four sleeves ARE the answer to that
 *     question.
 *   - src/server/domain/bankroll.ts: Sleeve + RiskCategory.
 *   - src/server/domain/regime.ts: regimeStrategyPosture (the target
 *     weight is the posture target).
 *
 * Layout: 1 column on mobile, 4 columns on desktop. Each card has a
 * left-border accent in the sleeve color (subtle, not heavy). The
 * stable sleeve is emerald-tinted, conservative is gold, balanced is
 * amber, aggressive is rose — the four hues communicate the risk
 * spectrum from low to high.
 */

const SLEEVE_META: Record<
  RiskCategory,
  {
    name: string;
    icon: React.ComponentType<{ className?: string }>;
    tint: string; // left-border accent
    barFrom: string; // progress bar gradient start
    barTo: string; // progress bar gradient end
  }
> = {
  stable: {
    name: "Stable",
    icon: Snowflake,
    tint: "border-l-allow/60",
    barFrom: "from-allow/50",
    barTo: "to-allow/80",
  },
  conservative: {
    name: "Conservative",
    icon: ShieldCheck,
    tint: "border-l-primary/60",
    barFrom: "from-primary/50",
    barTo: "to-primary/80",
  },
  balanced: {
    name: "Balanced",
    icon: Scale,
    tint: "border-l-warn/60",
    barFrom: "from-warn/50",
    barTo: "to-warn/80",
  },
  aggressive: {
    name: "Aggressive",
    icon: Flame,
    tint: "border-l-reject/60",
    barFrom: "from-reject/50",
    barTo: "to-reject/80",
  },
};

const SLEEVE_ORDER: RiskCategory[] = [
  "stable",
  "conservative",
  "balanced",
  "aggressive",
];

export function SleeveAllocation({ sleeves }: SleeveAllocationProps) {
  // Sort sleeves in canonical order (stable → aggressive) so the grid
  // is stable across renders regardless of how the API returns them.
  const sorted = [...sleeves].sort(
    (a, b) =>
      SLEEVE_ORDER.indexOf(a.category) - SLEEVE_ORDER.indexOf(b.category),
  );

  return (
    <section aria-labelledby="sleeve-allocation-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2
          id="sleeve-allocation-title"
          className="font-serif text-2xl font-bold tracking-tight"
        >
          Sleeve allocation
        </h2>
        <p className="text-sm text-muted-foreground">
          Four sleeves, low to high risk. Current vs the regime posture
          target. The stable sleeve carries the dry powder; the aggressive
          sleeve is capped in v1.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {sorted.map((sleeve) => (
          <SleeveCard key={sleeve.category} sleeve={sleeve} />
        ))}
      </div>
    </section>
  );
}

function SleeveCard({ sleeve }: { sleeve: Sleeve }) {
  const meta = SLEEVE_META[sleeve.category];
  const Icon = meta.icon;
  const currentPct = sleeve.currentWeightBps / 100;
  const targetPct = sleeve.targetWeightBps / 100;
  const floorPct = sleeve.floorBps ? sleeve.floorBps / 100 : null;
  const capPct = sleeve.capBps ? sleeve.capBps / 100 : null;

  // Drift: target - current. Positive = under-target (add); negative =
  // over-target (reduce). Used to pick the bar color tone so the owner
  // sees the direction at a glance.
  const driftBps = sleeve.targetWeightBps - sleeve.currentWeightBps;
  const driftTone =
    Math.abs(driftBps) <= 500
      ? "allow"
      : driftBps > 0
        ? "warn"
        : "reject";
  const driftLabel =
    driftBps > 500
      ? "under target — add"
      : driftBps < -500
        ? "over target — reduce"
        : "at target";

  // Bar max — same as the dry powder meter so the two are visually
  // consistent. 60% gives the 4-sleeve view enough headroom without
  // making the 10% aggressive cap invisible.
  const barMax = 60;
  const clamp = (v: number) => Math.max(0, Math.min(100, (v / barMax) * 100));
  const valuePct = clamp(currentPct);
  const targetMarkerPct = clamp(targetPct);
  const floorMarkerPct = floorPct !== null ? clamp(floorPct) : null;
  const capMarkerPct = capPct !== null ? clamp(capPct) : null;

  return (
    <Card
      className={`${meta.tint} relative overflow-hidden border-l-2`}
      aria-labelledby={`sleeve-${sleeve.category}-title`}
    >
      <CardHeader className="gap-2 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="size-4 text-muted-foreground" aria-hidden />
            <h3
              id={`sleeve-${sleeve.category}-title`}
              className="font-serif text-lg font-semibold tracking-tight"
            >
              {meta.name}
            </h3>
          </div>
          <Badge
            variant="outline"
            className={`text-[10px] ${
              driftTone === "allow"
                ? "bg-allow/10 text-allow-foreground border-allow/40"
                : driftTone === "warn"
                  ? "bg-warn/10 text-warn-foreground border-warn/40"
                  : "bg-reject/10 text-reject-foreground border-reject/40"
            }`}
          >
            {driftLabel}
          </Badge>
        </div>
        <Separator className="house-hairline" />
      </CardHeader>

      <CardContent className="flex flex-col gap-4 p-5 pt-0">
        {/* Current vs target numerals. */}
        <div className="flex items-end justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              current
            </span>
            <p className="font-serif text-3xl font-bold tracking-tight house-num">
              {currentPct.toFixed(2)}
              <span className="ml-0.5 text-base text-muted-foreground">%</span>
            </p>
            <span className="text-[10px] text-muted-foreground">
              <span className="house-num">{sleeve.currentWeightBps}</span> bps
            </span>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              target
            </span>
            <p className="font-mono text-sm text-muted-foreground house-num">
              {targetPct.toFixed(2)}
              <span className="ml-0.5 text-[10px]">%</span>
            </p>
            <span className="text-[10px] text-muted-foreground">
              <span className="house-num">{sleeve.targetWeightBps}</span> bps
            </span>
          </div>
        </div>

        {/* Bar. */}
        <div className="relative">
          <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r ${meta.barFrom} ${meta.barTo}`}
              style={{ width: `${valuePct}%` }}
              aria-hidden
            />
            {floorMarkerPct !== null && (
              <SleeveMarker pct={floorMarkerPct} tone="warn" label="floor" />
            )}
            <SleeveMarker
              pct={targetMarkerPct}
              tone="allow"
              label="target"
            />
            {capMarkerPct !== null && (
              <SleeveMarker pct={capMarkerPct} tone="reject" label="cap" />
            )}
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>0%</span>
            <span className="house-num">{barMax}%</span>
          </div>
        </div>

        {/* Floor / cap chips + assets. */}
        <div className="flex flex-wrap items-center gap-2">
          {sleeve.floorBps !== undefined && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="bg-warn/5 text-warn-foreground border-warn/40 text-[10px]"
                  >
                    floor {sleeve.floorBps / 100}%
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[14rem]">
                  <p className="text-xs leading-relaxed">
                    Hard floor. Below this is a breach of the dry-powder
                    principle.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {sleeve.capBps !== undefined && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="bg-reject/5 text-reject-foreground border-reject/40 text-[10px]"
                  >
                    cap {sleeve.capBps / 100}%
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[14rem]">
                  <p className="text-xs leading-relaxed">
                    v1 cap. Above this is a soft breach — the owner should
                    trim the sleeve at the next rebalance.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        {/* Assets. */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            assets held
          </span>
          {sleeve.assets.length > 0 ? (
            <p className="font-mono text-xs text-foreground">
              {sleeve.assets.join(", ")}
            </p>
          ) : (
            <p className="font-mono text-xs text-muted-foreground">
              no positions in this sleeve
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** A small vertical tick mark on the sleeve bar. */
function SleeveMarker({
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
      className="absolute top-1/2 z-10 h-4 w-px -translate-y-1/2"
      style={{ left: `${pct}%` }}
    >
      <div className={`absolute inset-0 ${color}`} aria-hidden />
    </div>
  );
}

// Re-export so callers can import the per-sleeve meta if needed.
export type { Sleeve, RiskCategory };
