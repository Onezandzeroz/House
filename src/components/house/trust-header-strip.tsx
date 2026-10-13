"use client";

import { Bot, ShieldAlert, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import {
  TRUST_MODE_META,
  TONE_CHIP_CLASS,
  type TrustSummary,
} from "./types";

/**
 * TrustHeaderStrip — the compact, in-page status line rendered at the
 * top of the Overview tab.
 *
 * Renders, left to right:
 *   1. Trust name (serif gold)            — the trust's human name.
 *   2. "Family Reserve" subtitle (mono)   — the product line, house-style.
 *   3. Mode chip                          — Observe / Advise / Confirm /
 *                                            Rules / House, with tone per
 *                                            the advisory status palette.
 *   4. AI-role chip                       — Advisor / Operator / Halted.
 *                                            Kill switch overrides both.
 *
 * The strip is the at-a-glance signal for the owner: they see the
 * trust's mode AND the AI's posture in one row. The pie chart and the
 * AI operator panel carry the deeper state.
 *
 * The strip wraps on mobile (390px viewport): trust name + subtitle
 * on the first line; chips wrap to the second line. The chips use
 * `Badge` so they inherit the existing chip component's focus styling.
 *
 * Spec source: Task 15 `trust-header-strip.tsx`.
 */
export interface TrustHeaderStripProps {
  /** The current trust state. Read-only — chips reflect it, never mutate. */
  trust: TrustSummary;
}

/**
 * Render the header strip. Pure presentation; no state of its own.
 */
export function TrustHeaderStrip({ trust }: TrustHeaderStripProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="font-serif text-2xl font-bold tracking-tight text-primary">
        {trust.name}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        Family Reserve
      </span>
      <ModeChip mode={trust.mode} />
      <AiRoleChip
        aiRole={trust.aiRole}
        killSwitchActive={trust.killSwitchActive}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModeChip — the trust's operating mode (plan §2). Tone per TRUST_MODE_META.
// ---------------------------------------------------------------------------

function ModeChip({ mode }: { mode: TrustSummary["mode"] }) {
  const meta = TRUST_MODE_META[mode];
  const cls = TONE_CHIP_CLASS[meta.tone];
  return (
    <Badge
      variant="outline"
      className={`text-[10px] uppercase tracking-widest ${cls}`}
      aria-label={`Operating mode: ${meta.label}`}
    >
      {meta.label} mode
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// AiRoleChip — the AI's role inside the trust (advisor / operator /
// halted). Kill switch overrides everything because it blocks ALL trade
// paths (plan §3) — showing "Advisor" while the kill switch is active
// would have been misleading. Mirrors the policy in
// portfolio-summary-strip's AiRoleCell.
// ---------------------------------------------------------------------------

function AiRoleChip({
  aiRole,
  killSwitchActive,
}: {
  aiRole: TrustSummary["aiRole"];
  killSwitchActive: boolean;
}) {
  if (killSwitchActive) {
    return (
      <Badge
        variant="outline"
        className="bg-reject/15 text-reject-foreground border-reject/40 text-[10px] uppercase tracking-widest"
        aria-label="AI role: Halted (kill switch active)"
      >
        <ShieldAlert className="size-3" aria-hidden />
        Halted
      </Badge>
    );
  }
  if (aiRole === "operator") {
    return (
      <Badge
        variant="outline"
        className="bg-operator/15 text-operator border-operator/40 text-[10px] uppercase tracking-widest house-pulse-operator"
        aria-label="AI role: Operator (House mode)"
      >
        <Bot className="size-3" aria-hidden />
        Operator
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="bg-allow/15 text-allow-foreground border-allow/40 text-[10px] uppercase tracking-widest"
      aria-label="AI role: Advisor"
    >
      <ShieldCheck className="size-3" aria-hidden />
      Advisor
    </Badge>
  );
}
