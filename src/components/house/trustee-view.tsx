"use client";

import * as React from "react";
import { ShieldCheck, ShieldAlert, Bot, FileText } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import { AiOperatorPanel } from "./ai-operator-panel";
import { TrustHeaderStrip } from "./trust-header-strip";
import type { TrustSummary } from "./types";

/**
 * TrusteeView (Task 51) — the "control room" tab for trust governance.
 *
 * Per eier direction:
 *   "I want everything related to the controls for AI-Trustee (second
 *    advisor and safety protocol) to be relocated into its own tab."
 *
 * This tab consolidates ALL AI / safety controls in one place:
 *   1. TrustHeaderStrip — trust name + mode chip + AI-role chip +
 *      kill-switch status.
 *   2. AiOperatorPanel — the "Call upon AI to operate" switch, mandate
 *      countdown, revoke button. This is the primary control surface.
 *   3. Safety Protocol card — explains the policy gate (8 checks),
 *      the intent schema (the only executable shape), and the mode
 *      ladder (Observe → House). Read-only reference; the controls
 *      above are the live surface.
 *
 * The Portfolio tab no longer shows these controls — the pie chart is
 * the first thing the trustee sees when landing (per eier direction).
 * This tab is where the trustee goes when they want to change the AI's
 * role or check the safety posture.
 */

/** The 8 policy-gate checks (mirrors src/server/services/policy-engine.ts). */
const POLICY_CHECKS = [
  { name: "kill-switch", desc: "If active, immediately reject. Stops all trade paths." },
  { name: "universe", desc: "Asset must be in the mandate universe." },
  { name: "ethics", desc: "Hard excludes — sanctioned, mixers, unverified contracts." },
  { name: "leverage", desc: "Total exposure must not exceed the leverage cap (1.0x default)." },
  { name: "concentration", desc: "Single-asset weight + venue concentration within caps." },
  { name: "drawdown", desc: "If drawdown > cap, only transfer-to-stables allowed." },
  { name: "daily-turnover", desc: "Running turnover + this notional within daily cap." },
  { name: "venue-health", desc: "Venue must be healthy — price dislocation halts the book." },
];

export interface TrusteeViewProps {
  /** The current trust state — forwarded to AiOperatorPanel. */
  trust: TrustSummary;
  /** Forwarded to AiOperatorPanel (mode switch handler). */
  onTrustUpdate: (next: TrustSummary) => void;
}

/**
 * Render the Trustee tab — the control room for AI governance + safety.
 */
export function TrusteeView({ trust, onTrustUpdate }: TrusteeViewProps) {
  return (
    <div className="flex flex-col gap-6">
      {/* ---- Trust header strip (mode + AI role + kill switch) --------- */}
      <Card className="relative overflow-hidden">
        <CardContent className="flex flex-col gap-3 p-4 sm:p-6">
          <TrustHeaderStrip trust={trust} />
          <p className="text-xs leading-relaxed text-muted-foreground">
            The AI inside this trust acts as <strong>advisor</strong> by
            default — it proposes, the policy gate decides. Call upon it
            to <strong>operate</strong> (House mode) when you want it to
            emit intents subject to the safety protocol below. The
            mandate is time-boxed and reversible.
          </p>
        </CardContent>
      </Card>

      {/* ---- AI Operator Panel (the switch) ------------------------------ */}
      <AiOperatorPanel trust={trust} onTrustUpdate={onTrustUpdate} />

      {/* ---- Safety Protocol reference ---------------------------------- */}
      <Card>
        <CardHeader className="gap-2 p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-allow-foreground" aria-hidden />
            <CardTitle className="font-serif text-lg font-bold tracking-tight">
              Safety protocol
            </CardTitle>
          </div>
          <p className="text-xs text-muted-foreground">
            The policy engine gates every intent — whether from the AI
            operator or the rules engine. No intent reaches the signer
            without passing all 8 checks below.
          </p>
        </CardHeader>
        <Separator className="house-hairline" />
        <CardContent className="p-6 pt-0">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {POLICY_CHECKS.map((check, i) => (
              <div
                key={check.name}
                className="flex items-start gap-3 rounded-md border border-border/60 bg-card/40 p-3"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-allow/10 text-[10px] font-bold text-allow-foreground house-num">
                  {i + 1}
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-xs font-semibold text-foreground">
                    {check.name}
                  </span>
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    {check.desc}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <Separator className="house-hairline my-4" />

          {/* Intent schema reference */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-muted-foreground" aria-hidden />
              <span className="font-serif text-sm font-semibold tracking-tight">
                Intent schema
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              The only shape the AI may emit, the policy engine accepts,
              and the signer may sign. Model output is never executed as
              text — only the intent schema is executable.
            </p>
            <div className="rounded-md border border-border/60 bg-muted/30 p-3">
              <code className="font-mono text-[10px] leading-relaxed text-muted-foreground">
                {"{ asset, side, venue, notional, maxSlippage, expiry, reasonCode }"}
              </code>
            </div>
          </div>

          <Separator className="house-hairline my-4" />

          {/* Mode ladder */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Bot className="size-4 text-muted-foreground" aria-hidden />
              <span className="font-serif text-sm font-semibold tracking-tight">
                Mode ladder
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Every account has exactly one mode. Moving up requires a
              fresh confirmation; moving down is always immediate.
            </p>
            <div className="flex flex-wrap gap-2">
              {["Observe", "Advise", "Confirm", "Rules", "House"].map(
                (mode, i) => {
                  const isCurrent =
                    trust.mode.toLowerCase() === mode.toLowerCase();
                  return (
                    <Badge
                      key={mode}
                      variant="outline"
                      className={`text-[10px] uppercase tracking-widest ${
                        isCurrent
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border bg-muted text-muted-foreground"
                      }`}
                    >
                      <span className="house-num">{i + 1}</span>
                      {mode}
                      {isCurrent && (
                        <span className="ml-1 text-[8px] font-bold uppercase">
                          ●
                        </span>
                      )}
                    </Badge>
                  );
                },
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
