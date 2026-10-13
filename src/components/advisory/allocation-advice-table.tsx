"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import type { AllocationAdviceTableProps } from "./types";
import type { AllocationAdvice } from "@/server/domain/advisory";

/**
 * AllocationAdviceTable — per-asset allocation advice (one row per
 * position).
 *
 * Columns: Asset | Risk category | Action | Current | Target | Delta |
 * Notional change (book currency) | Reason.
 *
 * Sortable on Current% and Delta% (asc/desc toggle). The table is
 * wrapped in a ScrollArea with max-h-96 so a long book does not blow
 * up the dashboard height.
 *
 * Action chip colors:
 *   add    → emerald (allow)
 *   reduce → amber   (warn)
 *   hold   → muted
 *   exit   → rose    (reject)
 *
 * Plan coverage:
 *   - owner direction (Task 6): "hvor mange, hvor store og i hvilke
 *     risiko kategori" — the per-asset rows are the precise answer.
 *   - src/server/domain/advisory.ts: AllocationAdvice.
 */

type SortKey = "current" | "delta" | "asset" | "target";
type SortOrder = "asc" | "desc";

const ACTION_META: Record<
  AllocationAdvice["action"],
  { chip: string; label: string }
> = {
  add: {
    chip: "bg-allow/15 text-allow-foreground border-allow/40",
    label: "add",
  },
  reduce: {
    chip: "bg-warn/15 text-warn-foreground border-warn/40",
    label: "reduce",
  },
  hold: {
    chip: "bg-muted text-muted-foreground border-border",
    label: "hold",
  },
  exit: {
    chip: "bg-reject/15 text-reject-foreground border-reject/40",
    label: "exit",
  },
};

const RISK_CHIP: Record<
  AllocationAdvice["riskCategory"],
  string
> = {
  stable: "bg-allow/10 text-allow-foreground border-allow/40",
  conservative: "bg-primary/10 text-primary-foreground border-primary/40",
  balanced: "bg-warn/10 text-warn-foreground border-warn/40",
  aggressive: "bg-reject/10 text-reject-foreground border-reject/40",
};

// A single sort-header cell. Hoisted out of the parent component so it
// is not re-created on every render (which would reset its state and
// trip the react-hooks/static-components lint rule).
function SortHeader({
  label,
  sortKey,
  activeKey,
  order,
  onToggle,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  order: SortOrder;
  onToggle: (key: SortKey) => void;
  align?: "left" | "right" | "center";
}) {
  const active = activeKey === sortKey;
  const Icon = !active || order === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onToggle(sortKey)}
      className={`inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider transition-colors hover:text-foreground ${
        align === "right"
          ? "justify-end"
          : align === "center"
            ? "justify-center"
            : "justify-start"
      } ${active ? "text-foreground" : "text-muted-foreground"}`}
    >
      {label}
      {active ? (
        <Icon className="size-3" aria-hidden />
      ) : (
        <ArrowUpDown className="size-3 opacity-50" aria-hidden />
      )}
    </button>
  );
}

export function AllocationAdviceTable({
  advice,
  bookCurrency,
}: AllocationAdviceTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("current");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const sorted = useMemo(() => {
    const arr = [...advice];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "asset") {
        cmp = a.assetId.localeCompare(b.assetId);
      } else if (sortKey === "current") {
        cmp = a.currentWeightBps - b.currentWeightBps;
      } else if (sortKey === "target") {
        cmp = a.targetWeightBps - b.targetWeightBps;
      } else if (sortKey === "delta") {
        cmp = a.deltaBps - b.deltaBps;
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [advice, sortKey, sortOrder]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortOrder("desc");
    }
  }

  return (
    <Card
      id="allocation-advice"
      className="scroll-mt-24"
      aria-labelledby="allocation-advice-title"
    >
      <CardHeader className="gap-3 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-muted-foreground">
            per-asset advice
          </Badge>
          <Badge
            variant="outline"
            className="bg-primary/10 text-primary-foreground border-primary/40"
          >
            <span className="house-num">{advice.length}</span> positions
          </Badge>
        </div>
        <CardTitle
          id="allocation-advice-title"
          className="font-serif text-2xl font-bold tracking-tight"
        >
          Allocation advice
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          One row per position. The advisor&apos;s proposal is rådgivning —
          it is not an executable intent. Each row becomes an intent only
          after the policy gate AND either the owner&apos;s approval
          (Confirm) or the Rules engine.
        </p>
        <Separator className="house-hairline" />
      </CardHeader>

      <CardContent className="p-0 pt-0">
        <ScrollArea className="max-h-96">
          <div className="px-4 pb-4 sm:px-6">
            <Table>
              <TableHeader>
                <TableRow className="border-border/60 hover:bg-transparent">
                  <TableHead className="text-xs">
                    <SortHeader
                      label="Asset"
                      sortKey="asset"
                      activeKey={sortKey}
                      order={sortOrder}
                      onToggle={toggleSort}
                    />
                  </TableHead>
                  <TableHead className="text-xs">Risk</TableHead>
                  <TableHead className="text-xs">Action</TableHead>
                  <TableHead className="text-xs">
                    <SortHeader
                      label="Current"
                      sortKey="current"
                      activeKey={sortKey}
                      order={sortOrder}
                      onToggle={toggleSort}
                      align="right"
                    />
                  </TableHead>
                  <TableHead className="text-xs text-right">Target</TableHead>
                  <TableHead className="text-xs">
                    <SortHeader
                      label="Delta"
                      sortKey="delta"
                      activeKey={sortKey}
                      order={sortOrder}
                      onToggle={toggleSort}
                      align="right"
                    />
                  </TableHead>
                  <TableHead className="text-xs text-right">
                    Notional
                  </TableHead>
                  <TableHead className="text-xs">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-6 text-center text-xs text-muted-foreground"
                    >
                      No positions held.
                    </TableCell>
                  </TableRow>
                )}
                {sorted.map((row) => {
                  const action = ACTION_META[row.action];
                  return (
                    <TableRow
                      key={row.assetId}
                      className="border-border/40 hover:bg-muted/30"
                    >
                      <TableCell className="font-mono text-sm font-semibold text-foreground">
                        {row.assetId}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${RISK_CHIP[row.riskCategory]}`}
                        >
                          {row.riskCategory}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${action.chip}`}
                        >
                          {action.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right house-num text-sm">
                        {(row.currentWeightBps / 100).toFixed(2)}%
                      </TableCell>
                      <TableCell className="text-right house-num text-sm text-muted-foreground">
                        {(row.targetWeightBps / 100).toFixed(2)}%
                      </TableCell>
                      <TableCell
                        className={`text-right house-num text-sm ${
                          row.deltaBps > 0
                            ? "text-allow-foreground"
                            : row.deltaBps < 0
                              ? "text-warn-foreground"
                              : "text-muted-foreground"
                        }`}
                      >
                        {row.deltaBps > 0 ? "+" : ""}
                        {(row.deltaBps / 100).toFixed(2)}%
                      </TableCell>
                      <TableCell className="text-right house-num text-sm">
                        <span className="text-muted-foreground">
                          {row.notionalChange}
                        </span>{" "}
                        <span className="text-[10px] text-muted-foreground">
                          {bookCurrency}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[18rem] text-xs text-muted-foreground">
                        {row.reason}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
