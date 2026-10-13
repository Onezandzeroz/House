"use client";

import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowDown, ArrowUp, ArrowUpDown, Lock } from "lucide-react";
import type { DataModelTableProps } from "./types";

// ---------------------------------------------------------------------------
// Data model table — every Prisma model with a one-line purpose and the
// immutability flag. The three immutable rows (MandateVersion,
// EthicsListVersion, DecisionLogEntry) are the audit spine: any past
// decision can be replayed against the mandate version, the ethics list
// version, and the policy context snapshot that were live that day.
//
// Columns are sortable by model name and by immutable flag (click the
// column header). The Table component wraps the table in an overflow-x
// container so it stays usable on mobile.
// ---------------------------------------------------------------------------

type SortKey = "model" | "immutable" | "purpose";
type SortOrder = "asc" | "desc";

export function DataModelTable({ models }: DataModelTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("model");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

  const sorted = useMemo(() => {
    const copy = [...models];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "model") cmp = a.model.localeCompare(b.model);
      else if (sortKey === "immutable")
        cmp = Number(b.immutable) - Number(a.immutable);
      else cmp = a.purpose.localeCompare(b.purpose);
      return sortOrder === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [models, sortKey, sortOrder]);

  const toggle = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="size-3 opacity-40" aria-hidden />;
    }
    return sortOrder === "asc" ? (
      <ArrowUp className="size-3" aria-hidden />
    ) : (
      <ArrowDown className="size-3" aria-hidden />
    );
  };

  const headerBtnClass =
    "inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide transition-colors hover:text-foreground";

  return (
    <Card
      id="data-model"
      className="scroll-mt-20"
      aria-labelledby="data-model-title"
    >
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-muted-foreground">
            plan §7
          </Badge>
          <Badge variant="outline" className="text-muted-foreground">
            prisma/schema.prisma
          </Badge>
        </div>
        <CardTitle id="data-model-title" className="font-serif text-2xl">
          Data model — the audit spine
        </CardTitle>
        <CardDescription>
          {models.length} Prisma models. Click a column header to sort. The
          three immutable rows are versioned or append-only — a later replay
          can use them as the source of truth.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[28%]">
                <button
                  type="button"
                  onClick={() => toggle("model")}
                  className={headerBtnClass}
                  aria-label="Sort by model name"
                >
                  Model
                  {sortIcon("model")}
                </button>
              </TableHead>
              <TableHead className="w-[55%]">
                <button
                  type="button"
                  onClick={() => toggle("purpose")}
                  className={headerBtnClass}
                  aria-label="Sort by purpose"
                >
                  Purpose
                  {sortIcon("purpose")}
                </button>
              </TableHead>
              <TableHead className="w-[17%] text-right">
                <button
                  type="button"
                  onClick={() => toggle("immutable")}
                  className={`${headerBtnClass} ml-auto`}
                  aria-label="Sort by immutability"
                >
                  Immutable
                  {sortIcon("immutable")}
                </button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((m) => (
              <TableRow
                key={m.model}
                className={m.immutable ? "bg-allow/5" : undefined}
              >
                <TableCell className="font-mono text-sm font-medium">
                  {m.model}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {m.purpose}
                </TableCell>
                <TableCell className="text-right">
                  {m.immutable ? (
                    <Badge
                      variant="outline"
                      className="ml-auto gap-1 bg-allow/10 text-allow-foreground"
                    >
                      <Lock className="size-3" aria-hidden />
                      immutable
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="ml-auto text-muted-foreground"
                    >
                      mutable
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
