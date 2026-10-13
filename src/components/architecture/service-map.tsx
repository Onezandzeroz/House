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
import { CircleDashed, XCircle } from "lucide-react";
import type { ServiceMapProps } from "./types";

// ---------------------------------------------------------------------------
// Service map. Every service the foundation has scaffolded is a stub
// today — every impl throws `not-implemented: ...` so callers fail loudly.
// Cards are grouped in a responsive grid; each card carries:
//   - name (mono)
//   - phase badge (amber = not implemented yet)
//   - role
//   - never-does (with a ban icon)
//   - status badge (gray = stub)
// ---------------------------------------------------------------------------

export function ServiceMap({ services }: ServiceMapProps) {
  return (
    <Card
      id="service-map"
      className="scroll-mt-20"
      aria-labelledby="service-map-title"
    >
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-muted-foreground">
            plan §6
          </Badge>
          <Badge
            variant="outline"
            className="bg-warn/10 text-warn-foreground"
          >
            All stubs
          </Badge>
          <Badge variant="outline" className="text-muted-foreground">
            src/server/services/
          </Badge>
        </div>
        <CardTitle id="service-map-title" className="font-serif text-2xl">
          Services — what is scaffolded
        </CardTitle>
        <CardDescription>
          Each service is an interface contract today. Every implementation
          throws <code>not-implemented</code> so callers fail loudly. Real
          impls land per the phase schedule — Observe in Phase 1, paper policy
          in Phase 2, signer in Phase 3 / 4, AI house in Phase 5.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          role="list"
          aria-label="Foundation services"
        >
          {services.map((svc) => (
            <Card
              key={svc.name}
              role="listitem"
              className="gap-4 py-4 shadow-none"
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="font-mono text-base">
                    {svc.name}
                  </CardTitle>
                  <Badge
                    variant="outline"
                    className="shrink-0 bg-muted text-muted-foreground"
                  >
                    <CircleDashed className="size-3" />
                    stub
                  </Badge>
                </div>
                <Badge
                  variant="outline"
                  className="w-fit bg-warn/10 text-warn-foreground"
                >
                  {svc.phase}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Role
                  </h4>
                  <p className="mt-1 text-sm text-foreground/90 leading-relaxed">
                    {svc.role}
                  </p>
                </div>
                <Separator />
                <div>
                  <h4 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <XCircle className="size-3 text-reject-foreground" aria-hidden />
                    Never does
                  </h4>
                  <p className="mt-1 text-sm text-foreground/90 leading-relaxed">
                    {svc.neverDoes}
                  </p>
                </div>
                <Separator />
                <div className="font-mono text-xs text-muted-foreground">
                  impl: {svc.implRef}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
