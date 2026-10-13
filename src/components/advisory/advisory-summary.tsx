"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import type { AdvisorySummaryProps } from "./types";
import { formatAsOf } from "./types";

/**
 * AdvisorySummary — the closing one-liner of the Advisory Dashboard.
 *
 * Renders the advisor&apos;s `summary` (one sentence: regime + NAV +
 * dry powder + edge + posture) in serif italic, plus the as-of
 * timestamp in .house-num muted. The summary is the advisor&apos;s
 * bottom line: a single sentence the owner can read in one glance.
 *
 * Plan coverage:
 *   - src/server/domain/advisory.ts: AdvisoryOpinion.summary + asOf.
 *   - owner direction (Task 6): one-sentence posture the owner can
 *     glance at.
 */

export function AdvisorySummary({ summary, asOf }: AdvisorySummaryProps) {
  const asOfString =
    asOf instanceof Date ? asOf.toISOString() : String(asOf);
  return (
    <Card
      id="advisory-summary"
      className="scroll-mt-24 border-border/60 bg-muted/20"
      aria-labelledby="advisory-summary-title"
    >
      <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span
            id="advisory-summary-title"
            className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
          >
            Bottom line
          </span>
          <p className="font-serif text-base font-medium italic leading-snug tracking-tight">
            &ldquo;{summary}&rdquo;
          </p>
        </div>
        <Badge
          variant="outline"
          className="self-start border-border bg-muted text-muted-foreground sm:self-auto"
        >
          as of{" "}
          <span className="house-num text-foreground">
            {formatAsOf(asOfString)}
          </span>
        </Badge>
      </CardContent>
    </Card>
  );
}
