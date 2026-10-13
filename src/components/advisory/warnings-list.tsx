"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";

import type { WarningsListProps } from "./types";
import type { Warning } from "@/server/domain/advisory";

/**
 * WarningsList — outside-principles proposals.
 *
 * Owner&apos;s words (Task 6):
 *   "advarsler i mod handlingar der falder ude for principper som 30%
 *    'tør krudt' ... og lignende regler for et stabilt profit."
 *
 * Each warning carries a severity (info / warn / critical), a stable
 * `code` the UI groups by, a title, a message, and a remediation
 * block. Critical warnings get a left-border in rose, warn in amber,
 * info in muted.
 *
 * Rendered ONLY if `warnings.length > 0`. If the book is within all
 * principles, this card is omitted entirely.
 *
 * Plan coverage:
 *   - owner direction (Task 6): advarsler against outside-principles
 *     actions.
 *   - src/server/domain/advisory.ts: Warning + severity.
 */

const SEVERITY_META: Record<
  Warning["severity"],
  {
    label: string;
    chip: string;
    border: string; // left-border accent
    icon: React.ComponentType<{ className?: string }>;
    iconClass: string;
    remediationLabel: string;
  }
> = {
  info: {
    label: "info",
    chip: "bg-muted text-muted-foreground border-border",
    border: "border-l-border",
    icon: Info,
    iconClass: "text-muted-foreground",
    remediationLabel: "Note",
  },
  warn: {
    label: "warn",
    chip: "bg-warn/15 text-warn-foreground border-warn/40",
    border: "border-l-warn/60",
    icon: AlertCircle,
    iconClass: "text-warn-foreground",
    remediationLabel: "Remediation",
  },
  critical: {
    label: "critical",
    chip: "bg-reject/15 text-reject-foreground border-reject/40",
    border: "border-l-reject",
    icon: AlertTriangle,
    iconClass: "text-reject-foreground",
    remediationLabel: "Remediation",
  },
};

export function WarningsList({ warnings }: WarningsListProps) {
  if (warnings.length === 0) return null;

  // Sort so critical warnings land first — the owner sees the worst
  // breaches before the soft ones.
  const sorted = [...warnings].sort((a, b) => {
    const rank: Record<Warning["severity"], number> = {
      critical: 0,
      warn: 1,
      info: 2,
    };
    return rank[a.severity] - rank[b.severity];
  });

  const criticalCount = warnings.filter(
    (w) => w.severity === "critical",
  ).length;
  const warnCount = warnings.filter((w) => w.severity === "warn").length;
  const infoCount = warnings.filter((w) => w.severity === "info").length;

  return (
    <Card
      id="warnings"
      className="scroll-mt-24"
      aria-labelledby="warnings-title"
    >
      <CardHeader className="gap-3 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-muted-foreground">
            outside principles
          </Badge>
          {criticalCount > 0 && (
            <Badge
              variant="outline"
              className="bg-reject/15 text-reject-foreground border-reject/40"
            >
              <span className="house-num">{criticalCount}</span> critical
            </Badge>
          )}
          {warnCount > 0 && (
            <Badge
              variant="outline"
              className="bg-warn/15 text-warn-foreground border-warn/40"
            >
              <span className="house-num">{warnCount}</span> warn
            </Badge>
          )}
          {infoCount > 0 && (
            <Badge
              variant="outline"
              className="bg-muted text-muted-foreground border-border"
            >
              <span className="house-num">{infoCount}</span> info
            </Badge>
          )}
        </div>
        <CardTitle
          id="warnings-title"
          className="font-serif text-2xl font-bold tracking-tight"
        >
          Warnings
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Actions OUTSIDE principles. The owner SHOULD reject whatever the
          warning flags. Critical warnings mean force-de-risk; warn means a
          soft breach recoverable at the next rebalance; info means
          something is worth surfacing but not a breach.
        </p>
        <Separator className="house-hairline" />
      </CardHeader>

      <CardContent className="p-6 pt-0">
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {sorted.map((w) => {
            const meta = SEVERITY_META[w.severity];
            const Icon = meta.icon;
            return (
              <li key={w.id}>
                <article
                  className={`flex h-full flex-col gap-3 rounded-lg border border-l-2 border-border/60 bg-card p-4 ${meta.border}`}
                  aria-labelledby={`warn-${w.id}-title`}
                >
                  <header className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Icon className={`size-4 ${meta.iconClass}`} aria-hidden />
                      <h4
                        id={`warn-${w.id}-title`}
                        className="font-serif text-base font-semibold tracking-tight"
                      >
                        {w.title}
                      </h4>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${meta.chip}`}
                    >
                      {meta.label}
                    </Badge>
                  </header>

                  <p className="text-xs leading-relaxed text-foreground/90">
                    {w.message}
                  </p>

                  <footer className="mt-auto rounded-md border border-border/40 bg-muted/40 p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {meta.remediationLabel}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {w.remediation}
                    </p>
                    <p className="mt-2 text-[10px] font-mono text-muted-foreground">
                      code: <span className="house-num">{w.code}</span>
                    </p>
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
