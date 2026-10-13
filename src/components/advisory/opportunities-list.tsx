"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Sparkles } from "lucide-react";

import type { OpportunitiesListProps } from "./types";
import type { Opportunity } from "@/server/domain/advisory";

/**
 * OpportunitiesList — within-principles proposals.
 *
 * Distinct from WarningsList: an Opportunity is something the owner MAY
 * want to do; a Warning is something the owner SHOULD NOT do. The
 * policy gate would accept an opportunity-shaped intent (subject to
 * the normal checks); a warning-shaped intent would be rejected.
 *
 * Rendered ONLY if `opportunities.length > 0`. If the advisor has no
 * within-principles proposals for the current regime / dry-powder
 * state, this card is omitted entirely (no "no opportunities" message
 * — that would be noise).
 *
 * Plan coverage:
 *   - owner direction (Task 6): "rådgive muligheter" — the
 *     Opportunities array is the advisor&apos;s within-principles
 *     proposals.
 *   - src/server/domain/advisory.ts: Opportunity.
 */

const WINDOW_META: Record<
  Opportunity["window"],
  { label: string; chip: string }
> = {
  now: {
    label: "now",
    chip: "bg-reject/10 text-reject-foreground border-reject/40",
  },
  "this-week": {
    label: "this week",
    chip: "bg-warn/10 text-warn-foreground border-warn/40",
  },
  "this-month": {
    label: "this month",
    chip: "bg-muted text-muted-foreground border-border",
  },
};

export function OpportunitiesList({ opportunities }: OpportunitiesListProps) {
  if (opportunities.length === 0) return null;

  return (
    <Card
      id="opportunities"
      className="scroll-mt-24"
      aria-labelledby="opportunities-title"
    >
      <CardHeader className="gap-3 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-muted-foreground">
            <Sparkles className="size-3" aria-hidden />
            opportunities
          </Badge>
          <Badge
            variant="outline"
            className="bg-allow/10 text-allow-foreground border-allow/40"
          >
            <span className="house-num">{opportunities.length}</span> within principles
          </Badge>
        </div>
        <CardTitle
          id="opportunities-title"
          className="font-serif text-2xl font-bold tracking-tight"
        >
          Opportunities
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Within-principles proposals. Each one the policy gate would accept,
          subject to the normal checks. Review and decide — these are not
          executable yet.
        </p>
        <Separator className="house-hairline" />
      </CardHeader>

      <CardContent className="p-6 pt-0">
        <ul className="flex flex-col gap-3">
          {opportunities.map((opp) => {
            const win = WINDOW_META[opp.window];
            const confPct = Math.round(opp.confidence * 100);
            return (
              <li key={opp.id}>
                <article
                  className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card p-4"
                  aria-labelledby={`opp-${opp.id}-title`}
                >
                  <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex flex-col gap-1">
                      <h4
                        id={`opp-${opp.id}-title`}
                        className="font-serif text-lg font-semibold tracking-tight"
                      >
                        {opp.title}
                      </h4>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${win.chip}`}
                        >
                          {win.label}
                        </Badge>
                        {opp.assetId && (
                          <Badge
                            variant="outline"
                            className="text-[10px] border-border bg-muted text-muted-foreground font-mono"
                          >
                            {opp.assetId}
                          </Badge>
                        )}
                        {opp.riskCategory && (
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              opp.riskCategory === "stable"
                                ? "bg-allow/10 text-allow-foreground border-allow/40"
                                : opp.riskCategory === "conservative"
                                  ? "bg-primary/10 text-primary-foreground border-primary/40"
                                  : opp.riskCategory === "balanced"
                                    ? "bg-warn/10 text-warn-foreground border-warn/40"
                                    : "bg-reject/10 text-reject-foreground border-reject/40"
                            }`}
                          >
                            {opp.riskCategory}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        expected edge
                      </span>
                      <p className="font-serif text-2xl font-bold tracking-tight house-num text-allow-foreground">
                        +{opp.expectedEdgeBps}
                        <span className="ml-1 text-sm text-muted-foreground">
                          bps
                        </span>
                      </p>
                    </div>
                  </header>

                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {opp.description}
                  </p>

                  <footer className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
                      <span>confidence</span>
                      <span className="house-num text-foreground">
                        {confPct}%
                      </span>
                    </div>
                    <Progress value={confPct} className="h-1.5" />
                  </footer>
                </article>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
