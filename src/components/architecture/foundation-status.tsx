"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Activity,
  CircleDashed,
  ArrowRight,
} from "lucide-react";
import type { FoundationStatusBannerProps } from "./types";

// ---------------------------------------------------------------------------
// Top-of-page banner. Product wordmark + tagline + current phase + next
// phase + a single status line. The status line tells the reader exactly
// what state the build is in — "Foundation ready, Observe not yet wired."
// ---------------------------------------------------------------------------

export function FoundationStatusBanner({
  product,
  phase,
}: FoundationStatusBannerProps) {
  return (
    <Card
      id="foundation-status"
      className="overflow-hidden"
      aria-labelledby="foundation-status-title"
    >
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="bg-warn/10 text-warn-foreground"
          >
            <CircleDashed className="size-3" />
            Foundation build
          </Badge>
          <Badge variant="outline" className="text-muted-foreground">
            v{product.version}
          </Badge>
          <Badge
            variant="outline"
            className="bg-allow/10 text-allow-foreground"
          >
            <Activity className="size-3" />
            Non-custody · trade keys not connected
          </Badge>
        </div>

        <div className="flex flex-col gap-1">
          <h1
            id="foundation-status-title"
            className="font-serif text-4xl font-bold tracking-tight sm:text-5xl"
          >
            {product.name}
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
            {product.tagline}
          </p>
        </div>

        <Separator />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Current phase
            </div>
            <div className="mt-1 font-mono text-sm font-medium">
              {phase.current}
            </div>
          </div>
          <div className="flex items-center justify-center">
            <ArrowRight
              className="size-5 rotate-90 text-muted-foreground sm:rotate-0"
              aria-hidden
            />
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Next phase
            </div>
            <div className="mt-1 font-mono text-sm font-medium">
              {phase.next}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div
          className="rounded-md border bg-allow/5 p-4"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-allow-foreground">
              Foundation ready
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              Observe not yet wired
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              Paper decision log not yet reviewed
            </span>
          </div>
          <CardDescription className="mt-2">
            Mandate schema and intent schema are landed. Domain types and
            service contracts are scaffolded (every service is a stub). The
            next step is to stand up Observe against one exchange and one
            wallet — no trade key is connected until the paper decision log
            from Phase 2 has been reviewed for a week.
          </CardDescription>
        </div>
      </CardContent>
    </Card>
  );
}
