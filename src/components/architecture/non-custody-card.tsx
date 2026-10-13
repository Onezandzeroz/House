"use client";

import {
  Shield,
  Lock,
  Key,
  Ban,
  Check,
  X,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { NonCustodyCardProps } from "./types";

// ---------------------------------------------------------------------------
// The four non-custody promises (plan §8 Phase 0 + docs/non-custody-statement.md).
// Each is a 2x2 cell with an icon, a short title, and a true/false state.
// The false values are the headline promise — they say what House never does.
// ---------------------------------------------------------------------------

type PromiseCell = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  detail: string;
  /** True when the promise is held (good); false when it would be a breach. */
  holds: boolean;
  /** Label to show under the icon — typically "Never" or "Scoped". */
  stateLabel: string;
  /** Tailwind classes for the icon background tint. */
  tint: string;
};

export function NonCustodyCard({ nonCustody }: NonCustodyCardProps) {
  const cells: PromiseCell[] = [
    {
      icon: Ban,
      title: "No seed phrases",
      detail:
        "House never holds seeds. Not at rest, not in transit, not in memory.",
      holds: !nonCustody.holdsSeeds,
      stateLabel: "Never",
      tint: "bg-allow/10 text-allow-foreground",
    },
    {
      icon: Shield,
      title: "No withdrawal keys",
      detail:
        "Trade keys are scoped trade-no-withdraw at minimum. Withdrawal is not in the scope the app can grant.",
      holds: !nonCustody.holdsWithdrawalKeys,
      stateLabel: "Never",
      tint: "bg-allow/10 text-allow-foreground",
    },
    {
      icon: Lock,
      title: "Trade keys scoped",
      detail:
        "Keys are scoped by mode. Wider scope requires a fresh confirmation. The DB stores a KMS reference, never the secret.",
      holds: nonCustody.tradeKeysScoped,
      stateLabel: "Scoped",
      tint: "bg-allow/10 text-allow-foreground",
    },
    {
      icon: Key,
      title: "AI cannot reach the signer",
      detail:
        "The AI service has no IAM path to the signer. Model output is never executed as text — only the intent schema is executable.",
      holds: !nonCustody.aiPathToSigner,
      stateLabel: "Isolated",
      tint: "bg-allow/10 text-allow-foreground",
    },
  ];

  return (
    <Card
      id="non-custody"
      className="scroll-mt-20"
      aria-labelledby="non-custody-title"
    >
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="bg-allow/10 text-allow-foreground"
          >
            Phase 0 deliverable
          </Badge>
          <Badge variant="outline" className="text-muted-foreground">
            docs/non-custody-statement.md
          </Badge>
        </div>
        <CardTitle id="non-custody-title" className="font-serif text-2xl">
          Non-custody statement
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          The headline promise. v1 is owner-operated; the app is a tool, not a
          custodian. Every cell below is held by the foundation today.
        </p>
      </CardHeader>
      <CardContent>
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          role="list"
          aria-label="Non-custody promises"
        >
          {cells.map((cell) => {
            const Icon = cell.icon;
            return (
              <div
                key={cell.title}
                role="listitem"
                className="flex flex-col gap-3 rounded-lg border bg-card p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <div
                    className={`flex size-9 items-center justify-center rounded-md ${cell.tint}`}
                    aria-hidden
                  >
                    <Icon className="size-5" />
                  </div>
                  <Badge
                    variant="outline"
                    className={`gap-1 ${cell.tint}`}
                    aria-label={`${cell.stateLabel}: ${cell.holds ? "held" : "breached"}`}
                  >
                    {cell.holds ? (
                      <Check className="size-3" />
                    ) : (
                      <X className="size-3" />
                    )}
                    {cell.stateLabel}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-medium leading-tight">
                    {cell.title}
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {cell.detail}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
