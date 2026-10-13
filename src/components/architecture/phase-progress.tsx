"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import type { PhaseProgressProps } from "./types";

// ---------------------------------------------------------------------------
// Phase strip — Phase 0 through Phase 6. The current phase is highlighted.
// The data is hard-coded from docs/build-phases.md (it is reference
// content; the docs are the source of truth, not a live lookup). Each
// step shows the phase number, the name, and the "done when" summary.
// ---------------------------------------------------------------------------

type Phase = {
  index: number;
  key: string;
  name: string;
  duration: string;
  doneWhen: string;
};

const PHASES: Phase[] = [
  {
    index: 0,
    key: "Phase 0 — Mandate & legal posture",
    name: "Mandate & legal posture",
    duration: "2 weeks",
    doneWhen:
      "Mandate schema + non-custody statement landed. A paper intent can be accepted or rejected and replayed.",
  },
  {
    index: 1,
    key: "Phase 1 — Observe",
    name: "Observe",
    duration: "4–6 weeks",
    doneWhen:
      "Two venues and two chains agree with a manual check within a stated tolerance.",
  },
  {
    index: 2,
    key: "Phase 2 — Paper book",
    name: "Policy & paper book",
    duration: "4 weeks",
    doneWhen:
      "A paper intent can be accepted or rejected and replayed. Paper decision log reviewed for a week.",
  },
  {
    index: 3,
    key: "Phase 3 — Confirm",
    name: "Confirm mode",
    duration: "4–6 weeks",
    doneWhen:
      "A capped rebalance fills and the lot ledger matches the venue.",
  },
  {
    index: 4,
    key: "Phase 4 — Rules",
    name: "Rules mode",
    duration: "4 weeks",
    doneWhen:
      "A drift event trades, and the kill switch stops the next one.",
  },
  {
    index: 5,
    key: "Phase 5 — AI house",
    name: "AI house service",
    duration: "not fixed",
    doneWhen:
      "The model can only emit the intent schema, and policy rejection rate is measured.",
  },
  {
    index: 6,
    key: "Phase 6 — Beneficiaries",
    name: "Beneficiaries & reporting",
    duration: "not fixed",
    doneWhen:
      "A beneficiary receives scheduled statements and a read-only view of the decision log; the owner remains the sole holder of the kill switch.",
  },
];

export function PhaseProgress({ current }: PhaseProgressProps) {
  // Mark Phase 0 done (foundation is landed) and Phase 1+ as pending.
  // The "current" indicator points at Phase 0; Phase 1 is "next".
  const CURRENT_INDEX = 0;

  return (
    <Card
      id="phase-progress"
      className="scroll-mt-20"
      aria-labelledby="phase-progress-title"
    >
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-muted-foreground">
            plan §8 · §11
          </Badge>
          <Badge variant="outline" className="text-muted-foreground">
            docs/build-phases.md
          </Badge>
        </div>
        <CardTitle id="phase-progress-title" className="font-serif text-2xl">
          Build phases — 0 to 6
        </CardTitle>
        <CardDescription>
          {current} is the live phase. The immediate next step (plan §13) is
          to stand up Observe against one exchange and one wallet. No trade
          key is connected until the paper decision log from Phase 2 has been
          reviewed for a week.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Horizontal strip */}
        <ol
          className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"
          aria-label="Build phases 0 through 6"
        >
          {PHASES.map((p) => {
            const isDone = p.index < CURRENT_INDEX;
            const isCurrent = p.index === CURRENT_INDEX;
            const isNext = p.index === CURRENT_INDEX + 1;
            return (
              <li
                key={p.index}
                className={[
                  "flex flex-col gap-1 rounded-md border p-3",
                  isCurrent
                    ? "border-allow/40 bg-allow/10"
                    : isNext
                      ? "border-warn/40 bg-warn/5"
                      : "bg-muted/20",
                ].join(" ")}
                aria-current={isCurrent ? "step" : undefined}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={[
                      "flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold",
                      isCurrent
                        ? "bg-allow/20 text-allow-foreground"
                        : isDone
                          ? "bg-allow/20 text-allow-foreground"
                          : "bg-muted text-muted-foreground",
                    ].join(" ")}
                  >
                    {isDone ? <Check className="size-3" aria-hidden /> : p.index}
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                    P{p.index}
                  </span>
                </div>
                <h3 className="text-sm font-semibold leading-tight">
                  {p.name}
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  {p.duration}
                </p>
                {isCurrent && (
                  <Badge
                    variant="outline"
                    className="mt-1 w-fit bg-allow/10 text-allow-foreground"
                  >
                    current
                  </Badge>
                )}
                {isNext && (
                  <Badge
                    variant="outline"
                    className="mt-1 w-fit bg-warn/10 text-warn-foreground"
                  >
                    next
                  </Badge>
                )}
              </li>
            );
          })}
        </ol>

        <div className="mt-4 rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
          <p>
            <span className="font-semibold">Build order for a small team:</span>{" "}
            two engineers can ship Observe and the paper policy. A third is
            useful once live orders exist. Do not hire for the AI seat until
            Phase 4 is in production.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
