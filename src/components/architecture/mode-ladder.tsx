"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info, ArrowRight, ChevronRight } from "lucide-react";
import type { ModeLadderProps } from "./types";

// ---------------------------------------------------------------------------
// The 5-mode ladder (plan §2). Lowest to highest: Observe, Advise,
// Confirm, Rules, House. Confirm is the default product. Each step
// shows what runs in that mode, who signs, and the signer kind.
//
// Mobile: stacked vertical timeline (a column of cards connected by a
// vertical rule). Desktop: horizontal (a row of cards connected by a
// horizontal rule). The default-mode badge sits on the Confirm step.
// ---------------------------------------------------------------------------

const SIGNER_LABEL: Record<string, string> = {
  none: "Nobody signs",
  user: "User signs",
  "session-key": "Session key signs",
};

const SIGNER_TINT: Record<string, string> = {
  none: "bg-muted text-muted-foreground",
  user: "bg-warn/10 text-warn-foreground",
  "session-key": "bg-allow/10 text-allow-foreground",
};

// Stair-step intensity — the further up the ladder, the more permissive.
// We use background tints to make the ladder visually climb from light
// to dark-accent.
const STEP_ACCENT: string[] = [
  "bg-muted/40",
  "bg-muted/60",
  "bg-allow/10",
  "bg-allow/15",
  "bg-allow/20",
];

export function ModeLadder({ modes }: ModeLadderProps) {
  return (
    <Card
      id="mode-ladder"
      className="scroll-mt-20"
      aria-labelledby="mode-ladder-title"
    >
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-muted-foreground">
            plan §2
          </Badge>
          <Badge
            variant="outline"
            className="bg-allow/10 text-allow-foreground"
          >
            Default: Confirm
          </Badge>
        </div>
        <CardTitle id="mode-ladder-title" className="font-serif text-2xl">
          Operating modes — the ladder
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Every account has exactly one mode. Moving up requires a fresh
          confirmation and a tighter permission grant. Moving down is always
          immediate. House mode is Rules mode with the proposal source swapped
          from a ruleset to the AI service — not a second product.
        </p>
      </CardHeader>
      <CardContent>
        {/* Mobile: vertical timeline */}
        <ol
          className="flex flex-col gap-0 md:hidden"
          aria-label="Mode ladder, lowest to highest"
        >
          {modes.map((mode, i) => {
            const isLast = i === modes.length - 1;
            return (
              <li
                key={mode.key}
                className={`relative flex flex-col gap-3 rounded-lg border p-4 ${STEP_ACCENT[i] ?? "bg-muted/40"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <h3 className="font-mono text-base font-semibold">
                        {mode.name}
                      </h3>
                      {mode.defaultFor === "confirm" && (
                        <Badge
                          variant="outline"
                          className="bg-allow/10 text-allow-foreground"
                        >
                          Default product
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={SIGNER_TINT[mode.whoSigns] ?? ""}
                  >
                    {SIGNER_LABEL[mode.whoSigns] ?? mode.whoSigns}
                  </Badge>
                </div>
                <p className="text-sm text-foreground/90">{mode.whatRuns}</p>
                {!isLast && (
                  <ChevronRight
                    className="pointer-events-none absolute -bottom-3 left-4 size-5 rotate-90 text-muted-foreground"
                    aria-hidden
                  />
                )}
              </li>
            );
          })}
        </ol>

        {/* Desktop: horizontal staircase */}
        <ol
          className="hidden md:flex md:items-stretch md:gap-2"
          aria-label="Mode ladder, lowest to highest (horizontal)"
        >
          {modes.map((mode, i) => {
            const isLast = i === modes.length - 1;
            return (
              <li
                key={mode.key}
                className="flex flex-1 flex-col gap-3"
              >
                <div
                  className={`flex h-full flex-col gap-3 rounded-lg border p-4 ${STEP_ACCENT[i] ?? "bg-muted/40"}`}
                >
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <h3 className="font-mono text-base font-semibold">
                        {mode.name}
                      </h3>
                    </div>
                    {mode.defaultFor === "confirm" && (
                      <Badge
                        variant="outline"
                        className="w-fit bg-allow/10 text-allow-foreground"
                      >
                        Default product
                      </Badge>
                    )}
                  </div>
                  <Separator />
                  <p className="flex-1 text-sm text-foreground/90">
                    {mode.whatRuns}
                  </p>
                  <Badge
                    variant="outline"
                    className={`w-fit ${SIGNER_TINT[mode.whoSigns] ?? ""}`}
                  >
                    {SIGNER_LABEL[mode.whoSigns] ?? mode.whoSigns}
                  </Badge>
                </div>
                {!isLast && (
                  <ArrowRight
                    className="mx-auto mt-2 size-4 text-muted-foreground"
                    aria-hidden
                  />
                )}
              </li>
            );
          })}
        </ol>

        <div className="mt-4 flex items-start gap-2 rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="mt-0.5 size-4 shrink-0 cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              House mode uses the same grants as Rules. AI cannot widen the
              grant. If the AI is down, the account falls back to Rules or
              Confirm, never to an open order book.
            </TooltipContent>
          </Tooltip>
          <p>
            The ladder is enforced by <code>canTransition</code> in
            <code> src/server/domain/modes.ts</code>. Up-moves return
            <code> false</code> from the pure function; the confirmation flow
            lives in the BFF / DB layer.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
