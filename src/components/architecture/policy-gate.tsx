"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ShieldX,
  ArrowDownToLine,
  Check,
  ArrowRight,
} from "lucide-react";
import type { PolicyGateProps } from "./types";

// ---------------------------------------------------------------------------
// The 8-check policy gate (plan §3, §10). The engine runs the checks in
// the canonical order shown here. On the first `reject`, it stops; on a
// `resize`, it composes the resized intent and continues; if all pass,
// the verdict is `allow`.
//
// Visual: a numbered vertical list with the order on the left, the check
// name in the middle, and the behaviour text below. A small flow legend
// at the top shows the three possible verdicts.
// ---------------------------------------------------------------------------

const VERDICTS = [
  {
    icon: ShieldX,
    label: "reject",
    detail: "Engine stops. Intent is logged.",
    tint: "bg-reject/10 text-reject-foreground",
  },
  {
    icon: ArrowDownToLine,
    label: "resize",
    detail: "Engine composes the resized intent and continues.",
    tint: "bg-warn/10 text-warn-foreground",
  },
  {
    icon: Check,
    label: "allow",
    detail: "Intent reaches the signer.",
    tint: "bg-allow/10 text-allow-foreground",
  },
] as const;

export function PolicyGate({ checks }: PolicyGateProps) {
  return (
    <Card
      id="policy-gate"
      className="scroll-mt-20"
      aria-labelledby="policy-gate-title"
    >
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-muted-foreground">
            plan §3 · §10
          </Badge>
          <Badge variant="outline" className="text-muted-foreground">
            src/server/services/policy-engine.ts
          </Badge>
        </div>
        <CardTitle id="policy-gate-title" className="font-serif text-2xl">
          Policy gate — the 8 checks
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          The rule that makes the AI safe to add later. Pure function from
          book state plus mandate to allow, resize, or reject. The signer is
          the only component that may turn an accepted intent into a signature
          — this engine never calls the signer.
        </p>
      </CardHeader>
      <CardContent>
        {/* Verdict flow legend */}
        <div
          className="mb-6 grid grid-cols-1 gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-3"
          aria-label="Verdict flow"
        >
          {VERDICTS.map((v, i) => {
            const Icon = v.icon;
            return (
              <div
                key={v.label}
                className="flex items-center gap-3"
              >
                <div
                  className={`flex size-8 shrink-0 items-center justify-center rounded-md ${v.tint}`}
                  aria-hidden
                >
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold">
                      {v.label}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {v.detail}
                  </p>
                </div>
                {i < VERDICTS.length - 1 && (
                  <ArrowRight
                    className="ml-auto hidden size-4 shrink-0 text-muted-foreground sm:block"
                    aria-hidden
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* The numbered gate */}
        <ol
          className="flex flex-col"
          aria-label="Policy checks in canonical order"
        >
          {checks.map((check, i) => {
            const isLast = i === checks.length - 1;
            return (
              <li
                key={check.name}
                className="relative flex gap-4 pb-4"
              >
                {/* Step number with connector */}
                <div className="flex flex-col items-center">
                  <div
                    className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-background font-mono text-sm font-semibold"
                    aria-label={`Check ${check.order}`}
                  >
                    {check.order}
                  </div>
                  {!isLast && (
                    <div
                      className="mt-1 w-px flex-1 bg-border"
                      aria-hidden
                    />
                  )}
                </div>

                {/* Body */}
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h3 className="font-mono text-base font-semibold">
                      {check.name}
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {check.behavior}
                  </p>
                  {!isLast && <Separator className="hidden" />}
                </div>
              </li>
            );
          })}
        </ol>

        <div className="mt-2 rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
          <p>
            The check order is normative. Kill switch first, universe before
            ethics, drawdown before turnover. Reordering them changes what a
            replay returns.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
