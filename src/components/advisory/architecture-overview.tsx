"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import type { ArchitectureOverviewProps } from "./types";

import { FoundationStatusBanner } from "@/components/architecture/foundation-status";
import { NonCustodyCard } from "@/components/architecture/non-custody-card";
import { ModeLadder } from "@/components/architecture/mode-ladder";
import { PolicyGate } from "@/components/architecture/policy-gate";
import { PhaseProgress } from "@/components/architecture/phase-progress";
import {
  ServiceMap,
  DataModelTable,
  IntentSchemaCard,
} from "@/components/architecture";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Server, Database, FileCode2 } from "lucide-react";

/**
 * ArchitectureOverview — the SECONDARY tab on the new Advisory
 * Dashboard page.
 *
 * Wraps the existing Task 3 foundation components in a single
 * container so the page can mount either tab without conditional
 * logic. The components themselves are untouched — they already work
 * in dark mode (the new design tokens land automatically through
 * `globals.css`). Their color updates (replacing hardcoded
 * `bg-emerald-500/10` with the new `bg-allow/10 text-allow-foreground`
 * token classes) are done in their own files; see the Task 9 worklog
 * for the list of color-only edits.
 *
 * Plan coverage:
 *   - plan §6: services surface (ServiceMap).
 *   - plan §7: data model (DataModelTable).
 *   - plan §3: intent schema (IntentSchemaCard).
 *   - docs/build-phases.md: phase strip (PhaseProgress).
 */

export function ArchitectureOverview({ foundation }: ArchitectureOverviewProps) {
  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <FoundationStatusBanner
        product={foundation.product}
        phase={foundation.phase}
      />

      {/* Headline promise — first content card. */}
      <NonCustodyCard nonCustody={foundation.nonCustody} />

      {/* The ladder — how the product scales read-only to AI. */}
      <ModeLadder modes={foundation.modes} />

      {/* The gate — why the AI is safe to add later. */}
      <PolicyGate checks={foundation.policyGate} />

      {/* Reference material — wrapped in Tabs so the page does not get
          too tall on mobile. Three tabs: services, data model, intent
          schema. Each renders its own card. */}
      <Tabs defaultValue="services" className="w-full">
        <Card
          id="reference-material"
          className="scroll-mt-24"
          aria-labelledby="reference-title"
        >
          <CardHeader className="gap-3 p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-muted-foreground">
                reference material
              </Badge>
              <Badge
                variant="outline"
                className="bg-primary/10 text-primary-foreground border-primary/40"
              >
                contract surface
              </Badge>
            </div>
            <CardTitle
              id="reference-title"
              className="font-serif text-2xl font-bold tracking-tight"
            >
              Reference material
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              The contract surface: services, data model, intent schema. Each
              is a source of truth for a different reader.
            </p>
            <Separator className="house-hairline" />
            <TabsList aria-label="Reference material" className="mt-1">
              <TabsTrigger value="services" className="gap-1.5">
                <Server className="size-3.5" aria-hidden />
                Services
              </TabsTrigger>
              <TabsTrigger value="data" className="gap-1.5">
                <Database className="size-3.5" aria-hidden />
                Data model
              </TabsTrigger>
              <TabsTrigger value="intent" className="gap-1.5">
                <FileCode2 className="size-3.5" aria-hidden />
                Intent schema
              </TabsTrigger>
            </TabsList>
          </CardHeader>
          <CardContent className="p-0 pt-0">
            <TabsContent value="services" className="mt-0 px-6 pb-6">
              <ServiceMap services={foundation.services} />
            </TabsContent>
            <TabsContent value="data" className="mt-0 px-6 pb-6">
              <DataModelTable models={foundation.dataModel} />
            </TabsContent>
            <TabsContent value="intent" className="mt-0 px-6 pb-6">
              <IntentSchemaCard fields={foundation.intentShape} />
            </TabsContent>
          </CardContent>
        </Card>
      </Tabs>

      <PhaseProgress current={foundation.phase.current} />
    </div>
  );
}
