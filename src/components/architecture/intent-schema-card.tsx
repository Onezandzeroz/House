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
import type { IntentSchemaCardProps } from "./types";

// ---------------------------------------------------------------------------
// Intent schema — the only executable shape (plan §3). The contract the
// later AI service plugs into. Model output is never executed as text —
// only the intent schema is executable.
//
// Layout: a contract / spec card. The fields are listed in a definition
// list; the proposer-chosen fields are plain rows; the engine-set fields
// (origin, status, id, bookId) are tagged "set by engine" so the reader
// knows which fields they don't choose.
// ---------------------------------------------------------------------------

const ENGINE_SET = new Set(["origin", "status", "id", "bookId"]);

export function IntentSchemaCard({ fields }: IntentSchemaCardProps) {
  return (
    <Card
      id="intent-schema"
      className="scroll-mt-20"
      aria-labelledby="intent-schema-title"
    >
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-muted-foreground">
            plan §3
          </Badge>
          <Badge variant="outline" className="text-muted-foreground">
            src/server/domain/intent.ts
          </Badge>
          <Badge variant="outline" className="text-muted-foreground">
            docs/intent-schema.md
          </Badge>
        </div>
        <CardTitle id="intent-schema-title" className="font-serif text-2xl">
          Intent schema — the executable contract
        </CardTitle>
        <CardDescription>
          The intent is the only shape the AI may emit, the policy engine
          accepts, and the signer may sign. Everything else — natural language,
          model reasoning, free-form JSON — is non-executable text. It goes
          into the decision log as rationale. It never reaches the signer.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border bg-muted/20">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2">
            <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              type Intent = z.infer&lt;typeof IntentSchema&gt;
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {fields.length} fields
            </span>
          </div>
          <dl className="divide-y">
            {fields.map((f) => {
              const engineSet = ENGINE_SET.has(f.field);
              return (
                <div
                  key={f.field}
                  className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[200px_80px_1fr] sm:gap-3"
                >
                  <dt className="flex items-center gap-2">
                    <code className="font-mono text-sm font-semibold">
                      {f.field}
                    </code>
                    {engineSet && (
                      <Badge
                        variant="outline"
                        className="bg-muted text-muted-foreground"
                      >
                        set by engine
                      </Badge>
                    )}
                  </dt>
                  <dd className="font-mono text-xs text-muted-foreground sm:py-0.5">
                    {f.type}
                  </dd>
                  <dd className="text-sm text-foreground/90 leading-relaxed">
                    {f.meaning}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>

        <Separator className="my-4" />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-md border bg-allow/5 p-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-allow-foreground">
              AI may emit
            </h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Only this schema. Any other text goes into the decision log as
              rationale, never into execution.
            </p>
          </div>
          <div className="rounded-md border bg-allow/5 p-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-allow-foreground">
              Policy accepts
            </h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Each intent runs the 8-check gate. The engine may allow, resize,
              or reject. It treats AI, rules, and user origins identically.
            </p>
          </div>
          <div className="rounded-md border bg-allow/5 p-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-allow-foreground">
              Signer signs
            </h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Only intents with verdict <code>allow</code> or a resized
              <code> resize</code>. The signer refuses a reject verdict.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
