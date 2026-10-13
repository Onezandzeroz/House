"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info, ShieldCheck, ShieldAlert } from "lucide-react";

import type { BankrollSnapshotProps } from "./types";

/**
 * BankrollSnapshot — three small cards in a row at the top of the
 * Advisory Dashboard, just under the RegimeBanner.
 *
 *   - NAV          — mark-to-book-currency net asset value, large serif
 *                    numeral with .house-num so columns align.
 *   - House Edge   — weighted sum of (sleeve.edge × sleeve.weight) per
 *                    rebalance cycle, in bps. Compared against
 *                    `principles.targetHouseEdgeBps` ("stable profit").
 *   - Mode         — the current operating mode. v0 hardcodes
 *                    "Observe (foundation)" because /api/foundation does
 *                    not surface a mode field yet (Phase 1 Observe
 *                    wires it). When a real BookState.mode is exposed,
 *                    the snapshot reads it from the foundation payload.
 *
 * Plan coverage:
 *   - owner direction (Task 6): "gro værdien af porteføljen" — the
 *     house edge card makes the expected growth rate visible.
 *   - plan §2: the mode ladder (Observe is the v0 mode).
 *   - src/server/domain/advisory.ts: AdvisoryOpinion.nav +
 *     AdvisoryOpinion.houseEdgeBps + AdvisoryOpinion.principles.
 *
 * Layout: a 1-column grid on mobile, 3 columns on desktop. The cards
 * stay short so the dry-powder meter below is the visual anchor.
 */

// The foundation API does not yet expose a `mode` field. v0 hardcodes
// the mode to "Observe (foundation)" because the demo book is in
// Advise but the UI's role in v0 is still observation-only — no
// execution path exists. When /api/foundation surfaces a mode, the
// snapshot reads it from the foundation payload.
const FOUNDATION_MODE = {
  name: "Observe",
  qualifier: "foundation",
  detail: "Read-only. No execution path. Trade keys not yet connected.",
};

export function BankrollSnapshot({
  nav,
  houseEdgeBps,
  principles,
  killSwitchActive,
}: BankrollSnapshotProps) {
  // Edge vs the "stable profit" target. Above-target = healthy
  // (emerald); at-target ± 10 bps = healthy; below = warn (amber).
  const targetEdge = principles.targetHouseEdgeBps;
  const edgeDelta = houseEdgeBps - targetEdge;
  const edgeHealthy =
    Number.isFinite(edgeDelta) && Math.abs(edgeDelta) <= 10;
  const edgeAbove = Number.isFinite(edgeDelta) && edgeDelta > 10;
  const edgeTint = edgeHealthy
    ? "border-allow/40 bg-allow/5"
    : edgeAbove
      ? "border-allow/40 bg-allow/10"
      : "border-warn/40 bg-warn/5";

  return (
    <section
      aria-label="Bankroll snapshot"
      className="grid grid-cols-1 gap-4 md:grid-cols-3"
    >
      {/* NAV card. */}
      <Card
        aria-labelledby="snapshot-nav-label"
        className="relative overflow-hidden"
      >
        <CardContent className="flex flex-col gap-1 p-5">
          <div className="flex items-center justify-between">
            <span
              id="snapshot-nav-label"
              className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
            >
              Net asset value
            </span>
            <Badge
              variant="outline"
              className="border-border bg-muted text-[10px] text-muted-foreground"
            >
              mark-to-book
            </Badge>
          </div>
          <p className="font-serif text-4xl font-semibold tracking-tight house-num text-primary">
            {nav}
          </p>
          <p className="text-xs text-muted-foreground">
            Book currency. Sum of position quantity × reference mark.
          </p>
        </CardContent>
      </Card>

      {/* House edge card. */}
      <Card
        aria-labelledby="snapshot-edge-label"
        className={`relative overflow-hidden ${edgeTint}`}
      >
        <CardContent className="flex flex-col gap-1 p-5">
          <div className="flex items-center justify-between">
            <span
              id="snapshot-edge-label"
              className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
            >
              House edge
            </span>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    aria-label="What is the house edge?"
                  >
                    <Info className="size-3.5" aria-hidden />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[16rem]">
                  <p className="text-xs leading-relaxed">
                    Expected growth per rebalance cycle, weighted by sleeve
                    weight. Compared against the {targetEdge} bps target
                    (&ldquo;stable profit&rdquo;).
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <p className="font-serif text-4xl font-semibold tracking-tight house-num text-primary">
            {houseEdgeBps.toFixed(2)}
            <span className="ml-1 text-base text-muted-foreground">bps</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {edgeHealthy && "At target posture."}
            {edgeAbove && "Above target — tilt is paying."}
            {!edgeHealthy && !edgeAbove && "Below target — review posture."}
          </p>
        </CardContent>
      </Card>

      {/* Mode card. */}
      <Card
        aria-labelledby="snapshot-mode-label"
        className={`relative overflow-hidden ${
          killSwitchActive
            ? "border-reject/60 bg-reject/10"
            : "border-allow/40 bg-allow/5"
        }`}
      >
        <CardContent className="flex flex-col gap-1 p-5">
          <div className="flex items-center justify-between">
            <span
              id="snapshot-mode-label"
              className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
            >
              Operating mode
            </span>
            {killSwitchActive ? (
              <ShieldAlert
                className="size-4 text-reject-foreground"
                aria-hidden
              />
            ) : (
              <ShieldCheck
                className="size-4 text-allow-foreground"
                aria-hidden
              />
            )}
          </div>
          <p className="font-serif text-4xl font-semibold tracking-tight text-primary">
            {FOUNDATION_MODE.name}
            <span className="ml-2 text-base text-muted-foreground">
              ({FOUNDATION_MODE.qualifier})
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            {killSwitchActive
              ? "Kill switch active. Trade permission revoked."
              : FOUNDATION_MODE.detail}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
